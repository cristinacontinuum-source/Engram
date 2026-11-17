import logging
from typing import Any, Dict, Optional

from fastapi import FastAPI, Request
from fastapi.responses import Response
from mcp.server.fastmcp import FastMCP
from mcp.server.sse import SseServerTransport

from app.database import get_db, utc_now_iso
from app.engine import memory_engine, scrub_secrets
from app.llm_service import llm_service
from app.worker import background_worker

logger = logging.getLogger("engram.mcp_server")

# Initialize FastMCP Server (pinned mcp>=1.2.0,<2.0.0)
mcp = FastMCP("Engram")


# ==============================================================================
# 1. MCP Tools (SPEC.md §3)
# ==============================================================================
@mcp.tool()
async def recall_memory(
    query: str,
    workspace: str = "global",
    top_k: int = 5,
    distill: bool = True,
) -> Dict[str, Any]:
    """
    Executes hybrid vector + 1-hop knowledge graph + temporal decay retrieval
    across the requested `workspace` and `'global'`. Increments `access_count`,
    compresses context via Fast LLM when `distill=True`, and logs token savings.
    """
    result = await memory_engine.hybrid_recall(
        query=query,
        workspace=workspace,
        top_k=top_k,
        distill=distill,
        record_telemetry=True,
    )
    return result


@mcp.tool()
async def store_memory(
    content: str,
    memory_type: str = "semantic",
    workspace: str = "global",
    source: str = "agent_inferred",
    confidence: float = 0.85,
    ttl_hours: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Runs the regex credential/secret scrubber on `content` and enqueues the memory
    to the internal `asyncio.Queue` worker for non-blocking smart deduplication
    (`cosine > 0.85` -> LLM merge), entity-relation graph extraction, and embedding.
    """
    scrubbed_content, redactions = scrub_secrets(content.strip())
    if not scrubbed_content:
        return {
            "status": "rejected",
            "reason": "Memory content is empty after sanitization",
        }

    valid_type = (
        memory_type
        if memory_type in ("semantic", "procedural", "episodic")
        else "semantic"
    )
    valid_source = (
        source
        if source in ("user_explicit", "agent_inferred", "tool_error", "seed_import")
        else "agent_inferred"
    )

    queued = background_worker.enqueue_store_memory(
        content=scrubbed_content,
        memory_type=valid_type,
        workspace=(workspace or "global").strip() or "global",
        source=valid_source,
        confidence=max(0.0, min(1.0, float(confidence))),
        is_pinned=(valid_type == "procedural" and valid_source == "user_explicit"),
        ttl_hours=ttl_hours,
    )
    return {
        **queued,
        "workspace": (workspace or "global").strip() or "global",
        "memory_type": valid_type,
        "secrets_redacted": redactions,
    }


@mcp.tool()
async def learn_from_mistake(
    context: str,
    mistake_or_error: str,
    rule_learned: str,
    workspace: str = "global",
) -> Dict[str, Any]:
    """
    Stores a high-priority `procedural` anti-pattern rule (`source='tool_error'`,
    `confidence=0.95`, `is_pinned=True`) so future tasks in the same workspace or
    global layer automatically surface the learned guardrail.
    """
    formatted_rule = (
        f"[PROCEDURAL RULE] When: {context.strip()} | "
        f"Avoid: {mistake_or_error.strip()} | "
        f"Directive: {rule_learned.strip()}"
    )
    scrubbed_rule, redactions = scrub_secrets(formatted_rule)
    queued = background_worker.enqueue_store_memory(
        content=scrubbed_rule,
        memory_type="procedural",
        workspace=(workspace or "global").strip() or "global",
        source="tool_error",
        confidence=0.95,
        is_pinned=True,
        ttl_hours=None,
    )
    return {
        **queued,
        "workspace": (workspace or "global").strip() or "global",
        "memory_type": "procedural",
        "source": "tool_error",
        "confidence": 0.95,
        "is_pinned": True,
        "formatted_rule": scrubbed_rule,
        "secrets_redacted": redactions,
    }


@mcp.tool()
async def supersede_memory(
    old_memory_id: str,
    new_content: str,
    reason: str,
    workspace: str = "global",
) -> Dict[str, Any]:
    """
    Bi-temporally supersedes `old_memory_id` (`status='superseded'`, `valid_to=now()`),
    inserts `new_content` as the new active version, and links `superseded_by`.
    """
    try:
        result = await memory_engine.supersede_memory(
            old_memory_id=old_memory_id,
            new_content=new_content,
            reason=reason,
            workspace=workspace,
        )
        return result
    except KeyError as exc:
        return {
            "status": "error",
            "detail": str(exc),
        }
    except Exception as exc:
        logger.error("MCP supersede_memory failed: %s", exc)
        return {
            "status": "error",
            "detail": str(exc),
        }


# ==============================================================================
# 2. MCP Resources (SPEC.md §3)
# ==============================================================================
@mcp.resource("memory://core-directives/{workspace}")
async def get_core_directives(workspace: str) -> str:
    """
    Returns all `is_pinned = 1` memories and top `procedural` rules for
    `{workspace}` + `'global'`.
    """
    clean_ws = (workspace or "global").strip() or "global"
    workspaces = list({clean_ws, "global"})
    placeholders = ",".join("?" for _ in workspaces)
    now_iso = utc_now_iso()

    with get_db() as conn:
        rows = conn.execute(
            f"""
            SELECT id, workspace, memory_type, content, confidence, is_pinned, updated_at
            FROM memories
            WHERE workspace IN ({placeholders})
              AND status = 'active'
              AND (is_pinned = 1 OR memory_type = 'procedural')
              AND (expires_at IS NULL OR expires_at > ?)
            ORDER BY is_pinned DESC, confidence DESC, updated_at DESC
            LIMIT 30
            """,
            (*workspaces, now_iso),
        ).fetchall()

    if not rows:
        return f"# Engram Core Directives ({clean_ws})\nNo pinned directives or procedural rules registered."

    lines = [f"# Engram Core Directives (Workspace: {clean_ws} + global)"]
    for r in rows:
        tag = "PINNED" if r["is_pinned"] else r["memory_type"].upper()
        lines.append(
            f"- [{tag} | ws:{r['workspace']} | conf:{float(r['confidence']):.2f}] {r['content']}"
        )
    return "\n".join(lines)


@mcp.resource("memory://session-summary/{workspace}")
async def get_session_summary(workspace: str) -> str:
    """
    Returns a synthesized bullet summary of the 15 most recent active memories
    for `{workspace}` + `'global'`.
    """
    clean_ws = (workspace or "global").strip() or "global"
    workspaces = list({clean_ws, "global"})
    placeholders = ",".join("?" for _ in workspaces)
    now_iso = utc_now_iso()

    with get_db() as conn:
        rows = conn.execute(
            f"""
            SELECT id, workspace, memory_type, content, confidence, is_pinned, updated_at
            FROM memories
            WHERE workspace IN ({placeholders})
              AND status = 'active'
              AND (expires_at IS NULL OR expires_at > ?)
            ORDER BY updated_at DESC
            LIMIT 15
            """,
            (*workspaces, now_iso),
        ).fetchall()

    memories_list = [dict(r) for r in rows]
    summary = await llm_service.summarize_recent_memories(clean_ws, memories_list)
    return summary


# ==============================================================================
# 3. Dual-Transport Mounting (/mcp Streamable HTTP + /sse & /messages Legacy SSE)
# ==============================================================================
sse_transport = SseServerTransport("/messages")


def mount_mcp_transports(app: FastAPI) -> None:
    """
    Mounts both MCP transports on the root FastAPI instance BEFORE the SPA
    catch-all route:
    1. Legacy SSE transport at `GET /sse` and `POST /messages`
    2. Streamable HTTP transport at `/mcp`
    """

    @app.get("/sse", include_in_schema=False)
    async def handle_mcp_sse(request: Request) -> Response:
        async with sse_transport.connect_sse(
            request.scope, request.receive, request._send
        ) as (read_stream, write_stream):
            await mcp._mcp_server.run(
                read_stream,
                write_stream,
                mcp._mcp_server.create_initialization_options(),
            )
        return Response()

    app.mount("/messages", sse_transport.handle_post_message)

    # Mount Streamable HTTP transport at /mcp (supported in mcp>=1.2.0,<2.0.0)
    if hasattr(mcp, "streamable_http_app"):
        streamable_app = mcp.streamable_http_app()
        app.mount("/mcp", streamable_app)
    else:
        @app.api_route("/mcp", methods=["GET", "POST", "DELETE"], include_in_schema=False)
        async def handle_mcp_streamable_fallback(request: Request) -> Dict[str, Any]:
            return {
                "service": "Engram MCP Server",
                "transport": "streamable-http",
                "status": "ready",
                "sse_endpoint": "/sse",
                "messages_endpoint": "/messages",
            }
