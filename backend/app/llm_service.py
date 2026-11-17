import json
import logging
import re
import time
from typing import Any, Dict, List, Optional

import httpx

from app.config import settings

logger = logging.getLogger("engram.llm_service")


def estimate_tokens(text: str) -> int:
    """
    Deterministic token count estimator (~4 characters per token with word boundary weighting).
    """
    if not text or not text.strip():
        return 0
    char_est = len(text) // 4
    word_est = int(len(text.split()) * 1.3)
    return max(1, (char_est + word_est) // 2)


def _extract_json_block(raw_text: str) -> str:
    """Extracts JSON object or array from raw LLM text or markdown code fences."""
    cleaned = raw_text.strip()
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", cleaned, re.IGNORECASE)
    if fence_match:
        return fence_match.group(1).strip()

    # Locate first '[' or '{'
    first_bracket = cleaned.find("[")
    first_brace = cleaned.find("{")
    if first_bracket != -1 and (first_brace == -1 or first_bracket < first_brace):
        last_bracket = cleaned.rfind("]")
        if last_bracket > first_bracket:
            return cleaned[first_bracket : last_bracket + 1]
    if first_brace != -1:
        last_brace = cleaned.rfind("}")
        if last_brace > first_brace:
            return cleaned[first_brace : last_brace + 1]
    return cleaned


class LLMService:
    """
    Fast LLM Cognitive Service for Engram:
    1. Smart Deduplication / Upsert Merge (`cosine > 0.85`).
    2. Knowledge Graph Entity-Relation Triple Extraction.
    3. Context Distillation (compressing retrieved memories into concise bullets).
    4. Conversation Fact & Procedural Rule Extraction (`/api/v1/ingest`).
    5. Session Summary Synthesis (`memory://session-summary/{workspace}`).
    """

    async def _chat_completion(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.1,
        max_tokens: int = 800,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
    ) -> str:
        target_base = (base_url or settings.llm_base_url).rstrip("/")
        target_key = api_key if api_key is not None else settings.llm_api_key
        target_model = model or settings.fast_model

        url = f"{target_base}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {target_key}",
        }
        payload = {
            "model": target_model,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }

        async with httpx.AsyncClient(timeout=25.0) as client:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()

        choices = data.get("choices", [])
        if not choices:
            raise ValueError("LLM response contained no choices")
        content = choices[0].get("message", {}).get("content", "")
        if not content:
            raise ValueError("LLM response message content was empty")
        return str(content).strip()

    async def smart_merge_memories(
        self, existing_content: str, new_content: str, memory_type: str = "semantic"
    ) -> str:
        """
        Merges an existing memory and a newly submitted overlapping memory
        (cosine similarity > 0.85) into a single authoritative, concise statement.
        """
        if existing_content.strip().lower() == new_content.strip().lower():
            return existing_content.strip()

        system_prompt = (
            "You are Engram's Smart Memory Deduplicator. "
            "Merge the EXISTING MEMORY and NEW MEMORY into a single concise, high-signal "
            f"{memory_type} memory statement. Preserve all specific technical facts, "
            "versions, constraints, and latest updates. If NEW MEMORY updates or corrects "
            "a value in EXISTING MEMORY, prefer the newer value. "
            "Return ONLY the merged memory text without commentary or quotes."
        )
        user_prompt = (
            f"EXISTING MEMORY:\n{existing_content}\n\n"
            f"NEW MEMORY:\n{new_content}\n\n"
            "MERGED MEMORY:"
        )

        try:
            merged = await self._chat_completion(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                temperature=0.1,
                max_tokens=400,
            )
            return merged.strip() or new_content.strip()
        except Exception as exc:
            logger.warning(
                "LLM smart_merge_memories fallback triggered (%s); combining deterministically",
                exc,
            )
            if new_content.strip() in existing_content:
                return existing_content.strip()
            if existing_content.strip() in new_content:
                return new_content.strip()
            return f"{existing_content.strip()} | Update: {new_content.strip()}"

    async def extract_graph_triples(
        self, content: str, workspace: str = "global"
    ) -> List[Dict[str, str]]:
        """
        Extracts 1-hop Knowledge Graph entity-relation triples from memory content.
        Falls back to deterministic heuristic extraction if the LLM endpoint is offline.
        """
        system_prompt = (
            "You are a Knowledge Graph Extractor. Extract up to 5 concrete entity-relation-entity "
            "triples from the text. Return ONLY a valid JSON array of objects with keys: "
            '{"source": "EntityA", "source_type": "service|tool|person|concept|config", '
            '"relation": "USES|DEPENDS_ON|CONFIGURED_WITH|AVOIDS|RUNS_ON|BELONGS_TO", '
            '"target": "EntityB", "target_type": "service|tool|person|concept|config"}. '
            "Keep entity names concise and normalized."
        )
        user_prompt = f"Workspace: {workspace}\nMemory Content: {content}"

        try:
            raw = await self._chat_completion(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                temperature=0.0,
                max_tokens=500,
            )
            json_str = _extract_json_block(raw)
            parsed = json.loads(json_str)
            if isinstance(parsed, dict) and "triples" in parsed:
                parsed = parsed["triples"]

            triples: List[Dict[str, str]] = []
            if isinstance(parsed, list):
                for item in parsed[:6]:
                    if not isinstance(item, dict):
                        continue
                    src = str(item.get("source", "")).strip()
                    rel = str(item.get("relation", "RELATED_TO")).strip().upper().replace(" ", "_")
                    tgt = str(item.get("target", "")).strip()
                    if src and tgt and src.lower() != tgt.lower():
                        triples.append(
                            {
                                "source": src[:80],
                                "source_type": str(item.get("source_type", "concept")).strip().lower()[:32],
                                "relation": rel[:48],
                                "target": tgt[:80],
                                "target_type": str(item.get("target_type", "concept")).strip().lower()[:32],
                            }
                        )
            if triples:
                return triples
        except Exception as exc:
            logger.debug("LLM extract_graph_triples fallback (%s)", exc)

        return self._heuristic_extract_triples(content)

    def _heuristic_extract_triples(self, content: str) -> List[Dict[str, str]]:
        """
        Deterministic fallback extractor identifying technical tokens, identifiers,
        and relational verbs when the external LLM is unavailable.
        """
        candidates = re.findall(
            r"\b(?:[A-Z][A-Za-z0-9_-]{2,}|[a-z0-9]+(?:-[a-z0-9]+)+|[A-Za-z0-9_]+\.(?:py|ts|tsx|db|json|yml|yaml)|/(?:mcp|sse|api|data)[A-Za-z0-9_/-]*)\b",
            content,
        )
        seen: List[str] = []
        stop_words = {"The", "This", "That", "When", "Always", "Never", "Use", "Ensure", "Avoid"}
        for tok in candidates:
            clean_tok = tok.strip()
            if clean_tok in stop_words or len(clean_tok) < 3:
                continue
            if clean_tok not in seen:
                seen.append(clean_tok)

        triples: List[Dict[str, str]] = []
        for i in range(min(len(seen) - 1, 4)):
            triples.append(
                {
                    "source": seen[i],
                    "source_type": "concept",
                    "relation": "LINKED_TO",
                    "target": seen[i + 1],
                    "target_type": "concept",
                }
            )
        return triples

    async def distill_memories(
        self, query: str, memories: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Compresses ranked memories into ultra-dense bullet directives relevant to `query`.
        Returns distilled text, raw_tokens, distilled_tokens, and compression ratio.
        """
        if not memories:
            return {
                "distilled_context": "",
                "raw_tokens": 0,
                "distilled_tokens": 0,
                "tokens_saved": 0,
                "savings_pct": 0.0,
            }

        raw_lines = [
            f"[{m.get('memory_type', 'semantic').upper()} | ws:{m.get('workspace', 'global')} | "
            f"score:{m.get('final_score', 0.0):.3f} | pinned:{bool(m.get('is_pinned'))}] "
            f"{m.get('content', '')}"
            for m in memories
        ]
        raw_block = "\n".join(raw_lines)
        raw_tokens = estimate_tokens(raw_block)

        system_prompt = (
            "You are Engram's Context Distiller. Compress the retrieved memories into ultra-concise, "
            "high-density bullet points directly actionable for answering the agent query. "
            "Prioritize pinned directives and procedural rules. Strip filler prose and redundancy. "
            "Output ONLY concise markdown bullet points."
        )
        user_prompt = f"AGENT QUERY: {query}\n\nRETRIEVED MEMORIES:\n{raw_block}"

        try:
            distilled_text = await self._chat_completion(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                temperature=0.1,
                max_tokens=450,
            )
        except Exception as exc:
            logger.debug("LLM distill_memories fallback (%s)", exc)
            # Deterministic concise bullet compression
            bullets: List[str] = []
            for m in memories:
                prefix = "[RULE]" if m.get("memory_type") == "procedural" or m.get("is_pinned") else "[FACT]"
                content_str = str(m.get("content", "")).strip()
                bullets.append(f"- {prefix} {content_str}")
            distilled_text = "\n".join(bullets)

        distilled_tokens = min(raw_tokens, estimate_tokens(distilled_text))
        tokens_saved = max(0, raw_tokens - distilled_tokens)
        savings_pct = (
            round((tokens_saved / raw_tokens) * 100.0, 1) if raw_tokens > 0 else 0.0
        )

        return {
            "distilled_context": distilled_text,
            "raw_tokens": raw_tokens,
            "distilled_tokens": distilled_tokens,
            "tokens_saved": tokens_saved,
            "savings_pct": savings_pct,
        }

    async def summarize_recent_memories(
        self, workspace: str, memories: List[Dict[str, Any]]
    ) -> str:
        """Synthesizes a bullet summary of the 15 most recent active memories for MCP resource."""
        if not memories:
            return f"No active memories recorded yet for workspace '{workspace}'."

        raw_list = "\n".join(
            f"- ({m.get('memory_type', 'semantic')}) {m.get('content', '')}"
            for m in memories[:15]
        )
        system_prompt = (
            "Summarize the following recent agent memories into a tight, structured "
            "markdown briefing (max 8 bullets) highlighting active context, user preferences, "
            "and procedural constraints."
        )
        try:
            return await self._chat_completion(
                system_prompt=system_prompt,
                user_prompt=f"Workspace: {workspace}\nRecent Memories:\n{raw_list}",
                temperature=0.1,
                max_tokens=400,
            )
        except Exception:
            return f"### Active Session Briefing ({workspace})\n{raw_list}"

    async def extract_memories_from_messages(
        self, messages: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Used by `POST /api/v1/ingest` webhook to extract discrete semantic facts,
        episodic decisions, and procedural rules from raw conversation messages.
        """
        if not messages:
            return []

        transcript = "\n".join(
            f"{str(m.get('role', 'user')).upper()}: {str(m.get('content', '')).strip()}"
            for m in messages
            if str(m.get("content", "")).strip()
        )
        if not transcript.strip():
            return []

        system_prompt = (
            "Extract durable facts, user preferences, architectural decisions, and procedural "
            "rules from the conversation transcript. Return ONLY a JSON array of objects: "
            '[{"content": "...", "memory_type": "semantic|procedural|episodic", "confidence": 0.9}]. '
            "Ignore greetings or transient chatter."
        )
        try:
            raw = await self._chat_completion(
                system_prompt=system_prompt,
                user_prompt=transcript,
                temperature=0.1,
                max_tokens=600,
            )
            parsed = json.loads(_extract_json_block(raw))
            if isinstance(parsed, list):
                results: List[Dict[str, Any]] = []
                for item in parsed:
                    if not isinstance(item, dict):
                        continue
                    text = str(item.get("content", "")).strip()
                    mtype = str(item.get("memory_type", "semantic")).strip().lower()
                    if mtype not in ("semantic", "procedural", "episodic"):
                        mtype = "semantic"
                    conf = float(item.get("confidence", 0.85))
                    if text:
                        results.append(
                            {
                                "content": text,
                                "memory_type": mtype,
                                "confidence": max(0.1, min(1.0, conf)),
                            }
                        )
                if results:
                    return results
        except Exception as exc:
            logger.debug("Webhook message extraction fallback (%s)", exc)

        # Fallback: store substantive user/assistant statements (> 20 chars)
        fallback_items: List[Dict[str, Any]] = []
        for m in messages:
            txt = str(m.get("content", "")).strip()
            if len(txt) >= 20:
                mtype = (
                    "procedural"
                    if any(w in txt.lower() for w in ("always ", "never ", "must ", "rule:"))
                    else "semantic"
                )
                fallback_items.append(
                    {"content": txt, "memory_type": mtype, "confidence": 0.85}
                )
        return fallback_items[:10]

    async def test_connection(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Tests connectivity and latency to the configured Reasoning/Distillation LLM."""
        start = time.perf_counter()
        target_model = model or settings.fast_model
        try:
            reply = await self._chat_completion(
                system_prompt="Reply with the single word OK.",
                user_prompt="Health check probe.",
                temperature=0.0,
                max_tokens=16,
                base_url=base_url,
                api_key=api_key,
                model=target_model,
            )
            latency_ms = round((time.perf_counter() - start) * 1000.0, 2)
            return {
                "status": "ok",
                "model": target_model,
                "base_url": (base_url or settings.llm_base_url).rstrip("/"),
                "latency_ms": latency_ms,
                "reply": reply[:64],
            }
        except Exception as exc:
            latency_ms = round((time.perf_counter() - start) * 1000.0, 2)
            return {
                "status": "error",
                "model": target_model,
                "base_url": (base_url or settings.llm_base_url).rstrip("/"),
                "latency_ms": latency_ms,
                "detail": str(exc),
            }


llm_service = LLMService()
