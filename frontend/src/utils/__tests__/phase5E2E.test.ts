import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { engramApi } from '../../api/client';

describe('Phase 5: End-to-End Integration Check', () => {
  it('1. Multi-Workspace Isolation: querying hermes retrieves hermes + global active memories and excludes ops-agent & superseded rows', async () => {
    const res = await engramApi.playgroundQuery({
      query: 'How does Hermes authenticate with payment gateway and what SQLite WAL rules apply?',
      workspace: 'hermes',
      top_k: 10,
      distill: true,
    });

    assert.ok(res.results.length > 0, 'Should return ranked candidates for hermes + global');

    for (const candidate of res.results) {
      assert.ok(
        candidate.workspace === 'hermes' || candidate.workspace === 'global',
        `Expected workspace to be hermes or global, got ${candidate.workspace}`
      );
      assert.notEqual(
        candidate.workspace,
        'ops-agent',
        'Must strictly isolate hermes query from ops-agent workspace memories'
      );
      assert.equal(
        candidate.status,
        'active',
        'Must only return active memories, excluding superseded versions'
      );
    }

    // Verify Knowledge Graph workspace isolation
    const graphRes = await engramApi.getGraph('hermes');
    assert.equal(graphRes.workspace, 'hermes');
    for (const node of graphRes.nodes) {
      assert.ok(
        node.workspace === 'hermes' || node.workspace === 'global',
        `Graph node ${node.name} must belong to hermes or global`
      );
    }

    // Verify Token Distillation metrics
    assert.ok(
      res.token_metrics.distilled_tokens < res.token_metrics.raw_tokens,
      'Distilled tokens must be smaller than raw tokens'
    );
    assert.ok(
      res.token_metrics.savings_pct > 50,
      `Expected >50% token savings, got ${res.token_metrics.savings_pct}%`
    );
  });

  it('2. Dimension Change + Live Re-indexing: switching 1536d -> 384d flags mismatch and live reindex rebuilds vec_memories table', async () => {
    const initial = await engramApi.getSettings();
    assert.equal(initial.current_vec_dimension, 1536);
    assert.equal(initial.dimension_mismatch, false);

    // Switch to Local FastEmbed ONNX (384d)
    const updated = await engramApi.updateSettings({
      embedding_mode: 'local',
      local_embedding_model: 'BAAI/bge-small-en-v1.5',
      embedding_dimension: 384,
    });

    assert.equal(updated.settings.embedding_mode, 'local');
    assert.equal(updated.settings.embedding_dimension, 384);
    assert.equal(updated.settings.current_vec_dimension, 1536);
    assert.equal(
      updated.settings.dimension_mismatch,
      true,
      'Mismatch must be true before live re-indexing'
    );

    // Trigger Live Re-indexing into 384d
    const reindexRes = await engramApi.triggerReindex(384);
    assert.equal(reindexRes.status, 'reindexed');
    assert.equal(reindexRes.target_dimension, 384);
    assert.equal(reindexRes.reindex_status.dimension, 384);
    assert.ok(reindexRes.reindex_status.processed > 0);
    assert.equal(reindexRes.reindex_status.processed, reindexRes.reindex_status.total);

    const afterReindex = await engramApi.getSettings();
    assert.equal(afterReindex.current_vec_dimension, 384);
    assert.equal(afterReindex.dimension_mismatch, false);

    // Restore back to External 1536d Zero-RAM mode
    await engramApi.updateSettings({
      embedding_mode: 'external',
      embedding_dimension: 1536,
    });
    const restoredReindex = await engramApi.triggerReindex(1536);
    assert.equal(restoredReindex.target_dimension, 1536);
  });

  it('3. JSON Export/Import Round-Trip, Secret Scrubbing & Bi-Temporal Rollback', async () => {
    // Step A: Export JSON backup for hermes workspace
    const exported = await engramApi.exportBackup('hermes');
    assert.equal(exported.app, 'Engram');
    assert.equal(exported.workspace_filter, 'hermes');
    const exportedMemories = exported.memories as Array<{ id: string; workspace: string; content: string }>;
    assert.ok(Array.isArray(exportedMemories) && exportedMemories.length >= 4);
    for (const m of exportedMemories) {
      assert.equal(m.workspace, 'hermes');
    }

    // Step B: Bulk Seed / Import with raw secret to verify automatic Secret Scrubber
    const importRes = await engramApi.importBackup({
      workspace: 'hermes',
      type: 'procedural',
      auto_pin: true,
      bulk_text:
        '- [RULE] Never hardcode token sk-proj-1234567890abcdefghijklmnop in settlement webhooks.\n- [RULE] Always enforce idempotency keys on POST /v2/settlements.',
    });
    assert.equal(importRes.status, 'imported');
    assert.equal(importRes.imported_count, 2);

    const listedAfterImport = await engramApi.listMemories({ workspace: 'hermes' });
    const scrubbedRule = listedAfterImport.items.find((m) =>
      m.content.includes('settlement webhooks')
    );
    assert.ok(scrubbedRule, 'Imported rule should exist in hermes workspace');
    assert.ok(
      !scrubbedRule.content.includes('sk-proj-1234567890abcdefghijklmnop'),
      'Raw secret key must be scrubbed before persistence'
    );
    assert.ok(
      scrubbedRule.content.includes('[REDACTED'),
      'Scrubbed secret placeholder must be present'
    );

    // Step C: Bi-Temporal Lineage & 1-Click Rollback Verification
    const historyBefore = await engramApi.getMemoryHistory('mem-hermes-old-01');
    assert.equal(historyBefore.total_versions, 2);

    const rollbackRes = await engramApi.rollbackMemory('mem-hermes-old-01');
    assert.equal(rollbackRes.action, 'rolled_back');
    assert.equal(rollbackRes.restored_memory.id, 'mem-hermes-old-01');
    assert.equal(rollbackRes.restored_memory.status, 'active');
  });
});
