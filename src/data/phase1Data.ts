import type { Phase1FileEntry, SchemaTableInfo } from '../utils/phase1Logic';

export const PHASE_1_FILES: Phase1FileEntry[] = [
  {
    id: 'dockerfile',
    phase: 1,
    path: 'Dockerfile',
    category: 'Container & Infra',
    language: 'dockerfile',
    summaryEn:
      'Multi-stage single-container build: Stage 1 (node:20-alpine) compiles the React SPA into static assets; Stage 2 (python:3.12-slim) runs FastAPI + Uvicorn (PID 1) on port 8080 with sqlite-vec and /health curl check.',
    summaryId:
      'Build multi-stage satu container: Stage 1 (node:20-alpine) mengompilasi SPA React ke aset statis; Stage 2 (python:3.12-slim) menjalankan FastAPI + Uvicorn (PID 1) di port 8080 dengan sqlite-vec dan healthcheck /health.',
    content: `# ==============================================================================
# Stage 1: Build React SPA Frontend (Raycast / Linear Developer Console)
# ==============================================================================
FROM node:20-alpine AS frontend-builder

WORKDIR /build/frontend

# Copy package manifests first for layer caching
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund

# Copy frontend source and build production bundle
COPY frontend/ ./
RUN npm run build

# ==============================================================================
# Stage 2: Python 3.12 Slim Runtime (FastAPI + Dual MCP + sqlite-vec)
# ==============================================================================
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \\
    PYTHONUNBUFFERED=1 \\
    PIP_NO_CACHE_DIR=1 \\
    PIP_DISABLE_PIP_VERSION_CHECK=1 \\
    DB_PATH=/data/memory.db \\
    LOCAL_MODELS_DIR=/data/models \\
    PORT=8080

WORKDIR /app

# Install curl for container healthcheck and libgomp1 for optional ONNX runtime
RUN apt-get update && apt-get install -y --no-install-recommends \\
    curl \\
    ca-certificates \\
    libgomp1 \\
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy backend application source
COPY backend/app /app/app

# Copy compiled React SPA from Stage 1 into /app/static
COPY --from=frontend-builder /build/frontend/dist /app/static

# Ensure persistent volume directories exist (/data and /data/models)
RUN mkdir -p /data /data/models

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \\
    CMD curl -fsS http://localhost:8080/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]`,
  },
  {
    id: 'docker-compose',
    phase: 1,
    path: 'docker-compose.yml',
    category: 'Container & Infra',
    language: 'yaml',
    summaryEn:
      'Production Docker Compose service definition exposing port 8080, mounting ./memory-data:/data for persistent SQLite WAL + local ONNX model cache, and wiring 9Router LLM/Embedding defaults.',
    summaryId:
      'Definisi layanan Docker Compose produksi yang mengekspos port 8080, melakukan bind-mount ./memory-data:/data untuk SQLite WAL + cache model ONNX lokal, serta menghubungkan default LLM/Embedding 9Router.',
    content: `services:
  agent-memory:
    build:
      context: .
      dockerfile: Dockerfile
    image: agent-memory:latest
    container_name: agent-memory
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - ./memory-data:/data
    environment:
      DB_PATH: /data/memory.db
      LOCAL_MODELS_DIR: /data/models
      # Reasoning / Distillation LLM via 9Router or OpenAI-compatible provider
      LLM_BASE_URL: \${LLM_BASE_URL:-http://9router:20128/v1}
      LLM_API_KEY: \${ROUTER_API_KEY:-dummy-key}
      FAST_MODEL: \${FAST_MODEL:-gemini-2.5-flash}
      # Embedding Config (Default: External API = 0 MB local model RAM)
      EMBEDDING_MODE: \${EMBEDDING_MODE:-external}
      EMBEDDING_BASE_URL: \${EMBEDDING_BASE_URL:-http://9router:20128/v1}
      EMBEDDING_API_KEY: \${ROUTER_API_KEY:-dummy-key}
      EMBEDDING_MODEL: \${EMBEDDING_MODEL:-text-embedding-3-small}
      EMBEDDING_DIMENSION: \${EMBEDDING_DIMENSION:-1536}
      LOCAL_EMBEDDING_MODEL: \${LOCAL_EMBEDDING_MODEL:-intfloat/multilingual-e5-small}
      # Feature Flags & Dual-Auth Credentials
      ENABLE_INGEST_WEBHOOK: \${ENABLE_INGEST_WEBHOOK:-false}
      MCP_API_KEY: \${MCP_API_KEY:-sk-mem-hermes-secret}
      DASHBOARD_USER: \${DASHBOARD_USER:-admin}
      DASHBOARD_PASS: \${DASHBOARD_PASS:-admin123}
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8080/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s`,
  },
  {
    id: 'env-example',
    phase: 1,
    path: '.env.example',
    category: 'Environment & Deps',
    language: 'ini',
    summaryEn:
      'Complete environment template covering SQLite DB path, 9Router LLM distillation endpoint, Zero-RAM external vs. local embedding configuration, webhook gate, and Dual-Auth credentials.',
    summaryId:
      'Template environment lengkap mencakup path DB SQLite, endpoint distilasi LLM 9Router, konfigurasi embedding eksternal Zero-RAM vs lokal, gerbang webhook, dan kredensial Dual-Auth.',
    content: `# ==============================================================================
# Agent Memory Hub — Environment Configuration (.env.example)
# ==============================================================================

# 1. Storage & Model Cache Paths (inside container bind-mounted to ./memory-data)
DB_PATH=/data/memory.db
LOCAL_MODELS_DIR=/data/models

# 2. Reasoning, Smart Merge & Context Distillation LLM (OpenAI-Compatible / 9Router)
LLM_BASE_URL=http://9router:20128/v1
LLM_API_KEY=dummy-key
FAST_MODEL=gemini-2.5-flash
ROUTER_API_KEY=dummy-key

# 3. Embedding Engine Configuration
# Mode: "external" (0 MB local model RAM) or "local" (Lazy FastEmbed ONNX in /data/models)
EMBEDDING_MODE=external
EMBEDDING_BASE_URL=http://9router:20128/v1
EMBEDDING_API_KEY=dummy-key
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSION=1536
LOCAL_EMBEDDING_MODEL=intfloat/multilingual-e5-small

# 4. Feature Flags
ENABLE_INGEST_WEBHOOK=false

# 5. Security & Dual-Auth Boundary
# Bearer Token for /mcp, /sse, /messages, and /api/v1/ingest
MCP_API_KEY=sk-mem-hermes-secret

# HTTP Basic Auth for Web Observability Dashboard (/* and /api/v1/*)
DASHBOARD_USER=admin
DASHBOARD_PASS=admin123`,
  },
  {
    id: 'requirements',
    phase: 1,
    path: 'backend/requirements.txt',
    category: 'Environment & Deps',
    language: 'ini',
    summaryEn:
      'Pinned Python dependencies locking mcp>=1.2.0,<2.0.0 for Dual-Transport FastMCP compatibility, sqlite-vec==0.1.6, FastAPI, Uvicorn, httpx, and fastembed.',
    summaryId:
      'Dependensi Python terkunci pada mcp>=1.2.0,<2.0.0 untuk kompatibilitas Dual-Transport FastMCP, sqlite-vec==0.1.6, FastAPI, Uvicorn, httpx, dan fastembed.',
    content: `fastapi==0.115.12
uvicorn[standard]==0.34.0
mcp>=1.2.0,<2.0.0
sqlite-vec==0.1.6
httpx==0.28.1
pydantic==2.10.6
pydantic-settings==2.8.1
python-dotenv==1.0.1
fastembed==0.6.0`,
  },
  {
    id: 'config-py',
    phase: 1,
    path: 'backend/app/config.py',
    category: 'Core Storage Engine',
    language: 'python',
    summaryEn:
      'Pydantic configuration manager (AppConfig) with environment defaults, live SQLite settings table synchronization (apply_db_overrides), and secret-masked serialization for Dashboard Settings.',
    summaryId:
      'Manajer konfigurasi Pydantic (AppConfig) dengan default environment, sinkronisasi langsung tabel settings SQLite (apply_db_overrides), dan serialisasi penyamaran rahasia untuk Dashboard Settings.',
    content: `import os
from typing import Any, Dict, Literal
from dotenv import load_dotenv
from pydantic import BaseModel, Field

load_dotenv()

EmbeddingMode = Literal["external", "local"]


def _parse_bool(val: str | bool | None, default: bool = False) -> bool:
    if isinstance(val, bool):
        return val
    if val is None:
        return default
    return str(val).strip().lower() in ("1", "true", "yes", "on")


class AppConfig(BaseModel):
    """
    Centralized configuration for Agent Memory Hub.
    Initialized from environment variables at startup and dynamically synchronized
    with persisted overrides from the SQLite \`settings\` table.
    """

    # Core Storage & Model Cache Paths
    db_path: str = Field(
        default_factory=lambda: os.getenv("DB_PATH", "/data/memory.db")
    )
    local_models_dir: str = Field(
        default_factory=lambda: os.getenv("LOCAL_MODELS_DIR", "/data/models")
    )
    static_dir: str = Field(
        default_factory=lambda: os.getenv("STATIC_DIR", "/app/static")
    )

    # Reasoning, Smart Deduplication & Context Distillation LLM
    llm_base_url: str = Field(
        default_factory=lambda: os.getenv("LLM_BASE_URL", "http://9router:20128/v1").rstrip("/")
    )
    llm_api_key: str = Field(
        default_factory=lambda: os.getenv(
            "LLM_API_KEY", os.getenv("ROUTER_API_KEY", "dummy-key")
        )
    )
    fast_model: str = Field(
        default_factory=lambda: os.getenv("FAST_MODEL", "gemini-2.5-flash")
    )

    # Embedding Engine (Default: "external" -> 0 MB local model RAM overhead)
    embedding_mode: EmbeddingMode = Field(
        default_factory=lambda: (
            "local"
            if os.getenv("EMBEDDING_MODE", "external").strip().lower() == "local"
            else "external"
        )
    )
    embedding_base_url: str = Field(
        default_factory=lambda: os.getenv(
            "EMBEDDING_BASE_URL", "http://9router:20128/v1"
        ).rstrip("/")
    )
    embedding_api_key: str = Field(
        default_factory=lambda: os.getenv(
            "EMBEDDING_API_KEY", os.getenv("ROUTER_API_KEY", "dummy-key")
        )
    )
    embedding_model: str = Field(
        default_factory=lambda: os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
    )
    embedding_dimension: int = Field(
        default_factory=lambda: int(os.getenv("EMBEDDING_DIMENSION", "1536"))
    )
    local_embedding_model: str = Field(
        default_factory=lambda: os.getenv(
            "LOCAL_EMBEDDING_MODEL", "intfloat/multilingual-e5-small"
        )
    )

    # Runtime Feature Flags
    enable_ingest_webhook: bool = Field(
        default_factory=lambda: _parse_bool(
            os.getenv("ENABLE_INGEST_WEBHOOK", "false"), default=False
        )
    )

    # Dual-Auth Security Credentials
    mcp_api_key: str = Field(
        default_factory=lambda: os.getenv("MCP_API_KEY", "sk-mem-hermes-secret")
    )
    dashboard_user: str = Field(
        default_factory=lambda: os.getenv("DASHBOARD_USER", "admin")
    )
    dashboard_pass: str = Field(
        default_factory=lambda: os.getenv("DASHBOARD_PASS", "admin123")
    )

    # Retrieval & Cognitive Thresholds
    dedup_cosine_threshold: float = Field(default=0.85)
    recency_decay_lambda: float = Field(default=0.03)

    # Keys allowed to be persisted and overridden via the SQLite \`settings\` table
    RUNTIME_MUTABLE_KEYS: tuple[str, ...] = (
        "llm_base_url",
        "llm_api_key",
        "fast_model",
        "embedding_mode",
        "embedding_base_url",
        "embedding_api_key",
        "embedding_model",
        "embedding_dimension",
        "local_embedding_model",
        "enable_ingest_webhook",
    )

    def apply_db_overrides(self, db_settings: Dict[str, str]) -> None:
        """
        Applies persisted key-value pairs from the SQLite \`settings\` table
        onto the live configuration instance.
        """
        if "llm_base_url" in db_settings and db_settings["llm_base_url"].strip():
            self.llm_base_url = db_settings["llm_base_url"].strip().rstrip("/")
        if "llm_api_key" in db_settings and db_settings["llm_api_key"].strip():
            self.llm_api_key = db_settings["llm_api_key"].strip()
        if "fast_model" in db_settings and db_settings["fast_model"].strip():
            self.fast_model = db_settings["fast_model"].strip()
        if "embedding_mode" in db_settings:
            mode_val = db_settings["embedding_mode"].strip().lower()
            if mode_val in ("external", "local"):
                self.embedding_mode = mode_val  # type: ignore[assignment]
        if (
            "embedding_base_url" in db_settings
            and db_settings["embedding_base_url"].strip()
        ):
            self.embedding_base_url = (
                db_settings["embedding_base_url"].strip().rstrip("/")
            )
        if (
            "embedding_api_key" in db_settings
            and db_settings["embedding_api_key"].strip()
        ):
            self.embedding_api_key = db_settings["embedding_api_key"].strip()
        if "embedding_model" in db_settings and db_settings["embedding_model"].strip():
            self.embedding_model = db_settings["embedding_model"].strip()
        if "embedding_dimension" in db_settings:
            try:
                dim = int(db_settings["embedding_dimension"])
                if dim > 0:
                    self.embedding_dimension = dim
            except ValueError:
                pass
        if (
            "local_embedding_model" in db_settings
            and db_settings["local_embedding_model"].strip()
        ):
            self.local_embedding_model = db_settings["local_embedding_model"].strip()
        if "enable_ingest_webhook" in db_settings:
            self.enable_ingest_webhook = _parse_bool(
                db_settings["enable_ingest_webhook"],
                default=self.enable_ingest_webhook,
            )

    def to_public_dict(self, mask_secrets: bool = True) -> Dict[str, Any]:
        """
        Serializes current runtime configuration for the Dashboard Settings API.
        Masks API keys when \`mask_secrets=True\`.
        """
        def _mask(secret: str) -> str:
            if not secret:
                return ""
            if len(secret) <= 6:
                return "***"
            return f"{secret[:3]}...{secret[-3:]}"

        return {
            "db_path": self.db_path,
            "local_models_dir": self.local_models_dir,
            "llm_base_url": self.llm_base_url,
            "llm_api_key": _mask(self.llm_api_key) if mask_secrets else self.llm_api_key,
            "llm_api_key_configured": bool(self.llm_api_key),
            "fast_model": self.fast_model,
            "embedding_mode": self.embedding_mode,
            "embedding_base_url": self.embedding_base_url,
            "embedding_api_key": (
                _mask(self.embedding_api_key)
                if mask_secrets
                else self.embedding_api_key
            ),
            "embedding_api_key_configured": bool(self.embedding_api_key),
            "embedding_model": self.embedding_model,
            "embedding_dimension": self.embedding_dimension,
            "local_embedding_model": self.local_embedding_model,
            "enable_ingest_webhook": self.enable_ingest_webhook,
            "dedup_cosine_threshold": self.dedup_cosine_threshold,
            "recency_decay_lambda": self.recency_decay_lambda,
        }


# Singleton configuration instance shared across the process
settings = AppConfig()`,
  },
  {
    id: 'database-py',
    phase: 1,
    path: 'backend/app/database.py',
    category: 'Core Storage Engine',
    language: 'python',
    summaryEn:
      'Embedded SQLite + sqlite-vec engine configuring WAL mode, foreign keys, float32 binary packing, all 5 core tables + vec_memories virtual table, dynamic dimension recreation, and /health verification.',
    summaryId:
      'Mesin SQLite + sqlite-vec tersemat yang mengonfigurasi mode WAL, foreign keys, pemaketan biner float32, 5 tabel inti + tabel virtual vec_memories, pembuatan ulang dimensi dinamis, dan verifikasi /health.',
    content: `import logging
import os
import re
import sqlite3
import struct
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional

import sqlite_vec

from app.config import settings

logger = logging.getLogger("agent_memory.database")

_db_lock = threading.RLock()


def utc_now_iso() -> str:
    """Returns current UTC timestamp in ISO-8601 format."""
    return datetime.now(timezone.utc).isoformat()


def serialize_f32(vector: List[float]) -> bytes:
    """Packs a list of floats into little-endian float32 bytes for sqlite-vec."""
    return struct.pack(f"<{len(vector)}f", *vector)


def deserialize_f32(blob: bytes) -> List[float]:
    """Unpacks little-endian float32 bytes from sqlite-vec into a list of floats."""
    count = len(blob) // 4
    return list(struct.unpack(f"<{count}f", blob))


def _ensure_parent_dirs(db_path: str) -> None:
    """Ensures the directory for \`/data/memory.db\` and \`/data/models\` exists."""
    if db_path != ":memory:":
        parent = Path(db_path).expanduser().resolve().parent
        parent.mkdir(parents=True, exist_ok=True)
    if settings.local_models_dir:
        try:
            Path(settings.local_models_dir).expanduser().resolve().mkdir(
                parents=True, exist_ok=True
            )
        except OSError:
            pass


def create_connection(db_path: Optional[str] = None) -> sqlite3.Connection:
    """
    Opens a SQLite connection with WAL mode, foreign keys, and \`sqlite-vec\`
    extension loaded.
    """
    target_path = db_path or settings.db_path
    _ensure_parent_dirs(target_path)

    conn = sqlite3.connect(target_path, timeout=30.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row

    # Load sqlite-vec C extension
    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)

    # Apply mandatory performance and integrity PRAGMAs
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.execute("PRAGMA busy_timeout=5000;")

    return conn


@contextmanager
def get_db(db_path: Optional[str] = None) -> Generator[sqlite3.Connection, None, None]:
    """
    Context manager providing a transactional SQLite connection with \`sqlite-vec\`.
    Automatically commits on success or rolls back on exception.
    """
    conn = create_connection(db_path)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


CORE_SCHEMA_SQL = """
-- 1. Core Memories Table (Semantic, Procedural, Episodic + Bi-Temporal + TTL)
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    workspace TEXT NOT NULL DEFAULT 'global',
    content TEXT NOT NULL,
    memory_type TEXT NOT NULL CHECK(memory_type IN ('semantic', 'procedural', 'episodic')),
    source TEXT NOT NULL DEFAULT 'agent_inferred' CHECK(source IN ('user_explicit', 'agent_inferred', 'tool_error', 'seed_import')),
    confidence REAL NOT NULL DEFAULT 0.85,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'superseded')),
    superseded_by TEXT REFERENCES memories(id) ON DELETE SET NULL,
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TEXT NOT NULL,
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_ws_status ON memories(workspace, status);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_memories_expires ON memories(expires_at);

-- 3. Lightweight Knowledge Graph (Entities & Edges)
CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    workspace TEXT NOT NULL DEFAULT 'global',
    name TEXT NOT NULL,
    entity_type TEXT NOT NULL DEFAULT 'concept',
    UNIQUE(workspace, name)
);

CREATE INDEX IF NOT EXISTS idx_entities_ws_name ON entities(workspace, name);

CREATE TABLE IF NOT EXISTS edges (
    id TEXT PRIMARY KEY,
    workspace TEXT NOT NULL DEFAULT 'global',
    source_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    relation TEXT NOT NULL,
    target_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    memory_id TEXT REFERENCES memories(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edges_ws ON edges(workspace);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
CREATE INDEX IF NOT EXISTS idx_edges_memory ON edges(memory_id);

-- 4. Runtime Configuration (Persisted overrides from Dashboard Settings)
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 5. Retrieval & Token Savings Telemetry
CREATE TABLE IF NOT EXISTS telemetry_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace TEXT NOT NULL,
    query TEXT NOT NULL,
    raw_tokens INTEGER NOT NULL,
    distilled_tokens INTEGER NOT NULL,
    latency_ms REAL NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telemetry_ws_created ON telemetry_logs(workspace, created_at);
"""


def _build_vec_table_sql(dimension: int) -> str:
    if dimension <= 0 or dimension > 8192:
        raise ValueError(f"Invalid embedding dimension: {dimension}")
    return f"""
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(
        memory_id TEXT PRIMARY KEY,
        embedding float[{int(dimension)}] distance_metric=cosine
    );
    """


def get_current_vec_dimension(conn: Optional[sqlite3.Connection] = None) -> int:
    """
    Inspects \`sqlite_master\` to determine the currently configured float[N]
    dimension of the \`vec_memories\` virtual table.
    """
    owns_conn = conn is None
    active_conn = conn or create_connection()
    try:
        row = active_conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='vec_memories'"
        ).fetchone()
        if not row or not row["sql"]:
            return settings.embedding_dimension
        match = re.search(r"float\\[(\\d+)\\]", row["sql"], re.IGNORECASE)
        if match:
            return int(match.group(1))
        return settings.embedding_dimension
    finally:
        if owns_conn:
            active_conn.close()


def recreate_vector_table(
    dimension: int, conn: Optional[sqlite3.Connection] = None
) -> int:
    """
    Drops and recreates the \`vec_memories\` virtual table with the new vector
    dimension and persists \`embedding_dimension\` in runtime settings.
    """
    if dimension <= 0 or dimension > 8192:
        raise ValueError(f"Invalid vector dimension: {dimension}")

    owns_conn = conn is None
    active_conn = conn or create_connection()
    with _db_lock:
        try:
            active_conn.execute("DROP TABLE IF EXISTS vec_memories;")
            active_conn.execute(_build_vec_table_sql(dimension))
            now = utc_now_iso()
            active_conn.execute(
                """
                INSERT INTO settings (key, value, updated_at)
                VALUES ('embedding_dimension', ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
                """,
                (str(dimension), now),
            )
            if owns_conn:
                active_conn.commit()
            settings.embedding_dimension = dimension
            logger.info(
                "Recreated vec_memories virtual table with dimension=%d", dimension
            )
            return dimension
        finally:
            if owns_conn:
                active_conn.close()


def get_all_runtime_settings(
    conn: Optional[sqlite3.Connection] = None,
) -> Dict[str, str]:
    """Reads all persisted key-value pairs from the \`settings\` table."""
    owns_conn = conn is None
    active_conn = conn or create_connection()
    try:
        rows = active_conn.execute("SELECT key, value FROM settings").fetchall()
        return {row["key"]: row["value"] for row in rows}
    finally:
        if owns_conn:
            active_conn.close()


def get_runtime_setting(
    key: str,
    default: Optional[str] = None,
    conn: Optional[sqlite3.Connection] = None,
) -> Optional[str]:
    """Reads a single setting value by key from the \`settings\` table."""
    owns_conn = conn is None
    active_conn = conn or create_connection()
    try:
        row = active_conn.execute(
            "SELECT value FROM settings WHERE key = ?", (key,)
        ).fetchone()
        return row["value"] if row else default
    finally:
        if owns_conn:
            active_conn.close()


def set_runtime_setting(
    key: str, value: Any, conn: Optional[sqlite3.Connection] = None
) -> None:
    """Upserts a single setting key-value pair and updates \`app.config.settings\`."""
    owns_conn = conn is None
    active_conn = conn or create_connection()
    str_val = (
        "true"
        if value is True
        else ("false" if value is False else str(value))
    )
    now = utc_now_iso()
    with _db_lock:
        try:
            active_conn.execute(
                """
                INSERT INTO settings (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
                """,
                (key, str_val, now),
            )
            if owns_conn:
                active_conn.commit()
            settings.apply_db_overrides({key: str_val})
        finally:
            if owns_conn:
                active_conn.close()


def set_runtime_settings_bulk(
    updates: Dict[str, Any], conn: Optional[sqlite3.Connection] = None
) -> Dict[str, str]:
    """Upserts multiple runtime settings atomically and syncs \`app.config.settings\`."""
    owns_conn = conn is None
    active_conn = conn or create_connection()
    now = utc_now_iso()
    normalized: Dict[str, str] = {}

    with _db_lock:
        try:
            for key, raw_val in updates.items():
                if key not in settings.RUNTIME_MUTABLE_KEYS or raw_val is None:
                    continue
                if isinstance(raw_val, bool):
                    str_val = "true" if raw_val else "false"
                else:
                    str_val = str(raw_val).strip()
                normalized[key] = str_val
                active_conn.execute(
                    """
                    INSERT INTO settings (key, value, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET
                        value = excluded.value,
                        updated_at = excluded.updated_at
                    """,
                    (key, str_val, now),
                )
            if owns_conn:
                active_conn.commit()
            settings.apply_db_overrides(normalized)
            return normalized
        finally:
            if owns_conn:
                active_conn.close()


def init_db(db_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Initializes \`/data/memory.db\` on startup:
    1. Enables WAL mode, NORMAL sync, and foreign keys.
    2. Loads \`sqlite-vec\`.
    3. Executes DDL for \`memories\`, \`entities\`, \`edges\`, \`settings\`, \`telemetry_logs\`.
    4. Loads any persisted runtime overrides from \`settings\` into \`app.config.settings\`.
    5. Creates \`vec_memories\` virtual table matching \`settings.embedding_dimension\`.
    """
    with _db_lock:
        with get_db(db_path) as conn:
            conn.executescript(CORE_SCHEMA_SQL)

            # Sync persisted settings from DB before creating vec_memories
            persisted = get_all_runtime_settings(conn)
            if persisted:
                settings.apply_db_overrides(persisted)

            # Ensure initial defaults are stored in settings table if not present
            now = utc_now_iso()
            default_seed = {
                "llm_base_url": settings.llm_base_url,
                "fast_model": settings.fast_model,
                "embedding_mode": settings.embedding_mode,
                "embedding_base_url": settings.embedding_base_url,
                "embedding_model": settings.embedding_model,
                "embedding_dimension": str(settings.embedding_dimension),
                "local_embedding_model": settings.local_embedding_model,
                "enable_ingest_webhook": (
                    "true" if settings.enable_ingest_webhook else "false"
                ),
            }
            for k, v in default_seed.items():
                if k not in persisted:
                    conn.execute(
                        """
                        INSERT INTO settings (key, value, updated_at)
                        VALUES (?, ?, ?)
                        ON CONFLICT(key) DO NOTHING
                        """,
                        (k, v, now),
                    )

            # Create vec_memories virtual table with active dimension
            conn.execute(_build_vec_table_sql(settings.embedding_dimension))
            active_dim = get_current_vec_dimension(conn)
            settings.embedding_dimension = active_dim

            vec_version_row = conn.execute("SELECT vec_version() AS v").fetchone()
            vec_version = vec_version_row["v"] if vec_version_row else "unknown"
            journal_mode_row = conn.execute("PRAGMA journal_mode;").fetchone()
            journal_mode = journal_mode_row[0] if journal_mode_row else "unknown"

            logger.info(
                "Initialized SQLite database at %s (journal_mode=%s, sqlite_vec=%s, vec_dim=%d)",
                db_path or settings.db_path,
                journal_mode,
                vec_version,
                active_dim,
            )

            return {
                "db_path": db_path or settings.db_path,
                "journal_mode": journal_mode,
                "sqlite_vec_version": vec_version,
                "vector_dimension": active_dim,
            }


def check_db_health(db_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Executes a lightweight read & extension check for the \`/health\` endpoint.
    """
    try:
        with get_db(db_path) as conn:
            vec_row = conn.execute("SELECT vec_version() AS v").fetchone()
            journal_row = conn.execute("PRAGMA journal_mode;").fetchone()
            count_row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM memories WHERE status = 'active'"
            ).fetchone()
            dim = get_current_vec_dimension(conn)
            return {
                "status": "ok",
                "database": "connected",
                "journal_mode": journal_row[0] if journal_row else "wal",
                "sqlite_vec_version": vec_row["v"] if vec_row else "loaded",
                "vector_dimension": dim,
                "active_memories": int(count_row["cnt"]) if count_row else 0,
            }
    except Exception as exc:
        logger.error("Database health check failed: %s", exc)
        return {
            "status": "error",
            "database": "disconnected",
            "detail": str(exc),
        }`,
  },
];

export const SCHEMA_TABLES: SchemaTableInfo[] = [
  {
    name: 'memories',
    kind: 'TABLE',
    primaryKey: 'id TEXT PRIMARY KEY',
    descriptionEn:
      'Bi-temporal semantic, procedural, and episodic memory store with workspace isolation, pinning, superseding lineage, and optional TTL.',
    descriptionId:
      'Penyimpanan memori semantik, prosedural, dan episodik bi-temporal dengan isolasi workspace, pin, riwayat superseding, dan TTL opsional.',
    columns: [
      { name: 'id', type: 'TEXT', constraints: 'PRIMARY KEY' },
      { name: 'workspace', type: 'TEXT', constraints: "NOT NULL DEFAULT 'global'" },
      { name: 'content', type: 'TEXT', constraints: 'NOT NULL' },
      {
        name: 'memory_type',
        type: 'TEXT',
        constraints: "CHECK(memory_type IN ('semantic', 'procedural', 'episodic'))",
      },
      {
        name: 'source',
        type: 'TEXT',
        constraints: "CHECK(source IN ('user_explicit', 'agent_inferred', 'tool_error', 'seed_import'))",
      },
      { name: 'confidence', type: 'REAL', constraints: 'NOT NULL DEFAULT 0.85' },
      { name: 'is_pinned', type: 'INTEGER', constraints: 'NOT NULL DEFAULT 0' },
      {
        name: 'status',
        type: 'TEXT',
        constraints: "NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'superseded'))",
      },
      { name: 'superseded_by', type: 'TEXT', constraints: 'REFERENCES memories(id) ON DELETE SET NULL' },
      { name: 'access_count', type: 'INTEGER', constraints: 'NOT NULL DEFAULT 0' },
      { name: 'last_accessed_at', type: 'TEXT', constraints: 'NOT NULL' },
      { name: 'valid_from', type: 'TEXT', constraints: 'NOT NULL' },
      { name: 'valid_to', type: 'TEXT', constraints: 'NULLABLE ISO-8601' },
      { name: 'expires_at', type: 'TEXT', constraints: 'NULLABLE ISO-8601 (TTL)' },
      { name: 'created_at', type: 'TEXT', constraints: 'NOT NULL' },
      { name: 'updated_at', type: 'TEXT', constraints: 'NOT NULL' },
    ],
    indexes: [
      'idx_memories_ws_status ON memories(workspace, status)',
      'idx_memories_type ON memories(memory_type)',
      'idx_memories_expires ON memories(expires_at)',
    ],
  },
  {
    name: 'vec_memories',
    kind: 'VIRTUAL TABLE (vec0)',
    primaryKey: 'memory_id TEXT PRIMARY KEY',
    descriptionEn:
      'Dynamic sqlite-vec virtual table storing little-endian float32 embeddings with cosine distance metric. Recreated automatically on dimension change.',
    descriptionId:
      'Tabel virtual sqlite-vec dinamis yang menyimpan embedding float32 little-endian dengan metrik jarak kosinus. Dibuat ulang otomatis saat dimensi berubah.',
    columns: [
      { name: 'memory_id', type: 'TEXT', constraints: 'PRIMARY KEY' },
      {
        name: 'embedding',
        type: 'float[1536]',
        constraints: 'distance_metric=cosine (Dynamic: 1536d / 384d / 768d)',
      },
    ],
    indexes: ['vec0 internal IVF/flat cosine index'],
  },
  {
    name: 'entities',
    kind: 'TABLE',
    primaryKey: 'id TEXT PRIMARY KEY',
    descriptionEn:
      'Knowledge graph nodes scoped by workspace with uniqueness constraint on (workspace, name).',
    descriptionId:
      'Node grafik pengetahuan yang diisolasi per workspace dengan constraint unik pada (workspace, name).',
    columns: [
      { name: 'id', type: 'TEXT', constraints: 'PRIMARY KEY' },
      { name: 'workspace', type: 'TEXT', constraints: "NOT NULL DEFAULT 'global'" },
      { name: 'name', type: 'TEXT', constraints: 'NOT NULL' },
      { name: 'entity_type', type: 'TEXT', constraints: "NOT NULL DEFAULT 'concept'" },
    ],
    indexes: ['UNIQUE(workspace, name)', 'idx_entities_ws_name ON entities(workspace, name)'],
  },
  {
    name: 'edges',
    kind: 'TABLE',
    primaryKey: 'id TEXT PRIMARY KEY',
    descriptionEn:
      '1-hop relational triples connecting source_id -> relation -> target_id with cascading foreign keys to entities and memories.',
    descriptionId:
      'Triple relasional 1-hop yang menghubungkan source_id -> relation -> target_id dengan foreign key cascade ke entities dan memories.',
    columns: [
      { name: 'id', type: 'TEXT', constraints: 'PRIMARY KEY' },
      { name: 'workspace', type: 'TEXT', constraints: "NOT NULL DEFAULT 'global'" },
      { name: 'source_id', type: 'TEXT', constraints: 'NOT NULL REFERENCES entities(id) ON DELETE CASCADE' },
      { name: 'relation', type: 'TEXT', constraints: 'NOT NULL' },
      { name: 'target_id', type: 'TEXT', constraints: 'NOT NULL REFERENCES entities(id) ON DELETE CASCADE' },
      { name: 'memory_id', type: 'TEXT', constraints: 'REFERENCES memories(id) ON DELETE CASCADE' },
      { name: 'created_at', type: 'TEXT', constraints: 'NOT NULL' },
    ],
    indexes: [
      'idx_edges_ws ON edges(workspace)',
      'idx_edges_source ON edges(source_id)',
      'idx_edges_target ON edges(target_id)',
      'idx_edges_memory ON edges(memory_id)',
    ],
  },
  {
    name: 'settings',
    kind: 'TABLE',
    primaryKey: 'key TEXT PRIMARY KEY',
    descriptionEn:
      'Persistent key-value store overriding environment defaults at runtime (LLM URL, Embedding Mode, Dimension, Ingest Webhook Flag).',
    descriptionId:
      'Penyimpanan key-value persisten yang menggantikan default environment saat runtime (URL LLM, Mode Embedding, Dimensi, Flag Webhook Ingest).',
    columns: [
      { name: 'key', type: 'TEXT', constraints: 'PRIMARY KEY' },
      { name: 'value', type: 'TEXT', constraints: 'NOT NULL' },
      { name: 'updated_at', type: 'TEXT', constraints: 'NOT NULL' },
    ],
    indexes: ['PRIMARY KEY (key)'],
  },
  {
    name: 'telemetry_logs',
    kind: 'TABLE',
    primaryKey: 'id INTEGER PRIMARY KEY AUTOINCREMENT',
    descriptionEn:
      'Tracks retrieval latency (ms) and Context Distiller compression efficiency (raw_tokens vs. distilled_tokens) per query.',
    descriptionId:
      'Melacak latensi pengambilan (ms) dan efisiensi kompresi Context Distiller (raw_tokens vs distilled_tokens) per kueri.',
    columns: [
      { name: 'id', type: 'INTEGER', constraints: 'PRIMARY KEY AUTOINCREMENT' },
      { name: 'workspace', type: 'TEXT', constraints: 'NOT NULL' },
      { name: 'query', type: 'TEXT', constraints: 'NOT NULL' },
      { name: 'raw_tokens', type: 'INTEGER', constraints: 'NOT NULL' },
      { name: 'distilled_tokens', type: 'INTEGER', constraints: 'NOT NULL' },
      { name: 'latency_ms', type: 'REAL', constraints: 'NOT NULL' },
      { name: 'created_at', type: 'TEXT', constraints: 'NOT NULL' },
    ],
    indexes: ['idx_telemetry_ws_created ON telemetry_logs(workspace, created_at)'],
  },
];
