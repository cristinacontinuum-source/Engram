# ==============================================================================
# Stage 1: Build React SPA Frontend (Raycast / Linear Developer Console)
# ==============================================================================
FROM node:20-alpine AS frontend-builder

WORKDIR /build/frontend

# Copy package manifests first for layer caching
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund

# Copy frontend source and build production bundle
COPY frontend/ ./
RUN npm run build

# ==============================================================================
# Stage 2: Python 3.12 Slim Runtime (FastAPI + Dual MCP + sqlite-vec)
# ==============================================================================
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DB_PATH=/data/memory.db \
    LOCAL_MODELS_DIR=/data/models \
    PORT=8080

WORKDIR /app

# Install curl for container healthcheck and libgomp1 for optional ONNX runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy backend application source
COPY backend/app /app/app

# Copy compiled React SPA from Stage 1 into /app/static
COPY --from=frontend-builder /build/frontend/dist /app/static

# Ensure persistent volume directories exist (/data and /data/models)
RUN mkdir -p /data /data/models

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:8080/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
