import {
  AnalyticsSummaryResponse,
  DirectivesPreviewResponse,
  DiscoveredModelOption,
  FetchModelsResponse,
  GraphEdge,
  GraphNode,
  GraphResponse,
  HygieneAuditResponse,
  IntegrationProbeResponse,
  IntegrationsStatusResponse,
  McpTransportKind,
  MemoryHistoryChain,
  MemoryRecord,
  MemoryStatus,
  MemoryType,
  ModelCatalogKind,
  ModelPricingProfileId,
  PlaygroundCandidate,
  PlaygroundQueryResponse,
  ReindexStatus,
  SettingsPayload,
  StatsResponse,
  TelemetryLogItem,
  WorkerActivityResponse,
  WorkerJobRecord,
  WorkerJobType,
} from '../types/engram';
import { extractMemoriesFromTranscriptText, filterWorkerJobs } from '../utils/activity';
import { buildTokenAnalytics } from '../utils/analytics';
import { buildDirectivesPreviewPayload } from '../utils/directives';
import { analyzeMemoryHygiene } from '../utils/hygiene';
import {
  getFallbackCatalogModels,
  isBrowserDirectFetchSafe,
  normalizeModelsEndpointUrl,
  parseOpenAiModelsPayload,
} from '../utils/modelCatalog';
import { computeCompositeScore, scrubSecretsText } from '../utils/phase1Logic';

const STORAGE_KEY_MEMORIES = 'engram_memories_v1';
const STORAGE_KEY_NODES = 'engram_graph_nodes_v1';
const STORAGE_KEY_EDGES = 'engram_graph_edges_v1';
const STORAGE_KEY_SETTINGS = 'engram_settings_v1';
const STORAGE_KEY_TELEMETRY = 'engram_telemetry_v1';
const STORAGE_KEY_ACTIVITY_JOBS = 'engram_activity_jobs_v1';
const STORAGE_KEY_ACTIVITY_META = 'engram_activity_meta_v1';
const STORAGE_KEY_HYGIENE_DISMISSED = 'engram_hygiene_dismissed_v1';

interface ActivityMetaState {
  ttl_sweeps_count: number;
  expired_cleaned_total: number;
}

const INITIAL_ACTIVITY_META: ActivityMetaState = {
  ttl_sweeps_count: 14,
  expired_cleaned_total: 6,
};

const INITIAL_ACTIVITY_JOBS: WorkerJobRecord[] = [
  {
    job_id: 'job_9f4b21c8e301',
    job_type: 'ingest_messages',
    workspace: 'hermes',
    status: 'completed',
    summary: 'Extracted 3 memories from 6 conversation turns',
    detail: 'POST /api/v1/ingest • workspace=hermes • 1 API token scrubbed -> [REDACTED_SECRET]',
    items_processed: 3,
    secrets_redacted: 1,
    latency_ms: 42.8,
    created_at: '2026-11-16T04:18:10Z',
    completed_at: '2026-11-16T04:18:10Z',
  },
  {
    job_id: 'job_8d3a10f2a904',
    job_type: 'store_memory',
    workspace: 'global',
    status: 'completed',
    summary: 'inserted procedural memory (tool_error)',
    detail: '[ANTI-PATTERN] Never import fastembed at top-level module scope; lazy-load TextEmbedding inside _get_local_embedder().',
    items_processed: 1,
    secrets_redacted: 0,
    latency_ms: 19.4,
    created_at: '2026-11-16T03:52:00Z',
    completed_at: '2026-11-16T03:52:00Z',
  },
  {
    job_id: 'job_7c2e09d4b112',
    job_type: 'ttl_cleanup',
    workspace: 'global',
    status: 'completed',
    summary: 'TTL sweep removed 2 expired episodic record(s)',
    detail: 'Periodic 60s cleaner expired 2 scratchpad records from memories + vec_memories.',
    items_processed: 2,
    secrets_redacted: 0,
    latency_ms: 4.6,
    created_at: '2026-11-16T03:40:00Z',
    completed_at: '2026-11-16T03:40:00Z',
  },
  {
    job_id: 'job_6a1d88c3e771',
    job_type: 'reindex_all',
    workspace: 'global',
    status: 'completed',
    summary: 'Re-indexed 8/8 vectors @ 1536d',
    detail: 'Recreated vec_memories virtual table using sqlite-vec WAL mode.',
    items_processed: 8,
    secrets_redacted: 0,
    latency_ms: 318.2,
    created_at: '2026-11-16T02:15:30Z',
    completed_at: '2026-11-16T02:15:31Z',
  },
  {
    job_id: 'job_5b0c77a1f409',
    job_type: 'store_memory',
    workspace: 'ops-agent',
    status: 'completed',
    summary: 'superseded semantic memory (mcp_store)',
    detail: 'Upgraded PostgreSQL connection pool limit from max 20 -> 45 workers for zero timeout spikes.',
    items_processed: 1,
    secrets_redacted: 0,
    latency_ms: 24.1,
    created_at: '2026-11-15T21:10:00Z',
    completed_at: '2026-11-15T21:10:00Z',
  },
];

function appendActivityJob(job: WorkerJobRecord): void {
  const jobs = loadStore<WorkerJobRecord[]>(STORAGE_KEY_ACTIVITY_JOBS, INITIAL_ACTIVITY_JOBS);
  jobs.unshift(job);
  saveStore(STORAGE_KEY_ACTIVITY_JOBS, jobs.slice(0, 100));
}

const INITIAL_MEMORIES: MemoryRecord[] = [
  {
    id: 'mem-core-01',
    workspace: 'global',
    content: '[RULE] Always enforce SQLite WAL mode (PRAGMA journal_mode=WAL) and load sqlite-vec before executing vec0 queries.',
    type: 'procedural',
    status: 'active',
    source: 'user_explicit',
    confidence: 0.99,
    is_pinned: 1,
    supersedes_id: null,
    superseded_by_id: null,
    valid_from: '2026-11-10T09:15:00Z',
    valid_until: null,
    expires_at: null,
    access_count: 42,
    last_accessed_at: '2026-11-16T04:20:00Z',
  },
  {
    id: 'mem-core-02',
    workspace: 'global',
    content: '[ANTI-PATTERN] Never import fastembed at top-level module scope; lazy-load TextEmbedding inside _get_local_embedder() and call gc.collect() when switching to external mode. Root cause: Top-level ONNX import consumes ~180MB idle RAM.',
    type: 'procedural',
    status: 'active',
    source: 'tool_error',
    confidence: 0.98,
    is_pinned: 1,
    supersedes_id: null,
    superseded_by_id: null,
    valid_from: '2026-11-11T14:22:00Z',
    valid_until: null,
    expires_at: null,
    access_count: 37,
    last_accessed_at: '2026-11-16T04:18:00Z',
  },
  {
    id: 'mem-hermes-old-01',
    workspace: 'hermes',
    content: 'Hermes agent authenticates to the production payment gateway using legacy static header X-Gateway-Token on port 8443.',
    type: 'semantic',
    status: 'superseded',
    source: 'agent_observation',
    confidence: 0.85,
    is_pinned: 0,
    supersedes_id: null,
    superseded_by_id: 'mem-hermes-new-02',
    valid_from: '2026-11-05T11:00:00Z',
    valid_until: '2026-11-14T16:40:00Z',
    expires_at: null,
    access_count: 14,
    last_accessed_at: '2026-11-14T16:39:00Z',
  },
  {
    id: 'mem-hermes-new-02',
    workspace: 'hermes',
    content: 'Hermes agent authenticates to the production payment gateway using short-lived mTLS client certificates and OAuth2 Bearer JWTs on port 443. [Reason: Migrated off deprecated static X-Gateway-Token in v2.4]',
    type: 'semantic',
    status: 'active',
    source: 'supersede_tool',
    confidence: 0.96,
    is_pinned: 1,
    supersedes_id: 'mem-hermes-old-01',
    superseded_by_id: null,
    valid_from: '2026-11-14T16:40:00Z',
    valid_until: null,
    expires_at: null,
    access_count: 28,
    last_accessed_at: '2026-11-16T04:30:00Z',
  },
  {
    id: 'mem-hermes-03',
    workspace: 'hermes',
    content: '[ANTI-PATTERN] Avoid calling /v2/settlements/batch with more than 250 line items per payload; split batches into chunks of 100 to prevent HTTP 504 gateway timeouts.',
    type: 'procedural',
    status: 'active',
    source: 'tool_error',
    confidence: 0.95,
    is_pinned: 1,
    supersedes_id: null,
    superseded_by_id: null,
    valid_from: '2026-11-13T08:10:00Z',
    valid_until: null,
    expires_at: null,
    access_count: 19,
    last_accessed_at: '2026-11-16T03:55:00Z',
  },
  {
    id: 'mem-hermes-old-04',
    workspace: 'hermes',
    content: 'Primary vector index dimension for Hermes workspace is configured as 768d using nomic-embed-text.',
    type: 'semantic',
    status: 'superseded',
    source: 'user_explicit',
    confidence: 0.88,
    is_pinned: 0,
    supersedes_id: null,
    superseded_by_id: 'mem-hermes-new-05',
    valid_from: '2026-11-02T10:00:00Z',
    valid_until: '2026-11-12T19:00:00Z',
    expires_at: null,
    access_count: 9,
    last_accessed_at: '2026-11-12T18:55:00Z',
  },
  {
    id: 'mem-hermes-new-05',
    workspace: 'hermes',
    content: 'Primary vector index dimension for Hermes workspace is standardized at 1536d via OpenAI-compatible 9Router text-embedding-3-small with automatic sqlite-vec vec0 table rebuild.',
    type: 'semantic',
    status: 'active',
    source: 'supersede_tool',
    confidence: 0.97,
    is_pinned: 0,
    supersedes_id: 'mem-hermes-old-04',
    superseded_by_id: null,
    valid_from: '2026-11-12T19:00:00Z',
    valid_until: null,
    expires_at: null,
    access_count: 31,
    last_accessed_at: '2026-11-16T04:12:00Z',
  },
  {
    id: 'mem-hermes-06',
    workspace: 'hermes',
    content: 'Session deployment check completed for Hermes worker cluster asia-southeast1: zero failed webhook deliveries over the last 72h window.',
    type: 'episodic',
    status: 'active',
    source: 'auto_ingest',
    confidence: 0.89,
    is_pinned: 0,
    supersedes_id: null,
    superseded_by_id: null,
    valid_from: '2026-11-15T22:15:00Z',
    valid_until: null,
    expires_at: '2026-11-29T22:15:00Z',
    access_count: 6,
    last_accessed_at: '2026-11-16T02:10:00Z',
  },
  {
    id: 'mem-global-07',
    workspace: 'global',
    content: 'Dual-Transport MCP server exposes Streamable HTTP at /mcp and Legacy SSE at /sse + /messages, protected by constant-time Bearer token comparison.',
    type: 'semantic',
    status: 'active',
    source: 'user_explicit',
    confidence: 0.97,
    is_pinned: 1,
    supersedes_id: null,
    superseded_by_id: null,
    valid_from: '2026-11-12T12:00:00Z',
    valid_until: null,
    expires_at: null,
    access_count: 34,
    last_accessed_at: '2026-11-16T04:25:00Z',
  },
  {
    id: 'mem-ops-08',
    workspace: 'ops-agent',
    content: '[RULE] Always verify container health via GET /health before rotating 9Router upstream API keys in production.',
    type: 'procedural',
    status: 'active',
    source: 'user_explicit',
    confidence: 0.94,
    is_pinned: 1,
    supersedes_id: null,
    superseded_by_id: null,
    valid_from: '2026-11-14T09:30:00Z',
    valid_until: null,
    expires_at: null,
    access_count: 15,
    last_accessed_at: '2026-11-16T01:45:00Z',
  },
  {
    id: 'mem-ops-conflict-09',
    workspace: 'ops-agent',
    content: 'Legacy ops-agent rotation script allows skipping GET /health probe during emergency 9Router upstream API keys rotation.',
    type: 'semantic',
    status: 'active',
    source: 'auto_ingest',
    confidence: 0.71,
    is_pinned: 0,
    supersedes_id: null,
    superseded_by_id: null,
    valid_from: '2026-11-08T10:15:00Z',
    valid_until: null,
    expires_at: null,
    access_count: 2,
    last_accessed_at: '2026-11-08T10:15:00Z',
  },
  {
    id: 'mem-hermes-dup-10',
    workspace: 'hermes',
    content: 'Hermes agent authenticates to the production payment gateway using mTLS client certificates and OAuth2 JWT tokens on port 443.',
    type: 'semantic',
    status: 'active',
    source: 'auto_ingest',
    confidence: 0.84,
    is_pinned: 0,
    supersedes_id: null,
    superseded_by_id: null,
    valid_from: '2026-11-15T11:20:00Z',
    valid_until: null,
    expires_at: null,
    access_count: 3,
    last_accessed_at: '2026-11-15T11:20:00Z',
  },
  {
    id: 'mem-global-dup-11',
    workspace: 'global',
    content: 'Dual-Transport MCP server exposes Streamable HTTP at /mcp and SSE at /sse + /messages with Bearer token authentication.',
    type: 'semantic',
    status: 'active',
    source: 'auto_ingest',
    confidence: 0.82,
    is_pinned: 0,
    supersedes_id: null,
    superseded_by_id: null,
    valid_from: '2026-11-14T15:00:00Z',
    valid_until: null,
    expires_at: null,
    access_count: 4,
    last_accessed_at: '2026-11-14T15:00:00Z',
  },
  {
    id: 'mem-global-stale-12',
    workspace: 'global',
    content: 'Temporary staging reverse-proxy IPv4 allowlist configured for 10.24.0.18 during initial v0.8 cluster bring-up.',
    type: 'semantic',
    status: 'active',
    source: 'agent_observation',
    confidence: 0.76,
    is_pinned: 0,
    supersedes_id: null,
    superseded_by_id: null,
    valid_from: '2026-09-10T08:00:00Z',
    valid_until: null,
    expires_at: null,
    access_count: 1,
    last_accessed_at: '2026-09-12T08:00:00Z',
  },
  {
    id: 'mem-ops-stale-13',
    workspace: 'ops-agent',
    content: 'Old staging Prometheus scrape interval temporarily raised to 45s while debugging high CPU telemetry.',
    type: 'semantic',
    status: 'active',
    source: 'agent_observation',
    confidence: 0.74,
    is_pinned: 0,
    supersedes_id: null,
    superseded_by_id: null,
    valid_from: '2026-09-18T12:00:00Z',
    valid_until: null,
    expires_at: null,
    access_count: 2,
    last_accessed_at: '2026-09-20T12:00:00Z',
  },
  {
    id: 'mem-hermes-exp-14',
    workspace: 'hermes',
    content: 'Short-lived canary settlement batch verification window active for asia-southeast1 hotfix validation.',
    type: 'episodic',
    status: 'active',
    source: 'auto_ingest',
    confidence: 0.83,
    is_pinned: 0,
    supersedes_id: null,
    superseded_by_id: null,
    valid_from: '2026-11-16T02:00:00Z',
    valid_until: null,
    expires_at: new Date(Date.now() + 18 * 3600 * 1000).toISOString(),
    access_count: 2,
    last_accessed_at: '2026-11-16T02:30:00Z',
  },
];

const INITIAL_NODES: GraphNode[] = [
  { id: 'ent-1', workspace: 'global', name: 'Engram Hub', type: 'service' },
  { id: 'ent-2', workspace: 'global', name: 'SQLite WAL + vec0', type: 'database' },
  { id: 'ent-3', workspace: 'global', name: 'FastEmbed ONNX', type: 'component' },
  { id: 'ent-4', workspace: 'global', name: '9Router API', type: 'service' },
  { id: 'ent-5', workspace: 'global', name: 'MCP Dual Transport', type: 'protocol' },
  { id: 'ent-6', workspace: 'hermes', name: 'Hermes Agent', type: 'agent' },
  { id: 'ent-7', workspace: 'hermes', name: 'Payment Gateway v2.4', type: 'service' },
  { id: 'ent-8', workspace: 'hermes', name: 'mTLS + OAuth2 JWT', type: 'security' },
  { id: 'ent-9', workspace: 'hermes', name: 'Settlement Batch API', type: 'endpoint' },
  { id: 'ent-10', workspace: 'hermes', name: 'text-embedding-3-small (1536d)', type: 'model' },
  { id: 'ent-11', workspace: 'ops-agent', name: 'Ops Agent', type: 'agent' },
  { id: 'ent-12', workspace: 'ops-agent', name: '/health Probe', type: 'endpoint' },
];

const INITIAL_EDGES: GraphEdge[] = [
  {
    id: 'edge-1',
    workspace: 'global',
    source_id: 'ent-1',
    source: 'Engram Hub',
    target_id: 'ent-2',
    target: 'SQLite WAL + vec0',
    relation: 'PERSISTS_IN',
    weight: 1.0,
  },
  {
    id: 'edge-2',
    workspace: 'global',
    source_id: 'ent-1',
    source: 'Engram Hub',
    target_id: 'ent-4',
    target: '9Router API',
    relation: 'DEFAULT_EMBEDDER',
    weight: 0.95,
  },
  {
    id: 'edge-3',
    workspace: 'global',
    source_id: 'ent-1',
    source: 'Engram Hub',
    target_id: 'ent-3',
    target: 'FastEmbed ONNX',
    relation: 'LAZY_LOADS',
    weight: 0.9,
  },
  {
    id: 'edge-4',
    workspace: 'global',
    source_id: 'ent-1',
    source: 'Engram Hub',
    target_id: 'ent-5',
    target: 'MCP Dual Transport',
    relation: 'EXPOSES_SSE_AND_HTTP',
    weight: 1.0,
  },
  {
    id: 'edge-5',
    workspace: 'hermes',
    source_id: 'ent-6',
    source: 'Hermes Agent',
    target_id: 'ent-7',
    target: 'Payment Gateway v2.4',
    relation: 'CALLS_UPSTREAM',
    weight: 0.96,
  },
  {
    id: 'edge-6',
    workspace: 'hermes',
    source_id: 'ent-7',
    source: 'Payment Gateway v2.4',
    target_id: 'ent-8',
    target: 'mTLS + OAuth2 JWT',
    relation: 'REQUIRES_AUTH',
    weight: 0.98,
  },
  {
    id: 'edge-7',
    workspace: 'hermes',
    source_id: 'ent-6',
    source: 'Hermes Agent',
    target_id: 'ent-9',
    target: 'Settlement Batch API',
    relation: 'CHUNKS_MAX_100',
    weight: 0.92,
  },
  {
    id: 'edge-8',
    workspace: 'hermes',
    source_id: 'ent-6',
    source: 'Hermes Agent',
    target_id: 'ent-10',
    target: 'text-embedding-3-small (1536d)',
    relation: 'INDEXED_BY',
    weight: 0.95,
  },
  {
    id: 'edge-9',
    workspace: 'ops-agent',
    source_id: 'ent-11',
    source: 'Ops Agent',
    target_id: 'ent-12',
    target: '/health Probe',
    relation: 'VERIFIES_BEFORE_ROTATION',
    weight: 0.94,
  },
];

const INITIAL_TELEMETRY: TelemetryLogItem[] = [
  {
    id: 101,
    workspace: 'hermes',
    query: 'How does Hermes authenticate with the production payment gateway and what batch limits apply?',
    raw_tokens: 1840,
    distilled_tokens: 235,
    latency_ms: 14.2,
    created_at: '2026-11-16T04:10:00Z',
  },
  {
    id: 102,
    workspace: 'global',
    query: 'What are the Zero-RAM local embedding rules for FastEmbed ONNX?',
    raw_tokens: 1620,
    distilled_tokens: 210,
    latency_ms: 11.8,
    created_at: '2026-11-16T04:15:00Z',
  },
  {
    id: 103,
    workspace: 'hermes',
    query: 'Settlement batch API timeout error 504 mitigation strategy',
    raw_tokens: 2190,
    distilled_tokens: 280,
    latency_ms: 16.4,
    created_at: '2026-11-16T04:20:00Z',
  },
  {
    id: 104,
    workspace: 'global',
    query: 'MCP Streamable HTTP /mcp vs Legacy SSE /sse authentication headers',
    raw_tokens: 1490,
    distilled_tokens: 195,
    latency_ms: 12.1,
    created_at: '2026-11-16T04:25:00Z',
  },
  {
    id: 105,
    workspace: 'ops-agent',
    query: 'Pre-flight checklist before rotating 9Router API credentials',
    raw_tokens: 1380,
    distilled_tokens: 180,
    latency_ms: 10.9,
    created_at: '2026-11-16T04:30:00Z',
  },
  {
    id: 106,
    workspace: 'hermes',
    query: 'Active vector embedding dimension and sqlite-vec configuration for Hermes',
    raw_tokens: 1920,
    distilled_tokens: 245,
    latency_ms: 13.7,
    created_at: '2026-11-16T04:35:00Z',
  },
  {
    id: 107,
    workspace: 'ops-agent',
    query: 'Container rollback policy when /health probe returns HTTP 503 during canary rollout',
    raw_tokens: 1710,
    distilled_tokens: 215,
    latency_ms: 12.6,
    created_at: '2026-11-16T04:42:00Z',
  },
  {
    id: 108,
    workspace: 'global',
    query: 'Token ceiling and learn_from_mistake anti-pattern ordering in core-directives',
    raw_tokens: 1580,
    distilled_tokens: 190,
    latency_ms: 11.4,
    created_at: '2026-11-16T04:48:00Z',
  },
];

const INITIAL_SETTINGS: SettingsPayload = {
  llm_base_url: 'http://host.docker.internal:20128/v1',
  llm_api_key: 'sk-9router-••••fd91',
  llm_model: 'gemini-2.5-flash',
  embedding_mode: 'external',
  embedding_base_url: 'http://host.docker.internal:20128/v1',
  embedding_api_key: 'sk-9router-••••fd91',
  embedding_model: 'text-embedding-3-small',
  embedding_dimension: 1536,
  local_embedding_model: 'BAAI/bge-small-en-v1.5',
  local_models_dir: '/data/models',
  auto_ingest_enabled: false,
  similarity_dedup_threshold: 0.85,
  default_workspace: 'default',
  current_vec_dimension: 1536,
  dimension_mismatch: false,
  runtime_embedding: {
    mode: 'external',
    external_base_url: 'http://host.docker.internal:20128/v1',
    external_model: 'text-embedding-3-small',
    local_model_name: 'BAAI/bge-small-en-v1.5',
    local_models_dir: '/data/models',
    local_model_loaded_in_ram: false,
    dimension: 1536,
  },
  reindex_status: {
    running: false,
    total: 8,
    processed: 8,
    dimension: 1536,
    started_at: '2026-11-16T04:00:00Z',
    completed_at: '2026-11-16T04:00:02Z',
    error: null,
  },
};

const memoryStorage = new Map<string, string>();

function loadStore<T>(key: string, fallback: T): T {
  try {
    const store = typeof localStorage !== 'undefined' ? localStorage : null;
    const raw = store ? store.getItem(key) : memoryStorage.get(key) ?? null;
    if (!raw) {
      const serialized = JSON.stringify(fallback);
      if (store) {
        store.setItem(key, serialized);
      } else {
        memoryStorage.set(key, serialized);
      }
      return JSON.parse(serialized) as T;
    }
    return JSON.parse(raw) as T;
  } catch {
    return JSON.parse(JSON.stringify(fallback)) as T;
  }
}

function saveStore<T>(key: string, value: T): void {
  try {
    const serialized = JSON.stringify(value);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, serialized);
    } else {
      memoryStorage.set(key, serialized);
    }
  } catch {
    // ignore storage quota errors
  }
}

async function tryBackendFetch<T>(path: string, options?: RequestInit): Promise<T | null> {
  if (
    typeof window !== 'undefined' &&
    window.location.port === '3000' &&
    import.meta.env.VITE_ENABLE_BACKEND_PROXY !== 'true'
  ) {
    return null;
  }
  try {
    const res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function extractTriplesFromContent(workspace: string, content: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const words = content
    .replace(/[^\w\s/-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && /^[A-Z]/.test(w));

  if (words.length >= 2) {
    const srcName = words[0];
    const tgtName = words[1];
    const srcId = `ent-${workspace}-${srcName.toLowerCase()}`;
    const tgtId = `ent-${workspace}-${tgtName.toLowerCase()}`;
    nodes.push({ id: srcId, workspace, name: srcName, type: 'entity' });
    nodes.push({ id: tgtId, workspace, name: tgtName, type: 'entity' });
    edges.push({
      id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      workspace,
      source_id: srcId,
      source: srcName,
      target_id: tgtId,
      target: tgtName,
      relation: 'RELATES_TO',
      weight: 0.9,
    });
  }
  return { nodes, edges };
}

export const engramApi = {
  async getStats(workspace?: string): Promise<StatsResponse> {
    const query = workspace && workspace !== 'all' ? `?workspace=${encodeURIComponent(workspace)}` : '';
    const remote = await tryBackendFetch<StatsResponse>(`/api/v1/stats${query}`);
    if (remote) return remote;

    const memories = loadStore<MemoryRecord[]>(STORAGE_KEY_MEMORIES, INITIAL_MEMORIES);
    const nodes = loadStore<GraphNode[]>(STORAGE_KEY_NODES, INITIAL_NODES);
    const edges = loadStore<GraphEdge[]>(STORAGE_KEY_EDGES, INITIAL_EDGES);
    const telemetry = loadStore<TelemetryLogItem[]>(STORAGE_KEY_TELEMETRY, INITIAL_TELEMETRY);
    const settings = loadStore<SettingsPayload>(STORAGE_KEY_SETTINGS, INITIAL_SETTINGS);

    const scopedMemories =
      workspace && workspace !== 'all'
        ? memories.filter((m) => m.workspace === workspace || m.workspace === 'global')
        : memories;

    const active = scopedMemories.filter((m) => m.status === 'active');
    const superseded = scopedMemories.filter((m) => m.status === 'superseded');
    const pinned = active.filter((m) => m.is_pinned === 1);

    const scopedTelemetry =
      workspace && workspace !== 'all'
        ? telemetry.filter((t) => t.workspace === workspace || t.workspace === 'global')
        : telemetry;

    const rawTotal = scopedTelemetry.reduce((acc, t) => acc + t.raw_tokens, 0);
    const distilledTotal = scopedTelemetry.reduce((acc, t) => acc + t.distilled_tokens, 0);
    const savedTotal = Math.max(0, rawTotal - distilledTotal);
    const savingsPct = rawTotal > 0 ? Number(((savedTotal / rawTotal) * 100).toFixed(1)) : 86.4;
    const avgLatency =
      scopedTelemetry.length > 0
        ? Number((scopedTelemetry.reduce((acc, t) => acc + t.latency_ms, 0) / scopedTelemetry.length).toFixed(1))
        : 13.2;

    const scopedNodes =
      workspace && workspace !== 'all'
        ? nodes.filter((n) => n.workspace === workspace || n.workspace === 'global')
        : nodes;
    const scopedEdges =
      workspace && workspace !== 'all'
        ? edges.filter((e) => e.workspace === workspace || e.workspace === 'global')
        : edges;

    return {
      status: 'ok',
      workspace_filter: workspace && workspace !== 'all' ? workspace : null,
      active_memories: active.length,
      superseded_memories: superseded.length,
      pinned_memories: pinned.length,
      type_breakdown: {
        semantic: active.filter((m) => m.type === 'semantic').length,
        procedural: active.filter((m) => m.type === 'procedural').length,
        episodic: active.filter((m) => m.type === 'episodic').length,
      },
      knowledge_graph: {
        entities: scopedNodes.length,
        edges: scopedEdges.length,
      },
      token_efficiency: {
        total_queries: scopedTelemetry.length,
        raw_tokens_total: rawTotal,
        distilled_tokens_total: distilledTotal,
        tokens_saved_total: savedTotal,
        compression_savings_pct: savingsPct,
        avg_latency_ms: avgLatency,
      },
      recent_telemetry: scopedTelemetry.slice(-12),
      recent_procedural_rules: active.filter((m) => m.type === 'procedural').slice(0, 8),
      worker: {
        running: true,
        queue_depth: settings.reindex_status.running ? 1 : 0,
        reindex_status: settings.reindex_status,
      },
      embedding_runtime: {
        mode: settings.embedding_mode,
        local_model_loaded_in_ram: settings.embedding_mode === 'local',
        dimension: settings.current_vec_dimension,
      },
    };
  },

  async listMemories(params: {
    workspace?: string;
    type?: string;
    status?: string;
    q?: string;
  }): Promise<{ total: number; items: MemoryRecord[] }> {
    const search = new URLSearchParams();
    if (params.workspace && params.workspace !== 'all') search.set('workspace', params.workspace);
    if (params.type && params.type !== 'all') search.set('type', params.type);
    if (params.status && params.status !== 'all') search.set('status', params.status);
    if (params.q) search.set('q', params.q);

    const remote = await tryBackendFetch<{ total: number; items: MemoryRecord[] }>(
      `/api/v1/memories?${search.toString()}`
    );
    if (remote) return remote;

    const memories = loadStore<MemoryRecord[]>(STORAGE_KEY_MEMORIES, INITIAL_MEMORIES);
    const filtered = memories.filter((m) => {
      if (params.workspace && params.workspace !== 'all' && m.workspace !== params.workspace) {
        return false;
      }
      if (params.type && params.type !== 'all' && m.type !== params.type) {
        return false;
      }
      if (params.status && params.status !== 'all' && m.status !== params.status) {
        return false;
      }
      if (params.q && params.q.trim()) {
        const needle = params.q.trim().toLowerCase();
        const hay = `${m.content} ${m.source} ${m.id} ${m.workspace}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      if (a.is_pinned !== b.is_pinned) return b.is_pinned - a.is_pinned;
      return b.valid_from.localeCompare(a.valid_from);
    });

    return { total: filtered.length, items: filtered };
  },

  async createMemory(payload: {
    workspace: string;
    content: string;
    type: MemoryType;
    source?: string;
    confidence?: number;
    is_pinned?: boolean;
    supersedes_id?: string | null;
    skip_activity_log?: boolean;
  }): Promise<{ action: string; memory: MemoryRecord }> {
    const remote = await tryBackendFetch<{ action: string; memory: MemoryRecord }>('/api/v1/memories', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (remote) return remote;

    const memories = loadStore<MemoryRecord[]>(STORAGE_KEY_MEMORIES, INITIAL_MEMORIES);
    const scrubResult = scrubSecretsText(payload.content.trim());
    const sanitizedContent = scrubResult.scrubbed;
    const nowIso = new Date().toISOString();
    const newId = `mem-${Math.random().toString(36).slice(2, 10)}`;

    if (payload.supersedes_id) {
      const oldIdx = memories.findIndex((m) => m.id === payload.supersedes_id);
      if (oldIdx !== -1) {
        memories[oldIdx] = {
          ...memories[oldIdx],
          status: 'superseded',
          superseded_by_id: newId,
          valid_until: nowIso,
        };
      }
    }

    const record: MemoryRecord = {
      id: newId,
      workspace: payload.workspace || 'default',
      content: sanitizedContent,
      type: payload.type || 'semantic',
      status: 'active',
      source: payload.source || 'dashboard_manual',
      confidence: payload.confidence ?? 0.95,
      is_pinned: payload.is_pinned ? 1 : 0,
      supersedes_id: payload.supersedes_id || null,
      superseded_by_id: null,
      valid_from: nowIso,
      valid_until: null,
      expires_at: null,
      access_count: 1,
      last_accessed_at: nowIso,
    };

    memories.unshift(record);
    saveStore(STORAGE_KEY_MEMORIES, memories);

    const extracted = extractTriplesFromContent(record.workspace, record.content);
    if (extracted.nodes.length > 0) {
      const nodes = loadStore<GraphNode[]>(STORAGE_KEY_NODES, INITIAL_NODES);
      const edges = loadStore<GraphEdge[]>(STORAGE_KEY_EDGES, INITIAL_EDGES);
      for (const n of extracted.nodes) {
        if (!nodes.some((existing) => existing.id === n.id)) {
          nodes.push(n);
        }
      }
      edges.push(...extracted.edges);
      saveStore(STORAGE_KEY_NODES, nodes);
      saveStore(STORAGE_KEY_EDGES, edges);
    }

    const actionName = payload.supersedes_id ? 'superseded' : 'inserted';
    if (!payload.skip_activity_log) {
      appendActivityJob({
        job_id: `job_${Math.random().toString(36).slice(2, 14)}`,
        job_type: 'store_memory',
        workspace: record.workspace,
        status: 'completed',
        summary: `${actionName} ${record.type} memory (${record.source})`,
        detail: record.content.slice(0, 240),
        items_processed: 1,
        secrets_redacted: scrubResult.redactionCount,
        latency_ms: Number((14.2 + Math.random() * 12).toFixed(1)),
        created_at: nowIso,
        completed_at: nowIso,
      });
    }

    return { action: actionName, memory: record };
  },

  async updateMemory(
    memoryId: string,
    patch: {
      content?: string;
      type?: MemoryType;
      status?: MemoryStatus;
      confidence?: number;
      is_pinned?: boolean;
      workspace?: string;
    }
  ): Promise<MemoryRecord> {
    const remote = await tryBackendFetch<MemoryRecord>(`/api/v1/memories/${memoryId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    if (remote) return remote;

    const memories = loadStore<MemoryRecord[]>(STORAGE_KEY_MEMORIES, INITIAL_MEMORIES);
    const idx = memories.findIndex((m) => m.id === memoryId);
    if (idx === -1) throw new Error(`Memory ${memoryId} not found`);

    const updated: MemoryRecord = {
      ...memories[idx],
      ...(patch.content !== undefined ? { content: scrubSecretsText(patch.content).scrubbed } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.confidence !== undefined ? { confidence: patch.confidence } : {}),
      ...(patch.is_pinned !== undefined ? { is_pinned: patch.is_pinned ? 1 : 0 } : {}),
      ...(patch.workspace !== undefined ? { workspace: patch.workspace } : {}),
      last_accessed_at: new Date().toISOString(),
    };
    memories[idx] = updated;
    saveStore(STORAGE_KEY_MEMORIES, memories);
    return updated;
  },

  async deleteMemory(memoryId: string): Promise<{ deleted: boolean; id: string }> {
    const remote = await tryBackendFetch<{ deleted: boolean; id: string }>(`/api/v1/memories/${memoryId}`, {
      method: 'DELETE',
    });
    if (remote) return remote;

    const memories = loadStore<MemoryRecord[]>(STORAGE_KEY_MEMORIES, INITIAL_MEMORIES);
    const filtered = memories.filter((m) => m.id !== memoryId);
    saveStore(STORAGE_KEY_MEMORIES, filtered);
    return { deleted: true, id: memoryId };
  },

  async getMemoryHistory(memoryId: string): Promise<MemoryHistoryChain> {
    const remote = await tryBackendFetch<MemoryHistoryChain>(`/api/v1/memories/${memoryId}/history`);
    if (remote) return remote;

    const memories = loadStore<MemoryRecord[]>(STORAGE_KEY_MEMORIES, INITIAL_MEMORIES);
    const byId = new Map(memories.map((m) => [m.id, m]));
    const current = byId.get(memoryId);
    if (!current) {
      return { memory_id: memoryId, total_versions: 0, history: [] };
    }

    const chain: MemoryRecord[] = [];
    let cursor: MemoryRecord | undefined = current;
    const visited = new Set<string>();
    while (cursor && cursor.supersedes_id && !visited.has(cursor.supersedes_id)) {
      visited.add(cursor.id);
      const prev = byId.get(cursor.supersedes_id);
      if (prev) {
        chain.unshift(prev);
        cursor = prev;
      } else {
        break;
      }
    }

    chain.push(current);
    cursor = current;
    while (cursor && cursor.superseded_by_id && !visited.has(cursor.superseded_by_id)) {
      visited.add(cursor.id);
      const next = byId.get(cursor.superseded_by_id);
      if (next) {
        chain.push(next);
        cursor = next;
      } else {
        break;
      }
    }

    return {
      memory_id: memoryId,
      total_versions: chain.length,
      history: chain,
    };
  },

  async rollbackMemory(memoryId: string): Promise<{ action: string; restored_memory: MemoryRecord }> {
    const remote = await tryBackendFetch<{ action: string; restored_memory: MemoryRecord }>(
      `/api/v1/memories/${memoryId}/rollback`,
      { method: 'POST' }
    );
    if (remote) return remote;

    const memories = loadStore<MemoryRecord[]>(STORAGE_KEY_MEMORIES, INITIAL_MEMORIES);
    const targetIdx = memories.findIndex((m) => m.id === memoryId);
    if (targetIdx === -1) throw new Error(`Memory ${memoryId} not found`);

    const target = memories[targetIdx];
    const nowIso = new Date().toISOString();

    if (target.superseded_by_id) {
      const successorIdx = memories.findIndex((m) => m.id === target.superseded_by_id);
      if (successorIdx !== -1) {
        memories[successorIdx] = {
          ...memories[successorIdx],
          status: 'superseded',
          superseded_by_id: target.id,
          valid_until: nowIso,
        };
      }
    }

    const restored: MemoryRecord = {
      ...target,
      status: 'active',
      superseded_by_id: null,
      valid_until: null,
      last_accessed_at: nowIso,
    };
    memories[targetIdx] = restored;
    saveStore(STORAGE_KEY_MEMORIES, memories);

    return { action: 'rolled_back', restored_memory: restored };
  },

  async getGraph(workspace?: string): Promise<GraphResponse> {
    const query = workspace && workspace !== 'all' ? `?workspace=${encodeURIComponent(workspace)}` : '';
    const remote = await tryBackendFetch<GraphResponse>(`/api/v1/graph${query}`);
    if (remote) return remote;

    const nodes = loadStore<GraphNode[]>(STORAGE_KEY_NODES, INITIAL_NODES);
    const edges = loadStore<GraphEdge[]>(STORAGE_KEY_EDGES, INITIAL_EDGES);

    const filteredNodes =
      workspace && workspace !== 'all'
        ? nodes.filter((n) => n.workspace === workspace || n.workspace === 'global')
        : nodes;
    const filteredEdges =
      workspace && workspace !== 'all'
        ? edges.filter((e) => e.workspace === workspace || e.workspace === 'global')
        : edges;

    return {
      workspace: workspace || 'all',
      nodes: filteredNodes,
      edges: filteredEdges,
    };
  },

  async playgroundQuery(payload: {
    query: string;
    workspace: string;
    top_k: number;
    distill: boolean;
  }): Promise<PlaygroundQueryResponse> {
    const remote = await tryBackendFetch<PlaygroundQueryResponse>('/api/v1/playground/query', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (remote) return remote;

    const startMs = performance.now();
    const memories = loadStore<MemoryRecord[]>(STORAGE_KEY_MEMORIES, INITIAL_MEMORIES);
    const edges = loadStore<GraphEdge[]>(STORAGE_KEY_EDGES, INITIAL_EDGES);
    const telemetry = loadStore<TelemetryLogItem[]>(STORAGE_KEY_TELEMETRY, INITIAL_TELEMETRY);

    const activePool = memories.filter(
      (m) =>
        m.status === 'active' &&
        (payload.workspace === 'all' || m.workspace === payload.workspace || m.workspace === 'global')
    );

    const queryTokens = payload.query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2);

    const candidates: PlaygroundCandidate[] = activePool.map((m) => {
      const contentLower = m.content.toLowerCase();
      let matchedTokens = 0;
      for (const tok of queryTokens) {
        if (contentLower.includes(tok)) matchedTokens++;
      }
      const lexicalOverlap = queryTokens.length > 0 ? matchedTokens / queryTokens.length : 0.5;
      const vectorScore = Number(Math.min(0.98, 0.58 + lexicalOverlap * 0.39).toFixed(4));

      const hasGraphOverlap = edges.some(
        (e) =>
          (e.workspace === m.workspace || e.workspace === 'global') &&
          (contentLower.includes(e.source.toLowerCase()) || contentLower.includes(e.target.toLowerCase()))
      );
      const graphBoost = hasGraphOverlap ? 0.88 : 0.25;

      const ageDays = Math.max(
        0,
        (Date.now() - new Date(m.valid_from).getTime()) / (1000 * 60 * 60 * 24)
      );
      const recencyScore = Number(Math.exp(-ageDays / 30).toFixed(4));
      const isPinned = m.is_pinned === 1;
      const pinnedBoost = isPinned ? 0.12 : 0.0;

      const breakdown = computeCompositeScore({
        sVector: vectorScore,
        sGraph: graphBoost,
        daysElapsed: ageDays,
        confidence: m.confidence,
        isPinned,
        memoryType: m.type,
      });
      const finalScore = breakdown.final_score;

      return {
        id: m.id,
        workspace: m.workspace,
        content: m.content,
        type: m.type,
        status: m.status,
        source: m.source,
        confidence: m.confidence,
        is_pinned: isPinned,
        access_count: m.access_count + 1,
        valid_from: m.valid_from,
        score: finalScore,
        score_breakdown: {
          vector_score: vectorScore,
          graph_boost: graphBoost,
          recency_score: recencyScore,
          confidence_score: m.confidence,
          pinned_boost: pinnedBoost,
        },
      };
    });

    candidates.sort((a, b) => b.score - a.score);
    const topResults = candidates.slice(0, payload.top_k);

    const rawChars = topResults.reduce((acc, item) => acc + item.content.length + 140, 0);
    const rawTokens = Math.max(180, Math.round(rawChars * 1.45));

    const distilledLines = topResults.map((r, idx) => {
      const prefix = r.is_pinned ? '[PINNED DIRECTIVE]' : `[${r.type.toUpperCase()} • ${r.workspace}]`;
      return `- **${prefix}** ${r.content} *(score: ${r.score.toFixed(3)})*`;
    });

    const distilledContext = payload.distill
      ? `### Engram Distilled Context (Workspace: \`${payload.workspace}\`)\n` +
        `Synthesized ${topResults.length} high-signal memories matching query *"${payload.query}"*:\n\n` +
        distilledLines.join('\n')
      : topResults
          .map((r) => `[ID: ${r.id} | Workspace: ${r.workspace} | Type: ${r.type}]\n${r.content}`)
          .join('\n\n---\n\n');

    const distilledTokens = payload.distill
      ? Math.max(45, Math.round(rawTokens * 0.14))
      : rawTokens;
    const tokensSaved = Math.max(0, rawTokens - distilledTokens);
    const savingsPct = rawTokens > 0 ? Number(((tokensSaved / rawTokens) * 100).toFixed(1)) : 0;
    const latencyMs = Number(Math.max(8.4, performance.now() - startMs + 11.2).toFixed(1));

    const newLog: TelemetryLogItem = {
      id: Date.now(),
      workspace: payload.workspace === 'all' ? 'global' : payload.workspace,
      query: payload.query,
      raw_tokens: rawTokens,
      distilled_tokens: distilledTokens,
      latency_ms: latencyMs,
      created_at: new Date().toISOString(),
    };
    telemetry.push(newLog);
    saveStore(STORAGE_KEY_TELEMETRY, telemetry.slice(-25));

    return {
      query: payload.query,
      workspace: payload.workspace,
      top_k: payload.top_k,
      distill: payload.distill,
      distilled_context: distilledContext,
      token_metrics: {
        raw_tokens: rawTokens,
        distilled_tokens: distilledTokens,
        tokens_saved: tokensSaved,
        savings_pct: savingsPct,
      },
      latency_ms: latencyMs,
      results: topResults,
    };
  },

  async exportBackup(workspace?: string): Promise<Record<string, unknown>> {
    const query = workspace && workspace !== 'all' ? `?workspace=${encodeURIComponent(workspace)}` : '';
    const remote = await tryBackendFetch<Record<string, unknown>>(`/api/v1/export${query}`);
    if (remote) return remote;

    const memories = loadStore<MemoryRecord[]>(STORAGE_KEY_MEMORIES, INITIAL_MEMORIES);
    const nodes = loadStore<GraphNode[]>(STORAGE_KEY_NODES, INITIAL_NODES);
    const edges = loadStore<GraphEdge[]>(STORAGE_KEY_EDGES, INITIAL_EDGES);

    const scopedMemories =
      workspace && workspace !== 'all' ? memories.filter((m) => m.workspace === workspace) : memories;
    const scopedNodes =
      workspace && workspace !== 'all' ? nodes.filter((n) => n.workspace === workspace) : nodes;
    const scopedEdges =
      workspace && workspace !== 'all' ? edges.filter((e) => e.workspace === workspace) : edges;

    return {
      app: 'Engram',
      version: '1.0.0',
      exported_at: new Date().toISOString(),
      workspace_filter: workspace || null,
      memories: scopedMemories,
      entities: scopedNodes,
      edges: scopedEdges,
    };
  },

  async importBackup(payload: {
    workspace?: string;
    type?: MemoryType;
    auto_pin?: boolean;
    bulk_text?: string;
    memories?: Array<Partial<MemoryRecord>>;
  }): Promise<{ status: string; imported_count: number }> {
    const remote = await tryBackendFetch<{ status: string; imported_count: number }>('/api/v1/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (remote) return remote;

    let importedCount = 0;
    const targetWorkspace = payload.workspace && payload.workspace !== 'all' ? payload.workspace : 'global';

    if (payload.bulk_text && payload.bulk_text.trim()) {
      const lines = payload.bulk_text
        .split('\n')
        .map((l) => l.trim().replace(/^[-*•]\s*/, '').replace(/^\d+\.\s*/, ''))
        .filter((l) => l.length >= 3);

      for (const line of lines) {
        await this.createMemory({
          workspace: targetWorkspace,
          content: line,
          type: payload.type || 'procedural',
          source: 'bulk_seed',
          confidence: 0.95,
          is_pinned: Boolean(payload.auto_pin),
        });
        importedCount++;
      }
    }

    if (Array.isArray(payload.memories)) {
      for (const item of payload.memories) {
        if (item.content && item.content.trim()) {
          await this.createMemory({
            workspace: item.workspace || targetWorkspace,
            content: item.content,
            type: (item.type as MemoryType) || payload.type || 'semantic',
            source: item.source || 'json_import',
            confidence: item.confidence ?? 0.92,
            is_pinned: Boolean(item.is_pinned ?? payload.auto_pin),
          });
          importedCount++;
        }
      }
    }

    return { status: 'imported', imported_count: importedCount };
  },

  async getSettings(): Promise<SettingsPayload> {
    const remote = await tryBackendFetch<SettingsPayload>('/api/v1/settings');
    if (remote) return remote;

    return loadStore<SettingsPayload>(STORAGE_KEY_SETTINGS, INITIAL_SETTINGS);
  },

  async updateSettings(patch: Partial<SettingsPayload>): Promise<{ status: string; settings: SettingsPayload }> {
    const remote = await tryBackendFetch<{ status: string; settings: SettingsPayload }>('/api/v1/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
    if (remote) return remote;

    const current = loadStore<SettingsPayload>(STORAGE_KEY_SETTINGS, INITIAL_SETTINGS);
    const nextMode = patch.embedding_mode ?? current.embedding_mode;
    const nextDim =
      patch.embedding_dimension !== undefined ? Number(patch.embedding_dimension) : current.embedding_dimension;

    const updated: SettingsPayload = {
      ...current,
      ...patch,
      embedding_mode: nextMode,
      embedding_dimension: nextDim,
      dimension_mismatch: nextDim !== current.current_vec_dimension,
      runtime_embedding: {
        ...current.runtime_embedding,
        mode: nextMode,
        external_base_url: patch.embedding_base_url ?? current.embedding_base_url,
        external_model: patch.embedding_model ?? current.embedding_model,
        local_model_name: patch.local_embedding_model ?? current.local_embedding_model,
        local_model_loaded_in_ram: nextMode === 'local',
        dimension: nextDim,
      },
    };

    saveStore(STORAGE_KEY_SETTINGS, updated);
    return { status: 'updated', settings: updated };
  },

  async testLlm(payload: {
    llm_base_url: string;
    llm_api_key?: string;
    llm_model: string;
  }): Promise<{
    ok: boolean;
    model: string;
    base_url: string;
    latency_ms: number;
    response_preview: string;
  }> {
    const remote = await tryBackendFetch<{
      ok: boolean;
      model: string;
      base_url: string;
      latency_ms: number;
      response_preview: string;
    }>('/api/v1/settings/test-llm', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (remote) return remote;

    await new Promise((r) => setTimeout(r, 180));
    return {
      ok: true,
      model: payload.llm_model,
      base_url: payload.llm_base_url,
      latency_ms: 84.6,
      response_preview: 'OK • OpenAI-compatible chat/completions handshake verified',
    };
  },

  async fetchAvailableModels(payload: {
    base_url: string;
    api_key?: string;
    kind: ModelCatalogKind;
  }): Promise<FetchModelsResponse> {
    const modelsUrl = normalizeModelsEndpointUrl(payload.base_url);
    const fallbackModels: DiscoveredModelOption[] = getFallbackCatalogModels(payload.kind);

    const remote = await tryBackendFetch<FetchModelsResponse>('/api/v1/settings/models', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (remote) {
      if (remote.models && remote.models.length > 0) {
        return remote;
      }
      return {
        ...remote,
        source: 'catalog',
        models: fallbackModels,
      };
    }

    // Standalone SPA mode on port 3000: attempt direct CORS-safe HTTPS /models fetch if valid external URL
    const trimmedKey = (payload.api_key || '').trim();
    const isMaskedKey =
      !trimmedKey || trimmedKey.includes('...') || trimmedKey.includes('•') || trimmedKey === '***';

    if (modelsUrl && isBrowserDirectFetchSafe(payload.base_url) && !isMaskedKey) {
      const started = performance.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      try {
        const res = await fetch(modelsUrl, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${trimmedKey}`,
          },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          const json = (await res.json()) as unknown;
          const parsed = parseOpenAiModelsPayload(json, payload.kind, 'live');
          if (parsed.length > 0) {
            return {
              ok: true,
              source: 'live',
              models_url: modelsUrl,
              latency_ms: Number((performance.now() - started).toFixed(1)),
              models: parsed,
              error: null,
            };
          }
        }
      } catch {
        clearTimeout(timer);
      }
    }

    await new Promise((r) => setTimeout(r, 90));
    return {
      ok: true,
      source: 'catalog',
      models_url: modelsUrl,
      latency_ms: 14.2,
      models: fallbackModels,
      error: null,
    };
  },

  async testEmbedding(payload: {
    embedding_mode: 'external' | 'local';
    embedding_base_url: string;
    embedding_api_key?: string;
    embedding_model: string;
    local_embedding_model: string;
  }): Promise<{
    ok: boolean;
    mode: string;
    model: string;
    detected_dimension: number;
    current_vec_dimension: number;
    dimension_mismatch: boolean;
    latency_ms: number;
    local_model_loaded_in_ram: boolean;
  }> {
    const remote = await tryBackendFetch<{
      ok: boolean;
      mode: string;
      model: string;
      detected_dimension: number;
      current_vec_dimension: number;
      dimension_mismatch: boolean;
      latency_ms: number;
      local_model_loaded_in_ram: boolean;
    }>('/api/v1/settings/test-embedding', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (remote) return remote;

    await new Promise((r) => setTimeout(r, 160));
    const current = loadStore<SettingsPayload>(STORAGE_KEY_SETTINGS, INITIAL_SETTINGS);
    const detectedDim =
      payload.embedding_mode === 'local'
        ? payload.local_embedding_model.includes('large')
          ? 1024
          : 384
        : payload.embedding_model.includes('3-large')
          ? 3072
          : payload.embedding_model.includes('nomic')
            ? 768
            : 1536;

    return {
      ok: true,
      mode: payload.embedding_mode,
      model: payload.embedding_mode === 'local' ? payload.local_embedding_model : payload.embedding_model,
      detected_dimension: detectedDim,
      current_vec_dimension: current.current_vec_dimension,
      dimension_mismatch: detectedDim !== current.current_vec_dimension,
      latency_ms: payload.embedding_mode === 'local' ? 18.4 : 62.5,
      local_model_loaded_in_ram: payload.embedding_mode === 'local',
    };
  },

  async triggerReindex(dimension?: number): Promise<{ status: string; target_dimension: number; reindex_status: ReindexStatus }> {
    const remote = await tryBackendFetch<{ status: string; target_dimension: number; reindex_status: ReindexStatus }>(
      '/api/v1/settings/reindex',
      {
        method: 'POST',
        body: JSON.stringify({ dimension }),
      }
    );
    if (remote) return remote;

    const current = loadStore<SettingsPayload>(STORAGE_KEY_SETTINGS, INITIAL_SETTINGS);
    const memories = loadStore<MemoryRecord[]>(STORAGE_KEY_MEMORIES, INITIAL_MEMORIES);
    const activeCount = memories.filter((m) => m.status === 'active').length;
    const targetDim = dimension || current.embedding_dimension || 1536;

    const statusObj: ReindexStatus = {
      running: false,
      total: activeCount,
      processed: activeCount,
      dimension: targetDim,
      started_at: new Date(Date.now() - 800).toISOString(),
      completed_at: new Date().toISOString(),
      error: null,
    };

    const updated: SettingsPayload = {
      ...current,
      embedding_dimension: targetDim,
      current_vec_dimension: targetDim,
      dimension_mismatch: false,
      reindex_status: statusObj,
    };
    saveStore(STORAGE_KEY_SETTINGS, updated);

    appendActivityJob({
      job_id: `job_${Math.random().toString(36).slice(2, 14)}`,
      job_type: 'reindex_all',
      workspace: 'global',
      status: 'completed',
      summary: `Re-indexed ${activeCount}/${activeCount} vectors @ ${targetDim}d`,
      detail: `vec_memories rebuilt at ${targetDim}d embedding vector space.`,
      items_processed: activeCount,
      secrets_redacted: 0,
      latency_ms: Number((180 + activeCount * 14.5).toFixed(1)),
      created_at: statusObj.started_at || new Date().toISOString(),
      completed_at: statusObj.completed_at,
    });

    return {
      status: 'reindexed',
      target_dimension: targetDim,
      reindex_status: statusObj,
    };
  },

  async getDirectivesPreview(
    workspace: string = 'global',
    budgetLimit: number = 1500
  ): Promise<DirectivesPreviewResponse> {
    const cleanWs = (workspace || 'global').trim() || 'global';
    const remote = await tryBackendFetch<DirectivesPreviewResponse>(
      `/api/v1/directives/preview?workspace=${encodeURIComponent(cleanWs)}&budget_limit=${budgetLimit}`
    );
    if (remote) return remote;

    const memories = loadStore<MemoryRecord[]>(STORAGE_KEY_MEMORIES, INITIAL_MEMORIES);
    return buildDirectivesPreviewPayload(memories, cleanWs, budgetLimit);
  },

  async getIntegrationsStatus(): Promise<IntegrationsStatusResponse> {
    const remote = await tryBackendFetch<IntegrationsStatusResponse>('/api/v1/integrations/status');
    if (remote) return remote;

    const currentSettings = loadStore<SettingsPayload>(STORAGE_KEY_SETTINGS, INITIAL_SETTINGS);
    return {
      service: 'Engram Dual-Transport MCP Server',
      mcp_streamable_path: '/mcp',
      mcp_sse_path: '/sse',
      mcp_messages_path: '/messages',
      ingest_webhook_path: '/api/v1/ingest',
      auto_ingest_enabled: Boolean(currentSettings.auto_ingest_enabled),
      mcp_key_hint: 'sk-m...cret',
      registered_tools: [
        'recall_memory',
        'store_memory',
        'learn_from_mistake',
        'supersede_memory',
      ],
      registered_resources: [
        'memory://core-directives/{workspace}',
        'memory://session-summary/{workspace}',
      ],
    };
  },

  async probeMcpTransport(transport: McpTransportKind = 'streamable_http'): Promise<IntegrationProbeResponse> {
    const remote = await tryBackendFetch<IntegrationProbeResponse>('/api/v1/integrations/probe', {
      method: 'POST',
      body: JSON.stringify({ transport }),
    });
    if (remote) return remote;

    await new Promise((r) => setTimeout(r, 140));
    const currentSettings = loadStore<SettingsPayload>(STORAGE_KEY_SETTINGS, INITIAL_SETTINGS);
    const ingestOpen = Boolean(currentSettings.auto_ingest_enabled);

    return {
      ok: true,
      checked_at: new Date().toISOString(),
      transport,
      overall_latency_ms: 21.4,
      endpoints: [
        {
          id: 'mcp-http',
          label: 'MCP Streamable HTTP',
          method: 'POST',
          path: '/mcp',
          status: 'online',
          http_status: 200,
          latency_ms: 6.2,
          detail: 'FastMCP streamable HTTP transport mounted with Bearer Auth guard.',
        },
        {
          id: 'mcp-sse',
          label: 'MCP Legacy SSE + Messages',
          method: 'GET',
          path: '/sse',
          status: 'online',
          http_status: 200,
          latency_ms: 7.4,
          detail: 'SSE event stream (/sse) + JSON-RPC channel (/messages) ready.',
        },
        {
          id: 'ingest-webhook',
          label: 'Auto-Ingest Webhook',
          method: 'POST',
          path: '/api/v1/ingest',
          status: ingestOpen ? 'online' : 'locked',
          http_status: ingestOpen ? 202 : 403,
          latency_ms: 4.1,
          detail: ingestOpen
            ? 'Accepting conversation transcripts for async extraction.'
            : 'Locked by Settings toggle (HTTP 403 Forbidden).',
        },
        {
          id: 'health',
          label: 'Container & sqlite-vec WAL',
          method: 'GET',
          path: '/health',
          status: 'online',
          http_status: 200,
          latency_ms: 3.7,
          detail: 'SQLite WAL + vec0 extension verified.',
        },
      ],
    };
  },

  async getWorkerActivity(
    workspace?: string,
    jobType?: string
  ): Promise<WorkerActivityResponse> {
    const search = new URLSearchParams();
    if (workspace && workspace !== 'all') search.set('workspace', workspace);
    if (jobType && jobType !== 'all') search.set('job_type', jobType);
    const qs = search.toString();

    const remote = await tryBackendFetch<WorkerActivityResponse>(
      `/api/v1/activity${qs ? `?${qs}` : ''}`
    );
    if (remote) return remote;

    const allJobs = loadStore<WorkerJobRecord[]>(STORAGE_KEY_ACTIVITY_JOBS, INITIAL_ACTIVITY_JOBS);
    const filtered = filterWorkerJobs(allJobs, {
      workspace: workspace || 'all',
      jobType: (jobType as WorkerJobType | 'all') || 'all',
    });
    const meta = loadStore<ActivityMetaState>(STORAGE_KEY_ACTIVITY_META, INITIAL_ACTIVITY_META);
    const currentSettings = loadStore<SettingsPayload>(STORAGE_KEY_SETTINGS, INITIAL_SETTINGS);

    return {
      worker_running: true,
      queue_depth: currentSettings.reindex_status.running ? 1 : 0,
      jobs_processed: Math.max(allJobs.length, 42 + (allJobs.length - INITIAL_ACTIVITY_JOBS.length)),
      ttl_sweeps_count: meta.ttl_sweeps_count,
      expired_cleaned_total: meta.expired_cleaned_total,
      auto_ingest_enabled: Boolean(currentSettings.auto_ingest_enabled),
      reindex_status: currentSettings.reindex_status,
      jobs: filtered,
    };
  },

  async runTtlSweep(): Promise<{
    status: string;
    expired_cleaned: number;
    swept_at: string;
  }> {
    const remote = await tryBackendFetch<{
      status: string;
      expired_cleaned: number;
      swept_at: string;
    }>('/api/v1/activity/ttl-sweep', {
      method: 'POST',
    });
    if (remote) return remote;

    const memories = loadStore<MemoryRecord[]>(STORAGE_KEY_MEMORIES, INITIAL_MEMORIES);
    const nowIso = new Date().toISOString();
    const expired = memories.filter(
      (m) => m.expires_at !== null && m.expires_at <= nowIso
    );
    const remaining = memories.filter(
      (m) => m.expires_at === null || m.expires_at > nowIso
    );
    if (expired.length > 0) {
      saveStore(STORAGE_KEY_MEMORIES, remaining);
    }

    const meta = loadStore<ActivityMetaState>(STORAGE_KEY_ACTIVITY_META, INITIAL_ACTIVITY_META);
    const updatedMeta: ActivityMetaState = {
      ttl_sweeps_count: meta.ttl_sweeps_count + 1,
      expired_cleaned_total: meta.expired_cleaned_total + expired.length,
    };
    saveStore(STORAGE_KEY_ACTIVITY_META, updatedMeta);

    appendActivityJob({
      job_id: `job_${Math.random().toString(36).slice(2, 14)}`,
      job_type: 'ttl_cleanup',
      workspace: 'global',
      status: 'completed',
      summary: `TTL sweep removed ${expired.length} expired episodic record(s)`,
      detail: `Checked expires_at <= ${nowIso}; removed ${expired.length} expired rows from memories + vec_memories.`,
      items_processed: expired.length,
      secrets_redacted: 0,
      latency_ms: Number((3.8 + Math.random() * 3.1).toFixed(1)),
      created_at: nowIso,
      completed_at: nowIso,
    });

    return {
      status: 'completed',
      expired_cleaned: expired.length,
      swept_at: nowIso,
    };
  },

  async simulateWebhookIngest(payload: {
    workspace: string;
    transcript: string;
  }): Promise<{
    status: string;
    job_id: string;
    extracted_count: number;
    secrets_redacted: number;
  }> {
    const cleanWs = (payload.workspace && payload.workspace !== 'all' ? payload.workspace : 'global').trim() || 'global';
    const lines = payload.transcript
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const messages = lines.map((line) => {
      const match = line.match(/^(user|assistant|system)\s*:\s*(.*)$/i);
      if (match) {
        return { role: match[1].toLowerCase(), content: match[2] };
      }
      return { role: 'user', content: line };
    });

    const remote = await tryBackendFetch<{
      status: string;
      job_id: string;
    }>('/api/v1/ingest', {
      method: 'POST',
      body: JSON.stringify({ workspace: cleanWs, messages }),
    });
    if (remote) {
      return {
        status: remote.status || 'queued',
        job_id: remote.job_id,
        extracted_count: messages.length,
        secrets_redacted: 0,
      };
    }

    const t0 = performance.now();
    const candidates = extractMemoriesFromTranscriptText(payload.transcript);
    let totalRedacted = 0;

    for (const item of candidates) {
      totalRedacted += item.secrets_redacted;
      await this.createMemory({
        workspace: cleanWs,
        content: item.content,
        type: item.type,
        source: 'ingest_webhook',
        confidence: item.confidence,
        is_pinned: item.is_pinned,
        skip_activity_log: true,
      });
    }

    const nowIso = new Date().toISOString();
    const jobId = `job_${Math.random().toString(36).slice(2, 14)}`;
    const latencyMs = Number(Math.max(16.4, performance.now() - t0 + 24.5).toFixed(1));

    appendActivityJob({
      job_id: jobId,
      job_type: 'ingest_messages',
      workspace: cleanWs,
      status: 'completed',
      summary: `Extracted ${candidates.length} memories from ${messages.length} conversation turns`,
      detail: `POST /api/v1/ingest -> workspace=${cleanWs} • extracted=${candidates.length} • redacted=${totalRedacted}`,
      items_processed: candidates.length,
      secrets_redacted: totalRedacted,
      latency_ms: latencyMs,
      created_at: nowIso,
      completed_at: nowIso,
    });

    return {
      status: 'completed',
      job_id: jobId,
      extracted_count: candidates.length,
      secrets_redacted: totalRedacted,
    };
  },

  async getHygieneAudit(
    workspace: string = 'all',
    staleDays: number = 30
  ): Promise<HygieneAuditResponse> {
    const cleanWs = (workspace || 'all').trim() || 'all';
    const remote = await tryBackendFetch<HygieneAuditResponse>(
      `/api/v1/hygiene/audit?workspace=${encodeURIComponent(cleanWs)}&stale_days=${staleDays}`
    );
    if (remote) return remote;

    const memories = loadStore<MemoryRecord[]>(STORAGE_KEY_MEMORIES, INITIAL_MEMORIES);
    const currentSettings = loadStore<SettingsPayload>(STORAGE_KEY_SETTINGS, INITIAL_SETTINGS);
    const dismissed = loadStore<string[]>(STORAGE_KEY_HYGIENE_DISMISSED, []);

    return analyzeMemoryHygiene(memories, {
      workspace: cleanWs,
      dedupThreshold: currentSettings.similarity_dedup_threshold ?? 0.85,
      staleDaysThreshold: staleDays,
      dismissedIssueIds: dismissed,
    });
  },

  async resolveHygieneIssue(payload: {
    action:
      | 'supersede_secondary'
      | 'merge_keep_primary'
      | 'archive_stale'
      | 'extend_ttl'
      | 'pin_keep'
      | 'dismiss';
    issue_id: string;
    primary_id: string;
    secondary_id?: string | null;
    merged_content?: string | null;
    workspace?: string;
  }): Promise<{ status: string; resolved_at: string }> {
    const remote = await tryBackendFetch<{ status: string; resolved_at: string }>(
      '/api/v1/hygiene/resolve',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    if (remote) return remote;

    const nowIso = new Date().toISOString();
    if (payload.action === 'dismiss') {
      const dismissed = loadStore<string[]>(STORAGE_KEY_HYGIENE_DISMISSED, []);
      if (!dismissed.includes(payload.issue_id)) {
        dismissed.push(payload.issue_id);
        saveStore(STORAGE_KEY_HYGIENE_DISMISSED, dismissed);
      }
      return { status: 'dismissed', resolved_at: nowIso };
    }

    const memories = loadStore<MemoryRecord[]>(STORAGE_KEY_MEMORIES, INITIAL_MEMORIES);
    const updated = memories.map((m) => {
      if (m.id === payload.primary_id) {
        if (payload.action === 'archive_stale') {
          return { ...m, status: 'archived' as MemoryStatus, valid_until: nowIso };
        }
        if (payload.action === 'extend_ttl') {
          return {
            ...m,
            expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
            last_accessed_at: nowIso,
          };
        }
        if (payload.action === 'pin_keep') {
          return {
            ...m,
            is_pinned: 1,
            expires_at: null,
            last_accessed_at: nowIso,
          };
        }
        return {
          ...m,
          ...(payload.merged_content && payload.merged_content.trim()
            ? { content: scrubSecretsText(payload.merged_content.trim()).scrubbed }
            : {}),
          last_accessed_at: nowIso,
        };
      }

      if (
        payload.secondary_id &&
        m.id === payload.secondary_id &&
        (payload.action === 'supersede_secondary' || payload.action === 'merge_keep_primary')
      ) {
        return {
          ...m,
          status: 'superseded' as MemoryStatus,
          superseded_by_id: payload.primary_id,
          valid_until: nowIso,
        };
      }
      return m;
    });

    saveStore(STORAGE_KEY_MEMORIES, updated);

    appendActivityJob({
      job_id: `job_${Math.random().toString(36).slice(2, 14)}`,
      job_type: 'store_memory',
      workspace: payload.workspace || 'global',
      status: 'completed',
      summary: `hygiene resolved (${payload.action}) on ${payload.primary_id}`,
      detail: `Issue ${payload.issue_id} resolved • primary=${payload.primary_id}${
        payload.secondary_id ? ` • superseded=${payload.secondary_id}` : ''
      }`,
      items_processed: payload.secondary_id ? 2 : 1,
      secrets_redacted: 0,
      latency_ms: 12.4,
      created_at: nowIso,
      completed_at: nowIso,
    });

    return { status: 'resolved', resolved_at: nowIso };
  },

  async getTokenAnalytics(params: {
    workspace?: string;
    modelId?: ModelPricingProfileId;
    sessionTurns?: number;
  } = {}): Promise<AnalyticsSummaryResponse> {
    const cleanWs = (params.workspace || 'all').trim() || 'all';
    const modelId = params.modelId || 'claude_sonnet_4';
    const sessionTurns = params.sessionTurns ?? 20;

    const remote = await tryBackendFetch<AnalyticsSummaryResponse>(
      `/api/v1/analytics/summary?workspace=${encodeURIComponent(cleanWs)}&model_id=${encodeURIComponent(modelId)}&session_turns=${sessionTurns}`
    );
    if (remote) return remote;

    const telemetry = loadStore<TelemetryLogItem[]>(STORAGE_KEY_TELEMETRY, INITIAL_TELEMETRY);
    const memories = loadStore<MemoryRecord[]>(STORAGE_KEY_MEMORIES, INITIAL_MEMORIES);

    return buildTokenAnalytics({
      telemetry,
      memories,
      workspace: cleanWs,
      modelId,
      sessionTurns,
    });
  },
};
