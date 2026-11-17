import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCoreDirectivesPreview,
  buildDirectivesPreviewPayload,
  buildSessionSummaryPreview,
  classifyDirective,
  computeDirectiveBudget,
  estimateTokens,
  filterAndSortDirectives,
} from './directives';
import { MemoryRecord } from '../types/engram';

const SAMPLE_MEMORIES: MemoryRecord[] = [
  {
    id: 'mem-pin-global',
    workspace: 'global',
    content: '[RULE] Always mask API keys and bearer tokens before persistence.',
    type: 'procedural',
    status: 'active',
    source: 'user_explicit',
    confidence: 0.99,
    is_pinned: 1,
    supersedes_id: null,
    superseded_by_id: null,
    valid_from: '2026-03-01T10:00:00Z',
    valid_until: null,
    expires_at: null,
    access_count: 20,
    last_accessed_at: '2026-03-10T10:00:00Z',
  },
  {
    id: 'mem-anti-hermes',
    workspace: 'hermes',
    content: '[ANTI-PATTERN] Never disable mTLS validation on sandbox payment webhooks.',
    type: 'procedural',
    status: 'active',
    source: 'tool_error',
    confidence: 0.95,
    is_pinned: 1,
    supersedes_id: null,
    superseded_by_id: null,
    valid_from: '2026-03-05T12:00:00Z',
    valid_until: null,
    expires_at: null,
    access_count: 8,
    last_accessed_at: '2026-03-11T09:00:00Z',
  },
  {
    id: 'mem-proc-hermes',
    workspace: 'hermes',
    content: 'Use sqlite-vec cosine similarity threshold >= 0.85 during deduplication.',
    type: 'procedural',
    status: 'active',
    source: 'agent_inferred',
    confidence: 0.88,
    is_pinned: 0,
    supersedes_id: null,
    superseded_by_id: null,
    valid_from: '2026-03-06T08:00:00Z',
    valid_until: null,
    expires_at: null,
    access_count: 3,
    last_accessed_at: '2026-03-09T08:00:00Z',
  },
  {
    id: 'mem-sem-ops',
    workspace: 'ops-agent',
    content: 'Ops agent deploys to staging namespace every Tuesday at 14:00 UTC.',
    type: 'semantic',
    status: 'active',
    source: 'user_explicit',
    confidence: 0.92,
    is_pinned: 1,
    supersedes_id: null,
    superseded_by_id: null,
    valid_from: '2026-03-07T14:00:00Z',
    valid_until: null,
    expires_at: null,
    access_count: 5,
    last_accessed_at: '2026-03-11T12:00:00Z',
  },
  {
    id: 'mem-superseded',
    workspace: 'hermes',
    content: '[RULE] Legacy XML settlement rule (superseded).',
    type: 'procedural',
    status: 'superseded',
    source: 'user_explicit',
    confidence: 0.7,
    is_pinned: 1,
    supersedes_id: null,
    superseded_by_id: 'mem-anti-hermes',
    valid_from: '2026-02-01T10:00:00Z',
    valid_until: '2026-03-05T12:00:00Z',
    expires_at: null,
    access_count: 2,
    last_accessed_at: '2026-02-10T10:00:00Z',
  },
];

test('estimateTokens returns 0 for empty whitespace and positive for text', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('   '), 0);
  assert.ok(estimateTokens('Always validate webhook signatures before settlement.') >= 4);
});

test('classifyDirective distinguishes anti-patterns, pinned rules, and unpinned procedural directives', () => {
  assert.equal(classifyDirective(SAMPLE_MEMORIES[1]), 'anti_pattern');
  assert.equal(classifyDirective(SAMPLE_MEMORIES[0]), 'pinned_rule');
  assert.equal(classifyDirective(SAMPLE_MEMORIES[2]), 'procedural');
  assert.equal(classifyDirective(SAMPLE_MEMORIES[3]), 'pinned_rule');
});

test('filterAndSortDirectives scopes workspace + global and excludes superseded rows', () => {
  const hermesDirectives = filterAndSortDirectives(SAMPLE_MEMORIES, 'hermes');
  const ids = hermesDirectives.map((m) => m.id);
  assert.deepEqual(ids, ['mem-pin-global', 'mem-anti-hermes', 'mem-proc-hermes']);
  assert.equal(ids.includes('mem-superseded'), false);
  assert.equal(ids.includes('mem-sem-ops'), false);
});

test('buildCoreDirectivesPreview formats MCP memory://core-directives/{workspace} accurately', () => {
  const preview = buildCoreDirectivesPreview(SAMPLE_MEMORIES, 'hermes');
  assert.match(preview, /^# Engram Core Directives \(Workspace: hermes \+ global\)/);
  assert.match(preview, /- \[PINNED \| ws:global \| conf:0\.99\]/);
  assert.match(preview, /- \[PROCEDURAL \| ws:hermes \| conf:0\.88\]/);
});

test('buildSessionSummaryPreview and computeDirectiveBudget calculate token utilization & health', () => {
  const payload = buildDirectivesPreviewPayload(SAMPLE_MEMORIES, 'hermes', 1200);
  assert.equal(payload.directives_count, 3);
  assert.equal(payload.anti_patterns_count, 1);
  assert.equal(payload.pinned_count, 2);
  assert.ok(payload.token_budget.directives_tokens > 0);
  assert.ok(payload.token_budget.session_tokens > 0);
  assert.equal(
    payload.token_budget.total_tokens,
    payload.token_budget.directives_tokens + payload.token_budget.session_tokens
  );
  assert.equal(payload.token_budget.health, 'healthy');

  const heavyBudget = computeDirectiveBudget('word '.repeat(2500), 'word '.repeat(500), 1200);
  assert.equal(heavyBudget.health, 'heavy');
  assert.equal(buildSessionSummaryPreview([], 'empty-ws'), "No active memories recorded yet for workspace 'empty-ws'.");
});
