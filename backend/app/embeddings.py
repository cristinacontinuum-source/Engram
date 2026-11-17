import asyncio
import gc
import logging
import math
import os
import time
from typing import Any, Dict, List, Optional

import httpx

from app.config import EmbeddingMode, settings

logger = logging.getLogger("engram.embeddings")


def _get_process_rss_mb() -> float:
    """Returns current process Resident Set Size (RSS) in MB."""
    try:
        with open("/proc/self/statm", "r", encoding="utf-8") as f:
            parts = f.read().split()
            if len(parts) >= 2:
                resident_pages = int(parts[1])
                page_size = os.sysconf("SC_PAGE_SIZE")
                return round((resident_pages * page_size) / (1024 * 1024), 2)
    except Exception:
        pass
    try:
        import resource

        usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        # On Linux ru_maxrss is in KB
        return round(usage / 1024.0, 2)
    except Exception:
        return 0.0


def _normalize_l2(vec: List[float]) -> List[float]:
    norm = math.sqrt(sum(x * x for x in vec))
    if norm <= 1e-12:
        return vec
    return [x / norm for x in vec]


class EmbeddingManager:
    """
    Zero-RAM Lazy Embedding Manager for Engram.
    - In `external` mode (default): Calls OpenAI-compatible `/embeddings` API.
      `fastembed` and ONNX Runtime are NEVER imported at module level (0 MB local model RAM).
    - In `local` mode: Lazily imports `fastembed` inside `_get_local_embedder()`,
      caching weights in `/data/models`.
    - Switching from `local` -> `external` explicitly deletes the model instance
      and triggers `gc.collect()` to release RAM immediately.
    """

    def __init__(self) -> None:
        self._local_model: Any = None
        self._local_model_name: Optional[str] = None
        self._lock = asyncio.Lock()

    def _get_local_embedder(self) -> Any:
        """
        Lazily imports `fastembed` and initializes `TextEmbedding` ONLY when
        `settings.embedding_mode == "local"`.
        """
        if settings.embedding_mode != "local":
            raise RuntimeError(
                "Local embedder requested while embedding_mode is not 'local'"
            )

        target_model = settings.local_embedding_model
        if self._local_model is None or self._local_model_name != target_model:
            if self._local_model is not None:
                del self._local_model
                self._local_model = None
                gc.collect()

            # Strict Rule 5: Import fastembed exclusively inside _get_local_embedder()
            from fastembed import TextEmbedding

            os.makedirs(settings.local_models_dir, exist_ok=True)
            logger.info(
                "Loading local FastEmbed model '%s' from cache_dir='%s'",
                target_model,
                settings.local_models_dir,
            )
            self._local_model = TextEmbedding(
                model_name=target_model,
                cache_dir=settings.local_models_dir,
            )
            self._local_model_name = target_model

        return self._local_model

    def release_local_model(self) -> Dict[str, Any]:
        """
        Explicitly unloads the local ONNX embedding model from memory and runs
        garbage collection (`del` + `gc.collect()`).
        """
        ram_before = _get_process_rss_mb()
        was_loaded = self._local_model is not None
        if self._local_model is not None:
            del self._local_model
            self._local_model = None
            self._local_model_name = None
        gc.collect()
        ram_after = _get_process_rss_mb()
        logger.info(
            "Released local embedding model (was_loaded=%s, ram_before=%.2fMB, ram_after=%.2fMB)",
            was_loaded,
            ram_before,
            ram_after,
        )
        return {
            "was_loaded": was_loaded,
            "ram_before_mb": ram_before,
            "ram_after_mb": ram_after,
        }

    async def switch_mode(self, new_mode: EmbeddingMode) -> Dict[str, Any]:
        """
        Switches between `external` and `local` embedding modes.
        When switching to `external`, immediately frees any loaded local ONNX model.
        """
        async with self._lock:
            old_mode = settings.embedding_mode
            settings.embedding_mode = new_mode
            release_info = {"was_loaded": False, "ram_before_mb": _get_process_rss_mb(), "ram_after_mb": _get_process_rss_mb()}
            if new_mode == "external":
                release_info = self.release_local_model()
            return {
                "previous_mode": old_mode,
                "active_mode": settings.embedding_mode,
                "local_model_loaded": self._local_model is not None,
                **release_info,
            }

    def _format_local_inputs(
        self, texts: List[str], is_query: bool = False
    ) -> List[str]:
        model_lower = settings.local_embedding_model.lower()
        if "e5" in model_lower:
            prefix = "query: " if is_query else "passage: "
            return [
                t if t.startswith(("query: ", "passage: ")) else f"{prefix}{t}"
                for t in texts
            ]
        return texts

    def _embed_local_sync(
        self, texts: List[str], is_query: bool = False
    ) -> List[List[float]]:
        embedder = self._get_local_embedder()
        formatted = self._format_local_inputs(texts, is_query=is_query)
        raw_embeddings = list(embedder.embed(formatted))
        results: List[List[float]] = []
        for vec in raw_embeddings:
            float_list = [float(x) for x in vec.tolist()] if hasattr(vec, "tolist") else [float(x) for x in vec]
            results.append(_normalize_l2(float_list))
        return results

    async def _embed_external_async(
        self,
        texts: List[str],
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
    ) -> List[List[float]]:
        target_base = (base_url or settings.embedding_base_url).rstrip("/")
        target_key = api_key if api_key is not None else settings.embedding_api_key
        target_model = model or settings.embedding_model

        url = f"{target_base}/embeddings"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {target_key}",
        }
        payload = {
            "model": target_model,
            "input": texts,
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()

        items = data.get("data", [])
        if not items:
            raise ValueError(f"Empty embedding data returned from {url}")

        # Sort by index to preserve input order
        items_sorted = sorted(items, key=lambda item: item.get("index", 0))
        vectors: List[List[float]] = []
        for item in items_sorted:
            vec = [float(x) for x in item["embedding"]]
            vectors.append(_normalize_l2(vec))
        return vectors

    async def embed_batch(
        self, texts: List[str], is_query: bool = False
    ) -> List[List[float]]:
        """
        Generates normalized float32 vectors for a batch of texts using the
        currently configured `embedding_mode` (`external` or `local`).
        """
        if not texts:
            return []

        cleaned = [t.strip() or " " for t in texts]
        if settings.embedding_mode == "local":
            async with self._lock:
                vectors = await asyncio.to_thread(
                    self._embed_local_sync, cleaned, is_query
                )
        else:
            # Ensure local model is never retained in external mode
            if self._local_model is not None:
                self.release_local_model()
            vectors = await self._embed_external_async(cleaned)

        return vectors

    async def embed_text(self, text: str, is_query: bool = False) -> List[float]:
        """Generates a single normalized embedding vector."""
        batch = await self.embed_batch([text], is_query=is_query)
        if not batch:
            raise RuntimeError("Failed to generate embedding vector")
        return batch[0]

    async def test_connection(
        self,
        mode: Optional[EmbeddingMode] = None,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        local_model: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Tests the selected embedding provider, measures latency in ms, and returns
        the detected vector dimension (e.g., 1536 or 384).
        """
        target_mode: EmbeddingMode = mode or settings.embedding_mode
        start = time.perf_counter()
        sample_text = "Engram hybrid vector and graph memory verification probe."

        try:
            if target_mode == "local":
                prev_mode = settings.embedding_mode
                prev_local_model = settings.local_embedding_model
                try:
                    settings.embedding_mode = "local"
                    if local_model:
                        settings.local_embedding_model = local_model
                    vecs = await asyncio.to_thread(
                        self._embed_local_sync, [sample_text], True
                    )
                    vec = vecs[0]
                    active_model_name = settings.local_embedding_model
                finally:
                    settings.embedding_mode = prev_mode
                    settings.local_embedding_model = prev_local_model
                    if prev_mode == "external":
                        self.release_local_model()
            else:
                vecs = await self._embed_external_async(
                    [sample_text],
                    base_url=base_url,
                    api_key=api_key,
                    model=model,
                )
                vec = vecs[0]
                active_model_name = model or settings.embedding_model

            latency_ms = round((time.perf_counter() - start) * 1000.0, 2)
            detected_dim = len(vec)
            return {
                "status": "ok",
                "mode": target_mode,
                "model": active_model_name,
                "detected_dimension": detected_dim,
                "current_db_dimension": settings.embedding_dimension,
                "dimension_mismatch": detected_dim != settings.embedding_dimension,
                "latency_ms": latency_ms,
                "ram_mb": _get_process_rss_mb(),
            }
        except Exception as exc:
            latency_ms = round((time.perf_counter() - start) * 1000.0, 2)
            logger.warning("Embedding test_connection failed: %s", exc)
            return {
                "status": "error",
                "mode": target_mode,
                "model": (
                    (local_model or settings.local_embedding_model)
                    if target_mode == "local"
                    else (model or settings.embedding_model)
                ),
                "latency_ms": latency_ms,
                "detail": str(exc),
            }

    def get_status(self) -> Dict[str, Any]:
        """Returns current embedding mode, model name, and RAM footprint."""
        return {
            "embedding_mode": settings.embedding_mode,
            "active_model": (
                settings.local_embedding_model
                if settings.embedding_mode == "local"
                else settings.embedding_model
            ),
            "embedding_dimension": settings.embedding_dimension,
            "local_model_loaded": self._local_model is not None,
            "ram_usage_mb": _get_process_rss_mb(),
        }


embedding_manager = EmbeddingManager()
