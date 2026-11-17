import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRecord, TelemetryLogItem } from '../types/engram';
import {
  buildAnalyticsCsv,
  buildTokenAnalytics,
  computeSessionTurnProjection,
  estimateTokenCostUsd,
  filterAnalyticsRuns,
} from './analytics';

const SAMPLE_MEMORIES: MemoryRecord[] = [
  {
    id: 'mem-1',
    workspace: 'hermes',
    content: '[RULE] Always require mTLS client certs for production payment gateway calls.',
    type: 'procedural',
    status: 'active',
    source: 'user_explicit',
    confidence: 0.96,
    is_pinned: 1,
    supersedes_id: null,
    superseded_by_id: null,
    valid_from: '2026-11-10T00:00:00Z',
    valid_until: null,
    expires_at: null,
    access_count: 10,
    last_accessed_at: '2026-11-15T00:00:00Z',
  },
  {
    id: 'mem-2',
    workspace: 'global',
    content: 'Engram stores vectors in sqlite-vec WAL mode with zero idle RAM on external embeddings.',
    type: 'semantic',
    status: 'active',
    source: 'auto_ingest',
    confidence: 0.92,
    is_pinned: 0,
    supersedes_id: null,
    superseded_by_id: null,
    valid_from: '2026-11-11T00:00:00Z',
    valid_until: null,
    expires_at: null,
    access_count: 6,
    last_accessed_at: '2026-11-15T00:00:00Z',
  },
];

const SAMPLE_TELEMETRY: TelemetryLogItem[] = [
  {
    id: 1,
    workspace: 'hermes',
    query: 'Payment gateway mTLS rule',
    raw_tokens: 2000,
    distilled_tokens: 250,
    latency_ms: 14.0,
    created_at: '2026-11-16T04:10:00Z',
  },
  {
    id: 2,
    workspace: 'global',
    query: 'SQLite WAL vector mode',
    raw_tokens: 1500,
    distilled_tokens: 200,
    latency_ms: 12.0,
    created_at: '2026-11-16T04:20:00Z',
  },
  {
    id: 3,
    workspace: 'ops-agent',
    query: 'API key rotation health check',
    raw_tokens: 1000,
    distilled_tokens: 150,
    latency_ms: 10.0,
    created_at: '2026-11-16T04:30:00Z',
  },
];

test('estimateTokenCostUsd calculates exact USD cost per 1M input tokens', () => {
  assert.equal(estimateTokenCostUsd(1_000_000, 3.0), 3.0);
  assert.equal(estimateTokenCostUsd(500_000, 2.5), 1.25);
  assert.equal(estimateTokenCostUsd(0, 3.0), 0);
});

test('computeSessionTurnProjection demonstrates growing savings across longer sessions', () => {
  const shortProj = computeSessionTurnProjection({
    turns: 10,
    baselineDirectiveTokens: 200,
    recallDistilledTokens: 220,
    inputPricePer1M: 3.0,
  });
  const longProj = computeSessionTurnProjection({
    turns: 30,
    baselineDirectiveTokens: 200,
    recallDistilledTokens: 220,
    inputPricePer1M: 3.0,
  });

  assert.ok(shortProj.with_engram_tokens < shortProj.without_engram_tokens);
  assert.ok(longProj.savings_pct > shortProj.savings_pct);
  assert.ok(longProj.saved_usd > shortProj.saved_usd);
});

test('buildTokenAnalytics aggregates totals, workspace breakdown, and sorted runs accurately', () => {
  const summary = buildTokenAnalytics({
    telemetry: SAMPLE_TELEMETRY,
    memories: SAMPLE_MEMORIES,
    workspace: 'all',
    modelId: 'claude_sonnet_4',
    sessionTurns: 20,
  });

  assert.equal(summary.totals.total_queries, 3);
  assert.equal(summary.totals.raw_tokens_total, 4500);
  assert.equal(summary.totals.distilled_tokens_total, 600);
  assert.equal(summary.totals.tokens_saved_total, 3900);
  assert.equal(summary.totals.compression_savings_pct, 86.7);
  assert.equal(summary.workspace_breakdown.length, 3);
  assert.equal(summary.workspace_breakdown[0].workspace, 'hermes');
  assert.equal(summary.recent_runs[0].id, 3);
});

test('filterAnalyticsRuns and buildAnalyticsCsv filter and escape CSV payloads safely', () => {
  const summary = buildTokenAnalytics({
    telemetry: SAMPLE_TELEMETRY,
    memories: SAMPLE_MEMORIES,
    workspace: 'all',
    modelId: 'gpt_4o',
  });

  const filtered = filterAnalyticsRuns(summary.recent_runs, {
    workspace: 'hermes',
    search: 'mtls',
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 1);

  const csv = buildAnalyticsCsv(filtered, summary.model_label);
  assert.ok(csv.includes('run_id,created_at,workspace,model'));
  assert.ok(csv.includes('"GPT-4o"'));
  assert.ok(csv.includes('1750'));
});
