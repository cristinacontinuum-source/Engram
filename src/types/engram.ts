export type TabId = 'overview' | 'explorer' | 'graph' | 'playground' | 'settings';

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
