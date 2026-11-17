import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeMemoryHygiene,
  buildMergedContent,
  computeLexicalSimilarity,
  filterHygieneIssues,
} from './hygiene';
import { MemoryRecord } from '../types/engram';

const NOW_MS = Date.parse('2026-11-17T08:00:00Z');

const MOCK_MEMORIES: MemoryRecord[] = [
  {
    id: 'm-rule-1',
    workspace: 'ops-agent',
    content: '[RULE] Always verify container health via GET /health before rotating upstream API keys.',
    type: 'procedural',
    status: 'active',
    source: 'user_explicit',
    confidence: 0.98,
    is_pinned: 1,
    supersedes_id: null,
    superseded_by_id: null,
    valid_from: '2026-11-10T00:00:00Z',
    valid_until: null,
    expires_at: null,
    access_count: 15,
    last_accessed_at: '2026-11-16T08:00:00Z',
  },
  {
    id: 'm-conf-2',
    workspace: 'ops-agent',
    content: 'Legacy scripts allow skipping container health GET /health before rotating upstream API keys.',
    type: 'semantic',
    status: 'active',
    source: 'auto_ingest',
    confidence: 0.72,
    is_pinned: 0,
    supersedes_id: null,
    superseded_by_id: null,
    valid_from: '2026-11-11T00:00:00Z',
    valid_until: null,
    expires_at: null,
    access_count: 2,
    last_accessed_at: '2026-11-11T00:00:00Z',
  },
  {
    id: 'm-dup-a',
    workspace: 'hermes',
    content: 'Hermes agent authenticates payment gateway using mTLS client certificates and OAuth2 Bearer JWT on port 443.',
    type: 'semantic',
    status: 'active',
    source: 'supersede_tool',
    confidence: 0.96,
    is_pinned: 1,
    supersedes_id: null,
    superseded_by_id: null,
    valid_from: '2026-11-14T00:00:00Z',
    valid_until: null,
    expires_at: null,
    access_count: 20,
    last_accessed_at: '2026-11-16T00:00:00Z',
  },
  {
    id: 'm-dup-b',
    workspace: 'hermes',
    content: 'Hermes agent authenticates payment gateway using mTLS client certificates with OAuth2 JWT tokens on port 443.',
    type: 'semantic',
    status: 'active',
    source: 'auto_ingest',
    confidence: 0.85,
    is_pinned: 0,
    supersedes_id: null,
    superseded_by_id: null,
    valid_from: '2026-11-15T00:00:00Z',
    valid_until: null,
    expires_at: null,
    access_count: 3,
    last_accessed_at: '2026-11-15T00:00:00Z',
  },
  {
    id: 'm-stale-1',
    workspace: 'global',
    content: 'Staging reverse-proxy IPv4 allowlist configured for 10.24.0.18 cluster.',
    type: 'semantic',
    status: 'active',
    source: 'manual',
    confidence: 0.78,
    is_pinned: 0,
    supersedes_id: null,
    superseded_by_id: null,
    valid_from: '2026-09-01T00:00:00Z',
    valid_until: null,
    expires_at: null,
    access_count: 1,
    last_accessed_at: '2026-09-02T00:00:00Z',
  },
  {
    id: 'm-exp-1',
    workspace: 'hermes',
    content: 'Temporary canary release window scheduled for settlement batch testing.',
    type: 'episodic',
    status: 'active',
    source: 'auto_ingest',
    confidence: 0.82,
    is_pinned: 0,
    supersedes_id: null,
    superseded_by_id: null,
    valid_from: '2026-11-16T00:00:00Z',
    valid_until: null,
    expires_at: '2026-11-17T20:00:00Z',
    access_count: 2,
    last_accessed_at: '2026-11-16T12:00:00Z',
  },
];

test('computeLexicalSimilarity returns high similarity for paraphrased memories', () => {
  const sim = computeLexicalSimilarity(MOCK_MEMORIES[2].content, MOCK_MEMORIES[3].content);
  assert.ok(sim >= 0.65, `Expected similarity >= 0.65, got ${sim}`);
});

test('analyzeMemoryHygiene detects conflicts, near-duplicates, stale, and expiring items accurately', () => {
  const report = analyzeMemoryHygiene(MOCK_MEMORIES, {
    workspace: 'all',
    dedupThreshold: 0.85,
    staleDaysThreshold: 30,
    nowMs: NOW_MS,
  });

  assert.equal(report.total_active_scanned, 6);
  assert.equal(report.counts.conflict, 1);
  assert.equal(report.counts.duplicate, 1);
  assert.equal(report.counts.stale, 1);
  assert.equal(report.counts.expiring, 1);
  assert.equal(report.counts.all, 4);
  assert.ok(report.health_score < 100 && report.health_score >= 15);
});

test('filterHygieneIssues and buildMergedContent handle workspace/kind/search filtering and consolidation', () => {
  const report = analyzeMemoryHygiene(MOCK_MEMORIES, { nowMs: NOW_MS });
  const conflictsOnly = filterHygieneIssues(report.issues, { kind: 'conflict' });
  assert.equal(conflictsOnly.length, 1);
  assert.equal(conflictsOnly[0].primary_memory.id, 'm-rule-1');

  const merged = buildMergedContent(MOCK_MEMORIES[2], MOCK_MEMORIES[3]);
  assert.ok(merged.includes('Consolidated note'));
});
