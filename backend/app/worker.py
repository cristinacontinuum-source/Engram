import asyncio
import logging
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Any, Deque, Dict, List, Optional

from app.config import settings
from app.database import (
    get_current_vec_dimension,
    get_db,
    recreate_vector_table,
    serialize_f32,
    utc_now_iso,
)
from app.embeddings import embedding_manager
from app.engine import memory_engine
from app.llm_service import llm_service

logger = logging.getLogger("engram.worker")


class BackgroundWorker:
    """
    Internal Async Worker (`asyncio.Queue`) for Engram:
    - Non-blocking memory ingestion, smart deduplication, and 1-hop graph extraction.
    - Webhook conversation fact/rule extraction (`POST /api/v1/ingest`).
    - Asynchronous full-database vector re-indexing on model/dimension switch.
    - Periodic TTL expiration cleaner (`expires_at <= now`).
    """

    def __init__(self) -> None:
        self._queue: asyncio.Queue[Dict[str, Any]] = asyncio.Queue()
        self._worker_task: Optional[asyncio.Task[None]] = None
        self._ttl_task: Optional[asyncio.Task[None]] = None
        self._running: bool = False
        self._jobs_processed: int = 0
        self._ttl_sweeps_count: int = 0
        self._expired_cleaned_total: int = 0
        self._job_history: Deque[Dict[str, Any]] = deque(maxlen=100)
        self._reindex_state: Dict[str, Any] = {
            "status": "idle",
            "dimension": settings.embedding_dimension,
            "total": 0,
            "completed": 0,
            "failed": 0,
            "started_at": None,
            "completed_at": None,
            "last_error": None,
        }

    @property
    def queue_depth(self) -> int:
        return self._queue.qsize()

    def get_reindex_status(self) -> Dict[str, Any]:
        return {
            **self._reindex_state,
            "queue_depth": self.queue_depth,
        }

    def _record_job(
        self,
        *,
        job_id: str,
        job_type: str,
        workspace: str,
        status: str,
        summary: str,
        detail: str,
        items_processed: int = 1,
        secrets_redacted: int = 0,
        latency_ms: float = 0.0,
        created_at: Optional[str] = None,
        completed_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        entry: Dict[str, Any] = {
            "job_id": job_id,
            "job_type": job_type,
            "workspace": workspace or "global",
            "status": status,
            "summary": summary,
            "detail": detail,
            "items_processed": items_processed,
            "secrets_redacted": secrets_redacted,
            "latency_ms": round(latency_ms, 1),
            "created_at": created_at or utc_now_iso(),
            "completed_at": completed_at,
        }
        self._job_history.appendleft(entry)
        return entry

    def get_activity_snapshot(
        self,
        workspace: Optional[str] = None,
        job_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        ws = (workspace or "").strip()
        jt = (job_type or "").strip()
        jobs = list(self._job_history)
        if ws and ws != "all":
            jobs = [j for j in jobs if j.get("workspace") in (ws, "global")]
        if jt and jt != "all":
            jobs = [j for j in jobs if j.get("job_type") == jt]

        return {
            "worker_running": self._running,
            "queue_depth": self.queue_depth,
            "jobs_processed": self._jobs_processed,
            "ttl_sweeps_count": self._ttl_sweeps_count,
            "expired_cleaned_total": self._expired_cleaned_total,
            "auto_ingest_enabled": bool(settings.enable_ingest_webhook),
            "reindex_status": self.get_reindex_status(),
            "jobs": jobs,
        }

    async def start(self) -> None:
        """Starts the background queue consumer and periodic TTL cleanup loop."""
        if self._running:
            return
        self._running = True
        self._worker_task = asyncio.create_task(
            self._consume_loop(), name="engram-queue-worker"
        )
        self._ttl_task = asyncio.create_task(
            self._ttl_cleanup_loop(), name="engram-ttl-cleaner"
        )
        logger.info("Engram BackgroundWorker started")

    async def stop(self) -> None:
        """Gracefully stops background tasks."""
        self._running = False
        for task in (self._worker_task, self._ttl_task):
            if task is not None and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        logger.info("Engram BackgroundWorker stopped")

    def enqueue_store_memory(
        self,
        content: str,
        memory_type: str = "semantic",
        workspace: str = "global",
        source: str = "agent_inferred",
        confidence: float = 0.85,
        is_pinned: bool = False,
        ttl_hours: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Enqueues a memory ingestion job and returns immediately."""
        job_id = f"job_{uuid.uuid4().hex[:12]}"
        self._queue.put_nowait(
            {
                "job_id": job_id,
                "job_type": "store_memory",
                "payload": {
                    "content": content,
                    "memory_type": memory_type,
                    "workspace": workspace,
                    "source": source,
                    "confidence": confidence,
                    "is_pinned": is_pinned,
                    "ttl_hours": ttl_hours,
                },
                "enqueued_at": utc_now_iso(),
            }
        )
        return {
            "status": "queued",
            "job_id": job_id,
            "queue_depth": self.queue_depth,
        }

    def enqueue_ingest_messages(
        self, workspace: str, messages: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Enqueues raw conversation messages from `/api/v1/ingest` for async fact extraction."""
        job_id = f"job_{uuid.uuid4().hex[:12]}"
        self._queue.put_nowait(
            {
                "job_id": job_id,
                "job_type": "ingest_messages",
                "payload": {
                    "workspace": workspace,
                    "messages": messages,
                },
                "enqueued_at": utc_now_iso(),
            }
        )
        return {
            "status": "queued",
            "job_id": job_id,
            "workspace": workspace,
            "message_count": len(messages),
            "queue_depth": self.queue_depth,
        }

    def enqueue_reindex_all(
        self, target_dimension: Optional[int] = None
    ) -> Dict[str, Any]:
        """Enqueues a full `vec_memories` table recreation and re-embedding job."""
        job_id = f"job_{uuid.uuid4().hex[:12]}"
        self._reindex_state.update(
            {
                "status": "queued",
                "dimension": target_dimension or settings.embedding_dimension,
                "total": 0,
                "completed": 0,
                "failed": 0,
                "started_at": utc_now_iso(),
                "completed_at": None,
                "last_error": None,
            }
        )
        self._queue.put_nowait(
            {
                "job_id": job_id,
                "job_type": "reindex_all",
                "payload": {"target_dimension": target_dimension},
                "enqueued_at": utc_now_iso(),
            }
        )
        return {
            "status": "queued",
            "job_id": job_id,
            "reindex_status": self.get_reindex_status(),
        }

    async def _consume_loop(self) -> None:
        while self._running:
            try:
                job = await self._queue.get()
            except asyncio.CancelledError:
                break

            job_id = job.get("job_id", "unknown")
            job_type = job.get("job_type", "")
            payload = job.get("payload", {})
            enqueued_at = job.get("enqueued_at") or utc_now_iso()
            workspace = str(payload.get("workspace") or "global")
            t0 = time.perf_counter()

            try:
                if job_type == "store_memory":
                    raw_content = str(payload.get("content", ""))
                    res = await memory_engine.ingest_memory(
                        content=raw_content,
                        memory_type=payload.get("memory_type", "semantic"),
                        workspace=workspace,
                        source=payload.get("source", "agent_inferred"),
                        confidence=float(payload.get("confidence", 0.85)),
                        is_pinned=bool(payload.get("is_pinned", False)),
                        ttl_hours=payload.get("ttl_hours"),
                        extract_graph=True,
                    )
                    latency_ms = (time.perf_counter() - t0) * 1000.0
                    redactions = int(res.get("secrets_redacted", 0) or 0)
                    action = res.get("action", "inserted")
                    self._record_job(
                        job_id=job_id,
                        job_type="store_memory",
                        workspace=workspace,
                        status="completed",
                        summary=f"{action} {payload.get('memory_type', 'semantic')} memory ({payload.get('source', 'agent_inferred')})",
                        detail=raw_content[:260],
                        items_processed=1,
                        secrets_redacted=redactions,
                        latency_ms=latency_ms,
                        created_at=enqueued_at,
                        completed_at=utc_now_iso(),
                    )
                elif job_type == "ingest_messages":
                    messages = payload.get("messages", [])
                    extracted = await llm_service.extract_memories_from_messages(messages)
                    redactions_total = 0
                    for item in extracted:
                        res = await memory_engine.ingest_memory(
                            content=item["content"],
                            memory_type=item.get("memory_type", "semantic"),
                            workspace=workspace,
                            source="agent_inferred",
                            confidence=float(item.get("confidence", 0.85)),
                            is_pinned=item.get("memory_type") == "procedural",
                            extract_graph=True,
                        )
                        redactions_total += int(res.get("secrets_redacted", 0) or 0)
                    latency_ms = (time.perf_counter() - t0) * 1000.0
                    self._record_job(
                        job_id=job_id,
                        job_type="ingest_messages",
                        workspace=workspace,
                        status="completed",
                        summary=f"Extracted {len(extracted)} memories from {len(messages)} conversation turns",
                        detail=f"POST /api/v1/ingest -> workspace={workspace} • extracted={len(extracted)}",
                        items_processed=len(extracted),
                        secrets_redacted=redactions_total,
                        latency_ms=latency_ms,
                        created_at=enqueued_at,
                        completed_at=utc_now_iso(),
                    )
                elif job_type == "reindex_all":
                    st = await self.run_reindex_all(
                        target_dimension=payload.get("target_dimension")
                    )
                    latency_ms = (time.perf_counter() - t0) * 1000.0
                    failed = int(st.get("failed", 0) or 0)
                    self._record_job(
                        job_id=job_id,
                        job_type="reindex_all",
                        workspace="global",
                        status="completed" if failed == 0 else "failed",
                        summary=f"Re-indexed {st.get('completed', 0)}/{st.get('total', 0)} vectors @ {st.get('dimension', settings.embedding_dimension)}d",
                        detail=st.get("last_error") or f"vec_memories recreated at {st.get('dimension', settings.embedding_dimension)}d",
                        items_processed=int(st.get("completed", 0) or 0),
                        secrets_redacted=0,
                        latency_ms=latency_ms,
                        created_at=enqueued_at,
                        completed_at=utc_now_iso(),
                    )

                self._jobs_processed += 1
            except Exception as exc:
                latency_ms = (time.perf_counter() - t0) * 1000.0
                logger.error("Worker job %s (%s) failed: %s", job_id, job_type, exc)
                self._record_job(
                    job_id=job_id,
                    job_type=job_type or "store_memory",
                    workspace=workspace,
                    status="failed",
                    summary=f"Job failed: {str(exc)[:120]}",
                    detail=str(exc),
                    items_processed=0,
                    secrets_redacted=0,
                    latency_ms=latency_ms,
                    created_at=enqueued_at,
                    completed_at=utc_now_iso(),
                )
            finally:
                self._queue.task_done()

    async def run_reindex_all(
        self, target_dimension: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Detects the active embedding model's dimension (or uses `target_dimension`),
        recreates `vec_memories`, and re-embeds all active memories in batches.
        """
        self._reindex_state["status"] = "running"
        self._reindex_state["started_at"] = utc_now_iso()
        self._reindex_state["completed"] = 0
        self._reindex_state["failed"] = 0
        self._reindex_state["last_error"] = None

        try:
            # Probe one sample vector to confirm actual model output dimension
            probe_vec = await embedding_manager.embed_text(
                "dimension probe", is_query=False
            )
            actual_dim = len(probe_vec)
        except Exception as exc:
            actual_dim = target_dimension or settings.embedding_dimension
            logger.warning(
                "Dimension probe failed during reindex (%s); using dim=%d",
                exc,
                actual_dim,
            )

        with get_db() as conn:
            recreate_vector_table(actual_dim, conn)
            rows = conn.execute(
                "SELECT id, content FROM memories WHERE status = 'active' ORDER BY created_at ASC"
            ).fetchall()

        total = len(rows)
        self._reindex_state["dimension"] = actual_dim
        self._reindex_state["total"] = total

        batch_size = 16
        for idx in range(0, total, batch_size):
            batch_rows = rows[idx : idx + batch_size]
            texts = [r["content"] for r in batch_rows]
            ids = [r["id"] for r in batch_rows]
            try:
                vectors = await embedding_manager.embed_batch(texts, is_query=False)
                with get_db() as conn:
                    for mid, vec in zip(ids, vectors):
                        if len(vec) == actual_dim:
                            conn.execute(
                                "DELETE FROM vec_memories WHERE memory_id = ?",
                                (mid,),
                            )
                            conn.execute(
                                "INSERT INTO vec_memories (memory_id, embedding) VALUES (?, ?)",
                                (mid, serialize_f32(vec)),
                            )
                            self._reindex_state["completed"] += 1
                        else:
                            self._reindex_state["failed"] += 1
            except Exception as exc:
                logger.error("Re-index batch failed at offset %d: %s", idx, exc)
                self._reindex_state["failed"] += len(batch_rows)
                self._reindex_state["last_error"] = str(exc)

        self._reindex_state["status"] = (
            "completed" if self._reindex_state["failed"] == 0 else "completed_with_errors"
        )
        self._reindex_state["completed_at"] = utc_now_iso()
        return self.get_reindex_status()

    def cleanup_expired_memories(self, record_empty: bool = False) -> int:
        """
        Deletes expired TTL memories (`expires_at IS NOT NULL AND expires_at <= now`)
        and cascades cleanup to `vec_memories`.
        """
        t0 = time.perf_counter()
        now_iso = datetime.now(timezone.utc).isoformat()
        with get_db() as conn:
            expired_rows = conn.execute(
                """
                SELECT id FROM memories
                WHERE expires_at IS NOT NULL AND expires_at <= ?
                """,
                (now_iso,),
            ).fetchall()

            cleaned = len(expired_rows)
            if cleaned > 0:
                expired_ids = [r["id"] for r in expired_rows]
                placeholders = ",".join("?" for _ in expired_ids)
                conn.execute(
                    f"DELETE FROM vec_memories WHERE memory_id IN ({placeholders})",
                    tuple(expired_ids),
                )
                conn.execute(
                    f"DELETE FROM memories WHERE id IN ({placeholders})",
                    tuple(expired_ids),
                )
                logger.info("Cleaned up %d expired TTL memories", cleaned)

        self._ttl_sweeps_count += 1
        self._expired_cleaned_total += cleaned
        if cleaned > 0 or record_empty:
            latency_ms = (time.perf_counter() - t0) * 1000.0
            self._record_job(
                job_id=f"job_{uuid.uuid4().hex[:12]}",
                job_type="ttl_cleanup",
                workspace="global",
                status="completed",
                summary=f"TTL sweep removed {cleaned} expired episodic record(s)",
                detail=f"Checked expires_at <= {now_iso}; removed {cleaned} expired rows from memories + vec_memories.",
                items_processed=cleaned,
                secrets_redacted=0,
                latency_ms=latency_ms,
                created_at=now_iso,
                completed_at=utc_now_iso(),
            )
        return cleaned

    async def _ttl_cleanup_loop(self) -> None:
        while self._running:
            try:
                await asyncio.sleep(60.0)
                self.cleanup_expired_memories(record_empty=False)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.warning("TTL cleanup iteration error: %s", exc)


background_worker = BackgroundWorker()
