import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

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

            try:
                if job_type == "store_memory":
                    await memory_engine.ingest_memory(
                        content=payload["content"],
                        memory_type=payload.get("memory_type", "semantic"),
                        workspace=payload.get("workspace", "global"),
                        source=payload.get("source", "agent_inferred"),
                        confidence=float(payload.get("confidence", 0.85)),
                        is_pinned=bool(payload.get("is_pinned", False)),
                        ttl_hours=payload.get("ttl_hours"),
                        extract_graph=True,
                    )
                elif job_type == "ingest_messages":
                    extracted = await llm_service.extract_memories_from_messages(
                        payload.get("messages", [])
                    )
                    ws = payload.get("workspace", "global")
                    for item in extracted:
                        await memory_engine.ingest_memory(
                            content=item["content"],
                            memory_type=item.get("memory_type", "semantic"),
                            workspace=ws,
                            source="agent_inferred",
                            confidence=float(item.get("confidence", 0.85)),
                            is_pinned=item.get("memory_type") == "procedural",
                            extract_graph=True,
                        )
                elif job_type == "reindex_all":
                    await self.run_reindex_all(
                        target_dimension=payload.get("target_dimension")
                    )

                self._jobs_processed += 1
            except Exception as exc:
                logger.error("Worker job %s (%s) failed: %s", job_id, job_type, exc)
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

    def cleanup_expired_memories(self) -> int:
        """
        Deletes expired TTL memories (`expires_at IS NOT NULL AND expires_at <= now`)
        and cascades cleanup to `vec_memories`.
        """
        now_iso = datetime.now(timezone.utc).isoformat()
        with get_db() as conn:
            expired_rows = conn.execute(
                """
                SELECT id FROM memories
                WHERE expires_at IS NOT NULL AND expires_at <= ?
                """,
                (now_iso,),
            ).fetchall()

            if not expired_rows:
                return 0

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
            logger.info("Cleaned up %d expired TTL memories", len(expired_ids))
            return len(expired_ids)

    async def _ttl_cleanup_loop(self) -> None:
        while self._running:
            try:
                await asyncio.sleep(60.0)
                self.cleanup_expired_memories()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.warning("TTL cleanup iteration error: %s", exc)


background_worker = BackgroundWorker()
