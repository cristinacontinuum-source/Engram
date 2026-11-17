import test from 'node:test';
import assert from 'node:assert/strict';
import {
  maskSecretValue,
  generateVecTableSql,
  calculateFloat32ByteLength,
  applyRuntimeOverrides,
  verifyGuardrailsOnFile,
  computeCompositeScore,
  scrubSecretsText,
  evaluateDualAuthRequest,
  type RuntimeConfigState,
} from './phase1Logic';

test('maskSecretValue masks secrets longer than 6 chars and preserves short ones', () => {
  assert.equal(maskSecretValue('sk-mem-hermes-secret'), 'sk-...ret');
  assert.equal(maskSecretValue('short'), '***');
  assert.equal(maskSecretValue(''), '');
});

test('generateVecTableSql generates valid sqlite-vec vec0 DDL and rejects invalid dimensions', () => {
  const sql1536 = generateVecTableSql(1536);
  assert.equal(sql1536.includes('embedding float[1536] distance_metric=cosine'), true);

  const sql384 = generateVecTableSql(384);
  assert.equal(sql384.includes('embedding float[384] distance_metric=cosine'), true);

  assert.throws(() => generateVecTableSql(0), /Invalid embedding dimension/);
  assert.throws(() => generateVecTableSql(16000), /Invalid embedding dimension/);
});

test('calculateFloat32ByteLength computes exact little-endian float32 byte size', () => {
  assert.equal(calculateFloat32ByteLength(1536), 6144);
  assert.equal(calculateFloat32ByteLength(384), 1536);
  assert.equal(calculateFloat32ByteLength(-10), 0);
});

test('applyRuntimeOverrides merges SQLite settings overrides cleanly', () => {
  const initial: RuntimeConfigState = {
    db_path: '/data/memory.db',
    local_models_dir: '/data/models',
    llm_base_url: 'http://9router:20128/v1',
    llm_api_key: 'sk-initial-secret',
    fast_model: 'gemini-2.5-flash',
    embedding_mode: 'external',
    embedding_base_url: 'http://9router:20128/v1',
    embedding_api_key: 'sk-initial-secret',
    embedding_model: 'text-embedding-3-small',
    embedding_dimension: 1536,
    local_embedding_model: 'intfloat/multilingual-e5-small',
    enable_ingest_webhook: false,
  };

  const updated = applyRuntimeOverrides(initial, {
    embedding_mode: 'local',
    embedding_dimension: '384',
    enable_ingest_webhook: 'true',
    llm_base_url: 'http://localhost:11434/v1/',
  });

  assert.equal(updated.embedding_mode, 'local');
  assert.equal(updated.embedding_dimension, 384);
  assert.equal(updated.enable_ingest_webhook, true);
  assert.equal(updated.llm_base_url, 'http://localhost:11434/v1');
});

test('computeCompositeScore follows SPEC.md §2 hybrid ranking formula', () => {
  const pinnedRes = computeCompositeScore({
    sVector: 0.9,
    sGraph: 1.0,
    daysElapsed: 30,
    confidence: 0.95,
    isPinned: true,
    memoryType: 'procedural',
  });
  assert.equal(pinnedRes.recency_score, 1.0);
  assert.equal(pinnedRes.pinned_boost, 0.15);
  assert.equal(pinnedRes.final_score, 1.09);

  const unpinnedRes = computeCompositeScore({
    sVector: 0.8,
    sGraph: 0.0,
    daysElapsed: 0,
    confidence: 0.85,
    isPinned: false,
    memoryType: 'semantic',
  });
  assert.equal(unpinnedRes.pinned_boost, 0.0);
  assert.equal(unpinnedRes.final_score, 0.675);
});

test('scrubSecretsText redacts API keys, Bearer headers, and key-value secrets', () => {
  const sample =
    'Connect with sk-proj-1234567890abcdefghijklmnop and Authorization: Bearer secret-jwt-token-xyz or api_key=my_super_secret_val_99';
  const res = scrubSecretsText(sample);
  assert.equal(res.redactionCount, 3);
  assert.equal(res.scrubbed.includes('sk-proj-'), false);
  assert.equal(res.scrubbed.includes('secret-jwt-token-xyz'), false);
  assert.equal(res.scrubbed.includes('my_super_secret_val_99'), false);
  assert.equal(res.scrubbed.includes('[REDACTED_SECRET]'), true);
});

test('evaluateDualAuthRequest enforces Phase 3 Dual-Auth and Ingest Webhook boundaries', () => {
  // /health is always 200 OK even without auth
  assert.equal(
    evaluateDualAuthRequest({
      path: '/health',
      authType: 'none',
      enableIngestWebhook: false,
    }).httpStatus,
    200
  );

  // /mcp and /sse require Bearer token (Basic auth is rejected)
  assert.equal(
    evaluateDualAuthRequest({
      path: '/mcp',
      authType: 'basic_valid',
      enableIngestWebhook: true,
    }).httpStatus,
    401
  );
  assert.equal(
    evaluateDualAuthRequest({
      path: '/sse',
      authType: 'bearer_valid',
      enableIngestWebhook: false,
    }).httpStatus,
    200
  );

  // /api/v1/ingest returns 403 when disabled and 202 when enabled
  assert.equal(
    evaluateDualAuthRequest({
      path: '/api/v1/ingest',
      authType: 'bearer_valid',
      enableIngestWebhook: false,
    }).httpStatus,
    403
  );
  assert.equal(
    evaluateDualAuthRequest({
      path: '/api/v1/ingest',
      authType: 'bearer_valid',
      enableIngestWebhook: true,
    }).httpStatus,
    202
  );

  // /api/v1/stats and / require Basic Auth
  assert.equal(
    evaluateDualAuthRequest({
      path: '/api/v1/stats',
      authType: 'bearer_valid',
      enableIngestWebhook: true,
    }).httpStatus,
    401
  );
  assert.equal(
    evaluateDualAuthRequest({
      path: '/api/v1/stats',
      authType: 'basic_valid',
      enableIngestWebhook: true,
    }).httpStatus,
    200
  );
});

test('verifyGuardrailsOnFile validates Phase 1-3 requirement locks', () => {
  const reqChecks = verifyGuardrailsOnFile({
    id: 'requirements',
    phase: 1,
    path: 'backend/requirements.txt',
    category: 'Environment & Deps',
    language: 'ini',
    summaryEn: 'Backend requirements',
    summaryId: 'Dependensi backend',
    content: 'fastapi==0.115.12\nmcp>=1.2.0,<2.0.0\nsqlite-vec==0.1.6\n',
  });
  assert.equal(reqChecks.every((c) => c.passed), true);
});
