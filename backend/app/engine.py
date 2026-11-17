import logging
import math
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from app.config import settings
from app.database import (
    get_current_vec_dimension,
    get_db,
    recreate_vector_table,
    serialize_f32,
    utc_now_iso,
)
from app.embeddings import embedding_manager
from app.llm_service import estimate_tokens, llm_service

logger = logging.getLogger("engram.engine")

# ==============================================================================
# 1. Security Guardrail: Regex Credential & Secret Scrubber on Write
# ==============================================================================
SECRET_PATTERNS: List[Tuple[str, re.Pattern[str]]] = [
    (
        "openai_or_router_key",
        re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b"),
    ),
    (
        "google_api_key",
        re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b"),
    ),
    (
        "github_pat",
        re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b"),
    ),
    (
        "slack_token",
        re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),
    ),
    (
        "aws_access_key",
        re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    ),
    (
        "jwt_token",
        re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
    ),
    (
        "private_key_block",
        re.compile(
            r"-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----"
        ),
    ),
    (
        "bearer_header",
        re.compile(r"(?i)(Authorization\s*:\s*Bearer\s+)[^\s\"']+"),
    ),
    (
        "key_value_secret",
        re.compile(
            r"(?i)\b(password|passwd|secret|api_key|apikey|access_token|private_key)\s*([:=])\s*['\"]?([A-Za-z0-9_\-./+=]{8,})['\"]?"
        ),
    ),
]


def scrub_secrets(text: str) -> Tuple[str, int]:
    """
    Scans incoming text and replaces credentials, tokens, and secrets with
    `[REDACTED_SECRET]`. Returns `(scrubbed_text, redaction_count)`.
    """
    if not text:
        return "", 0

    scrubbed = text
    redactions = 0

    for name, pattern in SECRET_PATTERNS:
        if name == "bearer_header":
            scrubbed, count = pattern.subn(r"\1[REDACTED_SECRET]", scrubbed)
            redactions += count
        elif name == "key_value_secret":
            def _kv_replacer(match: re.Match[str]) -> str:
                val = match.group(3)
                if val in ("[REDACTED_SECRET]", "dummy-key", "changeme"):
                    return match.group(0)
                return f"{match.group(1)}{match.group(2)}[REDACTED_SECRET]"

            before = scrubbed
            scrubbed = pattern.sub(_kv_replacer, scrubbed)
            if scrubbed != before:
                redactions += 1
        else:
            scrubbed, count = pattern.subn("[REDACTED_SECRET]", scrubbed)
            redactions += count

    return scrubbed, redactions


# ==============================================================================
# 2. Composite Hybrid Ranking Math (SPEC.md §2)
# ==============================================================================
def compute_days_elapsed(iso_timestamp: str, now_dt: Optional[datetime] = None) -> float:
    """Computes delta_t in days from an ISO-8601 timestamp to now."""
    ref_now = now_dt or datetime.now(timezone.utc)
    try:
        parsed = datetime.fromisoformat(iso_timestamp.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        delta_seconds = max(0.0, (ref_now - parsed).total_seconds())
        return delta_seconds / 86400.0
    except Exception:
        return 0.0


def compute_composite_score(
    s_vector: float,
    s_graph: float,
    days_elapsed: float,
    confidence: float,
    is_pinned: bool,
    memory_type: str,
    decay_lambda: float = 0.03,
) -> Dict[str, float]:
    """
    Implements the exact SPEC.md §2 Composite Retrieval Ranking Formula:
    FinalScore = (0.55 * S_vector) + (0.20 * S_graph) + (0.15 * S_recency)
                 + (0.10 * Confidence) + B_pinned
    """
    clamped_vec = max(0.0, min(1.0, float(s_vector)))
    clamped_graph = 1.0 if s_graph >= 0.5 else 0.0
    clamped_conf = max(0.0, min(1.0, float(confidence)))

    if is_pinned:
        s_recency = 1.0
    else:
        s_recency = math.exp(-decay_lambda * max(0.0, float(days_elapsed)))

    b_pinned = 0.15 if (is_pinned or memory_type == "procedural") else 0.0

    final_score = (
        (0.55 * clamped_vec)
        + (0.20 * clamped_graph)
        + (0.15 * s_recency)
        + (0.10 * clamped_conf)
        + b_pinned
    )

    return {
        "vector_score": round(clamped_vec, 4),
        "graph_score": round(clamped_graph, 4),
        "recency_score": round(s_recency, 4),
        "confidence_score": round(clamped_conf, 4),
        "pinned_boost": round(b_pinned, 4),
        "final_score": round(final_score, 4),
    }


def _row_to_memory_dict(row: Any) -> Dict[str, Any]:
    d = dict(row)
    pinned_bool = bool(d.get("is_pinned", 0))
    d["is_pinned"] = 1 if pinned_bool else 0
    d["type"] = d.get("memory_type") or d.get("type") or "semantic"
    d["memory_type"] = d["type"]
    d["superseded_by_id"] = d.get("superseded_by")
    d["valid_until"] = d.get("valid_to")
    d["confidence"] = float(d.get("confidence", 0.85))
    d["access_count"] = int(d.get("access_count", 0))
    return d


# ==============================================================================
# 3. Core Memory & Knowledge Graph Engine
# ==============================================================================
class MemoryEngine:
    """
    Core storage, deduplication, 1-hop graph traversal, bi-temporal versioning,
    and hybrid retrieval engine for Engram.
    """

    def _upsert_graph_triples_sync(
        self,
        conn: Any,
        workspace: str,
        memory_id: str,
        triples: List[Dict[str, str]],
    ) -> int:
        """Persists extracted entity-relation triples into `entities` and `edges`."""
        if not triples:
            return 0

        now = utc_now_iso()
        edges_created = 0

        for triple in triples:
            src_name = str(triple.get("source", "")).strip()
            src_type = str(triple.get("source_type", "concept")).strip() or "concept"
            rel = str(triple.get("relation", "RELATED_TO")).strip().upper() or "RELATED_TO"
            tgt_name = str(triple.get("target", "")).strip()
            tgt_type = str(triple.get("target_type", "concept")).strip() or "concept"

            if not src_name or not tgt_name or src_name.lower() == tgt_name.lower():
                continue

            # Upsert source entity
            src_row = conn.execute(
                "SELECT id FROM entities WHERE workspace = ? AND lower(name) = lower(?)",
                (workspace, src_name),
            ).fetchone()
            if src_row:
                src_id = src_row["id"]
            else:
                src_id = f"ent_{uuid.uuid4().hex[:12]}"
                conn.execute(
                    """
                    INSERT OR IGNORE INTO entities (id, workspace, name, entity_type)
                    VALUES (?, ?, ?, ?)
                    """,
                    (src_id, workspace, src_name, src_type),
                )
                recheck = conn.execute(
                    "SELECT id FROM entities WHERE workspace = ? AND lower(name) = lower(?)",
                    (workspace, src_name),
                ).fetchone()
                if recheck:
                    src_id = recheck["id"]

            # Upsert target entity
            tgt_row = conn.execute(
                "SELECT id FROM entities WHERE workspace = ? AND lower(name) = lower(?)",
                (workspace, tgt_name),
            ).fetchone()
            if tgt_row:
                tgt_id = tgt_row["id"]
            else:
                tgt_id = f"ent_{uuid.uuid4().hex[:12]}"
                conn.execute(
                    """
                    INSERT OR IGNORE INTO entities (id, workspace, name, entity_type)
                    VALUES (?, ?, ?, ?)
                    """,
                    (tgt_id, workspace, tgt_name, tgt_type),
                )
                recheck = conn.execute(
                    "SELECT id FROM entities WHERE workspace = ? AND lower(name) = lower(?)",
                    (workspace, tgt_name),
                ).fetchone()
                if recheck:
                    tgt_id = recheck["id"]

            edge_id = f"edge_{uuid.uuid4().hex[:12]}"
            conn.execute(
                """
                INSERT INTO edges (id, workspace, source_id, relation, target_id, memory_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (edge_id, workspace, src_id, rel, tgt_id, memory_id, now),
            )
            edges_created += 1

        return edges_created

    def _upsert_vector_sync(
        self, conn: Any, memory_id: str, vector: List[float]
    ) -> None:
        """Inserts or replaces a vector in `vec_memories`, auto-adjusting table dim if needed."""
        if not vector:
            return
        current_dim = get_current_vec_dimension(conn)
        if len(vector) != current_dim:
            logger.warning(
                "Vector dimension mismatch (got %d, table has %d); recreating vec_memories",
                len(vector),
                current_dim,
            )
            recreate_vector_table(len(vector), conn)

        conn.execute("DELETE FROM vec_memories WHERE memory_id = ?", (memory_id,))
        conn.execute(
            "INSERT INTO vec_memories (memory_id, embedding) VALUES (?, ?)",
            (memory_id, serialize_f32(vector)),
        )

    async def ingest_memory(
        self,
        content: str,
        memory_type: str = "semantic",
        workspace: str = "global",
        source: str = "agent_inferred",
        confidence: float = 0.85,
        is_pinned: bool = False,
        ttl_hours: Optional[int] = None,
        extract_graph: bool = True,
    ) -> Dict[str, Any]:
        """
        Full cognitive ingestion pipeline:
        1. Regex secret scrubbing.
        2. Vector embedding generation.
        3. Smart Deduplication (`cosine_similarity > 0.85` in same workspace) -> LLM Smart Merge.
        4. SQLite `memories` + `vec_memories` persistence.
        5. 1-Hop Knowledge Graph entity-relation extraction.
        """
        clean_ws = (workspace or "global").strip() or "global"
        clean_type = (
            memory_type
            if memory_type in ("semantic", "procedural", "episodic")
            else "semantic"
        )
        clean_source = (
            source
            if source in ("user_explicit", "agent_inferred", "tool_error", "seed_import")
            else "agent_inferred"
        )
        scrubbed_content, redaction_count = scrub_secrets(content.strip())
        if not scrubbed_content:
            raise ValueError("Memory content cannot be empty")

        now = utc_now_iso()
        expires_at: Optional[str] = None
        if ttl_hours is not None and ttl_hours > 0:
            expires_at = (
                datetime.now(timezone.utc) + timedelta(hours=int(ttl_hours))
            ).isoformat()

        # Step 1: Generate embedding (gracefully handle offline embedding provider)
        vector: Optional[List[float]] = None
        try:
            vector = await embedding_manager.embed_text(scrubbed_content, is_query=False)
        except Exception as exc:
            logger.warning(
                "Embedding provider unreachable during ingest (%s); storing memory metadata first",
                exc,
            )

        # Step 2: Check for Smart Deduplication candidate (cosine > 0.85)
        duplicate_row: Optional[Dict[str, Any]] = None
        max_similarity = 0.0

        if vector is not None:
            with get_db() as conn:
                current_dim = get_current_vec_dimension(conn)
                if len(vector) == current_dim:
                    try:
                        vec_matches = conn.execute(
                            """
                            SELECT memory_id, distance
                            FROM vec_memories
                            WHERE embedding MATCH ? AND k = 5
                            """,
                            (serialize_f32(vector),),
                        ).fetchall()
                        for vm in vec_matches:
                            sim = 1.0 - float(vm["distance"])
                            if sim >= settings.dedup_cosine_threshold:
                                mem_row = conn.execute(
                                    """
                                    SELECT * FROM memories
                                    WHERE id = ? AND workspace = ? AND status = 'active'
                                    """,
                                    (vm["memory_id"], clean_ws),
                                ).fetchone()
                                if mem_row and sim > max_similarity:
                                    max_similarity = sim
                                    duplicate_row = _row_to_memory_dict(mem_row)
                    except Exception as exc:
                        logger.debug("Deduplication vector lookup skipped: %s", exc)

        # Step 3: If duplicate found (cosine > 0.85), run Smart Merge & Upsert
        if duplicate_row is not None:
            existing_id = duplicate_row["id"]
            merged_content = await llm_service.smart_merge_memories(
                existing_content=duplicate_row["content"],
                new_content=scrubbed_content,
                memory_type=clean_type,
            )
            merged_content, extra_redactions = scrub_secrets(merged_content)
            redaction_count += extra_redactions

            if merged_content != duplicate_row["content"]:
                try:
                    vector = await embedding_manager.embed_text(
                        merged_content, is_query=False
                    )
                except Exception:
                    pass

            new_conf = max(float(duplicate_row["confidence"]), float(confidence))
            new_pinned = 1 if (is_pinned or duplicate_row["is_pinned"]) else 0

            with get_db() as conn:
                conn.execute(
                    """
                    UPDATE memories
                    SET content = ?,
                        confidence = ?,
                        is_pinned = ?,
                        expires_at = COALESCE(?, expires_at),
                        updated_at = ?,
                        last_accessed_at = ?
                    WHERE id = ?
                    """,
                    (
                        merged_content,
                        new_conf,
                        new_pinned,
                        expires_at,
                        now,
                        now,
                        existing_id,
                    ),
                )
                if vector is not None:
                    self._upsert_vector_sync(conn, existing_id, vector)

            if extract_graph:
                triples = await llm_service.extract_graph_triples(
                    merged_content, workspace=clean_ws
                )
                if triples:
                    with get_db() as conn:
                        self._upsert_graph_triples_sync(
                            conn, clean_ws, existing_id, triples
                        )

            return {
                "action": "merged",
                "memory_id": existing_id,
                "workspace": clean_ws,
                "memory_type": clean_type,
                "similarity": round(max_similarity, 4),
                "content": merged_content,
                "secrets_redacted": redaction_count,
            }

        # Step 4: Insert brand-new memory
        memory_id = f"mem_{uuid.uuid4().hex[:12]}"
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO memories (
                    id, workspace, content, memory_type, source, confidence,
                    is_pinned, status, superseded_by, access_count,
                    last_accessed_at, valid_from, valid_to, expires_at,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', NULL, 0, ?, ?, NULL, ?, ?, ?)
                """,
                (
                    memory_id,
                    clean_ws,
                    scrubbed_content,
                    clean_type,
                    clean_source,
                    max(0.0, min(1.0, float(confidence))),
                    1 if is_pinned else 0,
                    now,
                    now,
                    expires_at,
                    now,
                    now,
                ),
            )
            if vector is not None:
                self._upsert_vector_sync(conn, memory_id, vector)

        edges_added = 0
        if extract_graph:
            triples = await llm_service.extract_graph_triples(
                scrubbed_content, workspace=clean_ws
            )
            if triples:
                with get_db() as conn:
                    edges_added = self._upsert_graph_triples_sync(
                        conn, clean_ws, memory_id, triples
                    )

        return {
            "action": "inserted",
            "memory_id": memory_id,
            "workspace": clean_ws,
            "memory_type": clean_type,
            "content": scrubbed_content,
            "edges_created": edges_added,
            "secrets_redacted": redaction_count,
        }

    def _find_1hop_graph_memory_ids(
        self, conn: Any, query: str, workspaces: List[str]
    ) -> set[str]:
        """
        Finds all memory_ids linked via 1-hop knowledge graph edges to entities
        whose names appear in the query (or match query tokens >= 3 chars).
        """
        q_lower = query.lower().strip()
        if not q_lower:
            return set()

        placeholders = ",".join("?" for _ in workspaces)
        entities = conn.execute(
            f"SELECT id, name FROM entities WHERE workspace IN ({placeholders})",
            tuple(workspaces),
        ).fetchall()

        matched_entity_ids: List[str] = []
        query_tokens = {
            tok
            for tok in re.findall(r"[a-zA-Z0-9_-]{3,}", q_lower)
            if tok not in {"the", "and", "for", "with", "how", "what", "from", "that"}
        }

        for ent in entities:
            ent_name_lower = str(ent["name"]).lower()
            if ent_name_lower in q_lower or any(
                tok == ent_name_lower or (len(tok) >= 4 and tok in ent_name_lower)
                for tok in query_tokens
            ):
                matched_entity_ids.append(ent["id"])

        if not matched_entity_ids:
            return set()

        ent_placeholders = ",".join("?" for _ in matched_entity_ids)
        ws_placeholders = ",".join("?" for _ in workspaces)
        params = tuple(workspaces) + tuple(matched_entity_ids) + tuple(matched_entity_ids)

        edge_rows = conn.execute(
            f"""
            SELECT DISTINCT memory_id
            FROM edges
            WHERE workspace IN ({ws_placeholders})
              AND memory_id IS NOT NULL
              AND (source_id IN ({ent_placeholders}) OR target_id IN ({ent_placeholders}))
            """,
            params,
        ).fetchall()

        return {row["memory_id"] for row in edge_rows if row["memory_id"]}

    async def hybrid_recall(
        self,
        query: str,
        workspace: str = "global",
        top_k: int = 5,
        distill: bool = True,
        record_telemetry: bool = True,
    ) -> Dict[str, Any]:
        """
        Executes Hybrid Retrieval across `workspace IN (:workspace, 'global')`:
        1. Vector similarity search via `sqlite-vec` (`vec_memories`).
        2. 1-Hop Knowledge Graph entity boost (`S_graph`).
        3. Exponential time-decay (`S_recency`) + Pinned/Procedural boost (`B_pinned`).
        4. Optional Fast LLM Context Distillation + Token Savings Telemetry logging.
        """
        start_time = time.perf_counter()
        clean_ws = (workspace or "global").strip() or "global"
        workspaces = list({clean_ws, "global"})
        k_limit = max(1, min(50, int(top_k)))
        now_iso = utc_now_iso()
        now_dt = datetime.now(timezone.utc)

        # 1. Embed query
        query_vec: Optional[List[float]] = None
        try:
            query_vec = await embedding_manager.embed_text(query, is_query=True)
        except Exception as exc:
            logger.warning(
                "Query embedding fallback to lexical/graph scoring (%s)", exc
            )

        with get_db() as conn:
            ws_placeholders = ",".join("?" for _ in workspaces)
            active_rows = conn.execute(
                f"""
                SELECT * FROM memories
                WHERE workspace IN ({ws_placeholders})
                  AND status = 'active'
                  AND (expires_at IS NULL OR expires_at > ?)
                """,
                (*workspaces, now_iso),
            ).fetchall()

            if not active_rows:
                latency_ms = round((time.perf_counter() - start_time) * 1000.0, 2)
                return {
                    "workspace": clean_ws,
                    "query": query,
                    "results": [],
                    "distilled_context": "",
                    "raw_tokens": 0,
                    "distilled_tokens": 0,
                    "tokens_saved": 0,
                    "savings_pct": 0.0,
                    "latency_ms": latency_ms,
                }

            active_map: Dict[str, Dict[str, Any]] = {
                row["id"]: _row_to_memory_dict(row) for row in active_rows
            }

            # 2. Vector distance lookup in vec_memories
            vec_scores: Dict[str, float] = {}
            if query_vec is not None and len(query_vec) == get_current_vec_dimension(conn):
                try:
                    candidate_k = min(len(active_map) + 10, max(k_limit * 6, 30))
                    vec_rows = conn.execute(
                        """
                        SELECT memory_id, distance
                        FROM vec_memories
                        WHERE embedding MATCH ? AND k = ?
                        """,
                        (serialize_f32(query_vec), candidate_k),
                    ).fetchall()
                    for vr in vec_rows:
                        mid = vr["memory_id"]
                        if mid in active_map:
                            vec_scores[mid] = max(
                                0.0, min(1.0, 1.0 - float(vr["distance"]))
                            )
                except Exception as exc:
                    logger.debug("vec_memories MATCH query error: %s", exc)

            # Fallback lexical overlap if vector wasn't computed for some rows
            q_terms = set(re.findall(r"[a-zA-Z0-9_-]{3,}", query.lower()))
            for mid, mem in active_map.items():
                if mid not in vec_scores:
                    if not q_terms:
                        vec_scores[mid] = 0.25
                    else:
                        c_lower = mem["content"].lower()
                        hits = sum(1 for t in q_terms if t in c_lower)
                        vec_scores[mid] = min(0.85, (hits / max(1, len(q_terms))) * 0.85)

            # 3. 1-Hop Graph Entity Match
            graph_matched_ids = self._find_1hop_graph_memory_ids(
                conn, query=query, workspaces=workspaces
            )

            # 4. Compute composite scores
            scored_memories: List[Dict[str, Any]] = []
            for mid, mem in active_map.items():
                s_vec = vec_scores.get(mid, 0.0)
                s_graph = 1.0 if mid in graph_matched_ids else 0.0
                days_old = compute_days_elapsed(
                    mem.get("updated_at") or mem.get("created_at") or now_iso,
                    now_dt=now_dt,
                )
                breakdown = compute_composite_score(
                    s_vector=s_vec,
                    s_graph=s_graph,
                    days_elapsed=days_old,
                    confidence=mem["confidence"],
                    is_pinned=mem["is_pinned"],
                    memory_type=mem["memory_type"],
                    decay_lambda=settings.recency_decay_lambda,
                )
                enriched = {
                    **mem,
                    **breakdown,
                    "score": breakdown["final_score"],
                    "score_breakdown": {
                        "vector_score": breakdown["vector_score"],
                        "graph_boost": breakdown["graph_score"],
                        "recency_score": breakdown["recency_score"],
                        "confidence_score": breakdown["confidence_score"],
                        "pinned_boost": breakdown["pinned_boost"],
                    },
                }
                scored_memories.append(enriched)

            scored_memories.sort(key=lambda item: item["final_score"], reverse=True)
            top_results = scored_memories[:k_limit]

            # 5. Increment access_count on retrieved memories
            if record_telemetry and top_results:
                for item in top_results:
                    conn.execute(
                        """
                        UPDATE memories
                        SET access_count = access_count + 1,
                            last_accessed_at = ?
                        WHERE id = ?
                        """,
                        (now_iso, item["id"]),
                    )
                    item["access_count"] = int(item["access_count"]) + 1
                    item["last_accessed_at"] = now_iso

        # 6. Context Distillation
        if distill and top_results:
            distill_info = await llm_service.distill_memories(query, top_results)
        else:
            raw_concat = "\n".join(m["content"] for m in top_results)
            raw_tok = estimate_tokens(raw_concat)
            distill_info = {
                "distilled_context": raw_concat,
                "raw_tokens": raw_tok,
                "distilled_tokens": raw_tok,
                "tokens_saved": 0,
                "savings_pct": 0.0,
            }

        latency_ms = round((time.perf_counter() - start_time) * 1000.0, 2)

        if record_telemetry:
            with get_db() as conn:
                conn.execute(
                    """
                    INSERT INTO telemetry_logs (
                        workspace, query, raw_tokens, distilled_tokens, latency_ms, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        clean_ws,
                        query[:500],
                        int(distill_info["raw_tokens"]),
                        int(distill_info["distilled_tokens"]),
                        latency_ms,
                        now_iso,
                    ),
                )

        return {
            "workspace": clean_ws,
            "query": query,
            "top_k": k_limit,
            "distill": distill,
            "results": top_results,
            **distill_info,
            "token_metrics": {
                "raw_tokens": int(distill_info["raw_tokens"]),
                "distilled_tokens": int(distill_info["distilled_tokens"]),
                "tokens_saved": int(distill_info["tokens_saved"]),
                "savings_pct": float(distill_info["savings_pct"]),
            },
            "latency_ms": latency_ms,
        }

    # ==========================================================================
    # 4. Bi-Temporal Versioning & Rollback (SPEC.md §3 & §4)
    # ==========================================================================
    async def supersede_memory(
        self,
        old_memory_id: str,
        new_content: str,
        reason: str = "Updated fact",
        workspace: str = "global",
    ) -> Dict[str, Any]:
        """
        Marks `old_memory_id` as `status='superseded'` and `valid_to=now()`,
        inserts the updated memory as `status='active'`, and links `superseded_by`.
        """
        scrubbed_new, redactions = scrub_secrets(new_content.strip())
        if not scrubbed_new:
            raise ValueError("New memory content cannot be empty")

        now = utc_now_iso()
        new_id = f"mem_{uuid.uuid4().hex[:12]}"

        with get_db() as conn:
            old_row = conn.execute(
                "SELECT * FROM memories WHERE id = ?", (old_memory_id,)
            ).fetchone()
            if not old_row:
                raise KeyError(f"Memory '{old_memory_id}' not found")

            old_mem = _row_to_memory_dict(old_row)
            target_ws = old_mem["workspace"] or workspace

            # Insert new active version inheriting type and pin state
            conn.execute(
                """
                INSERT INTO memories (
                    id, workspace, content, memory_type, source, confidence,
                    is_pinned, status, superseded_by, access_count,
                    last_accessed_at, valid_from, valid_to, expires_at,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'user_explicit', ?, ?, 'active', NULL, 0, ?, ?, NULL, ?, ?, ?)
                """,
                (
                    new_id,
                    target_ws,
                    scrubbed_new,
                    old_mem["memory_type"],
                    old_mem["confidence"],
                    1 if old_mem["is_pinned"] else 0,
                    now,
                    now,
                    old_mem.get("expires_at"),
                    now,
                    now,
                ),
            )

            # Mark old memory superseded
            conn.execute(
                """
                UPDATE memories
                SET status = 'superseded',
                    superseded_by = ?,
                    valid_to = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (new_id, now, now, old_memory_id),
            )
            conn.execute(
                "DELETE FROM vec_memories WHERE memory_id = ?", (old_memory_id,)
            )

        # Embed and index the new memory
        try:
            vec = await embedding_manager.embed_text(scrubbed_new, is_query=False)
            with get_db() as conn:
                self._upsert_vector_sync(conn, new_id, vec)
        except Exception as exc:
            logger.warning("Failed to embed superseded replacement %s: %s", new_id, exc)

        return {
            "status": "superseded",
            "old_memory_id": old_memory_id,
            "new_memory_id": new_id,
            "workspace": target_ws,
            "reason": reason,
            "new_content": scrubbed_new,
            "secrets_redacted": redactions,
        }

    def get_memory_history(self, memory_id: str) -> Dict[str, Any]:
        """
        Returns the full bi-temporal lineage chain (`superseded` -> `active` versions)
        for any memory ID in the chain.
        """
        with get_db() as conn:
            target = conn.execute(
                "SELECT * FROM memories WHERE id = ?", (memory_id,)
            ).fetchone()
            if not target:
                raise KeyError(f"Memory '{memory_id}' not found")

            # Walk backward to the earliest ancestor
            curr_id = memory_id
            visited = {curr_id}
            while True:
                prev = conn.execute(
                    "SELECT id FROM memories WHERE superseded_by = ?", (curr_id,)
                ).fetchone()
                if not prev or prev["id"] in visited:
                    break
                curr_id = prev["id"]
                visited.add(curr_id)

            # Walk forward from earliest ancestor to latest version
            chain: List[Dict[str, Any]] = []
            walk_id: Optional[str] = curr_id
            seen_forward: set[str] = set()
            while walk_id and walk_id not in seen_forward:
                seen_forward.add(walk_id)
                row = conn.execute(
                    "SELECT * FROM memories WHERE id = ?", (walk_id,)
                ).fetchone()
                if not row:
                    break
                mem_dict = _row_to_memory_dict(row)
                chain.append(mem_dict)
                walk_id = mem_dict.get("superseded_by")

            return {
                "requested_id": memory_id,
                "memory_id": memory_id,
                "chain": chain,
                "history": chain,
                "total_versions": len(chain),
            }

    async def rollback_memory(self, memory_id: str) -> Dict[str, Any]:
        """
        Restores a `superseded` memory version back to `status='active'`,
        marks any newer versions in its lineage as `status='superseded'`,
        and re-indexes the restored memory's vector embedding.
        """
        history = self.get_memory_history(memory_id)
        chain = history["chain"]
        now = utc_now_iso()

        target_mem: Optional[Dict[str, Any]] = None
        for m in chain:
            if m["id"] == memory_id:
                target_mem = m
                break

        if not target_mem:
            raise KeyError(f"Memory '{memory_id}' not found in lineage")

        with get_db() as conn:
            for m in chain:
                mid = m["id"]
                if mid == memory_id:
                    conn.execute(
                        """
                        UPDATE memories
                        SET status = 'active',
                            superseded_by = NULL,
                            valid_to = NULL,
                            updated_at = ?
                        WHERE id = ?
                        """,
                        (now, mid),
                    )
                elif m["status"] == "active":
                    conn.execute(
                        """
                        UPDATE memories
                        SET status = 'superseded',
                            superseded_by = ?,
                            valid_to = ?,
                            updated_at = ?
                        WHERE id = ?
                        """,
                        (memory_id, now, now, mid),
                    )
                    conn.execute(
                        "DELETE FROM vec_memories WHERE memory_id = ?", (mid,)
                    )

        try:
            vec = await embedding_manager.embed_text(
                target_mem["content"], is_query=False
            )
            with get_db() as conn:
                self._upsert_vector_sync(conn, memory_id, vec)
        except Exception as exc:
            logger.warning("Embedding refresh after rollback skipped: %s", exc)

        with get_db() as conn:
            restored_row = conn.execute(
                "SELECT * FROM memories WHERE id = ?", (memory_id,)
            ).fetchone()
            restored_dict = (
                _row_to_memory_dict(restored_row) if restored_row else target_mem
            )

        return {
            "status": "rolled_back",
            "action": "rolled_back",
            "restored_memory_id": memory_id,
            "restored_memory": restored_dict,
            "workspace": target_mem["workspace"],
            "content": target_mem["content"],
        }


memory_engine = MemoryEngine()
