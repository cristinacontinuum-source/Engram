import {
  AnalyticsSummaryResponse,
  AnalyticsTelemetryRun,
  MemoryRecord,
  ModelPricingProfile,
  ModelPricingProfileId,
  SessionProjection,
  TelemetryLogItem,
  WorkspaceTokenBreakdown,
} from '../types/engram';
import { estimateTokens } from './directives';

export const MODEL_PRICING_PROFILES: ModelPricingProfile[] = [
  {
    id: 'claude_sonnet_4',
    label: 'Claude Sonnet 4',
    provider: 'Anthropic',
    inputPricePer1M: 3.0,
    badge: '$3.00/1M',
  },
  {
    id: 'gpt_4o',
    label: 'GPT-4o',
    provider: 'OpenAI',
    inputPricePer1M: 2.5,
    badge: '$2.50/1M',
  },
  {
    id: 'gemini_2_5_pro',
    label: 'Gemini 2.5 Pro',
    provider: 'Google',
    inputPricePer1M: 1.25,
    badge: '$1.25/1M',
  },
  {
    id: 'deepseek_v3',
    label: 'DeepSeek V3',
    provider: 'DeepSeek',
    inputPricePer1M: 0.27,
    badge: '$0.27/1M',
  },
  {
    id: 'gemini_2_5_flash',
    label: 'Gemini 2.5 Flash',
    provider: 'Google',
    inputPricePer1M: 0.15,
    badge: '$0.15/1M',
  },
];

export function getModelPricingProfile(
  modelId: ModelPricingProfileId = 'claude_sonnet_4'
): ModelPricingProfile {
  return (
    MODEL_PRICING_PROFILES.find((m) => m.id === modelId) ||
    MODEL_PRICING_PROFILES[0]
  );
}

export function estimateTokenCostUsd(tokens: number, inputPricePer1M: number): number {
  if (tokens <= 0 || inputPricePer1M <= 0) return 0;
  return Number(((tokens / 1_000_000) * inputPricePer1M).toFixed(6));
}

export function computeSessionTurnProjection(params: {
  turns: number;
  historyGrowthPerTurn?: number;
  baselineDirectiveTokens: number;
  recallDistilledTokens: number;
  inputPricePer1M: number;
}): SessionProjection {
  const turns = Math.max(1, Math.min(100, Math.round(params.turns)));
  const historyGrowthPerTurn = Math.max(350, params.historyGrowthPerTurn ?? 920);
  const baseSystemOverhead = 1400;
  const userTurnTokens = 160;

  // Without Engram: every turn replays growing chat transcript + bulky unpruned docs
  let withoutTokens = 0;
  for (let t = 1; t <= turns; t += 1) {
    withoutTokens += baseSystemOverhead + t * historyGrowthPerTurn + userTurnTokens;
  }

  // With Engram: short session stays lean (core directives + compact distilled recall per turn + small sliding window)
  const effectiveBaseline = Math.max(120, params.baselineDirectiveTokens || 240);
  const recallInjection = Math.max(140, params.recallDistilledTokens || 230);
  const compactRecentTurns = 480;
  const withTokens = turns * (effectiveBaseline + recallInjection + compactRecentTurns + userTurnTokens);

  const savedTokens = Math.max(0, withoutTokens - withTokens);
  const withoutCost = estimateTokenCostUsd(withoutTokens, params.inputPricePer1M);
  const withCost = estimateTokenCostUsd(withTokens, params.inputPricePer1M);
  const savedUsd = Number(Math.max(0, withoutCost - withCost).toFixed(6));
  const savingsPct =
    withoutTokens > 0
      ? Number(((savedTokens / withoutTokens) * 100).toFixed(1))
      : 0;

  return {
    turn_count: turns,
    without_engram_tokens: withoutTokens,
    with_engram_tokens: withTokens,
    without_engram_cost_usd: withoutCost,
    with_engram_cost_usd: withCost,
    saved_tokens: savedTokens,
    saved_usd: savedUsd,
    savings_pct: savingsPct,
  };
}

export function buildTokenAnalytics(params: {
  telemetry: TelemetryLogItem[];
  memories: MemoryRecord[];
  workspace?: string;
  modelId?: ModelPricingProfileId;
  sessionTurns?: number;
}): AnalyticsSummaryResponse {
  const cleanWs = (params.workspace || 'all').trim() || 'all';
  const profile = getModelPricingProfile(params.modelId);

  const scopedMemories = (params.memories || []).filter(
    (m) =>
      m.status === 'active' &&
      (cleanWs === 'all' || m.workspace === cleanWs || m.workspace === 'global')
  );

  const pinnedOrProcedural = scopedMemories.filter(
    (m) => m.is_pinned === 1 || m.type === 'procedural'
  );
  const directiveBaselineTokens = pinnedOrProcedural.reduce(
    (sum, item) => sum + estimateTokens(item.content),
    0
  );

  const scopedTelemetry = (params.telemetry || []).filter(
    (t) => cleanWs === 'all' || t.workspace === cleanWs
  );

  let rawTotal = 0;
  let distilledTotal = 0;
  let latencySum = 0;

  const wsMap = new Map<
    string,
    { queries: number; raw: number; distilled: number; latencySum: number }
  >();

  const enrichedRuns: AnalyticsTelemetryRun[] = [];

  for (const row of scopedTelemetry) {
    const raw = Math.max(0, Number(row.raw_tokens) || 0);
    const distilled = Math.max(0, Number(row.distilled_tokens) || 0);
    const latency = Math.max(0, Number(row.latency_ms) || 0);
    const saved = Math.max(0, raw - distilled);
    const savingsPct = raw > 0 ? Number(((saved / raw) * 100).toFixed(1)) : 0;
    const rawCost = estimateTokenCostUsd(raw, profile.inputPricePer1M);
    const distilledCost = estimateTokenCostUsd(distilled, profile.inputPricePer1M);
    const usdSaved = Number(Math.max(0, rawCost - distilledCost).toFixed(6));

    rawTotal += raw;
    distilledTotal += distilled;
    latencySum += latency;

    const wsKey = row.workspace || 'global';
    const existing = wsMap.get(wsKey) || { queries: 0, raw: 0, distilled: 0, latencySum: 0 };
    existing.queries += 1;
    existing.raw += raw;
    existing.distilled += distilled;
    existing.latencySum += latency;
    wsMap.set(wsKey, existing);

    enrichedRuns.push({
      ...row,
      tokens_saved: saved,
      savings_pct: savingsPct,
      raw_cost_usd: rawCost,
      distilled_cost_usd: distilledCost,
      usd_saved: usdSaved,
    });
  }

  enrichedRuns.sort((a, b) => {
    const tDiff = (b.created_at || '').localeCompare(a.created_at || '');
    return tDiff !== 0 ? tDiff : b.id - a.id;
  });

  const savedTotal = Math.max(0, rawTotal - distilledTotal);
  const overallSavingsPct =
    rawTotal > 0 ? Number(((savedTotal / rawTotal) * 100).toFixed(1)) : 0;
  const rawCostTotal = estimateTokenCostUsd(rawTotal, profile.inputPricePer1M);
  const distilledCostTotal = estimateTokenCostUsd(distilledTotal, profile.inputPricePer1M);
  const avgDistilledPerRun =
    scopedTelemetry.length > 0 ? Math.round(distilledTotal / scopedTelemetry.length) : 230;

  const workspaceBreakdown: WorkspaceTokenBreakdown[] = Array.from(wsMap.entries())
    .map(([ws, agg]) => {
      const wsSaved = Math.max(0, agg.raw - agg.distilled);
      return {
        workspace: ws,
        queries: agg.queries,
        raw_tokens: agg.raw,
        distilled_tokens: agg.distilled,
        tokens_saved: wsSaved,
        savings_pct: agg.raw > 0 ? Number(((wsSaved / agg.raw) * 100).toFixed(1)) : 0,
        estimated_usd_saved: estimateTokenCostUsd(wsSaved, profile.inputPricePer1M),
        avg_latency_ms: agg.queries > 0 ? Number((agg.latencySum / agg.queries).toFixed(1)) : 0,
      };
    })
    .sort((a, b) => b.tokens_saved - a.tokens_saved);

  const projection = computeSessionTurnProjection({
    turns: params.sessionTurns ?? 20,
    baselineDirectiveTokens: directiveBaselineTokens,
    recallDistilledTokens: avgDistilledPerRun,
    inputPricePer1M: profile.inputPricePer1M,
  });

  return {
    generated_at: new Date().toISOString(),
    workspace: cleanWs,
    model_id: profile.id,
    model_label: profile.label,
    input_price_per_1m: profile.inputPricePer1M,
    currency: 'USD',
    totals: {
      total_queries: scopedTelemetry.length,
      raw_tokens_total: rawTotal,
      distilled_tokens_total: distilledTotal,
      tokens_saved_total: savedTotal,
      compression_savings_pct: overallSavingsPct,
      raw_cost_usd: rawCostTotal,
      distilled_cost_usd: distilledCostTotal,
      estimated_usd_saved: Number(Math.max(0, rawCostTotal - distilledCostTotal).toFixed(6)),
      avg_latency_ms:
        scopedTelemetry.length > 0 ? Number((latencySum / scopedTelemetry.length).toFixed(1)) : 0,
      directive_baseline_tokens: directiveBaselineTokens,
      active_memories_count: scopedMemories.length,
    },
    workspace_breakdown: workspaceBreakdown,
    recent_runs: enrichedRuns,
    session_projection: projection,
  };
}

export function filterAnalyticsRuns(
  runs: AnalyticsTelemetryRun[],
  options: { workspace?: string; search?: string }
): AnalyticsTelemetryRun[] {
  const ws = (options.workspace || 'all').trim();
  const q = (options.search || '').trim().toLowerCase();

  return runs.filter((run) => {
    if (ws !== 'all' && run.workspace !== ws) return false;
    if (q) {
      const hay = `${run.id} ${run.workspace} ${run.query}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function buildAnalyticsCsv(
  runs: AnalyticsTelemetryRun[],
  modelLabel: string
): string {
  const header = [
    'run_id',
    'created_at',
    'workspace',
    'model',
    'raw_tokens',
    'distilled_tokens',
    'tokens_saved',
    'savings_pct',
    'usd_saved',
    'latency_ms',
    'query',
  ].join(',');

  const lines = runs.map((r) => {
    const safeQuery = `"${(r.query || '').replace(/"/g, '""')}"`;
    return [
      r.id,
      r.created_at,
      r.workspace,
      `"${modelLabel}"`,
      r.raw_tokens,
      r.distilled_tokens,
      r.tokens_saved,
      r.savings_pct,
      r.usd_saved,
      r.latency_ms,
      safeQuery,
    ].join(',');
  });

  return [header, ...lines].join('\n');
}
