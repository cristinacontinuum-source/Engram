export interface DeliverableFileEntry {
  id: string;
  phase: 1 | 2 | 3;
  path: string;
  category:
    | 'Container & Infra'
    | 'Environment & Deps'
    | 'Core Storage Engine'
    | 'Cognitive & Async Engine'
    | 'MCP & REST API Layer';
  language: 'dockerfile' | 'yaml' | 'ini' | 'python';
  summaryEn: string;
  summaryId: string;
  content: string;
}

export type Phase1FileEntry = DeliverableFileEntry;

export interface SchemaTableInfo {
  name: string;
  kind: 'TABLE' | 'VIRTUAL TABLE (vec0)';
  primaryKey: string;
  descriptionEn: string;
  descriptionId: string;
  columns: Array<{
    name: string;
    type: string;
    constraints: string;
  }>;
  indexes: string[];
}

export interface RuntimeConfigState {
  db_path: string;
  local_models_dir: string;
  llm_base_url: string;
  llm_api_key: string;
  fast_model: string;
  embedding_mode: 'external' | 'local';
  embedding_base_url: string;
  embedding_api_key: string;
  embedding_model: string;
  embedding_dimension: number;
  local_embedding_model: string;
  enable_ingest_webhook: boolean;
}

export interface CompositeScoreBreakdown {
  vector_score: number;
  graph_score: number;
  recency_score: number;
  confidence_score: number;
  pinned_boost: number;
  final_score: number;
}

export type SimulatedAuthType = 'none' | 'bearer_valid' | 'bearer_invalid' | 'basic_valid';

export interface DualAuthSimulationResult {
  httpStatus: 200 | 202 | 401 | 403;
  statusText: string;
  allowed: boolean;
  authBoundary: string;
  responsePreview: Record<string, unknown>;
}

export function maskSecretValue(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 6) return '***';
  return `${secret.slice(0, 3)}...${secret.slice(-3)}`;
}

export function generateVecTableSql(dimension: number): string {
  const cleanDim = Math.trunc(dimension);
  if (!Number.isFinite(cleanDim) || cleanDim <= 0 || cleanDim > 8192) {
    throw new Error(`Invalid embedding dimension: ${dimension}`);
  }
  return `CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(\n    memory_id TEXT PRIMARY KEY,\n    embedding float[${cleanDim}] distance_metric=cosine\n);`;
}

export function calculateFloat32ByteLength(dimension: number): number {
  const cleanDim = Math.trunc(dimension);
  if (!Number.isFinite(cleanDim) || cleanDim <= 0) return 0;
  return cleanDim * 4;
}

export function computeCompositeScore(params: {
  sVector: number;
  sGraph: number;
  daysElapsed: number;
  confidence: number;
  isPinned: boolean;
  memoryType: 'semantic' | 'procedural' | 'episodic';
  decayLambda?: number;
}): CompositeScoreBreakdown {
  const decayLambda = params.decayLambda ?? 0.03;
  const clampedVec = Math.max(0, Math.min(1, Number(params.sVector) || 0));
  const clampedGraph = Number(params.sGraph) >= 0.5 ? 1.0 : 0.0;
  const clampedConf = Math.max(0, Math.min(1, Number(params.confidence) || 0));

  const sRecency = params.isPinned
    ? 1.0
    : Math.exp(-decayLambda * Math.max(0, Number(params.daysElapsed) || 0));

  const bPinned =
    params.isPinned || params.memoryType === 'procedural' ? 0.15 : 0.0;

  const finalScore =
    0.55 * clampedVec +
    0.2 * clampedGraph +
    0.15 * sRecency +
    0.1 * clampedConf +
    bPinned;

  return {
    vector_score: Number(clampedVec.toFixed(4)),
    graph_score: Number(clampedGraph.toFixed(4)),
    recency_score: Number(sRecency.toFixed(4)),
    confidence_score: Number(clampedConf.toFixed(4)),
    pinned_boost: Number(bPinned.toFixed(4)),
    final_score: Number(finalScore.toFixed(4)),
  };
}

export function scrubSecretsText(input: string): {
  scrubbed: string;
  redactionCount: number;
} {
  if (!input) return { scrubbed: '', redactionCount: 0 };

  let scrubbed = input;
  let redactionCount = 0;

  const patterns: Array<{
    type: 'direct' | 'bearer' | 'kv';
    regex: RegExp;
  }> = [
    { type: 'direct', regex: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
    { type: 'direct', regex: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
    {
      type: 'direct',
      regex: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g,
    },
    { type: 'direct', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
    { type: 'direct', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
    {
      type: 'direct',
      regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    },
    {
      type: 'bearer',
      regex: /(Authorization\s*:\s*Bearer\s+)[^\s"']+/gi,
    },
    {
      type: 'kv',
      regex:
        /\b(password|passwd|secret|api_key|apikey|access_token|private_key)\s*([:=])\s*['"]?([A-Za-z0-9_\-./+=]{8,})['"]?/gi,
    },
  ];

  for (const item of patterns) {
    if (item.type === 'bearer') {
      scrubbed = scrubbed.replace(item.regex, (_m, prefix) => {
        redactionCount += 1;
        return `${prefix}[REDACTED_SECRET]`;
      });
    } else if (item.type === 'kv') {
      scrubbed = scrubbed.replace(item.regex, (full, key, sep, val) => {
        if (val === '[REDACTED_SECRET]' || val === 'dummy-key') {
          return full;
        }
        redactionCount += 1;
        return `${key}${sep}[REDACTED_SECRET]`;
      });
    } else {
      scrubbed = scrubbed.replace(item.regex, () => {
        redactionCount += 1;
        return '[REDACTED_SECRET]';
      });
    }
  }

  return { scrubbed, redactionCount };
}

export function evaluateDualAuthRequest(params: {
  path: string;
  authType: SimulatedAuthType;
  enableIngestWebhook: boolean;
}): DualAuthSimulationResult {
  const { path, authType, enableIngestWebhook } = params;

  // 1. /health is public
  if (path === '/health') {
    return {
      httpStatus: 200,
      statusText: '200 OK',
      allowed: true,
      authBoundary: 'Public Unauthenticated Healthcheck',
      responsePreview: {
        application: 'Engram',
        status: 'ok',
        database: 'connected',
        journal_mode: 'wal',
        sqlite_vec_version: 'v0.1.6',
      },
    };
  }

  // 2. MCP endpoints (/mcp, /sse, /messages) -> Strictly Bearer Token
  if (
    path === '/mcp' ||
    path.startsWith('/mcp/') ||
    path === '/sse' ||
    path.startsWith('/sse/') ||
    path === '/messages'
  ) {
    if (authType !== 'bearer_valid') {
      return {
        httpStatus: 401,
        statusText: '401 Unauthorized',
        allowed: false,
        authBoundary: 'MCP Transport Boundary (Bearer MCP_API_KEY Required)',
        responsePreview: {
          error: 'Unauthorized',
          detail: 'Valid Bearer token (MCP_API_KEY) required for MCP transport.',
        },
      };
    }
    return {
      httpStatus: 200,
      statusText: '200 OK',
      allowed: true,
      authBoundary: 'MCP Transport Boundary (Bearer Verified via secrets.compare_digest)',
      responsePreview: {
        service: 'Engram MCP Server',
        transport: path === '/mcp' ? 'streamable-http' : 'legacy-sse',
        tools: ['recall_memory', 'store_memory', 'learn_from_mistake', 'supersede_memory'],
      },
    };
  }

  // 3. /api/v1/ingest -> Bearer OR Basic Auth + Webhook Flag Gate
  if (path === '/api/v1/ingest') {
    if (authType !== 'bearer_valid' && authType !== 'basic_valid') {
      return {
        httpStatus: 401,
        statusText: '401 Unauthorized',
        allowed: false,
        authBoundary: 'Ingest Webhook Boundary (Bearer OR Basic Auth Required)',
        responsePreview: {
          error: 'Unauthorized',
          detail: 'Valid Bearer token or Basic Auth credentials required for /api/v1/ingest.',
        },
      };
    }
    if (!enableIngestWebhook) {
      return {
        httpStatus: 403,
        statusText: '403 Forbidden',
        allowed: false,
        authBoundary: 'Ingest Feature Gate (enable_ingest_webhook == false)',
        responsePreview: {
          detail: 'Auto-Ingest Webhook (/api/v1/ingest) is currently disabled in Settings.',
        },
      };
    }
    return {
      httpStatus: 202,
      statusText: '202 Accepted',
      allowed: true,
      authBoundary: 'Ingest Webhook Active (Queued in BackgroundWorker)',
      responsePreview: {
        status: 'queued',
        job_id: 'job_8f92a1c04b12',
        workspace: 'hermes',
        message_count: 4,
        queue_depth: 1,
      },
    };
  }

  // 4. Dashboard API (/api/v1/*) & SPA (/*) -> Strictly Basic Auth
  if (authType !== 'basic_valid') {
    return {
      httpStatus: 401,
      statusText: '401 Unauthorized',
      allowed: false,
      authBoundary: 'Dashboard & SPA Boundary (HTTP Basic Auth Required)',
      responsePreview: {
        error: 'Unauthorized: Engram Dashboard credentials required.',
        header: 'WWW-Authenticate: Basic realm="Engram Developer Console"',
      },
    };
  }

  return {
    httpStatus: 200,
    statusText: '200 OK',
    allowed: true,
    authBoundary: 'Dashboard & SPA Boundary (Basic Auth Verified)',
    responsePreview:
      path.startsWith('/api/v1')
        ? {
            active_memories: 42,
            tokens_saved_pct: 84.5,
            avg_latency_ms: 14.2,
            embedding_mode: 'external',
          }
        : {
            served: 'FileResponse("static/index.html")',
            engine: 'StaticFiles (Zero Jinja2)',
          },
  };
}

export function verifyGuardrailsOnFile(file: DeliverableFileEntry): Array<{
  rule: string;
  passed: boolean;
  detail: string;
}> {
  const hasPlaceholders =
    /\bTODO\b|\/\/ implement later|\bpass\s*#\s*todo/i.test(file.content);

  const checks: Array<{ rule: string; passed: boolean; detail: string }> = [
    {
      rule: 'Rule 1: Zero Placeholders',
      passed: !hasPlaceholders && file.content.trim().length > 50,
      detail: 'Complete production code with zero TODOs or stubs',
    },
  ];

  if (file.path === 'Dockerfile') {
    checks.push({
      rule: 'Rule 2: Single-Image Multi-Stage Build',
      passed:
        file.content.includes('FROM node:20-alpine AS frontend-builder') &&
        file.content.includes('FROM python:3.12-slim AS runtime') &&
        file.content.includes('HEALTHCHECK'),
      detail: 'Node 20 SPA builder -> Python 3.12 Uvicorn PID 1 on port 8080',
    });
  }

  if (file.path === 'backend/requirements.txt') {
    checks.push({
      rule: 'Rule 4: MCP SDK Version Lock',
      passed:
        file.content.includes('mcp>=1.2.0,<2.0.0') &&
        file.content.includes('sqlite-vec'),
      detail: 'Pins mcp>=1.2.0,<2.0.0 alongside sqlite-vec and FastAPI',
    });
  }

  if (file.path === 'backend/app/database.py') {
    checks.push({
      rule: 'Spec §1: WAL Mode + sqlite-vec Extension',
      passed:
        file.content.includes('PRAGMA journal_mode=WAL;') &&
        file.content.includes('sqlite_vec.load(conn)') &&
        file.content.includes('USING vec0('),
      detail: 'Enables WAL, foreign_keys=ON, and vec0 virtual table',
    });
  }

  if (file.path === 'backend/app/config.py') {
    checks.push({
      rule: 'Architecture §3.C: Default External Zero-RAM Mode',
      passed:
        file.content.includes('embedding_mode') &&
        file.content.includes('apply_db_overrides') &&
        !file.content.includes('import fastembed'),
      detail: 'Defaults to external mode (0 MB RAM) with live SQLite settings sync',
    });
  }

  if (file.path === 'backend/app/embeddings.py') {
    const topLines = file.content.split('\n').slice(0, 35).join('\n');
    checks.push({
      rule: 'Rule 5: Lazy FastEmbed + gc.collect()',
      passed:
        !topLines.includes('from fastembed') &&
        file.content.includes('from fastembed import TextEmbedding') &&
        file.content.includes('gc.collect()'),
      detail: 'Imports fastembed only inside _get_local_embedder() and frees RAM via gc.collect()',
    });
  }

  if (file.path === 'backend/app/llm_service.py') {
    checks.push({
      rule: 'Spec §2-3: Smart Merge + Graph + Distiller',
      passed:
        file.content.includes('async def smart_merge_memories') &&
        file.content.includes('async def extract_graph_triples') &&
        file.content.includes('async def distill_memories'),
      detail: 'Provides LLM Smart Merge, 1-Hop Graph Extractor, and Context Distiller',
    });
  }

  if (file.path === 'backend/app/engine.py') {
    checks.push({
      rule: 'Spec §2: Hybrid Ranking + Secret Scrubber + Bi-Temporal Rollback',
      passed:
        file.content.includes('def scrub_secrets') &&
        file.content.includes('def compute_composite_score') &&
        file.content.includes('async def rollback_memory'),
      detail: 'Enforces regex credential scrubbing, composite ranking math, and temporal rollback',
    });
  }

  if (file.path === 'backend/app/worker.py') {
    checks.push({
      rule: 'Architecture §2: asyncio.Queue + TTL Cleaner + Re-indexer',
      passed:
        file.content.includes('asyncio.Queue') &&
        file.content.includes('cleanup_expired_memories') &&
        file.content.includes('run_reindex_all'),
      detail: 'Non-blocking background queue, TTL expiration cleanup, and batch vector re-indexing',
    });
  }

  if (file.path === 'backend/app/mcp_server.py') {
    checks.push({
      rule: 'Spec §3: 4 MCP Tools + 2 Resources + Dual Transport',
      passed:
        file.content.includes('async def recall_memory') &&
        file.content.includes('async def store_memory') &&
        file.content.includes('async def learn_from_mistake') &&
        file.content.includes('async def supersede_memory') &&
        file.content.includes('memory://core-directives/{workspace}') &&
        file.content.includes('memory://session-summary/{workspace}'),
      detail: 'Registers all 4 MCP tools, 2 resources, and mounts /mcp + /sse & /messages',
    });
  }

  if (file.path === 'backend/app/api_routes.py') {
    checks.push({
      rule: 'Spec §4: Complete Dashboard & Webhook REST API',
      passed:
        file.content.includes('"/stats"') &&
        file.content.includes('"/memories/{memory_id}/rollback"') &&
        file.content.includes('"/playground/query"') &&
        file.content.includes('"/ingest"') &&
        file.content.includes('"/settings/reindex"'),
      detail: 'Exposes stats, CRUD, temporal rollback, graph, playground, ingest, export/import, and reindex',
    });
  }

  if (file.path === 'backend/app/main.py') {
    checks.push({
      rule: 'Rule 3 & 4: Dual-Auth Middleware + Zero Jinja2 + Route Order',
      passed:
        !file.content.includes('Jinja2Templates') &&
        file.content.includes('secrets.compare_digest') &&
        file.content.includes('mount_mcp_transports(app)') &&
        file.content.includes('FileResponse'),
      detail: 'Enforces Bearer/Basic Dual-Auth and serves SPA via StaticFiles + FileResponse',
    });
  }

  return checks;
}

export function applyRuntimeOverrides(
  base: RuntimeConfigState,
  overrides: Partial<Record<keyof RuntimeConfigState, string | number | boolean>>
): RuntimeConfigState {
  const next: RuntimeConfigState = { ...base };

  if (typeof overrides.llm_base_url === 'string' && overrides.llm_base_url.trim()) {
    next.llm_base_url = overrides.llm_base_url.trim().replace(/\/+$/, '');
  }
  if (typeof overrides.llm_api_key === 'string' && overrides.llm_api_key.trim()) {
    next.llm_api_key = overrides.llm_api_key.trim();
  }
  if (typeof overrides.fast_model === 'string' && overrides.fast_model.trim()) {
    next.fast_model = overrides.fast_model.trim();
  }
  if (overrides.embedding_mode === 'external' || overrides.embedding_mode === 'local') {
    next.embedding_mode = overrides.embedding_mode;
  }
  if (typeof overrides.embedding_dimension !== 'undefined') {
    const dim = Number(overrides.embedding_dimension);
    if (Number.isInteger(dim) && dim > 0 && dim <= 8192) {
      next.embedding_dimension = dim;
    }
  }
  if (typeof overrides.enable_ingest_webhook !== 'undefined') {
    if (typeof overrides.enable_ingest_webhook === 'boolean') {
      next.enable_ingest_webhook = overrides.enable_ingest_webhook;
    } else {
      next.enable_ingest_webhook = ['1', 'true', 'yes', 'on'].includes(
        String(overrides.enable_ingest_webhook).trim().toLowerCase()
      );
    }
  }

  return next;
}
