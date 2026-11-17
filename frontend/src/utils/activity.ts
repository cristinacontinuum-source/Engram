import {
  MemoryType,
  WorkerJobRecord,
  WorkerJobType,
} from '../types/engram';
import { scrubSecretsText } from './phase1Logic';

export type JobTypeFilter = 'all' | WorkerJobType;

export interface ActivitySummaryMetrics {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  successRatePct: number;
  avgLatencyMs: number;
  totalSecretsRedacted: number;
  countsByType: Record<WorkerJobType, number>;
}

export function filterWorkerJobs(
  jobs: WorkerJobRecord[],
  options?: {
    workspace?: string;
    jobType?: JobTypeFilter;
    search?: string;
  }
): WorkerJobRecord[] {
  const ws = (options?.workspace || 'all').trim();
  const jobType = options?.jobType || 'all';
  const search = (options?.search || '').trim().toLowerCase();

  return jobs
    .filter((job) => {
      if (ws !== 'all' && job.workspace !== ws && job.workspace !== 'global') return false;
      if (jobType !== 'all' && job.job_type !== jobType) return false;
      if (search) {
        const hay = `${job.job_id} ${job.job_type} ${job.workspace} ${job.summary} ${job.detail}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    })
    .slice()
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export function computeActivitySummary(jobs: WorkerJobRecord[]): ActivitySummaryMetrics {
  const countsByType: Record<WorkerJobType, number> = {
    store_memory: 0,
    ingest_messages: 0,
    reindex_all: 0,
    ttl_cleanup: 0,
  };

  let completedJobs = 0;
  let failedJobs = 0;
  let latencySum = 0;
  let latencyCount = 0;
  let totalSecretsRedacted = 0;

  for (const j of jobs) {
    countsByType[j.job_type] = (countsByType[j.job_type] || 0) + 1;
    if (j.status === 'completed') completedJobs++;
    if (j.status === 'failed') failedJobs++;
    if (j.latency_ms > 0) {
      latencySum += j.latency_ms;
      latencyCount++;
    }
    totalSecretsRedacted += j.secrets_redacted || 0;
  }

  const finished = completedJobs + failedJobs;
  const successRatePct =
    finished > 0 ? Number(((completedJobs / finished) * 100).toFixed(1)) : 100;
  const avgLatencyMs =
    latencyCount > 0 ? Number((latencySum / latencyCount).toFixed(1)) : 0;

  return {
    totalJobs: jobs.length,
    completedJobs,
    failedJobs,
    successRatePct,
    avgLatencyMs,
    totalSecretsRedacted,
    countsByType,
  };
}

export interface ExtractedTranscriptCandidate {
  content: string;
  type: MemoryType;
  is_pinned: boolean;
  confidence: number;
  secrets_redacted: number;
}

/**
 * Deterministic extractor mirroring backend `llm_service.py::extract_memories_from_messages`
 * fallback + secret scrubbing for simulator & offline preview mode.
 */
export function extractMemoriesFromTranscriptText(
  transcriptText: string
): ExtractedTranscriptCandidate[] {
  const lines = transcriptText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length >= 16);

  const extracted: ExtractedTranscriptCandidate[] = [];

  for (const rawLine of lines) {
    const cleanedLine = rawLine.replace(/^(user|assistant|system)\s*:\s*/i, '').trim();
    if (cleanedLine.length < 16) continue;

    const { scrubbed, redactionCount } = scrubSecretsText(cleanedLine);
    const lower = scrubbed.toLowerCase();
    const isProcedural =
      lower.includes('always ') ||
      lower.includes('never ') ||
      lower.includes('must ') ||
      lower.includes('avoid ') ||
      lower.includes('[rule]') ||
      lower.includes('[anti-pattern]');

    extracted.push({
      content: scrubbed,
      type: isProcedural ? 'procedural' : 'semantic',
      is_pinned: isProcedural,
      confidence: isProcedural ? 0.94 : 0.87,
      secrets_redacted: redactionCount,
    });

    if (extracted.length >= 8) break;
  }

  return extracted;
}
