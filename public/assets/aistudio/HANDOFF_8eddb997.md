# Handoff & Deployment Runbook — Agent Memory Hub

## 1. How to Execute in Google AI Studio
1. Open **Google AI Studio** (select **Gemini 2.5 Pro** or latest flagship reasoning model).
2. Paste `AGENTS.md`, `ARCHITECTURE.md`, `SPEC.md`, and `UI_SYSTEM.md` into **System Instructions** (or upload them as context files).
3. Send the prompt:
   > *"Follow `PLAN.md` and `AGENTS.md`. Execute **Phase 1** completely now, outputting every file in full."*
4. Review the output, save the files locally, then reply `"Proceed to Phase 2"` until all 4 phases are generated.

---

## 2. Server Deployment (`docker-compose.yml` Integration)
Build the single image on the server:
```bash
docker build -t agent-memory:latest .
```

Add this service block to the existing server `docker-compose.yml` (alongside `9router`, `hermes`, and `cloudflared`):
```yaml
  agent-memory:
    image: agent-memory:latest
    container_name: agent-memory
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - ./memory-data:/data
    environment:
      DB_PATH: /data/memory.db
      # Reasoning / Distillation LLM via 9Router
      LLM_BASE_URL: http://9router:20128/v1
      LLM_API_KEY: ${ROUTER_API_KEY:-dummy-key}
      FAST_MODEL: gemini-2.5-flash
      # Embedding Config (Default: External API = 0 MB local model RAM)
      EMBEDDING_MODE: external
      EMBEDDING_BASE_URL: http://9router:20128/v1
      EMBEDDING_API_KEY: ${ROUTER_API_KEY:-dummy-key}
      EMBEDDING_MODEL: text-embedding-3-small
      LOCAL_EMBEDDING_MODEL: intfloat/multilingual-e5-small
      # Feature Flags & Auth
      ENABLE_INGEST_WEBHOOK: "false"
      MCP_API_KEY: ${MCP_API_KEY:-sk-mem-hermes-secret}
      DASHBOARD_USER: ${DASHBOARD_USER:-admin}
      DASHBOARD_PASS: ${DASHBOARD_PASS:-admin123}
```

### Connecting AI Agents (e.g., Hermes)
- **Streamable HTTP URL:** `http://agent-memory:8080/mcp`
- **Legacy SSE URL:** `http://agent-memory:8080/sse`
- **Header:** `Authorization: Bearer sk-mem-hermes-secret`

---

## 3. Session Continuation Checklist
When resuming development in a new AI session, paste this file along with the current checklist state:
- [ ] **Phase 1:** `Dockerfile`, `docker-compose.yml`, `.env.example`, `requirements.txt`, `config.py`, `database.py`
- [ ] **Phase 2:** `embeddings.py`, `llm_service.py`, `engine.py`, `worker.py`
- [ ] **Phase 3:** `mcp_server.py`, `api_routes.py`, `main.py`
- [ ] **Phase 4:** Frontend (`i18n`, `Overview`, `Explorer`, `Graph`, `Playground`, `Settings`)
- [ ] **Phase 5:** `docker build` & live MCP connection test
