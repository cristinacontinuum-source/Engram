import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.config import EmbeddingMode, settings
from app.database import (
    get_current_vec_dimension,
    get_db,
    set_runtime_settings_bulk,
    utc_now_iso,
)
from app.embeddings import _get_process_rss_mb, embedding_manager
from app.engine import _row_to_memory_dict, memory_engine, scrub_secrets
from app.llm_service import llm_service
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
