import logging
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
    """Ensures the directory for `/data/memory.db` and `/data/models` exists."""
    if db_path != ":memory:":
        parent = Path(db_path).expanduser().resolve().parent
        parent.mkdir(parents=True, exist_ok=True)
    if settings.local_models_dir:
        try:
            Path(settings.local_models_dir).expanduser().resolve().mkdir(
                parents=True, exist_ok=True
            )
        except OSError:
            # Fallback if running outside container without /data permissions
            pass


def create_connection(db_path: Optional[str] = None) -> sqlite3.Connection:
    """
    Opens a SQLite connection with WAL mode, foreign keys, and `sqlite-vec`
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
    Context manager providing a transactional SQLite connection with `sqlite-vec`.
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
    Inspects `sqlite_master` to determine the currently configured float[N]
    dimension of the `vec_memories` virtual table.
    """
    owns_conn = conn is None
    active_conn = conn or create_connection()
    try:
        row = active_conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='vec_memories'"
        ).fetchone()
        if not row or not row["sql"]:
            return settings.embedding_dimension
        match = re.search(r"float\[(\d+)\]", row["sql"], re.IGNORECASE)
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
    Drops and recreates the `vec_memories` virtual table with the new vector
    dimension and persists `embedding_dimension` in runtime settings.
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
    """Reads all persisted key-value pairs from the `settings` table."""
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
    """Reads a single setting value by key from the `settings` table."""
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
    """Upserts a single setting key-value pair and updates `app.config.settings`."""
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
    """Upserts multiple runtime settings atomically and syncs `app.config.settings`."""
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
    Initializes `/data/memory.db` on startup:
    1. Enables WAL mode, NORMAL sync, and foreign keys.
    2. Loads `sqlite-vec`.
    3. Executes DDL for `memories`, `entities`, `edges`, `settings`, `telemetry_logs`.
    4. Loads any persisted runtime overrides from `settings` into `app.config.settings`.
    5. Creates `vec_memories` virtual table matching `settings.embedding_dimension`.
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
    Executes a lightweight read & extension check for the `/health` endpoint.
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
        }
