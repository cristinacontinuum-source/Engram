import {
  DirectiveBudgetHealth,
  DirectiveCategory,
  DirectivesPreviewResponse,
  MemoryRecord,
} from '../types/engram';

export type DirectiveFilterCategory = 'all' | DirectiveCategory;

/**
 * Deterministic token count estimator matching backend `llm_service.py::estimate_tokens`.
 * Blends ~4 chars/token with word count weighting (1.3x words) / 2.
 */
export function estimateTokens(text: string): number {
  if (!text || !text.trim()) return 0;
  const charEst = Math.floor(text.length / 4);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const wordEst = Math.floor(words * 1.3);
  return Math.max(1, Math.floor((charEst + wordEst) / 2));
}

export function isMemoryExpired(memory: MemoryRecord, nowMs: number = Date.now()): boolean {
  if (!memory.expires_at) return false;
  const exp = Date.parse(memory.expires_at);
  if (Number.isNaN(exp)) return false;
  return exp <= nowMs;
}

export function classifyDirective(memory: MemoryRecord): DirectiveCategory {
  const lower = memory.content.toLowerCase();
  if (
    memory.source === 'tool_error' ||
    lower.includes('[anti-pattern]') ||
    lower.includes('avoid:') ||
    lower.includes('[procedural rule]')
  ) {
    return 'anti_pattern';
  }
  if (memory.is_pinned === 1) {
    return 'pinned_rule';
  }
  return 'procedural';
}

export function isDirectiveCandidate(memory: MemoryRecord, nowMs: number = Date.now()): boolean {
  if (memory.status !== 'active') return false;
  if (isMemoryExpired(memory, nowMs)) return false;
  return memory.is_pinned === 1 || memory.type === 'procedural';
}

export function matchesWorkspaceScope(
  memoryWorkspace: string,
  targetWorkspace: string,
  includeGlobal: boolean = true
): boolean {
  const cleanTarget = (targetWorkspace || 'global').trim() || 'global';
  if (cleanTarget === 'all') return true;
  if (memoryWorkspace === cleanTarget) return true;
  return includeGlobal && memoryWorkspace === 'global';
}

export function sortDirectives(a: MemoryRecord, b: MemoryRecord): number {
  if (b.is_pinned !== a.is_pinned) return b.is_pinned - a.is_pinned;
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  return Date.parse(b.valid_from) - Date.parse(a.valid_from);
}

export function filterAndSortDirectives(
  memories: MemoryRecord[],
  workspace: string,
  options?: {
    category?: DirectiveFilterCategory;
    search?: string;
    includeGlobal?: boolean;
    nowMs?: number;
  }
): MemoryRecord[] {
  const category = options?.category ?? 'all';
  const search = (options?.search ?? '').trim().toLowerCase();
  const includeGlobal = options?.includeGlobal ?? true;
  const nowMs = options?.nowMs ?? Date.now();

  return memories
    .filter((m) => isDirectiveCandidate(m, nowMs))
    .filter((m) => matchesWorkspaceScope(m.workspace, workspace, includeGlobal))
    .filter((m) => (category === 'all' ? true : classifyDirective(m) === category))
    .filter((m) => {
      if (!search) return true;
      const hay = `${m.content} ${m.workspace} ${m.source} ${m.id}`.toLowerCase();
      return hay.includes(search);
    })
    .sort(sortDirectives);
}

export function formatDirectivePromptLine(memory: MemoryRecord): string {
  const tag = memory.is_pinned === 1 ? 'PINNED' : memory.type.toUpperCase();
  return `- [${tag} | ws:${memory.workspace} | conf:${memory.confidence.toFixed(2)}] ${memory.content}`;
}

/**
 * Mirrors backend `mcp_server.py::get_core_directives` (`memory://core-directives/{workspace}`).
 */
export function buildCoreDirectivesPreview(
  memories: MemoryRecord[],
  workspace: string,
  nowMs: number = Date.now()
): string {
  const cleanWs = (workspace || 'global').trim() || 'global';
  const scoped = filterAndSortDirectives(memories, cleanWs, {
    includeGlobal: true,
    nowMs,
  }).slice(0, 30);

  if (scoped.length === 0) {
    return `# Engram Core Directives (${cleanWs})\nNo pinned directives or procedural rules registered.`;
  }

  const header =
    cleanWs === 'all' || cleanWs === 'global'
      ? `# Engram Core Directives (Workspace: ${cleanWs})`
      : `# Engram Core Directives (Workspace: ${cleanWs} + global)`;

  const lines = [header, ...scoped.map(formatDirectivePromptLine)];
  return lines.join('\n');
}

/**
 * Mirrors backend `mcp_server.py::get_session_summary` (`memory://session-summary/{workspace}`).
 */
export function buildSessionSummaryPreview(
  memories: MemoryRecord[],
  workspace: string,
  nowMs: number = Date.now()
): string {
  const cleanWs = (workspace || 'global').trim() || 'global';
  const recent = memories
    .filter((m) => m.status === 'active' && !isMemoryExpired(m, nowMs))
    .filter((m) => matchesWorkspaceScope(m.workspace, cleanWs, true))
    .sort((a, b) => {
      const aTime = Date.parse(a.last_accessed_at || a.valid_from);
      const bTime = Date.parse(b.last_accessed_at || b.valid_from);
      return bTime - aTime;
    })
    .slice(0, 15);

  if (recent.length === 0) {
    return `No active memories recorded yet for workspace '${cleanWs}'.`;
  }

  const bullets = recent.map((m) => `- (${m.type}) ${m.content}`);
  return `### Active Session Briefing (${cleanWs})\n${bullets.join('\n')}`;
}

export function computeDirectiveBudget(
  coreDirectivesText: string,
  sessionSummaryText: string,
  budgetLimit: number = 1500
): {
  directives_tokens: number;
  session_tokens: number;
  total_tokens: number;
  budget_limit: number;
  utilization_pct: number;
  health: DirectiveBudgetHealth;
} {
  const directivesTokens = estimateTokens(coreDirectivesText);
  const sessionTokens = estimateTokens(sessionSummaryText);
  const totalTokens = directivesTokens + sessionTokens;
  const safeLimit = Math.max(200, budgetLimit);
  const utilizationPct = Math.min(100, Number(((totalTokens / safeLimit) * 100).toFixed(1)));

  let health: DirectiveBudgetHealth = 'healthy';
  if (totalTokens > safeLimit) {
    health = 'heavy';
  } else if (totalTokens > safeLimit * 0.72) {
    health = 'warning';
  }

  return {
    directives_tokens: directivesTokens,
    session_tokens: sessionTokens,
    total_tokens: totalTokens,
    budget_limit: safeLimit,
    utilization_pct: utilizationPct,
    health,
  };
}

export function buildDirectivesPreviewPayload(
  memories: MemoryRecord[],
  workspace: string,
  budgetLimit: number = 1500,
  nowMs: number = Date.now()
): DirectivesPreviewResponse {
  const cleanWs = (workspace || 'global').trim() || 'global';
  const directives = filterAndSortDirectives(memories, cleanWs, {
    includeGlobal: true,
    nowMs,
  });
  const coreText = buildCoreDirectivesPreview(memories, cleanWs, nowMs);
  const sessionText = buildSessionSummaryPreview(memories, cleanWs, nowMs);
  const tokenBudget = computeDirectiveBudget(coreText, sessionText, budgetLimit);

  return {
    workspace: cleanWs,
    directives_count: directives.length,
    anti_patterns_count: directives.filter((d) => classifyDirective(d) === 'anti_pattern').length,
    pinned_count: directives.filter((d) => d.is_pinned === 1).length,
    directives,
    core_directives_text: coreText,
    session_summary_text: sessionText,
    token_budget: tokenBudget,
  };
}
