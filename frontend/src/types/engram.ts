export type TabId = 'overview' | 'explorer' | 'directives' | 'graph' | 'playground' | 'activity' | 'hygiene' | 'analytics' | 'integrations' | 'settings';

export type MemoryType = 'semantic' | 'procedural' | 'episodic';
export type MemoryStatus = 'active' | 'superseded' | 'archived';

export interface MemoryRecord {
  id: string;
  workspace: string;
  content: string;
  type: MemoryType;
  status: MemoryStatus;
  source: string;
  confidence: number;
  is_pinned: number;
  supersedes_id: string | null;
  superseded_by_id: string | null;
  valid_from: string;
  valid_until: string | null;
  expires_at: string | null;
  access_count: number;
  last_accessed_at: string | null;
}

export interface MemoryHistoryChain {
  memory_id: string;
  total_versions: number;
  history: MemoryRecord[];
}

export interface TelemetryLogItem {
  id: number;
  workspace: string;
  query: string;
  raw_tokens: number;
  distilled_tokens: number;
  latency_ms: number;
  created_at: string;
}

export interface StatsResponse {
  status: string;
  workspace_filter: string | null;
  active_memories: number;
  superseded_memories: number;
  pinned_memories: number;
  type_breakdown: {
    semantic: number;
    procedural: number;
    episodic: number;
  };
  knowledge_graph: {
    entities: number;
    edges: number;
  };
  token_efficiency: {
    total_queries: number;
    raw_tokens_total: number;
    distilled_tokens_total: number;
    tokens_saved_total: number;
    compression_savings_pct: number;
    avg_latency_ms: number;
  };
  recent_telemetry: TelemetryLogItem[];
  recent_procedural_rules: MemoryRecord[];
  worker: {
    running: boolean;
    queue_depth: number;
    reindex_status: ReindexStatus;
  };
  embedding_runtime: {
    mode: 'external' | 'local';
    local_model_loaded_in_ram: boolean;
    dimension: number;
  };
}

export interface GraphNode {
  id: string;
  workspace: string;
  name: string;
  type: string;
  created_at?: string;
}

export interface GraphEdge {
  id: string;
  workspace: string;
  source_id: string;
  source: string;
  source_type?: string;
  target_id: string;
  target: string;
  target_type?: string;
  relation: string;
  weight: number;
  created_at?: string;
}

export interface GraphResponse {
  workspace: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface PlaygroundScoreBreakdown {
  vector_score: number;
  graph_boost: number;
  recency_score: number;
  confidence_score: number;
  pinned_boost: number;
}

export interface PlaygroundCandidate {
  id: string;
  workspace: string;
  content: string;
  type: MemoryType;
  status: MemoryStatus;
  source: string;
  confidence: number;
  is_pinned: boolean;
  access_count: number;
  valid_from: string;
  score: number;
  score_breakdown: PlaygroundScoreBreakdown;
}

export interface PlaygroundQueryResponse {
  query: string;
  workspace: string;
  top_k: number;
  distill: boolean;
  distilled_context: string;
  token_metrics: {
    raw_tokens: number;
    distilled_tokens: number;
    tokens_saved: number;
    savings_pct: number;
  };
  latency_ms: number;
  results: PlaygroundCandidate[];
}

export interface ReindexStatus {
  running: boolean;
  total: number;
  processed: number;
  dimension: number;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
}

export interface SettingsPayload {
  llm_base_url: string;
  llm_api_key: string;
  llm_model: string;
  embedding_mode: 'external' | 'local';
  embedding_base_url: string;
  embedding_api_key: string;
  embedding_model: string;
  embedding_dimension: number;
  local_embedding_model: string;
  local_models_dir: string;
  auto_ingest_enabled: boolean;
  similarity_dedup_threshold: number;
  default_workspace: string;
  current_vec_dimension: number;
  dimension_mismatch: boolean;
  runtime_embedding: {
    mode: 'external' | 'local';
    external_base_url: string;
    external_model: string;
    local_model_name: string;
    local_models_dir: string;
    local_model_loaded_in_ram: boolean;
    dimension: number;
  };
  reindex_status: ReindexStatus;
}

export type DirectiveCategory = 'anti_pattern' | 'pinned_rule' | 'procedural';
export type DirectiveBudgetHealth = 'healthy' | 'warning' | 'heavy';

export interface DirectivesPreviewResponse {
  workspace: string;
  directives_count: number;
  anti_patterns_count: number;
  pinned_count: number;
  directives: MemoryRecord[];
  core_directives_text: string;
  session_summary_text: string;
  token_budget: {
    directives_tokens: number;
    session_tokens: number;
    total_tokens: number;
    budget_limit: number;
    utilization_pct: number;
    health: DirectiveBudgetHealth;
  };
}

export type IntegrationClientId =
  | 'hermes_agent'
  | 'claude_desktop'
  | 'cursor'
  | 'windsurf'
  | 'claude_code'
  | 'continue'
  | 'curl';

export type McpTransportKind = 'streamable_http' | 'sse';

export interface McpToolDescriptor {
  name: string;
  description: string;
  params: Array<{
    name: string;
    type: string;
    required: boolean;
    defaultValue?: string;
    description: string;
  }>;
  sampleCall: string;
}

export interface McpResourceDescriptor {
  uriTemplate: string;
  name: string;
  description: string;
  sampleUri: (workspace: string) => string;
}

export interface IntegrationsStatusResponse {
  service: string;
  mcp_streamable_path: string;
  mcp_sse_path: string;
  mcp_messages_path: string;
  ingest_webhook_path: string;
  auto_ingest_enabled: boolean;
  mcp_key_hint: string;
  registered_tools: string[];
  registered_resources: string[];
}

export interface IntegrationProbeEndpointResult {
  id: string;
  label: string;
  method: string;
  path: string;
  status: 'online' | 'locked' | 'error';
  http_status: number;
  latency_ms: number;
  detail: string;
}

export interface IntegrationProbeResponse {
  ok: boolean;
  checked_at: string;
  transport: McpTransportKind;
  overall_latency_ms: number;
  endpoints: IntegrationProbeEndpointResult[];
}

export type WorkerJobType = 'store_memory' | 'ingest_messages' | 'reindex_all' | 'ttl_cleanup';
export type WorkerJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface WorkerJobRecord {
  job_id: string;
  job_type: WorkerJobType;
  workspace: string;
  status: WorkerJobStatus;
  summary: string;
  detail: string;
  items_processed: number;
  secrets_redacted: number;
  latency_ms: number;
  created_at: string;
  completed_at: string | null;
}

export interface WorkerActivityResponse {
  worker_running: boolean;
  queue_depth: number;
  jobs_processed: number;
  ttl_sweeps_count: number;
  expired_cleaned_total: number;
  auto_ingest_enabled: boolean;
  reindex_status: ReindexStatus;
  jobs: WorkerJobRecord[];
}

export type HygieneIssueKind = 'conflict' | 'duplicate' | 'stale' | 'expiring';
export type HygieneSeverity = 'high' | 'medium' | 'low';
export type HygieneSuggestedAction =
  | 'supersede_secondary'
  | 'merge_keep_primary'
  | 'archive_stale'
  | 'extend_ttl';

export interface HygieneCandidatePair {
  issue_id: string;
  kind: HygieneIssueKind;
  severity: HygieneSeverity;
  workspace: string;
  similarity_score: number;
  title: string;
  reason: string;
  primary_memory: MemoryRecord;
  secondary_memory: MemoryRecord | null;
  suggested_action: HygieneSuggestedAction;
}

export interface HygieneAuditResponse {
  scanned_at: string;
  workspace: string;
  total_active_scanned: number;
  health_score: number;
  dedup_threshold: number;
  stale_days_threshold: number;
  counts: {
    all: number;
    conflict: number;
    duplicate: number;
    stale: number;
    expiring: number;
  };
  issues: HygieneCandidatePair[];
}

export type ModelPricingProfileId =
  | 'claude_sonnet_4'
  | 'gpt_4o'
  | 'gemini_2_5_pro'
  | 'gemini_2_5_flash'
  | 'deepseek_v3';

export interface ModelPricingProfile {
  id: ModelPricingProfileId;
  label: string;
  provider: string;
  inputPricePer1M: number;
  badge: string;
}

export interface WorkspaceTokenBreakdown {
  workspace: string;
  queries: number;
  raw_tokens: number;
  distilled_tokens: number;
  tokens_saved: number;
  savings_pct: number;
  estimated_usd_saved: number;
  avg_latency_ms: number;
}

export interface SessionProjection {
  turn_count: number;
  without_engram_tokens: number;
  with_engram_tokens: number;
  without_engram_cost_usd: number;
  with_engram_cost_usd: number;
  saved_tokens: number;
  saved_usd: number;
  savings_pct: number;
}

export interface AnalyticsTelemetryRun extends TelemetryLogItem {
  tokens_saved: number;
  savings_pct: number;
  raw_cost_usd: number;
  distilled_cost_usd: number;
  usd_saved: number;
}

export interface AnalyticsSummaryResponse {
  generated_at: string;
  workspace: string;
  model_id: ModelPricingProfileId;
  model_label: string;
  input_price_per_1m: number;
  currency: 'USD';
  totals: {
    total_queries: number;
    raw_tokens_total: number;
    distilled_tokens_total: number;
    tokens_saved_total: number;
    compression_savings_pct: number;
    raw_cost_usd: number;
    distilled_cost_usd: number;
    estimated_usd_saved: number;
    avg_latency_ms: number;
    directive_baseline_tokens: number;
    active_memories_count: number;
  };
  workspace_breakdown: WorkspaceTokenBreakdown[];
  recent_runs: AnalyticsTelemetryRun[];
  session_projection: SessionProjection;
}
