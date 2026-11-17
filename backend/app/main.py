import base64
import binascii
import logging
import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator, Dict, Any

from fastapi import FastAPI, Request, status
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from app.api_routes import router as api_v1_router
from app.config import settings
from app.database import check_db_health, init_db
from app.embeddings import embedding_manager
from app.mcp_server import mount_mcp_transports
from app.worker import background_worker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("engram.main")


# ==============================================================================
# 1. Lifespan Management (SQLite WAL + sqlite-vec Init & Async Worker)
# ==============================================================================
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    init_info = init_db()
    logger.info("Engram storage initialized: %s", init_info)
    await background_worker.start()
    try:
        yield
    finally:
        await background_worker.stop()
        embedding_manager.release_local_model()


app = FastAPI(
    title="Engram — Agent Memory Hub",
    description="Single-Container AI Memory Engine with Dual-Transport MCP Server & sqlite-vec",
    version="1.0.0",
    lifespan=lifespan,
)


# ==============================================================================
# 2. Dual-Auth Security Middleware (Bearer for MCP, Basic Auth for Dashboard)
# ==============================================================================
def _verify_bearer_token(auth_header: str) -> bool:
    if not auth_header or not auth_header.lower().startswith("bearer "):
        return False
    provided_token = auth_header[7:].strip()
    expected_token = settings.mcp_api_key
    if not expected_token:
        return False
    return secrets.compare_digest(
        provided_token.encode("utf-8"), expected_token.encode("utf-8")
    )


def _verify_basic_auth(auth_header: str) -> bool:
    if not auth_header or not auth_header.lower().startswith("basic "):
        return False
    b64_part = auth_header[6:].strip()
    try:
        decoded = base64.b64decode(b64_part).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError):
        return False

    if ":" not in decoded:
        return False
    username, password = decoded.split(":", 1)
    user_ok = secrets.compare_digest(
        username.encode("utf-8"), settings.dashboard_user.encode("utf-8")
    )
    pass_ok = secrets.compare_digest(
        password.encode("utf-8"), settings.dashboard_pass.encode("utf-8")
    )
    return user_ok and pass_ok


@app.middleware("http")
async def dual_auth_security_middleware(
    request: Request, call_next: Any
) -> Response:
    """
    Enforces strict single-port (8080) authentication boundaries:
    1. `/health`: Public unauthenticated JSON endpoint for Docker healthchecks.
    2. `/mcp`, `/sse`, `/messages`: Protected by `Authorization: Bearer <MCP_API_KEY>`.
    3. `/api/v1/ingest`: Protected by Bearer Token (`MCP_API_KEY`) OR HTTP Basic Auth.
    4. `/api/v1/*` and `/*` (React SPA): Protected by HTTP Basic Auth (`DASHBOARD_USER` / `DASHBOARD_PASS`).
    """
    path = request.url.path

    # 1. Public Docker Healthcheck
    if path == "/health":
        return await call_next(request)

    auth_header = request.headers.get("Authorization", "")

    # 2. MCP Transports (/mcp, /sse, /messages) -> Bearer Token Required
    if (
        path == "/mcp"
        or path.startswith("/mcp/")
        or path == "/sse"
        or path.startswith("/sse/")
        or path == "/messages"
        or path.startswith("/messages/")
    ):
        if not _verify_bearer_token(auth_header):
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={
                    "error": "Unauthorized",
                    "detail": "Valid Bearer token (MCP_API_KEY) required for MCP transport.",
                },
                headers={"WWW-Authenticate": "Bearer"},
            )
        return await call_next(request)

    # 3. Auto-Ingest Webhook (/api/v1/ingest) -> Bearer OR Basic Auth
    if path == "/api/v1/ingest" or path == "/api/v1/ingest/":
        if not (_verify_bearer_token(auth_header) or _verify_basic_auth(auth_header)):
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={
                    "error": "Unauthorized",
                    "detail": "Valid Bearer token or Basic Auth credentials required for /api/v1/ingest.",
                },
                headers={"WWW-Authenticate": 'Bearer, Basic realm="Engram"'},
            )
        return await call_next(request)

    # 4. Dashboard REST API (/api/v1/*) & Compiled React SPA (/*) -> Basic Auth
    if not _verify_basic_auth(auth_header):
        return Response(
            content="Unauthorized: Engram Dashboard credentials required.",
            status_code=status.HTTP_401_UNAUTHORIZED,
            headers={"WWW-Authenticate": 'Basic realm="Engram Developer Console"'},
        )

    return await call_next(request)


# ==============================================================================
# 3. Route Registration Order (BEFORE SPA Catch-All per AGENTS.md Rule 4)
# ==============================================================================
@app.get("/health", tags=["System"])
async def healthcheck() -> JSONResponse:
    health = check_db_health()
    code = (
        status.HTTP_200_OK
        if health.get("status") == "ok"
        else status.HTTP_503_SERVICE_UNAVAILABLE
    )
    return JSONResponse(
        status_code=code,
        content={
            "application": "Engram",
            **health,
            "queue_depth": background_worker.queue_depth,
        },
    )


# Mount Dual MCP Transports (/mcp, /sse, /messages)
mount_mcp_transports(app)

# Mount Dashboard & Ingest REST API (/api/v1/*)
app.include_router(api_v1_router)


# ==============================================================================
# 4. Static React SPA Serving (Zero Jinja2 / Pure StaticFiles + FileResponse)
# ==============================================================================
STATIC_ROOT = Path(settings.static_dir)
ASSETS_DIR = STATIC_ROOT / "assets"

if ASSETS_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="static-assets")


@app.get("/{full_path:path}", include_in_schema=False)
async def serve_react_spa(full_path: str) -> Response:
    """
    Serves static files from `/app/static` or falls back to `static/index.html`
    for client-side SPA routing without any template engine.
    """
    if full_path:
        candidate = (STATIC_ROOT / full_path).resolve()
        # Prevent path traversal outside STATIC_ROOT
        if (
            str(candidate).startswith(str(STATIC_ROOT.resolve()))
            and candidate.is_file()
        ):
            return FileResponse(str(candidate))

    index_file = STATIC_ROOT / "index.html"
    if index_file.is_file():
        return FileResponse(str(index_file))

    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={
            "application": "Engram — Agent Memory Hub",
            "status": "running",
            "mcp_streamable_http": "/mcp",
            "mcp_legacy_sse": "/sse",
            "api_v1": "/api/v1/stats",
            "health": "/health",
        },
    )
