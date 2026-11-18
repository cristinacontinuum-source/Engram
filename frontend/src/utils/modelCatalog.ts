import { DiscoveredModelOption, ModelCatalogKind } from '../types/engram';

const KNOWN_EMBEDDING_DIMENSIONS: Array<{ pattern: RegExp; dimension: number }> = [
  { pattern: /text-embedding-3-large/i, dimension: 3072 },
  { pattern: /text-embedding-3-small/i, dimension: 1536 },
  { pattern: /text-embedding-ada-002/i, dimension: 1536 },
  { pattern: /gemini-embedding-001|embedding-001/i, dimension: 3072 },
  { pattern: /text-embedding-004/i, dimension: 768 },
  { pattern: /nomic-embed-text/i, dimension: 768 },
  { pattern: /mxbai-embed-large/i, dimension: 1024 },
  { pattern: /snowflake-arctic-embed/i, dimension: 1024 },
  { pattern: /bge-m3/i, dimension: 1024 },
  { pattern: /bge-large/i, dimension: 1024 },
  { pattern: /bge-base/i, dimension: 768 },
  { pattern: /bge-small/i, dimension: 384 },
  { pattern: /all-minilm/i, dimension: 384 },
  { pattern: /e5-large/i, dimension: 1024 },
  { pattern: /e5-base/i, dimension: 768 },
  { pattern: /e5-small/i, dimension: 384 },
  { pattern: /voyage-3-large/i, dimension: 1024 },
  { pattern: /voyage-3-lite/i, dimension: 512 },
  { pattern: /voyage-3/i, dimension: 1024 },
  { pattern: /embed-english-v3|embed-multilingual-v3/i, dimension: 1024 },
];

export const FALLBACK_LLM_MODELS: DiscoveredModelOption[] = [
  {
    id: 'gemini-2.5-flash',
    label: 'gemini-2.5-flash',
    owned_by: 'google / 9router',
    kind: 'llm',
    badge: 'fast',
    source: 'catalog',
  },
  {
    id: 'gemini-2.5-pro',
    label: 'gemini-2.5-pro',
    owned_by: 'google / 9router',
    kind: 'llm',
    badge: 'reasoning',
    source: 'catalog',
  },
  {
    id: 'gpt-4o-mini',
    label: 'gpt-4o-mini',
    owned_by: 'openai / 9router',
    kind: 'llm',
    badge: 'fast',
    source: 'catalog',
  },
  {
    id: 'gpt-4o',
    label: 'gpt-4o',
    owned_by: 'openai / 9router',
    kind: 'llm',
    badge: 'flagship',
    source: 'catalog',
  },
  {
    id: 'claude-sonnet-4-20250514',
    label: 'claude-sonnet-4-20250514',
    owned_by: 'anthropic / 9router',
    kind: 'llm',
    badge: 'balanced',
    source: 'catalog',
  },
  {
    id: 'claude-3-5-haiku-latest',
    label: 'claude-3-5-haiku-latest',
    owned_by: 'anthropic / 9router',
    kind: 'llm',
    badge: 'fast',
    source: 'catalog',
  },
  {
    id: 'deepseek-chat',
    label: 'deepseek-chat',
    owned_by: 'deepseek',
    kind: 'llm',
    badge: 'v3',
    source: 'catalog',
  },
  {
    id: 'qwen-2.5-72b-instruct',
    label: 'qwen-2.5-72b-instruct',
    owned_by: 'qwen / openrouter',
    kind: 'llm',
    badge: '72b',
    source: 'catalog',
  },
];

export const FALLBACK_EMBEDDING_MODELS: DiscoveredModelOption[] = [
  {
    id: 'text-embedding-3-small',
    label: 'text-embedding-3-small',
    owned_by: 'openai / 9router',
    kind: 'embedding',
    dimension: 1536,
    badge: '1536d',
    source: 'catalog',
  },
  {
    id: 'text-embedding-3-large',
    label: 'text-embedding-3-large',
    owned_by: 'openai / 9router',
    kind: 'embedding',
    dimension: 3072,
    badge: '3072d',
    source: 'catalog',
  },
  {
    id: 'text-embedding-ada-002',
    label: 'text-embedding-ada-002',
    owned_by: 'openai',
    kind: 'embedding',
    dimension: 1536,
    badge: '1536d',
    source: 'catalog',
  },
  {
    id: 'gemini-embedding-001',
    label: 'gemini-embedding-001',
    owned_by: 'google',
    kind: 'embedding',
    dimension: 3072,
    badge: '3072d',
    source: 'catalog',
  },
  {
    id: 'text-embedding-004',
    label: 'text-embedding-004',
    owned_by: 'google',
    kind: 'embedding',
    dimension: 768,
    badge: '768d',
    source: 'catalog',
  },
  {
    id: 'nomic-embed-text',
    label: 'nomic-embed-text',
    owned_by: 'ollama / nomic',
    kind: 'embedding',
    dimension: 768,
    badge: '768d',
    source: 'catalog',
  },
  {
    id: 'bge-m3',
    label: 'bge-m3',
    owned_by: 'baai / ollama',
    kind: 'embedding',
    dimension: 1024,
    badge: '1024d',
    source: 'catalog',
  },
  {
    id: 'BAAI/bge-small-en-v1.5',
    label: 'BAAI/bge-small-en-v1.5',
    owned_by: 'baai / fastembed',
    kind: 'embedding',
    dimension: 384,
    badge: '384d',
    source: 'catalog',
  },
];

export function normalizeModelsEndpointUrl(baseUrl: string): string {
  const raw = (baseUrl || '').trim();
  if (!raw) return '';

  let cleaned = raw.replace(/\/+$/, '');
  cleaned = cleaned.replace(/\/(chat\/completions|completions|embeddings|responses)$/i, '');
  if (cleaned.endsWith('/models')) {
    return cleaned;
  }
  if (/\/v\d+(beta\d*)?$/i.test(cleaned) || cleaned.endsWith('/api/v1')) {
    return `${cleaned}/models`;
  }
  return `${cleaned}/v1/models`;
}

export function inferEmbeddingDimension(modelId: string): number | undefined {
  const clean = (modelId || '').trim();
  if (!clean) return undefined;
  for (const rule of KNOWN_EMBEDDING_DIMENSIONS) {
    if (rule.pattern.test(clean)) {
      return rule.dimension;
    }
  }
  return undefined;
}

export function isEmbeddingModelId(modelId: string): boolean {
  const clean = (modelId || '').toLowerCase();
  if (!clean) return false;
  return (
    clean.includes('embed') ||
    clean.includes('bge-') ||
    clean.includes('minilm') ||
    clean.includes('e5-') ||
    clean.includes('voyage') ||
    clean.includes('jina-embeddings') ||
    clean.includes('nomic') ||
    clean.includes('arctic-embed')
  );
}

export function parseOpenAiModelsPayload(
  payload: unknown,
  kind: ModelCatalogKind,
  source: 'live' | 'catalog' = 'live'
): DiscoveredModelOption[] {
  let rawItems: Array<Record<string, unknown>> = [];

  if (Array.isArray(payload)) {
    rawItems = payload
      .map((item) => (typeof item === 'string' ? { id: item } : item))
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
  } else if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.data)) {
      rawItems = obj.data.filter(
        (item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')
      );
    } else if (Array.isArray(obj.models)) {
      rawItems = obj.models
        .map((item) => (typeof item === 'string' ? { id: item } : item))
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
    }
  }

  const dedup = new Map<string, DiscoveredModelOption>();
  for (const item of rawItems) {
    const rawId = String(item.id || item.name || item.model || '').trim();
    if (!rawId) continue;

    const cleanId = rawId.replace(/^models\//i, '');
    const isEmb = isEmbeddingModelId(cleanId);
    const inferredDim = inferEmbeddingDimension(cleanId);
    const ownedByRaw = item.owned_by ?? item.provider ?? item.details;
    const ownedBy =
      typeof ownedByRaw === 'string' && ownedByRaw.trim() ? ownedByRaw.trim() : undefined;

    dedup.set(cleanId, {
      id: cleanId,
      label: cleanId,
      owned_by: ownedBy,
      kind: isEmb ? 'embedding' : 'llm',
      dimension: inferredDim,
      badge: inferredDim ? `${inferredDim}d` : isEmb ? 'embed' : undefined,
      source,
    });
  }

  const all = Array.from(dedup.values());
  const matching = all.filter((m) => m.kind === kind);
  const nonMatching = all.filter((m) => m.kind !== kind);

  // If the endpoint returned models matching the requested kind, prioritize them;
  // include remaining models after only if matching list is small or empty.
  const ordered =
    matching.length > 0
      ? [...matching.sort((a, b) => a.id.localeCompare(b.id)), ...nonMatching.sort((a, b) => a.id.localeCompare(b.id))]
      : all.sort((a, b) => a.id.localeCompare(b.id));

  return ordered;
}

export function filterModelOptions(
  options: DiscoveredModelOption[],
  query: string,
  preferredKind?: ModelCatalogKind
): DiscoveredModelOption[] {
  const q = (query || '').trim().toLowerCase();
  const baseList = preferredKind
    ? [
        ...options.filter((o) => o.kind === preferredKind),
        ...options.filter((o) => o.kind !== preferredKind),
      ]
    : [...options];

  if (!q) {
    return baseList;
  }

  const scored = baseList
    .map((opt) => {
      const idLower = opt.id.toLowerCase();
      const ownerLower = (opt.owned_by || '').toLowerCase();
      const badgeLower = (opt.badge || '').toLowerCase();

      let score = -1;
      if (idLower === q) score = 100;
      else if (idLower.startsWith(q)) score = 80;
      else if (idLower.includes(q)) score = 60;
      else if (ownerLower.includes(q) || badgeLower.includes(q)) score = 40;

      if (score > 0 && preferredKind && opt.kind === preferredKind) {
        score += 10;
      }
      return { opt, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.opt.id.localeCompare(b.opt.id));

  return scored.map((entry) => entry.opt);
}

export function isBrowserDirectFetchSafe(baseUrl: string): boolean {
  const raw = (baseUrl || '').trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    // Skip internal Docker/container hostnames that browsers cannot resolve directly
    if (
      host === 'host.docker.internal' ||
      host === '9router' ||
      host === 'ollama' ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      !host.includes('.')
    ) {
      return false;
    }
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getFallbackCatalogModels(kind: ModelCatalogKind): DiscoveredModelOption[] {
  return kind === 'embedding' ? [...FALLBACK_EMBEDDING_MODELS] : [...FALLBACK_LLM_MODELS];
}
