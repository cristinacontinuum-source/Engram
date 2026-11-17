import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeActivitySummary,
  extractMemoriesFromTranscriptText,
  filterWorkerJobs,
} from './activity';
import { WorkerJobRecord } from '../types/engram';

const SAMPLE_JOBS: WorkerJobRecord[] = [
  {
    job_id: 'job_a1',
    job_type: 'store_memory',
    workspace: 'hermes',
    status: 'completed',
    summary: 'Stored mTLS gateway rule with 1-hop entity extraction',
    detail: 'Extracted 2 entities and stored 1536d vector.',
    items_processed: 1,
    secrets_redacted: 0,
    latency_ms: 42.4,
    created_at: '2026-11-16T08:00:00Z',
    completed_at: '2026-11-16T08:00:01Z',
  },
  {
    job_id: 'job_b2',
    job_type: 'ingest_messages',
    workspace: 'ops-agent',
    status: 'completed',
    summary: 'Webhook extracted 2 memories from 4 chat turns',
    detail: 'Redacted 1 Bearer credential prior to embedding.',
    items_processed: 2,
    secrets_redacted: 1,
    latency_ms: 118.6,
    created_at: '2026-11-16T09:30:00Z',
    completed_at: '2026-11-16T09:30:02Z',
  },
  {
    job_id: 'job_c3',
    job_type: 'ttl_cleanup',
    workspace: 'global',
    status: 'completed',
    summary: 'TTL expiration sweep removed 0 stale rows',
    detail: 'Scanned expires_at <= now across sqlite-vec WAL.',
    items_processed: 0,
    secrets_redacted: 0,
    latency_ms: 6.2,
    created_at: '2026-11-16T10:00:00Z',
    completed_at: '2026-11-16T10:00:00Z',
  },
];

test('filterWorkerJobs filters by workspace, jobType, and search sorted newest-first', () => {
  const hermesAll = filterWorkerJobs(SAMPLE_JOBS, { workspace: 'hermes' });
  // Includes hermes + global
  assert.deepEqual(
    hermesAll.map((j) => j.job_id),
    ['job_c3', 'job_a1']
  );

  const ingestOnly = filterWorkerJobs(SAMPLE_JOBS, { jobType: 'ingest_messages' });
  assert.deepEqual(
    ingestOnly.map((j) => j.job_id),
    ['job_b2']
  );

  const byText = filterWorkerJobs(SAMPLE_JOBS, { search: 'mTLS' });
  assert.equal(byText.length, 1);
  assert.equal(byText[0].job_id, 'job_a1');
});

test('computeActivitySummary calculates success rate, avg latency, redacted count, and breakdown', () => {
  const summary = computeActivitySummary(SAMPLE_JOBS);
  assert.equal(summary.totalJobs, 3);
  assert.equal(summary.completedJobs, 3);
  assert.equal(summary.failedJobs, 0);
  assert.equal(summary.successRatePct, 100);
  assert.equal(summary.totalSecretsRedacted, 1);
  assert.equal(summary.countsByType.store_memory, 1);
  assert.equal(summary.countsByType.ingest_messages, 1);
  assert.equal(summary.countsByType.ttl_cleanup, 1);
  assert.ok(summary.avgLatencyMs > 50 && summary.avgLatencyMs < 60);
});

test('extractMemoriesFromTranscriptText scrubs secrets and classifies procedural rules', () => {
  const transcript = [
    'USER: Always validate GET /health before rotating sk-1234567890abcdef123456 upstream keys.',
    'ASSISTANT: Noted, production gateway uses mTLS client certs on port 443.',
    'USER: hi',
  ].join('\n');

  const extracted = extractMemoriesFromTranscriptText(transcript);
  assert.equal(extracted.length, 2);
  assert.equal(extracted[0].type, 'procedural');
  assert.equal(extracted[0].is_pinned, true);
  assert.equal(extracted[0].secrets_redacted, 1);
  assert.equal(extracted[0].content.includes('sk-1234567890'), false);
  assert.equal(extracted[1].type, 'semantic');
});
