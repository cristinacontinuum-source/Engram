import {
  HygieneAuditResponse,
  HygieneCandidatePair,
  HygieneIssueKind,
  MemoryRecord,
} from '../types/engram';

export type HygieneFilterKind = 'all' | HygieneIssueKind;

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'when',
  'using',
  'use',
  'are',
  'was',
  'were',
  'been',
  'have',
  'has',
  'will',
  'only',
  'more',
  'than',
  'before',
  'after',
  'via',
  'all',
  'any',
  'per',
  'rule',
  'anti',
  'pattern',
]);

export function tokenizeHygieneWords(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/\[(?:rule|anti-pattern|redacted_secret)\]/gi, ' ')
    .replace(/[^a-z0-9/_-]+/g, ' ');
  return cleaned
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

export function computeLexicalSimilarity(aText: string, bText: string): number {
  const aTokens = new Set(tokenizeHygieneWords(aText));
  const bTokens = new Set(tokenizeHygieneWords(bText));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let intersection = 0;
  for (const t of aTokens) {
    if (bTokens.has(t)) intersection++;
  }
  const union = aTokens.size + bTokens.size - intersection;
  const jaccard = union > 0 ? intersection / union : 0;
  const overlapCoeff = intersection / Math.min(aTokens.size, bTokens.size);
  return Number(Math.min(1, jaccard * 0.65 + overlapCoeff * 0.35).toFixed(3));
}

const POSITIVE_MARKERS = ['always', 'require', 'enforce', 'must', 'verify', 'enable', 'allow_mtls', 'short-lived'];
const NEGATIVE_MARKERS = ['never', 'avoid', 'skip', 'skipping', 'disable', 'deprecated', 'static', 'legacy', 'bypass'];

export function detectConflictSignal(
  aContent: string,
  bContent: string,
  similarity: number
): { isConflict: boolean; reason: string } {
  if (similarity < 0.24) {
    return { isConflict: false, reason: '' };
  }

  const aLower = aContent.toLowerCase();
  const bLower = bContent.toLowerCase();

  const aPos = POSITIVE_MARKERS.some((m) => aLower.includes(m));
  const aNeg = NEGATIVE_MARKERS.some((m) => aLower.includes(m));
  const bPos = POSITIVE_MARKERS.some((m) => bLower.includes(m));
  const bNeg = NEGATIVE_MARKERS.some((m) => bLower.includes(m));

  if ((aPos && bNeg && !aNeg) || (bPos && aNeg && !bNeg)) {
    return {
      isConflict: true,
      reason: 'Contradictory directive polarity detected across overlapping operational entities.',
    };
  }

  // Check conflicting numeric specs (e.g., port 443 vs port 8443, max 20 vs max 45, 768d vs 1536d)
  const numsA = new Set(aLower.match(/\b(?:port\s+\d+|\d+d|max\s+\d+|\d+mb)\b/g) || []);
  const numsB = new Set(bLower.match(/\b(?:port\s+\d+|\d+d|max\s+\d+|\d+mb)\b/g) || []);
  if (numsA.size > 0 && numsB.size > 0 && similarity >= 0.42) {
    const identical = Array.from(numsA).some((x) => numsB.has(x));
    if (!identical) {
      return {
        isConflict: true,
        reason: 'Divergent numeric configuration parameters detected on the same service/topic.',
      };
    }
  }

  return { isConflict: false, reason: '' };
}

export function buildMergedContent(
  primary: MemoryRecord,
  secondary: MemoryRecord | null
): string {
  if (!secondary) return primary.content;
  const p = primary.content.trim();
  const s = secondary.content.trim();
  if (p.length >= s.length && p.includes(s.slice(0, 24))) {
    return p;
  }
  return `${p}\n[Consolidated note: ${s}]`;
}

export function analyzeMemoryHygiene(
  memories: MemoryRecord[],
  options?: {
    workspace?: string;
    dedupThreshold?: number;
    staleDaysThreshold?: number;
    dismissedIssueIds?: string[];
    nowMs?: number;
  }
): HygieneAuditResponse {
  const cleanWs = (options?.workspace || 'all').trim() || 'all';
  const dedupThreshold = options?.dedupThreshold ?? 0.85;
  const staleDaysThreshold = options?.staleDaysThreshold ?? 30;
  const dismissedSet = new Set(options?.dismissedIssueIds ?? []);
  const nowMs = options?.nowMs ?? Date.now();

  const active = memories.filter((m) => {
    if (m.status !== 'active') return false;
    if (cleanWs !== 'all' && m.workspace !== cleanWs) return false;
    return true;
  });

  const issues: HygieneCandidatePair[] = [];
  const pairedKeys = new Set<string>();

  // Effective lexical threshold tracks user's dedup slider meaningfully without requiring 100% verbatim copy
  const dupLexThreshold = Math.max(0.42, Math.min(0.88, Number((dedupThreshold - 0.35).toFixed(2))));

  // 1. Pairwise conflicts & near-duplicates inside same workspace
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      if (a.workspace !== b.workspace) continue;

      // Order primary = newer / pinned / higher confidence
      const scoreA = a.is_pinned * 2 + a.confidence + Date.parse(a.valid_from) / 1e14;
      const scoreB = b.is_pinned * 2 + b.confidence + Date.parse(b.valid_from) / 1e14;
      const [primary, secondary] = scoreA >= scoreB ? [a, b] : [b, a];

      const pairKey = [primary.id, secondary.id].sort().join('::');
      if (pairedKeys.has(pairKey)) continue;

      const sim = computeLexicalSimilarity(primary.content, secondary.content);
      const conflictCheck = detectConflictSignal(primary.content, secondary.content, sim);

      if (conflictCheck.isConflict) {
        const issueId = `hyg-conf-${primary.id}-${secondary.id}`;
        if (!dismissedSet.has(issueId)) {
          pairedKeys.add(pairKey);
          issues.push({
            issue_id: issueId,
            kind: 'conflict',
            severity: 'high',
            workspace: primary.workspace,
            similarity_score: sim,
            title: `Policy / config conflict between ${primary.id} and ${secondary.id}`,
            reason: conflictCheck.reason,
            primary_memory: primary,
            secondary_memory: secondary,
            suggested_action: 'supersede_secondary',
          });
        }
        continue;
      }

      if (sim >= dupLexThreshold) {
        const issueId = `hyg-dup-${primary.id}-${secondary.id}`;
        if (!dismissedSet.has(issueId)) {
          pairedKeys.add(pairKey);
          issues.push({
            issue_id: issueId,
            kind: 'duplicate',
            severity: sim >= 0.72 ? 'high' : 'medium',
            workspace: primary.workspace,
            similarity_score: sim,
            title: `Near-duplicate overlap (${Math.round(sim * 100)}% lexical similarity)`,
            reason: `Exceeds consolidation similarity floor (${Math.round(dupLexThreshold * 100)}% mapped from dedup ${dedupThreshold.toFixed(2)}). Consolidating eliminates duplicate prompt tokens.`,
            primary_memory: primary,
            secondary_memory: secondary,
            suggested_action: 'merge_keep_primary',
          });
        }
      }
    }
  }

  // 2. Expiring TTL & Stale unused memories
  for (const m of active) {
    if (m.expires_at) {
      const expMs = Date.parse(m.expires_at);
      if (!Number.isNaN(expMs)) {
        const hoursLeft = (expMs - nowMs) / (1000 * 3600);
        if (hoursLeft <= 48) {
          const issueId = `hyg-exp-${m.id}`;
          if (!dismissedSet.has(issueId)) {
            issues.push({
              issue_id: issueId,
              kind: 'expiring',
              severity: hoursLeft <= 0 ? 'high' : 'low',
              workspace: m.workspace,
              similarity_score: 1,
              title:
                hoursLeft <= 0
                  ? `Expired TTL memory awaiting cleanup (${m.id})`
                  : `Episodic memory expires in ${Math.max(1, Math.round(hoursLeft))}h`,
              reason:
                hoursLeft <= 0
                  ? `expires_at (${m.expires_at}) has elapsed and will be removed on next TTL sweep.`
                  : `Scheduled expiration (${m.expires_at}). Extend TTL or promote to permanent if still needed.`,
              primary_memory: m,
              secondary_memory: null,
              suggested_action: 'extend_ttl',
            });
          }
          continue;
        }
      }
    }

    if (m.is_pinned !== 1) {
      const refIso = m.last_accessed_at || m.valid_from;
      const refMs = Date.parse(refIso);
      if (!Number.isNaN(refMs)) {
        const ageDays = (nowMs - refMs) / (1000 * 3600 * 24);
        if (ageDays >= staleDaysThreshold && m.access_count <= 3) {
          const issueId = `hyg-stale-${m.id}`;
          if (!dismissedSet.has(issueId)) {
            issues.push({
              issue_id: issueId,
              kind: 'stale',
              severity: ageDays >= staleDaysThreshold * 2 ? 'medium' : 'low',
              workspace: m.workspace,
              similarity_score: Number(Math.min(1, ageDays / 90).toFixed(2)),
              title: `Stale unpinned memory (${Math.round(ageDays)}d idle, ${m.access_count} recalls)`,
              reason: `Unpinned record untouched for ${Math.round(ageDays)} days (threshold: ${staleDaysThreshold}d). Safe candidate for archival.`,
              primary_memory: m,
              secondary_memory: null,
              suggested_action: 'archive_stale',
            });
          }
        }
      }
    }
  }

  // Sort: conflict -> duplicate -> stale -> expiring, then severity
  const kindRank: Record<HygieneIssueKind, number> = {
    conflict: 0,
    duplicate: 1,
    stale: 2,
    expiring: 3,
  };
  const sevRank = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => {
    if (kindRank[a.kind] !== kindRank[b.kind]) return kindRank[a.kind] - kindRank[b.kind];
    if (sevRank[a.severity] !== sevRank[b.severity]) return sevRank[a.severity] - sevRank[b.severity];
    return b.similarity_score - a.similarity_score;
  });

  const counts = {
    all: issues.length,
    conflict: issues.filter((i) => i.kind === 'conflict').length,
    duplicate: issues.filter((i) => i.kind === 'duplicate').length,
    stale: issues.filter((i) => i.kind === 'stale').length,
    expiring: issues.filter((i) => i.kind === 'expiring').length,
  };

  const penalty = issues.reduce((acc, item) => {
    if (item.severity === 'high') return acc + 10;
    if (item.severity === 'medium') return acc + 6;
    return acc + 3;
  }, 0);
  const healthScore = Math.max(15, Math.min(100, 100 - penalty));

  return {
    scanned_at: new Date(nowMs).toISOString(),
    workspace: cleanWs,
    total_active_scanned: active.length,
    health_score: healthScore,
    dedup_threshold: dedupThreshold,
    stale_days_threshold: staleDaysThreshold,
    counts,
    issues,
  };
}

export function filterHygieneIssues(
  issues: HygieneCandidatePair[],
  options?: { kind?: HygieneFilterKind; search?: string }
): HygieneCandidatePair[] {
  const kind = options?.kind || 'all';
  const search = (options?.search || '').trim().toLowerCase();

  return issues.filter((issue) => {
    if (kind !== 'all' && issue.kind !== kind) return false;
    if (search) {
      const hay = [
        issue.issue_id,
        issue.title,
        issue.reason,
        issue.workspace,
        issue.primary_memory.id,
        issue.primary_memory.content,
        issue.secondary_memory?.id || '',
        issue.secondary_memory?.content || '',
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}
