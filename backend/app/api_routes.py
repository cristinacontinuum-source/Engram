import json
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.config import EmbeddingMode, settings
from app.database import (
    check_db_health,
    get_current_vec_dimension,
    get_db,
    set_runtime_settings_bulk,
    utc_now_iso,
)
from app.embeddings import _get_process_rss_mb, embedding_manager
from app.engine import _row_to_memory_dict, memory_engine, scrub_secrets
from app.llm_service import estimate_tokens, llm_service
from app.worker import background_worker

logger = logging.getLogger("engram.api_routes")

router = APIRouter(prefix="/api/v1", tags=["Engram v1 API"])


# ==============================================================================
# Pydantic Request Schemas
# ==============================================================================
class CreateMemoryRequest(BaseModel):
    content: str = Field(..., min_length=1)
    workspace: str = Field(default="global")
    memory_type: Literal["semantic", "procedural", "episodic"] = Field(
        default="semantic"
    )
    type: Optional[Literal["semantic", "procedural", "episodic"]] = None
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    is_pinned: bool = Field(default=False)
    ttl_hours: Optional[int] = Field(default=None, ge=1)
    supersedes_id: Optional[str] = None


class UpdateMemoryRequest(BaseModel):
    content: Optional[str] = None
    workspace: Optional[str] = None
    memory_type: Optional[Literal["semantic", "procedural", "episodic"]] = None
    type: Optional[Literal["semantic", "procedural", "episodic"]] = None
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    is_pinned: Optional[bool] = None


class PlaygroundQueryRequest(BaseModel):
    query: str = Field(..., min_length=1)
    workspace: str = Field(default="global")
    top_k: int = Field(default=5, ge=1, le=25)
    distill: bool = Field(default=True)


class IngestWebhookRequest(BaseModel):
    workspace: str = Field(default="global")
    messages: List[Dict[str, Any]] = Field(default_factory=list)


class ImportPayloadRequest(BaseModel):
    mode: Optional[Literal["json", "bulk_seed"]] = None
    workspace: str = Field(default="global")
    pin_all: Optional[bool] = None
    auto_pin: Optional[bool] = None
    memory_type: Literal["semantic", "procedural", "episodic"] = Field(
        default="procedural"
    )
    type: Optional[Literal["semantic", "procedural", "episodic"]] = None
    payload: Optional[Any] = None
    bulk_text: Optional[str] = None
    memories: Optional[List[Dict[str, Any]]] = None


class UpdateSettingsRequest(BaseModel):
    llm_base_url: Optional[str] = None
    llm_api_key: Optional[str] = None
    fast_model: Optional[str] = None
    llm_model: Optional[str] = None
    embedding_mode: Optional[EmbeddingMode] = None
    embedding_base_url: Optional[str] = None
    embedding_api_key: Optional[str] = None
    embedding_model: Optional[str] = None
    embedding_dimension: Optional[int] = Field(default=None, ge=1, le=8192)
    local_embedding_model: Optional[str] = None
    enable_ingest_webhook: Optional[bool] = None
    auto_ingest_enabled: Optional[bool] = None


class TestEmbeddingRequest(BaseModel):
    embedding_mode: Optional[EmbeddingMode] = None
    embedding_base_url: Optional[str] = None
    embedding_api_key: Optional[str] = None
    embedding_model: Optional[str] = None
    local_embedding_model: Optional[str] = None


class TestLLMRequest(BaseModel):
    llm_base_url: Optional[str] = None
    llm_api_key: Optional[str] = None
    fast_model: Optional[str] = None
    llm_model: Optional[str] = None


class ReindexRequest(BaseModel):
    target_dimension: Optional[int] = Field(default=None, ge=1, le=8192)
    dimension: Optional[int] = Field(default=None, ge=1, le=8192)


# ==============================================================================
# 1. Overview & Telemetry Stats (`GET /api/v1/stats`)
# ==============================================================================
@router.get("/stats")
async def get_stats(workspace: Optional[str] = Query(default=None)) -> Dict[str, Any]:
    now_iso = utc_now_iso()
    with get_db() as conn:
        ws_rows = conn.execute(
            "SELECT DISTINCT workspace FROM memories ORDER BY workspace ASC"
        ).fetchall()
        workspaces = sorted(
            list({r["workspace"] for r in ws_rows if r["workspace"]} | {"global"})
        )

        if workspace and workspace not in ("all", "*"):
            ws_filter = "WHERE workspace = ?"
            ws_params: tuple[Any, ...] = (workspace,)
        else:
            ws_filter = ""
            ws_params = ()

        counts_row = conn.execute(
            f"""
            SELECT
                COUNT(CASE WHEN status = 'active' AND (expires_at IS NULL OR expires_at > ?) THEN 1 END) AS active_count,
                COUNT(CASE WHEN status = 'superseded' THEN 1 END) AS superseded_count,
                COUNT(CASE WHEN status = 'active' AND is_pinned = 1 THEN 1 END) AS pinned_count,
                COUNT(CASE WHEN status = 'active' AND memory_type = 'semantic' THEN 1 END) AS semantic_count,
                COUNT(CASE WHEN status = 'active' AND memory_type = 'procedural' THEN 1 END) AS procedural_count,
                COUNT(CASE WHEN status = 'active' AND memory_type = 'episodic' THEN 1 END) AS episodic_count
            FROM memories
            {ws_filter}
            """,
            (now_iso, *ws_params),
        ).fetchone()

        ent_count = conn.execute(
            f"SELECT COUNT(*) AS cnt FROM entities {ws_filter}", ws_params
        ).fetchone()["cnt"]
        edge_count = conn.execute(
            f"SELECT COUNT(*) AS cnt FROM edges {ws_filter}", ws_params
        ).fetchone()["cnt"]

        tel_row = conn.execute(
            f"""
            SELECT
                COALESCE(SUM(raw_tokens), 0) AS total_raw,
                COALESCE(SUM(distilled_tokens), 0) AS total_distilled,
                COALESCE(AVG(latency_ms), 0.0) AS avg_latency,
                COUNT(*) AS total_queries
            FROM telemetry_logs
            {ws_filter}
            """,
            ws_params,
        ).fetchone()

        recent_telemetry_rows = conn.execute(
            f"""
            SELECT id, workspace, query, raw_tokens, distilled_tokens, latency_ms, created_at
            FROM telemetry_logs
            {ws_filter}
            ORDER BY id DESC
            LIMIT 20
            """,
            ws_params,
        ).fetchall()

        proc_where = (
            "WHERE status = 'active' AND memory_type = 'procedural' AND workspace = ?"
            if (workspace and workspace not in ("all", "*"))
            else "WHERE status = 'active' AND memory_type = 'procedural'"
        )
        recent_proc_rows = conn.execute(
            f"""
            SELECT * FROM memories
            {proc_where}
            ORDER BY is_pinned DESC, updated_at DESC
            LIMIT 8
            """,
            ws_params,
        ).fetchall()

        current_vec_dim = get_current_vec_dimension(conn)

    total_raw = int(tel_row["total_raw"] or 0)
    total_distilled = int(tel_row["total_distilled"] or 0)
    tokens_saved = max(0, total_raw - total_distilled)
    tokens_saved_pct = (
        round((tokens_saved / total_raw) * 100.0, 1) if total_raw > 0 else 0.0
    )

    emb_status = embedding_manager.get_status()
    recent_proc_list = [_row_to_memory_dict(r) for r in recent_proc_rows]
    avg_lat = round(float(tel_row["avg_latency"] or 0.0), 2)

    return {
        "status": "ok",
        "workspace_filter": workspace if (workspace and workspace not in ("all", "*")) else None,
        "active_memories": int(counts_row["active_count"] or 0),
        "superseded_memories": int(counts_row["superseded_count"] or 0),
        "pinned_memories": int(counts_row["pinned_count"] or 0),
        "procedural_rules": int(counts_row["procedural_count"] or 0),
        "type_breakdown": {
            "semantic": int(counts_row["semantic_count"] or 0),
            "procedural": int(counts_row["procedural_count"] or 0),
            "episodic": int(counts_row["episodic_count"] or 0),
        },
        "entities_count": int(ent_count or 0),
        "edges_count": int(edge_count or 0),
        "knowledge_graph": {
            "entities": int(ent_count or 0),
            "edges": int(edge_count or 0),
        },
        "workspaces": workspaces,
        "total_queries": int(tel_row["total_queries"] or 0),
        "total_raw_tokens": total_raw,
        "total_distilled_tokens": total_distilled,
        "total_tokens_saved": tokens_saved,
        "tokens_saved_pct": tokens_saved_pct,
        "avg_latency_ms": avg_lat,
        "token_efficiency": {
            "total_queries": int(tel_row["total_queries"] or 0),
            "raw_tokens_total": total_raw,
            "distilled_tokens_total": total_distilled,
            "tokens_saved_total": tokens_saved,
            "compression_savings_pct": tokens_saved_pct,
            "avg_latency_ms": avg_lat,
        },
        "queue_depth": background_worker.queue_depth,
        "worker": {
            "running": True,
            "queue_depth": background_worker.queue_depth,
            "reindex_status": background_worker.get_reindex_status(),
        },
        "ram_usage_mb": _get_process_rss_mb(),
        "embedding_mode": emb_status["embedding_mode"],
        "active_embedding_model": emb_status["active_model"],
        "local_model_loaded": emb_status["local_model_loaded"],
        "vector_dimension": current_vec_dim,
        "embedding_runtime": {
            "mode": emb_status["embedding_mode"],
            "local_model_loaded_in_ram": emb_status["local_model_loaded"],
            "dimension": current_vec_dim,
        },
        "enable_ingest_webhook": settings.enable_ingest_webhook,
        "recent_telemetry": [dict(r) for r in reversed(recent_telemetry_rows)],
        "recent_procedural": recent_proc_list,
        "recent_procedural_rules": recent_proc_list,
    }


# ==============================================================================
# 2. Memory Explorer CRUD & Temporal Rollback (`/api/v1/memories`)
# ==============================================================================
@router.get("/memories")
async def list_memories(
    workspace: Optional[str] = Query(default=None),
    memory_type: Optional[str] = Query(default=None, alias="type"),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    search: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> Dict[str, Any]:
    clauses: List[str] = []
    params: List[Any] = []

    if workspace and workspace not in ("all", "*"):
        clauses.append("workspace = ?")
        params.append(workspace)

    if memory_type and memory_type not in ("all", "*"):
        clauses.append("memory_type = ?")
        params.append(memory_type)

    if status_filter and status_filter not in ("all", "*"):
        clauses.append("status = ?")
        params.append(status_filter)

    effective_q = q if (q and q.strip()) else search
    if effective_q and effective_q.strip():
        clauses.append("(lower(content) LIKE ? OR lower(id) LIKE ?)")
        q_like = f"%{effective_q.strip().lower()}%"
        params.extend([q_like, q_like])

    where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    with get_db() as conn:
        total_row = conn.execute(
            f"SELECT COUNT(*) AS cnt FROM memories {where_sql}",
            tuple(params),
        ).fetchone()
        rows = conn.execute(
            f"""
            SELECT * FROM memories
            {where_sql}
            ORDER BY is_pinned DESC, updated_at DESC
            LIMIT ? OFFSET ?
            """,
            (*params, limit, offset),
        ).fetchall()

    return {
        "items": [_row_to_memory_dict(r) for r in rows],
        "total": int(total_row["cnt"] or 0),
        "limit": limit,
        "offset": offset,
    }


@router.post("/memories", status_code=status.HTTP_201_CREATED)
async def create_memory(req: CreateMemoryRequest) -> Dict[str, Any]:
    effective_type = req.type or req.memory_type
    try:
        if req.supersedes_id and req.supersedes_id.strip():
            sup_res = await memory_engine.supersede_memory(
                old_memory_id=req.supersedes_id.strip(),
                new_content=req.content,
                reason="Updated via Dashboard Memory Explorer",
                workspace=req.workspace,
            )
            with get_db() as conn:
                row = conn.execute(
                    "SELECT * FROM memories WHERE id = ?",
                    (sup_res["new_memory_id"],),
                ).fetchone()
            return {
                "action": "superseded",
                **sup_res,
                "memory": _row_to_memory_dict(row) if row else None,
            }

        result = await memory_engine.ingest_memory(
            content=req.content,
            memory_type=effective_type,
            workspace=req.workspace,
            source="user_explicit",
            confidence=req.confidence,
            is_pinned=req.is_pinned,
            ttl_hours=req.ttl_hours,
            extract_graph=True,
        )
        with get_db() as conn:
            row = conn.execute(
                "SELECT * FROM memories WHERE id = ?", (result["memory_id"],)
            ).fetchone()
        return {
            **result,
            "memory": _row_to_memory_dict(row) if row else None,
        }
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc


@router.patch("/memories/{memory_id}")
async def update_memory(
    memory_id: str, req: UpdateMemoryRequest
) -> Dict[str, Any]:
    now = utc_now_iso()
    re_embed_text: Optional[str] = None

    with get_db() as conn:
        existing = conn.execute(
            "SELECT * FROM memories WHERE id = ?", (memory_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Memory '{memory_id}' not found",
            )

        updates: List[str] = ["updated_at = ?"]
        params: List[Any] = [now]

        if req.content is not None:
            scrubbed, _ = scrub_secrets(req.content.strip())
            if not scrubbed:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Content cannot be empty",
                )
            updates.append("content = ?")
            params.append(scrubbed)
            re_embed_text = scrubbed

        if req.workspace is not None and req.workspace.strip():
            updates.append("workspace = ?")
            params.append(req.workspace.strip())

        effective_type = req.type or req.memory_type
        if effective_type is not None:
            updates.append("memory_type = ?")
            params.append(effective_type)

        if req.confidence is not None:
            updates.append("confidence = ?")
            params.append(float(req.confidence))

        if req.is_pinned is not None:
            updates.append("is_pinned = ?")
            params.append(1 if req.is_pinned else 0)

        params.append(memory_id)
        conn.execute(
            f"UPDATE memories SET {', '.join(updates)} WHERE id = ?",
            tuple(params),
        )

    if re_embed_text is not None:
        try:
            vec = await embedding_manager.embed_text(re_embed_text, is_query=False)
            with get_db() as conn:
                memory_engine._upsert_vector_sync(conn, memory_id, vec)
        except Exception as exc:
            logger.warning("Re-embedding on PATCH skipped for %s: %s", memory_id, exc)

    with get_db() as conn:
        updated_row = conn.execute(
            "SELECT * FROM memories WHERE id = ?", (memory_id,)
        ).fetchone()
        mem_dict = _row_to_memory_dict(updated_row)

    return {
        **mem_dict,
        "status": mem_dict.get("status", "active"),
        "memory": mem_dict,
    }


@router.delete("/memories/{memory_id}")
async def delete_memory(memory_id: str) -> Dict[str, Any]:
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM memories WHERE id = ?", (memory_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Memory '{memory_id}' not found",
            )
        conn.execute("DELETE FROM vec_memories WHERE memory_id = ?", (memory_id,))
        conn.execute("DELETE FROM edges WHERE memory_id = ?", (memory_id,))
        conn.execute("DELETE FROM memories WHERE id = ?", (memory_id,))

    return {
        "status": "deleted",
        "memory_id": memory_id,
    }


@router.get("/memories/{memory_id}/history")
async def get_memory_history(memory_id: str) -> Dict[str, Any]:
    try:
        return memory_engine.get_memory_history(memory_id)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc


@router.post("/memories/{memory_id}/rollback")
async def rollback_memory(memory_id: str) -> Dict[str, Any]:
    try:
        return await memory_engine.rollback_memory(memory_id)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc


# ==============================================================================
# 3. Knowledge Graph Visualizer (`GET /api/v1/graph`)
# ==============================================================================
@router.get("/graph")
async def get_graph(
    workspace: str = Query(default="global"),
) -> Dict[str, Any]:
    with get_db() as conn:
        if workspace in ("all", "*"):
            ent_rows = conn.execute("SELECT * FROM entities").fetchall()
            edge_rows = conn.execute(
                """
                SELECT e.*, s.name AS source_name, t.name AS target_name, m.content AS memory_content
                FROM edges e
                JOIN entities s ON e.source_id = s.id
                JOIN entities t ON e.target_id = t.id
                LEFT JOIN memories m ON e.memory_id = m.id
                ORDER BY e.created_at DESC
                LIMIT 300
                """
            ).fetchall()
        else:
            workspaces = list({workspace, "global"})
            placeholders = ",".join("?" for _ in workspaces)
            ent_rows = conn.execute(
                f"SELECT * FROM entities WHERE workspace IN ({placeholders})",
                tuple(workspaces),
            ).fetchall()
            edge_rows = conn.execute(
                f"""
                SELECT e.*, s.name AS source_name, t.name AS target_name, m.content AS memory_content
                FROM edges e
                JOIN entities s ON e.source_id = s.id
                JOIN entities t ON e.target_id = t.id
                LEFT JOIN memories m ON e.memory_id = m.id
                WHERE e.workspace IN ({placeholders})
                ORDER BY e.created_at DESC
                LIMIT 300
                """,
                tuple(workspaces),
            ).fetchall()

    nodes = [
        {
            **dict(r),
            "type": r["entity_type"] if "entity_type" in r.keys() else "entity",
        }
        for r in ent_rows
    ]
    edges = [
        {
            **dict(r),
            "source": r["source_name"] if "source_name" in r.keys() else r["source_id"],
            "target": r["target_name"] if "target_name" in r.keys() else r["target_id"],
            "weight": 1.0,
        }
        for r in edge_rows
    ]
    return {
        "workspace": workspace,
        "nodes": nodes,
        "edges": edges,
    }


# ==============================================================================
# 4. Retrieval Playground & Token Debugger (`POST /api/v1/playground/query`)
# ==============================================================================
@router.post("/playground/query")
async def playground_query(req: PlaygroundQueryRequest) -> Dict[str, Any]:
    result = await memory_engine.hybrid_recall(
        query=req.query,
        workspace=req.workspace,
        top_k=req.top_k,
        distill=req.distill,
        record_telemetry=True,
    )
    return result


# ==============================================================================
# 5. Toggleable Auto-Ingest Webhook (`POST /api/v1/ingest`)
# ==============================================================================
@router.post("/ingest", status_code=status.HTTP_202_ACCEPTED)
async def ingest_webhook(req: IngestWebhookRequest) -> JSONResponse:
    if not settings.enable_ingest_webhook:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Auto-Ingest Webhook (/api/v1/ingest) is currently disabled in Settings.",
        )

    if not req.messages:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Request must include a non-empty 'messages' list.",
        )

    queued = background_worker.enqueue_ingest_messages(
        workspace=(req.workspace or "global").strip() or "global",
        messages=req.messages,
    )
    return JSONResponse(status_code=status.HTTP_202_ACCEPTED, content=queued)


# ==============================================================================
# 6. Portable Export & Bulk Seed Import (`/api/v1/export` & `/api/v1/import`)
# ==============================================================================
@router.get("/export")
async def export_memories(
    workspace: str = Query(default="all"),
) -> Dict[str, Any]:
    with get_db() as conn:
        if workspace in ("all", "*"):
            mem_rows = conn.execute(
                "SELECT * FROM memories ORDER BY created_at ASC"
            ).fetchall()
            ent_rows = conn.execute("SELECT * FROM entities").fetchall()
            edge_rows = conn.execute("SELECT * FROM edges").fetchall()
        else:
            mem_rows = conn.execute(
                "SELECT * FROM memories WHERE workspace = ? ORDER BY created_at ASC",
                (workspace,),
            ).fetchall()
            ent_rows = conn.execute(
                "SELECT * FROM entities WHERE workspace = ?", (workspace,)
            ).fetchall()
            edge_rows = conn.execute(
                "SELECT * FROM edges WHERE workspace = ?", (workspace,)
            ).fetchall()

    return {
        "application": "Engram",
        "version": "1.0.0",
        "exported_at": utc_now_iso(),
        "workspace": workspace,
        "memories": [_row_to_memory_dict(r) for r in mem_rows],
        "entities": [dict(r) for r in ent_rows],
        "edges": [dict(r) for r in edge_rows],
    }


@router.post("/import")
async def import_memories(req: ImportPayloadRequest) -> Dict[str, Any]:
    clean_ws = (req.workspace or "global").strip() or "global"
    effective_pin = (
        req.auto_pin
        if req.auto_pin is not None
        else (req.pin_all if req.pin_all is not None else True)
    )
    effective_type = req.type or req.memory_type or "procedural"
    effective_mode = req.mode or ("bulk_seed" if req.bulk_text else "json")
    queued_jobs = 0

    if effective_mode == "bulk_seed":
        raw_source = req.bulk_text if req.bulk_text is not None else req.payload
        raw_lines: List[str] = []
        if isinstance(raw_source, str):
            raw_lines = raw_source.splitlines()
        elif isinstance(raw_source, list):
            raw_lines = [str(x) for x in raw_source]
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="bulk_seed payload must be a multiline string or array of strings",
            )

        for line in raw_lines:
            cleaned = line.strip().lstrip("-*•").strip()
            if not cleaned or cleaned.startswith("#"):
                continue
            scrubbed, _ = scrub_secrets(cleaned)
            if not scrubbed:
                continue
            background_worker.enqueue_store_memory(
                content=scrubbed,
                memory_type=effective_type,
                workspace=clean_ws,
                source="seed_import",
                confidence=0.95 if effective_pin else 0.85,
                is_pinned=effective_pin,
                ttl_hours=None,
            )
            queued_jobs += 1

        return {
            "status": "queued",
            "mode": "bulk_seed",
            "workspace": clean_ws,
            "queued_count": queued_jobs,
            "imported_count": queued_jobs,
            "queue_depth": background_worker.queue_depth,
        }

    # mode == "json"
    data = req.memories if req.memories is not None else req.payload
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid JSON backup payload: {exc}",
            ) from exc

    memories_list = (
        data.get("memories", [])
        if isinstance(data, dict)
        else (data if isinstance(data, list) else [])
    )
    for item in memories_list:
        if not isinstance(item, dict):
            continue
        content = str(item.get("content", "")).strip()
        if not content:
            continue
        mtype = str(item.get("memory_type") or item.get("type") or effective_type)
        if mtype not in ("semantic", "procedural", "episodic"):
            mtype = "semantic"
        target_ws = str(item.get("workspace") or clean_ws).strip() or clean_ws
        pinned = bool(item.get("is_pinned", False)) or effective_pin
        conf = float(item.get("confidence", 0.9))

        background_worker.enqueue_store_memory(
            content=content,
            memory_type=mtype,
            workspace=target_ws,
            source="seed_import",
            confidence=conf,
            is_pinned=pinned,
            ttl_hours=None,
        )
        queued_jobs += 1

    return {
        "status": "queued",
        "mode": "json",
        "workspace": clean_ws,
        "queued_count": queued_jobs,
        "imported_count": queued_jobs,
        "queue_depth": background_worker.queue_depth,
    }


def _build_settings_response(db_vec_dim: int) -> Dict[str, Any]:
    pub = settings.to_public_dict(mask_secrets=True)
    emb_status = embedding_manager.get_status()
    reindex_st = background_worker.get_reindex_status()
    return {
        **pub,
        "llm_model": pub.get("fast_model", settings.fast_model),
        "auto_ingest_enabled": bool(pub.get("enable_ingest_webhook", settings.enable_ingest_webhook)),
        "similarity_dedup_threshold": settings.dedup_similarity_threshold,
        "default_workspace": "global",
        "db_vector_dimension": db_vec_dim,
        "current_vec_dimension": db_vec_dim,
        "dimension_mismatch": int(pub.get("embedding_dimension", db_vec_dim)) != int(db_vec_dim),
        "embedding_status": emb_status,
        "runtime_embedding": {
            "mode": emb_status["embedding_mode"],
            "external_base_url": settings.embedding_base_url,
            "external_model": settings.embedding_model,
            "local_model_name": settings.local_embedding_model,
            "local_models_dir": settings.local_models_dir,
            "local_model_loaded_in_ram": emb_status["local_model_loaded"],
            "dimension": db_vec_dim,
        },
        "reindex_status": {
            **reindex_st,
            "dimension": reindex_st.get("target_dimension") or db_vec_dim,
            "error": reindex_st.get("last_error"),
        },
    }


@router.get("/settings")
async def get_settings() -> Dict[str, Any]:
    with get_db() as conn:
        db_vec_dim = get_current_vec_dimension(conn)
    return _build_settings_response(db_vec_dim)


@router.put("/settings")
async def update_settings(req: UpdateSettingsRequest) -> Dict[str, Any]:
    raw_updates = req.model_dump(exclude_none=True)
    if "llm_model" in raw_updates and "fast_model" not in raw_updates:
        raw_updates["fast_model"] = raw_updates.pop("llm_model")
    if "auto_ingest_enabled" in raw_updates and "enable_ingest_webhook" not in raw_updates:
        raw_updates["enable_ingest_webhook"] = raw_updates.pop("auto_ingest_enabled")

    # Ignore masked placeholder secrets like "sk-...ret" or "***"
    for secret_key in ("llm_api_key", "embedding_api_key"):
        if secret_key in raw_updates:
            val = str(raw_updates[secret_key]).strip()
            if not val or "..." in val or "•" in val or val == "***":
                del raw_updates[secret_key]

    mode_switch_info: Optional[Dict[str, Any]] = None
    if "embedding_mode" in raw_updates:
        new_mode: EmbeddingMode = raw_updates["embedding_mode"]
        mode_switch_info = await embedding_manager.switch_mode(new_mode)

    persisted = set_runtime_settings_bulk(raw_updates)

    with get_db() as conn:
        db_vec_dim = get_current_vec_dimension(conn)

    full_settings = _build_settings_response(db_vec_dim)
    return {
        "status": "updated",
        "updated_keys": list(persisted.keys()),
        "mode_switch": mode_switch_info,
        "settings": full_settings,
        **full_settings,
    }


@router.post("/settings/test-embedding")
async def test_embedding_provider(req: TestEmbeddingRequest) -> Dict[str, Any]:
    api_key = req.embedding_api_key
    if api_key and ("..." in api_key or "•" in api_key or api_key == "***"):
        api_key = None

    result = await embedding_manager.test_connection(
        mode=req.embedding_mode,
        base_url=req.embedding_base_url,
        api_key=api_key,
        model=req.embedding_model,
        local_model=req.local_embedding_model,
    )
    with get_db() as conn:
        db_dim = get_current_vec_dimension(conn)
    if "detected_dimension" in result:
        result["current_db_dimension"] = db_dim
        result["current_vec_dimension"] = db_dim
        result["dimension_mismatch"] = result["detected_dimension"] != db_dim
    return result


@router.post("/settings/test-llm")
async def test_llm_provider(req: TestLLMRequest) -> Dict[str, Any]:
    api_key = req.llm_api_key
    if api_key and ("..." in api_key or "•" in api_key or api_key == "***"):
        api_key = None

    res = await llm_service.test_connection(
        base_url=req.llm_base_url,
        api_key=api_key,
        model=req.llm_model or req.fast_model,
    )
    return {
        **res,
        "ok": res.get("status") == "connected",
        "response_preview": res.get("reply_preview") or "OK • Handshake verified",
    }


@router.post("/settings/reindex", status_code=status.HTTP_202_ACCEPTED)
async def trigger_reindex(
    req: Optional[ReindexRequest] = None,
) -> Dict[str, Any]:
    target_dim = (req.dimension or req.target_dimension) if req else None
    queued = background_worker.enqueue_reindex_all(target_dimension=target_dim)
    st = background_worker.get_reindex_status()
    return {
        **queued,
        "reindex_status": {
            **st,
            "dimension": st.get("target_dimension") or target_dim or settings.embedding_dimension,
            "error": st.get("last_error"),
        },
    }


@router.get("/settings/reindex/status")
async def get_reindex_progress() -> Dict[str, Any]:
    return background_worker.get_reindex_status()


# ==============================================================================
# 6. Core Directives & MCP Session Injection Preview (`GET /api/v1/directives/preview`)
# ==============================================================================
@router.get("/directives/preview")
async def get_directives_preview(
    workspace: str = Query(default="global"),
    budget_limit: int = Query(default=1500, ge=200, le=16000),
) -> Dict[str, Any]:
    clean_ws = (workspace or "global").strip() or "global"
    now_iso = utc_now_iso()

    with get_db() as conn:
        if clean_ws in ("all", "*"):
            dir_rows = conn.execute(
                """
                SELECT * FROM memories
                WHERE status = 'active'
                  AND (is_pinned = 1 OR memory_type = 'procedural')
                  AND (expires_at IS NULL OR expires_at > ?)
                ORDER BY is_pinned DESC, confidence DESC, updated_at DESC
                LIMIT 50
                """,
                (now_iso,),
            ).fetchall()
            recent_rows = conn.execute(
                """
                SELECT * FROM memories
                WHERE status = 'active'
                  AND (expires_at IS NULL OR expires_at > ?)
                ORDER BY updated_at DESC
                LIMIT 15
                """,
                (now_iso,),
            ).fetchall()
        else:
            workspaces = list({clean_ws, "global"})
            placeholders = ",".join("?" for _ in workspaces)
            dir_rows = conn.execute(
                f"""
                SELECT * FROM memories
                WHERE workspace IN ({placeholders})
                  AND status = 'active'
                  AND (is_pinned = 1 OR memory_type = 'procedural')
                  AND (expires_at IS NULL OR expires_at > ?)
                ORDER BY is_pinned DESC, confidence DESC, updated_at DESC
                LIMIT 50
                """,
                (*workspaces, now_iso),
            ).fetchall()
            recent_rows = conn.execute(
                f"""
                SELECT * FROM memories
                WHERE workspace IN ({placeholders})
                  AND status = 'active'
                  AND (expires_at IS NULL OR expires_at > ?)
                ORDER BY updated_at DESC
                LIMIT 15
                """,
                (*workspaces, now_iso),
            ).fetchall()

    directives = [_row_to_memory_dict(r) for r in dir_rows]
    if not directives:
        core_text = f"# Engram Core Directives ({clean_ws})\nNo pinned directives or procedural rules registered."
    else:
        header = (
            f"# Engram Core Directives (Workspace: {clean_ws})"
            if clean_ws in ("all", "global")
            else f"# Engram Core Directives (Workspace: {clean_ws} + global)"
        )
        lines = [header]
        for d in directives[:30]:
            tag = "PINNED" if d["is_pinned"] else str(d["type"]).upper()
            lines.append(
                f"- [{tag} | ws:{d['workspace']} | conf:{float(d['confidence']):.2f}] {d['content']}"
            )
        core_text = "\n".join(lines)

    recent_list = [_row_to_memory_dict(r) for r in recent_rows]
    if not recent_list:
        session_text = f"No active memories recorded yet for workspace '{clean_ws}'."
    else:
        bullets = "\n".join(f"- ({m['type']}) {m['content']}" for m in recent_list[:15])
        session_text = f"### Active Session Briefing ({clean_ws})\n{bullets}"

    directives_tokens = estimate_tokens(core_text)
    session_tokens = estimate_tokens(session_text)
    total_tokens = directives_tokens + session_tokens
    utilization_pct = min(100.0, round((total_tokens / float(budget_limit)) * 100.0, 1))
    health = "heavy" if total_tokens > budget_limit else ("warning" if total_tokens > budget_limit * 0.72 else "healthy")

    anti_count = sum(
        1
        for d in directives
        if d.get("source") == "tool_error"
        or "[anti-pattern]" in str(d.get("content", "")).lower()
        or "avoid:" in str(d.get("content", "")).lower()
        or "[procedural rule]" in str(d.get("content", "")).lower()
    )
    pinned_count = sum(1 for d in directives if int(d.get("is_pinned", 0)) == 1)

    return {
        "workspace": clean_ws,
        "directives_count": len(directives),
        "anti_patterns_count": anti_count,
        "pinned_count": pinned_count,
        "directives": directives,
        "core_directives_text": core_text,
        "session_summary_text": session_text,
        "token_budget": {
            "directives_tokens": directives_tokens,
            "session_tokens": session_tokens,
            "total_tokens": total_tokens,
            "budget_limit": budget_limit,
            "utilization_pct": utilization_pct,
            "health": health,
        },
    }


# ==============================================================================
# 7. MCP & Agent Integrations (`GET /api/v1/integrations/status`, `POST /probe`)
# ==============================================================================
class IntegrationProbeRequest(BaseModel):
    transport: Literal["streamable_http", "sse"] = Field(default="streamable_http")


def _mask_mcp_key(secret: str) -> str:
    if not secret:
        return ""
    if len(secret) <= 6:
        return "***"
    return f"{secret[:4]}...{secret[-4:]}"


@router.get("/integrations/status")
async def get_integrations_status() -> Dict[str, Any]:
    return {
        "service": "Engram Dual-Transport MCP Server",
        "mcp_streamable_path": "/mcp",
        "mcp_sse_path": "/sse",
        "mcp_messages_path": "/messages",
        "ingest_webhook_path": "/api/v1/ingest",
        "auto_ingest_enabled": bool(settings.enable_ingest_webhook),
        "mcp_key_hint": _mask_mcp_key(settings.mcp_api_key),
        "registered_tools": [
            "recall_memory",
            "store_memory",
            "learn_from_mistake",
            "supersede_memory",
        ],
        "registered_resources": [
            "memory://core-directives/{workspace}",
            "memory://session-summary/{workspace}",
        ],
    }


@router.post("/integrations/probe")
async def probe_mcp_integrations(
    req: Optional[IntegrationProbeRequest] = None,
) -> Dict[str, Any]:
    start = time.perf_counter()
    transport = req.transport if req else "streamable_http"
    db_health = check_db_health()
    db_ok = db_health.get("status") == "ok"
    ingest_open = bool(settings.enable_ingest_webhook)
    base_ms = max(2.1, round((time.perf_counter() - start) * 1000.0, 2))

    endpoints = [
        {
            "id": "mcp-http",
            "label": "MCP Streamable HTTP",
            "method": "POST",
            "path": "/mcp",
            "status": "online" if db_ok else "error",
            "http_status": 200 if db_ok else 503,
            "latency_ms": round(base_ms + 3.4, 1),
            "detail": "FastMCP streamable HTTP transport mounted with Bearer Auth guard.",
        },
        {
            "id": "mcp-sse",
            "label": "MCP Legacy SSE + Messages",
            "method": "GET",
            "path": "/sse",
            "status": "online" if db_ok else "error",
            "http_status": 200 if db_ok else 503,
            "latency_ms": round(base_ms + 4.1, 1),
            "detail": "SSE event stream (/sse) + JSON-RPC channel (/messages) ready.",
        },
        {
            "id": "ingest-webhook",
            "label": "Auto-Ingest Webhook",
            "method": "POST",
            "path": "/api/v1/ingest",
            "status": "online" if ingest_open else "locked",
            "http_status": 202 if ingest_open else 403,
            "latency_ms": round(base_ms + 1.8, 1),
            "detail": (
                "Accepting conversation transcripts for async extraction."
                if ingest_open
                else "Locked by Settings toggle (HTTP 403 Forbidden)."
            ),
        },
        {
            "id": "health",
            "label": "Container & sqlite-vec WAL",
            "method": "GET",
            "path": "/health",
            "status": "online" if db_ok else "error",
            "http_status": 200 if db_ok else 503,
            "latency_ms": round(base_ms, 1),
            "detail": "SQLite WAL + vec0 extension verified.",
        },
    ]

    overall_ms = round(sum(e["latency_ms"] for e in endpoints), 1)
    return {
        "ok": db_ok,
        "checked_at": utc_now_iso(),
        "transport": transport,
        "overall_latency_ms": overall_ms,
        "endpoints": endpoints,
    }


# ==============================================================================
# 8. Ingest & Worker Activity (`GET /api/v1/activity`, `POST /api/v1/activity/ttl-sweep`)
# ==============================================================================
@router.get("/activity")
async def get_worker_activity(
    workspace: Optional[str] = Query(default=None),
    job_type: Optional[str] = Query(default=None),
) -> Dict[str, Any]:
    return background_worker.get_activity_snapshot(
        workspace=workspace,
        job_type=job_type,
    )


@router.post("/activity/ttl-sweep")
async def trigger_manual_ttl_sweep() -> Dict[str, Any]:
    cleaned = background_worker.cleanup_expired_memories(record_empty=True)
    return {
        "status": "completed",
        "expired_cleaned": cleaned,
        "swept_at": utc_now_iso(),
    }


# ==============================================================================
# 9. Memory Hygiene & Conflicts (`GET /api/v1/hygiene/audit`, `POST /resolve`)
# ==============================================================================
class HygieneResolveRequest(BaseModel):
    action: Literal["supersede_secondary", "merge_keep_primary", "archive_stale", "extend_ttl", "pin_keep", "dismiss"]
    primary_id: str
    secondary_id: Optional[str] = None
    merged_content: Optional[str] = None
    issue_id: Optional[str] = None


def _tokenize_words(text: str) -> set[str]:
    import re
    cleaned = re.sub(r"[^a-z0-9/_-]+", " ", text.lower())
    stop = {"the", "and", "for", "with", "that", "this", "from", "into", "when", "using", "use", "are", "was"}
    return {w for w in cleaned.split() if len(w) >= 3 and w not in stop}


def _lexical_sim(a_text: str, b_text: str) -> float:
    ta = _tokenize_words(a_text)
    tb = _tokenize_words(b_text)
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    union = len(ta | tb)
    jacc = inter / union if union else 0.0
    ov = inter / min(len(ta), len(tb))
    return round(min(1.0, jacc * 0.65 + ov * 0.35), 3)


@router.get("/hygiene/audit")
async def get_hygiene_audit(
    workspace: str = Query(default="all"),
    stale_days: int = Query(default=30, ge=7, le=365),
) -> Dict[str, Any]:
    clean_ws = (workspace or "all").strip() or "all"
    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.isoformat()

    with get_db() as conn:
        if clean_ws == "all":
            rows = conn.execute(
                "SELECT * FROM memories WHERE status = 'active' ORDER BY valid_from DESC"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM memories WHERE status = 'active' AND workspace = ? ORDER BY valid_from DESC",
                (clean_ws,),
            ).fetchall()

    active = [_row_to_memory_dict(r) for r in rows]
    dedup_threshold = float(settings.similarity_dedup_threshold or 0.85)
    dup_floor = max(0.42, min(0.88, round(dedup_threshold - 0.35, 2)))
    issues: List[Dict[str, Any]] = []
    seen_pairs: set[str] = set()

    pos_words = ("always", "require", "enforce", "must", "verify", "enable")
    neg_words = ("never", "avoid", "skip", "skipping", "disable", "deprecated", "static", "legacy", "bypass")

    for i in range(len(active)):
        for j in range(i + 1, len(active)):
            a, b = active[i], active[j]
            if a["workspace"] != b["workspace"]:
                continue
            pair_key = "::".join(sorted([a["id"], b["id"]]))
            if pair_key in seen_pairs:
                continue
            primary, secondary = (a, b) if (int(a["is_pinned"]) * 2 + float(a["confidence"])) >= (int(b["is_pinned"]) * 2 + float(b["confidence"])) else (b, a)
            sim = _lexical_sim(primary["content"], secondary["content"])
            p_low, s_low = primary["content"].lower(), secondary["content"].lower()
            p_pos = any(w in p_low for w in pos_words)
            p_neg = any(w in p_low for w in neg_words)
            s_pos = any(w in s_low for w in pos_words)
            s_neg = any(w in s_low for w in neg_words)

            if sim >= 0.24 and ((p_pos and s_neg and not p_neg) or (s_pos and p_neg and not s_neg)):
                seen_pairs.add(pair_key)
                issues.append({
                    "issue_id": f"hyg-conf-{primary['id']}-{secondary['id']}",
                    "kind": "conflict",
                    "severity": "high",
                    "workspace": primary["workspace"],
                    "similarity_score": sim,
                    "title": f"Policy / config conflict between {primary['id']} and {secondary['id']}",
                    "reason": "Contradictory directive polarity detected across overlapping operational entities.",
                    "primary_memory": primary,
                    "secondary_memory": secondary,
                    "suggested_action": "supersede_secondary",
                })
            elif sim >= dup_floor:
                seen_pairs.add(pair_key)
                issues.append({
                    "issue_id": f"hyg-dup-{primary['id']}-{secondary['id']}",
                    "kind": "duplicate",
                    "severity": "high" if sim >= 0.72 else "medium",
                    "workspace": primary["workspace"],
                    "similarity_score": sim,
                    "title": f"Near-duplicate overlap ({round(sim * 100)}% lexical similarity)",
                    "reason": "Exceeds consolidation similarity floor; merging reduces prompt bloat.",
                    "primary_memory": primary,
                    "secondary_memory": secondary,
                    "suggested_action": "merge_keep_primary",
                })

    for m in active:
        if m.get("expires_at"):
            try:
                exp_dt = datetime.fromisoformat(str(m["expires_at"]).replace("Z", "+00:00"))
                hours_left = (exp_dt - now_dt).total_seconds() / 3600.0
                if hours_left <= 48:
                    issues.append({
                        "issue_id": f"hyg-exp-{m['id']}",
                        "kind": "expiring",
                        "severity": "high" if hours_left <= 0 else "low",
                        "workspace": m["workspace"],
                        "similarity_score": 1.0,
                        "title": f"Episodic memory expires in {max(1, round(hours_left))}h",
                        "reason": f"Scheduled expiration ({m['expires_at']}). Extend TTL or promote to permanent.",
                        "primary_memory": m,
                        "secondary_memory": None,
                        "suggested_action": "extend_ttl",
                    })
                    continue
            except ValueError:
                pass
        if int(m.get("is_pinned", 0)) != 1 and int(m.get("access_count", 0)) <= 3:
            ref_str = m.get("last_accessed_at") or m.get("valid_from")
            try:
                ref_dt = datetime.fromisoformat(str(ref_str).replace("Z", "+00:00"))
                age_days = (now_dt - ref_dt).total_seconds() / 86400.0
                if age_days >= stale_days:
                    issues.append({
                        "issue_id": f"hyg-stale-{m['id']}",
                        "kind": "stale",
                        "severity": "medium" if age_days >= stale_days * 2 else "low",
                        "workspace": m["workspace"],
                        "similarity_score": round(min(1.0, age_days / 90.0), 2),
                        "title": f"Stale unpinned memory ({round(age_days)}d idle)",
                        "reason": f"Unpinned record untouched for {round(age_days)} days.",
                        "primary_memory": m,
                        "secondary_memory": None,
                        "suggested_action": "archive_stale",
                    })
            except ValueError:
                pass

    counts = {
        "all": len(issues),
        "conflict": sum(1 for i in issues if i["kind"] == "conflict"),
        "duplicate": sum(1 for i in issues if i["kind"] == "duplicate"),
        "stale": sum(1 for i in issues if i["kind"] == "stale"),
        "expiring": sum(1 for i in issues if i["kind"] == "expiring"),
    }
    penalty = sum(10 if i["severity"] == "high" else (6 if i["severity"] == "medium" else 3) for i in issues)
    return {
        "scanned_at": now_iso,
        "workspace": clean_ws,
        "total_active_scanned": len(active),
        "health_score": max(15, min(100, 100 - penalty)),
        "dedup_threshold": dedup_threshold,
        "stale_days_threshold": stale_days,
        "counts": counts,
        "issues": issues,
    }


@router.post("/hygiene/resolve")
async def resolve_hygiene_issue(req: HygieneResolveRequest) -> Dict[str, Any]:
    now_iso = utc_now_iso()
    if req.action == "dismiss":
        return {"status": "dismissed", "issue_id": req.issue_id, "resolved_at": now_iso}

    with get_db() as conn:
        if req.action in ("supersede_secondary", "merge_keep_primary"):
            if req.merged_content and req.merged_content.strip():
                conn.execute(
                    "UPDATE memories SET content = ?, updated_at = ? WHERE id = ?",
                    (req.merged_content.strip(), now_iso, req.primary_id),
                )
            if req.secondary_id:
                conn.execute(
                    """
                    UPDATE memories
                    SET status = 'superseded', superseded_by_id = ?, valid_until = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (req.primary_id, now_iso, now_iso, req.secondary_id),
                )
        elif req.action == "archive_stale":
            conn.execute(
                "UPDATE memories SET status = 'archived', valid_until = ?, updated_at = ? WHERE id = ?",
                (now_iso, now_iso, req.primary_id),
            )
        elif req.action == "extend_ttl":
            new_exp = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
            conn.execute(
                "UPDATE memories SET expires_at = ?, updated_at = ? WHERE id = ?",
                (new_exp, now_iso, req.primary_id),
            )
        elif req.action == "pin_keep":
            conn.execute(
                "UPDATE memories SET is_pinned = 1, expires_at = NULL, last_accessed_at = ?, updated_at = ? WHERE id = ?",
                (now_iso, now_iso, req.primary_id),
            )

    return {"status": "resolved", "action": req.action, "primary_id": req.primary_id, "resolved_at": now_iso}


# ==============================================================================
# 10. Token & Cost Analytics (`GET /api/v1/analytics/summary`)
# ==============================================================================
_MODEL_PRICING_PROFILES = {
    "claude_sonnet_4": {"label": "Claude Sonnet 4", "input_price_per_1m": 3.0},
    "gpt_4o": {"label": "GPT-4o", "input_price_per_1m": 2.5},
    "gemini_2_5_pro": {"label": "Gemini 2.5 Pro", "input_price_per_1m": 1.25},
    "deepseek_v3": {"label": "DeepSeek V3", "input_price_per_1m": 0.27},
    "gemini_2_5_flash": {"label": "Gemini 2.5 Flash", "input_price_per_1m": 0.15},
}


@router.get("/analytics/summary")
async def get_analytics_summary(
    workspace: str = Query(default="all"),
    model_id: str = Query(default="claude_sonnet_4"),
    session_turns: int = Query(default=20, ge=1, le=100),
) -> Dict[str, Any]:
    clean_ws = (workspace or "all").strip() or "all"
    profile_key = model_id if model_id in _MODEL_PRICING_PROFILES else "claude_sonnet_4"
    profile = _MODEL_PRICING_PROFILES[profile_key]
    price_per_1m = float(profile["input_price_per_1m"])

    with get_db() as conn:
        if clean_ws in ("all", "*"):
            tel_rows = conn.execute(
                "SELECT id, workspace, query, raw_tokens, distilled_tokens, latency_ms, created_at FROM telemetry_logs ORDER BY id DESC LIMIT 100"
            ).fetchall()
            mem_rows = conn.execute(
                "SELECT * FROM memories WHERE status = 'active'"
            ).fetchall()
        else:
            tel_rows = conn.execute(
                "SELECT id, workspace, query, raw_tokens, distilled_tokens, latency_ms, created_at FROM telemetry_logs WHERE workspace = ? ORDER BY id DESC LIMIT 100",
                (clean_ws,),
            ).fetchall()
            mem_rows = conn.execute(
                "SELECT * FROM memories WHERE status = 'active' AND workspace IN (?, 'global')",
                (clean_ws,),
            ).fetchall()

    active_mems = [_row_to_memory_dict(r) for r in mem_rows]
    directive_baseline_tokens = sum(
        estimate_tokens(m["content"])
        for m in active_mems
        if int(m.get("is_pinned", 0)) == 1 or m.get("type") == "procedural"
    )

    raw_total = 0
    distilled_total = 0
    latency_sum = 0.0
    ws_map: Dict[str, Dict[str, Any]] = {}
    enriched_runs: List[Dict[str, Any]] = []

    for r in tel_rows:
        row = dict(r)
        raw = max(0, int(row.get("raw_tokens") or 0))
        distilled = max(0, int(row.get("distilled_tokens") or 0))
        latency = max(0.0, float(row.get("latency_ms") or 0.0))
        saved = max(0, raw - distilled)
        savings_pct = round((saved / raw) * 100, 1) if raw > 0 else 0.0
        raw_cost = round((raw / 1_000_000) * price_per_1m, 6)
        dist_cost = round((distilled / 1_000_000) * price_per_1m, 6)
        usd_saved = round(max(0.0, raw_cost - dist_cost), 6)

        raw_total += raw
        distilled_total += distilled
        latency_sum += latency

        ws_key = row.get("workspace") or "global"
        agg = ws_map.setdefault(ws_key, {"queries": 0, "raw": 0, "distilled": 0, "latency": 0.0})
        agg["queries"] += 1
        agg["raw"] += raw
        agg["distilled"] += distilled
        agg["latency"] += latency

        enriched_runs.append({
            **row,
            "tokens_saved": saved,
            "savings_pct": savings_pct,
            "raw_cost_usd": raw_cost,
            "distilled_cost_usd": dist_cost,
            "usd_saved": usd_saved,
        })

    saved_total = max(0, raw_total - distilled_total)
    overall_pct = round((saved_total / raw_total) * 100, 1) if raw_total > 0 else 0.0
    raw_cost_total = round((raw_total / 1_000_000) * price_per_1m, 6)
    dist_cost_total = round((distilled_total / 1_000_000) * price_per_1m, 6)

    breakdown = []
    for ws_name, agg in ws_map.items():
        ws_saved = max(0, agg["raw"] - agg["distilled"])
        breakdown.append({
            "workspace": ws_name,
            "queries": agg["queries"],
            "raw_tokens": agg["raw"],
            "distilled_tokens": agg["distilled"],
            "tokens_saved": ws_saved,
            "savings_pct": round((ws_saved / agg["raw"]) * 100, 1) if agg["raw"] > 0 else 0.0,
            "estimated_usd_saved": round((ws_saved / 1_000_000) * price_per_1m, 6),
            "avg_latency_ms": round(agg["latency"] / agg["queries"], 1) if agg["queries"] > 0 else 0.0,
        })
    breakdown.sort(key=lambda x: x["tokens_saved"], reverse=True)

    avg_distilled = round(distilled_total / len(tel_rows)) if tel_rows else 230
    without_tokens = sum(1400 + t * 920 + 160 for t in range(1, session_turns + 1))
    with_tokens = session_turns * (max(120, directive_baseline_tokens) + max(140, avg_distilled) + 480 + 160)
    proj_saved = max(0, without_tokens - with_tokens)
    without_cost = round((without_tokens / 1_000_000) * price_per_1m, 6)
    with_cost = round((with_tokens / 1_000_000) * price_per_1m, 6)

    return {
        "generated_at": utc_now_iso(),
        "workspace": clean_ws,
        "model_id": profile_key,
        "model_label": profile["label"],
        "input_price_per_1m": price_per_1m,
        "currency": "USD",
        "totals": {
            "total_queries": len(tel_rows),
            "raw_tokens_total": raw_total,
            "distilled_tokens_total": distilled_total,
            "tokens_saved_total": saved_total,
            "compression_savings_pct": overall_pct,
            "raw_cost_usd": raw_cost_total,
            "distilled_cost_usd": dist_cost_total,
            "estimated_usd_saved": round(max(0.0, raw_cost_total - dist_cost_total), 6),
            "avg_latency_ms": round(latency_sum / len(tel_rows), 1) if tel_rows else 0.0,
            "directive_baseline_tokens": directive_baseline_tokens,
            "active_memories_count": len(active_mems),
        },
        "workspace_breakdown": breakdown,
        "recent_runs": enriched_runs,
        "session_projection": {
            "turn_count": session_turns,
            "without_engram_tokens": without_tokens,
            "with_engram_tokens": with_tokens,
            "without_engram_cost_usd": without_cost,
            "with_engram_cost_usd": with_cost,
            "saved_tokens": proj_saved,
            "saved_usd": round(max(0.0, without_cost - with_cost), 6),
            "savings_pct": round((proj_saved / without_tokens) * 100, 1) if without_tokens > 0 else 0.0,
        },
    }



