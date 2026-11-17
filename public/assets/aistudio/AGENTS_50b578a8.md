# AI Coding Agent Rules & Guardrails

Follow these strict engineering rules when generating or modifying code in this repository:

1. **Zero Placeholders:** NEVER write `TODO`, `// implement later`, `...`, or abbreviated functions. Every file must be 100% complete and runnable.
2. **Single-Image Discipline:** Do NOT introduce PostgreSQL, Redis, Nginx, or `supervisord`. Everything runs inside one FastAPI/Uvicorn process backed by `/data/memory.db` (`sqlite-vec`).
3. **No Template Engines:** NEVER import or configure `Jinja2Templates` or `TemplateResponse`. Serve the compiled React SPA purely via `fastapi.staticfiles.StaticFiles` and `FileResponse("static/index.html")`.
4. **MCP SDK Version Lock:** Pin `mcp>=1.2.0,<2.0.0` in `backend/requirements.txt`. Mount both Streamable HTTP (`/mcp`) and Legacy SSE (`/sse` + `/messages`) cleanly without conflicting with FastAPI's catch-all SPA route (register `/mcp`, `/sse`, `/messages`, `/api/v1`, and `/health` **before** the `/{full_path:path}` SPA fallback).
5. **Strict Zero-RAM Local Embedding:** Never import `fastembed` at module top-level. Import it exclusively inside `EmbeddingManager._get_local_embedder()` when `mode == "local"`, store models in `/data/models`, and call `del` + `gc.collect()` when switching to `external`.
6. **Frontend Build Safety:** Use pure HTML5 Canvas or SVG with a lightweight custom force layout for `GraphTab.tsx` instead of heavy third-party graph libraries that frequently break Vite production builds. Ensure all TypeScript types are strict and valid.
7. **Incremental Generation Protocol:** Output files grouped by Phase (`Phase 1` through `Phase 4`) in full, clearly labeled code blocks, waiting for user confirmation before advancing to the next phase.
