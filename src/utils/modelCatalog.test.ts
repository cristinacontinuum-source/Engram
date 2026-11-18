import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterModelOptions,
  getFallbackCatalogModels,
  inferEmbeddingDimension,
  isBrowserDirectFetchSafe,
  normalizeModelsEndpointUrl,
  parseOpenAiModelsPayload,
} from './modelCatalog';

test('normalizeModelsEndpointUrl handles OpenAI, 9Router, Ollama, and trailing slashes', () => {
  assert.equal(
    normalizeModelsEndpointUrl('http://host.docker.internal:20128/v1'),
    'http://host.docker.internal:20128/v1/models'
  );
  assert.equal(
    normalizeModelsEndpointUrl('http://host.docker.internal:20128/v1/'),
    'http://host.docker.internal:20128/v1/models'
  );
  assert.equal(
    normalizeModelsEndpointUrl('https://api.openai.com/v1/chat/completions'),
    'https://api.openai.com/v1/models'
  );
  assert.equal(
    normalizeModelsEndpointUrl('https://api.openai.com/v1/embeddings'),
    'https://api.openai.com/v1/models'
  );
  assert.equal(
    normalizeModelsEndpointUrl('http://localhost:11434'),
    'http://localhost:11434/v1/models'
  );
  assert.equal(
    normalizeModelsEndpointUrl('https://openrouter.ai/api/v1'),
    'https://openrouter.ai/api/v1/models'
  );
  assert.equal(
    normalizeModelsEndpointUrl('https://custom.example.com/v1/models'),
    'https://custom.example.com/v1/models'
  );
});

test('inferEmbeddingDimension identifies standard OpenAI, Google, and BAAI dimensions', () => {
  assert.equal(inferEmbeddingDimension('text-embedding-3-small'), 1536);
  assert.equal(inferEmbeddingDimension('text-embedding-3-large'), 3072);
  assert.equal(inferEmbeddingDimension('nomic-embed-text'), 768);
  assert.equal(inferEmbeddingDimension('bge-m3'), 1024);
  assert.equal(inferEmbeddingDimension('BAAI/bge-small-en-v1.5'), 384);
  assert.equal(inferEmbeddingDimension('gpt-4o'), undefined);
});

test('parseOpenAiModelsPayload classifies embedding vs LLM models and prioritizes matching kind', () => {
  const payload = {
    object: 'list',
    data: [
      { id: 'text-embedding-3-small', owned_by: 'openai' },
      { id: 'gpt-4o', owned_by: 'openai' },
      { id: 'models/gemini-2.5-flash', owned_by: 'google' },
      { id: 'text-embedding-3-large', owned_by: 'openai' },
    ],
  };

  const embModels = parseOpenAiModelsPayload(payload, 'embedding', 'live');
  assert.equal(embModels.length, 4);
  assert.equal(embModels[0].kind, 'embedding');
  assert.equal(embModels[1].kind, 'embedding');
  assert.equal(embModels.find((m) => m.id === 'text-embedding-3-large')?.dimension, 3072);
  assert.equal(embModels.find((m) => m.id === 'text-embedding-3-large')?.badge, '3072d');

  const llmModels = parseOpenAiModelsPayload(payload, 'llm', 'live');
  assert.equal(llmModels[0].kind, 'llm');
  assert.equal(llmModels[1].kind, 'llm');
  assert.ok(llmModels.some((m) => m.id === 'gemini-2.5-flash'));
});

test('filterModelOptions ranks exact and prefix matches above substring matches', () => {
  const llmCatalog = getFallbackCatalogModels('llm');
  const filtered = filterModelOptions(llmCatalog, 'gpt', 'llm');
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every((m) => m.id.startsWith('gpt')));

  const exactFirst = filterModelOptions(llmCatalog, 'gpt-4o', 'llm');
  assert.equal(exactFirst[0].id, 'gpt-4o');

  const embCatalog = getFallbackCatalogModels('embedding');
  const dimMatch = filterModelOptions(embCatalog, '3072d', 'embedding');
  assert.equal(dimMatch.length, 2);
  assert.ok(dimMatch.some((m) => m.id === 'text-embedding-3-large'));
});

test('isBrowserDirectFetchSafe blocks Docker/local hostnames to prevent browser DNS console errors', () => {
  assert.equal(isBrowserDirectFetchSafe('http://host.docker.internal:20128/v1'), false);
  assert.equal(isBrowserDirectFetchSafe('http://9router:20128/v1'), false);
  assert.equal(isBrowserDirectFetchSafe('http://localhost:11434/v1'), false);
  assert.equal(isBrowserDirectFetchSafe('https://openrouter.ai/api/v1'), true);
});
