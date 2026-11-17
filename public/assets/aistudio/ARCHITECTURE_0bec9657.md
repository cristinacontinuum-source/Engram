# System Architecture — Agent Memory Hub

## 1. Architectural Overview
**Agent Memory Hub** is a self-hosted, single-container AI memory engine that combines a **Dual-Transport MCP (Model Context Protocol) Server** with a **Raycast/Linear-style Web Observability Dashboard**. It is designed to drop cleanly into an existing Docker Compose stack (alongside LLM routers like `9router`, AI agents like `Hermes`, and `cloudflared` tunnels) with zero external database or reverse-proxy containers.

## 2. Single-Container Process Topology (Port `8080`)
All services run inside a single `python:3.12-slim` container managed by a single `uvicorn` process (`PID 1`):

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                    CONTAINER: agent-memory (Port 8080)                  │
│                                                                         │
│  [ FastAPI + Uvicorn (PID 1) ]                                          │
│   ├── /mcp               ──► MCP Streamable HTTP (Bearer Auth)          │
│   ├── /sse & /messages   ──► MCP Legacy SSE Transport (Bearer Auth)     │
│   ├── /api/v1/*          ──► Dashboard & Ingest REST API                │
│   ├── /health            ──► Unauthenticated Docker Healthcheck         │
│   └── /*                 ──► Compiled React SPA Static Files (Basic Auth)│
│                                                                         │
│  [ Core Memory & Cognitive Engine ]                                     │
│   ├── Hybrid Retriever   (sqlite-vec + 1-Hop Graph + Temporal Decay)    │
│   ├── Context Distiller  (Fast LLM compression: raw -> concise bullets) │
│   ├── Smart Deduplicator (Cosine > 0.85 -> LLM Upsert/Merge)            │
│   ├── Security Guardrail (Regex credential/secret scrubber on write)    │
│   └── EmbeddingManager   (Zero-RAM Lazy Loader: External API | Local)   │
│                                                                         │
│  [ Internal Async Worker (asyncio.Queue) ]                              │
│   └── Non-blocking ingestion, entity-relation extraction, TTL cleanup   │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Bind Mount (./memory-data:/data)
                                     ▼
                    ┌─────────────────────────────────┐
                    │       /data/memory.db           │
                    │  SQLite (WAL Mode) + sqlite-vec │
                    └─────────────────────────────────┘
```

## 3. Key Architectural Decisions

### A. Multi-Agent Workspace Isolation + Global Shared Layer
- Every memory belongs to a `workspace` (default: `"global"`).
- When an agent queries memory with `workspace="hermes"`, retrieval automatically scopes to `workspace IN ('hermes', 'global')`.
- This prevents domain pollution across different agents while keeping core user facts and global rules universally accessible.

### B. Dual MCP Transport Compatibility
- Mounts both **Streamable HTTP (`/mcp`)** and **Legacy SSE (`/sse` + `/messages`)** simultaneously on the FastAPI app using `mcp>=1.2.0,<2.0.0` (`FastMCP`), ensuring plug-and-play compatibility across modern and legacy MCP clients without external bridge processes.

### C. Zero-RAM Lazy Embedding Architecture
- **Default (`external`):** Calls any OpenAI-compatible `/v1/embeddings` endpoint (e.g., `http://9router:20128/v1`). `fastembed` and ONNX Runtime are **never imported**, resulting in `0 MB` local model RAM overhead.
- **Optional (`local`):** Lazily imports `fastembed` (`intfloat/multilingual-e5-small` by default) and caches weights in `/data/models` (host bind-mount, keeping the Docker image slim).
- **Live Memory Release:** Switching from `local` to `external` in the Dashboard explicitly deletes the model reference (`del`) and runs `gc.collect()` to reclaim RAM immediately.

### D. Security & Dual-Auth Boundary
A single HTTP middleware enforces strict separation on port `8080`:
1. **`/mcp`, `/sse`, `/messages`**: Requires `Authorization: Bearer <MCP_API_KEY>` (constant-time `secrets.compare_digest`).
2. **`/api/v1/ingest`**: Protected by Bearer Token (`MCP_API_KEY`) OR Basic Auth, and gated by the runtime `enable_ingest_webhook` flag (`403 Forbidden` when toggled OFF).
3. **`/api/v1/*` & `/*` (Frontend UI)**: Protected by HTTP Basic Auth (`DASHBOARD_USER` / `DASHBOARD_PASS`).
4. **`/health`**: Public JSON endpoint for Docker healthchecks.
