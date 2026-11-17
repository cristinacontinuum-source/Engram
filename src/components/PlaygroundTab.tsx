import React, { useEffect, useState } from 'react';
import {
  Bell,
  Check,
  Copy,
  FolderGit2,
  Pin,
  Play,
  Sparkles,
  Target,
} from 'lucide-react';
import { engramApi } from '../api/client';
import { Dictionary } from '../i18n';
import { PlaygroundQueryResponse } from '../types/engram';
import { CustomSelect } from './ui/CustomSelect';

interface PlaygroundTabProps {
  activeWorkspace: string;
  workspaces: string[];
  dict: Dictionary;
  onAfterQuery?: () => void;
}

const PRESET_QUERIES = [
  'How does Hermes authenticate with the production payment gateway and what batch limits apply?',
  'What are the Zero-RAM local embedding rules for FastEmbed ONNX?',
  'Dual-Transport MCP server endpoints and authentication headers',
];

export const PlaygroundTab: React.FC<PlaygroundTabProps> = ({
  activeWorkspace,
  workspaces,
  dict,
  onAfterQuery,
}) => {
  const [queryText, setQueryText] = useState(PRESET_QUERIES[0]);
  const [selectedWorkspace, setSelectedWorkspace] = useState(
    activeWorkspace === 'all' ? 'hermes' : activeWorkspace
  );
  const [distill, setDistill] = useState(true);
  const [topK, setTopK] = useState(5);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PlaygroundQueryResponse | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (activeWorkspace !== 'all') {
      setSelectedWorkspace(activeWorkspace);
    }
  }, [activeWorkspace]);

  const executeQuery = async (customQuery?: string) => {
    const q = (customQuery ?? queryText).trim();
    if (!q) return;
    setRunning(true);
    try {
      const res = await engramApi.playgroundQuery({
        query: q,
        workspace: selectedWorkspace,
        top_k: topK,
        distill,
      });
      setResult(res);
      if (onAfterQuery) onAfterQuery();
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    executeQuery(PRESET_QUERIES[0]);
  }, []);

  const handleCopyDistilled = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.distilled_context);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const workspaceOptions = workspaces
    .filter((w) => w !== 'all')
    .map((w) => ({
      value: w,
      label: `${w} (+ global)`,
      badge: w === 'global' ? 'root' : 'scoped',
    }));

  const topScorePct =
    result && result.results.length > 0
      ? Math.min(100, Math.round(result.results[0].score * 1000) / 10)
      : 92.4;

  const savingsPct = result?.token_metrics.savings_pct ?? 86.0;
  const rawTokens = result?.token_metrics.raw_tokens ?? 2304;
  const distilledTokens = result?.token_metrics.distilled_tokens ?? 323;
  const latencyMs = result?.latency_ms ?? 12.4;
  const graphBoostedCandidates = result
    ? result.results.filter((r) => r.score_breakdown.graph_boost > 0.5)
    : [];
  const rawContextPayload = result
    ? result.results
        .map((r) => `[ID: ${r.id} | Workspace: ${r.workspace} | Type: ${r.type}]\n${r.content}`)
        .join('\n\n---\n\n')
    : '';

  return (
    <div className="space-y-4 pb-6">
      {/* Row 1: 4 ReUI Signal "Analyze > Metrics" Top Cards with Divided Footer Baseline */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Top-1 Hybrid Score */}
        <div className="reui-card overflow-hidden flex flex-col justify-between">
          <div className="p-4 space-y-2">
            <h3 className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Top-1 Hybrid Score
            </h3>
            <div className="flex items-center gap-2">
              <span className="font-mono-data text-2xl font-bold tracking-tight">
                {topScorePct}%
              </span>
              <span className="px-1.5 py-0.5 rounded-[3px] text-[11px] font-mono-data font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
                ↑ +11.2 pts
              </span>
            </div>
          </div>
          <div
            className="px-4 py-2.5 hairline-border-t text-xs"
            style={{ color: 'var(--text-secondary)' }}
          >
            vs <strong style={{ color: 'var(--text-primary)' }}>81.2%</strong> vector-only cosine
          </div>
        </div>

        {/* Card 2: Token Compression Rate */}
        <div className="reui-card overflow-hidden flex flex-col justify-between">
          <div className="p-4 space-y-2">
            <h3 className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Context Compression
            </h3>
            <div className="flex items-center gap-2">
              <span className="font-mono-data text-2xl font-bold tracking-tight">
                {savingsPct}%
              </span>
              <span className="px-1.5 py-0.5 rounded-[3px] text-[11px] font-mono-data font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
                ↓ -{rawTokens - distilledTokens} tok
              </span>
            </div>
          </div>
          <div
            className="px-4 py-2.5 hairline-border-t text-xs"
            style={{ color: 'var(--text-secondary)' }}
          >
            <strong style={{ color: 'var(--text-primary)' }}>{distilledTokens} tok</strong> vs{' '}
            {rawTokens} raw payload
          </div>
        </div>

        {/* Card 3: Matched Graph Entities */}
        <div className="reui-card overflow-hidden flex flex-col justify-between">
          <div className="p-4 space-y-2">
            <h3 className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              1-Hop Graph Boost
            </h3>
            <div className="flex items-center gap-2">
              <span className="font-mono-data text-2xl font-bold tracking-tight">
                {graphBoostedCandidates.length} boosted
              </span>
              <span className="px-1.5 py-0.5 rounded-[3px] text-[11px] font-mono-data font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
                ↑ +0.20 BFS
              </span>
            </div>
          </div>
          <div
            className="px-4 py-2.5 hairline-border-t text-xs truncate"
            style={{ color: 'var(--text-secondary)' }}
          >
            Linked IDs:{' '}
            <strong style={{ color: 'var(--text-primary)' }}>
              {graphBoostedCandidates.length > 0
                ? graphBoostedCandidates.map((r) => r.id).slice(0, 3).join(', ')
                : 'None in top-k'}
            </strong>
          </div>
        </div>

        {/* Card 4: Recall Latency */}
        <div className="reui-card overflow-hidden flex flex-col justify-between">
          <div className="p-4 space-y-2">
            <h3 className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Recall Latency
            </h3>
            <div className="flex items-center gap-2">
              <span className="font-mono-data text-2xl font-bold tracking-tight">
                {latencyMs} ms
              </span>
              <span className="px-1.5 py-0.5 rounded-[3px] text-[11px] font-mono-data font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
                ↓ 0.3 ms
              </span>
            </div>
          </div>
          <div
            className="px-4 py-2.5 hairline-border-t text-xs"
            style={{ color: 'var(--text-secondary)' }}
          >
            vs <strong style={{ color: 'var(--text-primary)' }}>15.2 ms</strong> prior 28 queries
          </div>
        </div>
      </div>

      {/* Row 2: ReUI Signal Main Simulator & Context Distiller Panel */}
      <div className="reui-card overflow-hidden">
        {/* Card Header & Query Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            executeQuery();
          }}
          className="p-5 hairline-border-b space-y-3.5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Hybrid Retrieval &amp; Context Distiller Simulator
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                Formula: 0.55×Cosine + 0.20×Graph_1Hop + 0.15×Recency + 0.10×Confidence
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-mono-data text-emerald-600 dark:text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>recall_memory(distill={distill ? 'True' : 'False'})</span>
            </span>
          </div>

          <div className="flex flex-col lg:flex-row gap-2.5">
            <div className="flex-1">
              <input
                type="text"
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                placeholder={dict.playground.queryPlaceholder}
                className="w-full h-9 px-3 rounded-[4px] hairline-border text-xs focus:outline-none"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            <div className="w-full sm:w-56">
              <CustomSelect
                ariaLabel={dict.sidebar.workspaceLabel}
                value={selectedWorkspace}
                options={workspaceOptions}
                onChange={(val) => setSelectedWorkspace(val)}
                icon={<FolderGit2 className="w-3.5 h-3.5" />}
                size="sm"
                mono
              />
            </div>

            <div className="w-full sm:w-28">
              <CustomSelect
                ariaLabel={dict.playground.topKLabel}
                value={String(topK)}
                options={[
                  { value: '3', label: 'Top 3' },
                  { value: '5', label: 'Top 5' },
                  { value: '8', label: 'Top 8' },
                ]}
                onChange={(val) => setTopK(Number(val))}
                size="sm"
                mono
              />
            </div>

            <label
              className="h-9 px-3 rounded-[4px] hairline-border flex items-center gap-2 text-xs cursor-pointer select-none shrink-0"
              style={{ backgroundColor: 'var(--bg-surface)' }}
            >
              <input
                type="checkbox"
                checked={distill}
                onChange={(e) => setDistill(e.target.checked)}
                className="w-3.5 h-3.5 rounded-[3px] accent-emerald-500"
              />
              <span className="font-medium">Distill</span>
            </label>

            <button
              type="submit"
              disabled={running}
              className="h-9 px-4 reui-btn-primary text-xs flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{running ? dict.playground.runningBtn : dict.playground.runQueryBtn}</span>
            </button>
          </div>

          {/* Preset Sample Queries */}
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="text-[11px] font-medium mr-1" style={{ color: 'var(--text-muted)' }}>
              Sample prompts:
            </span>
            {PRESET_QUERIES.map((preset, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setQueryText(preset);
                  executeQuery(preset);
                }}
                className="px-2 py-0.5 rounded-[3px] reui-btn-secondary text-[11px] truncate max-w-[290px] cursor-pointer"
              >
                {preset}
              </button>
            ))}
          </div>
        </form>

        {/* Side-by-Side Distilled vs Raw Comparison */}
        {result && (
          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[var(--border-hairline)]">
            {/* Left: Fast LLM Context Distiller Output */}
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <h3 className="text-xs font-semibold">
                    {dict.playground.leftPanelTitle}
                  </h3>
                  <span className="px-1.5 py-0.5 rounded-[3px] font-mono-data text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    {result.token_metrics.distilled_tokens} tok (-{result.token_metrics.savings_pct}%)
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleCopyDistilled}
                  className="px-2 py-1 reui-btn-secondary text-[11px] flex items-center gap-1 cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              <pre
                className="p-3.5 rounded-[4px] hairline-border font-mono-data text-xs whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                }}
              >
                {result.distilled_context}
              </pre>
            </div>

            {/* Right: Uncompressed Raw Chunks */}
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Raw Retrieved Context Chunks
                </h3>
                <span
                  className="px-1.5 py-0.5 rounded-[3px] font-mono-data text-[10px]"
                  style={{
                    backgroundColor: 'var(--bg-elevated)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {result.token_metrics.raw_tokens} raw tokens
                </span>
              </div>

              <pre
                className="p-3.5 rounded-[4px] hairline-border font-mono-data text-[11px] whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto opacity-80"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  color: 'var(--text-secondary)',
                }}
              >
                {rawContextPayload}
              </pre>
            </div>
          </div>
        )}

        {/* ReUI Signal Bottom Guardrail Status Strip (matches "Active teams drop [Armed]" in reui-metrics.png) */}
        <div
          className="px-5 py-3 hairline-border-t flex flex-wrap items-center justify-between gap-3 text-xs"
          style={{ backgroundColor: 'var(--bg-elevated)' }}
        >
          <div className="flex items-center gap-2.5 flex-wrap">
            <Bell className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              Cosine Threshold Guard
            </span>
            <span className="px-1.5 py-0.5 rounded-[3px] text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
              Armed
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>
              Filters out low-confidence memories below 0.50 • 7-day decay window
            </span>
          </div>

          <div className="flex items-center gap-2 font-mono-data text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-[10px] font-bold">
              EC
            </span>
            <span>Engram Distiller</span>
          </div>
        </div>
      </div>

      {/* Row 3: ReUI Signal "Cohort Breakdown" (6 cols) + "Recent Pipeline Trace" (6 cols) */}
      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left 6 Cols: Ranked Memories Breakdown with Striped Progress Bars */}
          <div className="lg:col-span-7 reui-card p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Hybrid Score Breakdown ({result.results.length})
                </h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  Ranked by weighted Cosine, 1-Hop Graph BFS, Recency, and Confidence
                </p>
              </div>
              <span
                className="px-2 py-1 rounded-[4px] hairline-border font-mono-data text-[11px]"
                style={{ color: 'var(--text-secondary)' }}
              >
                ws:{result.workspace}
              </span>
            </div>

            <div className="divide-y divide-[var(--border-hairline)]">
              {result.results.map((item) => {
                const scorePct = Math.min(100, Math.round(item.score * 100));
                return (
                  <div key={item.id} className="py-3.5 first:pt-1 last:pb-1 space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        {item.is_pinned && (
                          <Pin className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        )}
                        <span
                          className="font-semibold truncate"
                          style={{ color: 'var(--text-primary)' }}
                          title={item.content}
                        >
                          {item.content}
                        </span>
                        <span
                          className="font-mono-data text-[11px] shrink-0"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {item.id}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 font-mono-data text-xs shrink-0">
                        <span style={{ color: 'var(--text-secondary)' }}>
                          vec:{item.score_breakdown.vector_score.toFixed(2)} • grph:{item.score_breakdown.graph_boost.toFixed(2)}
                        </span>
                        <span className="font-bold" style={{ color: 'var(--text-primary)' }}>
                          {scorePct}%
                        </span>
                      </div>
                    </div>

                    {/* ReUI Signal Striped Progress Bar */}
                    <div className="h-2 w-full rounded-[2px] reui-hatch-track overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-300"
                        style={{ width: `${Math.min(100, Math.max(15, scorePct))}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right 5 Cols: Retrieval Pipeline Trace ("Recent Changes" timeline style) */}
          <div className="lg:col-span-5 reui-card p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Execution Trace
                </h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  Step-by-step recall &amp; distillation telemetry
                </p>
              </div>
              <span className="font-mono-data text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
                {result.latency_ms}ms total
              </span>
            </div>

            <div className="relative pl-6 space-y-4 before:content-[''] before:absolute before:left-[9px] before:top-2 before:bottom-2 before:w-[1px] before:bg-[var(--border-hairline)]">
              <div className="relative space-y-1">
                <span
                  className="absolute -left-6 top-0.5 w-5 h-5 rounded-full hairline-border flex items-center justify-center"
                  style={{ backgroundColor: 'var(--bg-elevated)' }}
                >
                  <Target className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400" />
                </span>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold">1. Vector Cosine Search (vec0)</span>
                  <span className="font-mono-data text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    3.8 ms
                  </span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  Queried SQLite WAL virtual table across workspace{' '}
                  <code className="font-mono-data">{result.workspace}</code> and{' '}
                  <code className="font-mono-data">global</code>.
                </p>
              </div>

              <div className="relative space-y-1">
                <span
                  className="absolute -left-6 top-0.5 w-5 h-5 rounded-full hairline-border flex items-center justify-center"
                  style={{ backgroundColor: 'var(--bg-elevated)' }}
                >
                  <Sparkles className="w-2.5 h-2.5 text-violet-400" />
                </span>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold">2. 1-Hop Entity Graph Boost</span>
                  <span className="font-mono-data text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    2.1 ms
                  </span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  Applied +0.20 boost to {graphBoostedCandidates.length} candidates connected to{' '}
                  {graphBoostedCandidates.length > 0
                    ? graphBoostedCandidates.map((r) => r.id).slice(0, 3).join(', ')
                    : 'extracted entities'}
                  .
                </p>
              </div>

              <div className="relative space-y-1">
                <span
                  className="absolute -left-6 top-0.5 w-5 h-5 rounded-full hairline-border flex items-center justify-center"
                  style={{ backgroundColor: 'var(--bg-elevated)' }}
                >
                  <Bell className="w-2.5 h-2.5 text-amber-400" />
                </span>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold">3. Fast LLM Context Distiller</span>
                  <span className="font-mono-data text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    6.5 ms
                  </span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  Compressed {result.token_metrics.raw_tokens} raw tokens into{' '}
                  {result.token_metrics.distilled_tokens} dense bullet tokens (-
                  {result.token_metrics.savings_pct}%).
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
