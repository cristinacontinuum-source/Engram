import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  Link2,
  Pin,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { Dictionary } from '../i18n';
import { MemoryRecord, StatsResponse, TabId } from '../types/engram';

interface OverviewTabProps {
  stats: StatsResponse;
  dict: Dictionary;
  onNavigateTab: (tab: TabId) => void;
  onTogglePin: (memory: MemoryRecord) => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  stats,
  dict,
  onNavigateTab,
  onTogglePin,
}) => {
  const [hoveredBarIdx, setHoveredBarIdx] = useState<number | null>(null);
  const [chartMetricMode, setChartMetricMode] = useState<'tokens' | 'latency'>('tokens');

  const allTelemetry = stats.recent_telemetry || [];
  const telemetry = allTelemetry.slice(-16);
  const maxRawTokens = Math.max(2200, ...telemetry.map((t) => t.raw_tokens));
  const maxLatency = Math.max(25, ...telemetry.map((t) => t.latency_ms));

  const inspectedItem =
    hoveredBarIdx !== null && telemetry[hoveredBarIdx]
      ? telemetry[hoveredBarIdx]
      : telemetry[telemetry.length - 1] || null;

  const totalMemories = stats.active_memories + stats.superseded_memories;
  const activePct = Math.round((stats.active_memories / Math.max(1, totalMemories)) * 100);
  const pinnedPct = Math.round((stats.pinned_memories / Math.max(1, totalMemories)) * 100);
  const supersededPct = Math.max(0, 100 - activePct);

  const proceduralRules = stats.recent_procedural_rules || [];

  return (
    <div className="space-y-4 pb-6">
      {/* Row 1: 4 ReUI Signal Top KPI Cards with Segmented Bars, Sparkline, & Footer Action Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Memory Health (Connection Health style) */}
        <div className="reui-card flex flex-col justify-between overflow-hidden">
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 font-semibold" style={{ color: 'var(--text-primary)' }}>
                <Zap className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
                <span>Memory Health</span>
              </span>
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Now
              </span>
            </div>

            <div>
              <div className="flex items-baseline gap-2">
                <span className="font-mono-data text-2xl font-bold tracking-tight">
                  {stats.active_memories}
                  <span className="text-base font-normal" style={{ color: 'var(--text-muted)' }}>
                    /{totalMemories}
                  </span>
                </span>
                <span className="font-mono-data text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  ↑ {activePct}%
                </span>
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                {stats.pinned_memories} core directives pinned
              </div>
            </div>

            {/* Segmented Pill Bar */}
            <div className="flex items-center gap-1 h-2 w-full">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${Math.max(20, activePct - 15)}%` }}
              />
              <div
                className="h-full rounded-full bg-amber-500"
                style={{ width: `${Math.max(8, supersededPct)}%` }}
              />
              <div className="h-full rounded-full bg-violet-500 flex-1" />
            </div>

            {/* 2x2 Status Legend */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs pt-0.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span>Active</span>
                </span>
                <span className="font-mono-data font-semibold">{stats.active_memories}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span>Superseded</span>
                </span>
                <span className="font-mono-data font-semibold">{stats.superseded_memories}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                  <span className="w-2 h-2 rounded-full bg-violet-500" />
                  <span>Pinned</span>
                </span>
                <span className="font-mono-data font-semibold">{stats.pinned_memories}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                  <span className="w-2 h-2 rounded-full bg-zinc-500" />
                  <span>Procedural</span>
                </span>
                <span className="font-mono-data font-semibold">
                  {stats.type_breakdown?.procedural ?? 3}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigateTab('explorer')}
            className="w-full px-4 py-2.5 hairline-border-t flex items-center justify-between text-xs hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span>Open Memory Explorer</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Card 2: Linked Knowledge Graph (Linked Datasets style) */}
        <div className="reui-card flex flex-col justify-between overflow-hidden">
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 font-semibold" style={{ color: 'var(--text-primary)' }}>
                <Link2 className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
                <span>Knowledge Graph</span>
              </span>
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                1-Hop BFS
              </span>
            </div>

            <div>
              <div className="flex items-baseline gap-2">
                <span className="font-mono-data text-2xl font-bold tracking-tight">
                  {stats.knowledge_graph.entities}
                  <span className="text-base font-normal" style={{ color: 'var(--text-muted)' }}>
                    /{stats.knowledge_graph.edges}
                  </span>
                </span>
                <span className="font-mono-data text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  ↑ +0.20 boost
                </span>
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                {stats.knowledge_graph.entities} entities linked across triplets
              </div>
            </div>

            {/* Segmented Violet Bar */}
            <div className="flex items-center gap-1 h-2 w-full">
              <div className="h-full rounded-full bg-violet-500 w-[68%]" />
              <div className="h-full rounded-full bg-amber-500 w-[12%]" />
              <div className="h-full rounded-full bg-zinc-700 flex-1" />
            </div>

            {/* 2x2 Legend */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs pt-0.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                  <span className="w-2 h-2 rounded-full bg-violet-500" />
                  <span>Entities</span>
                </span>
                <span className="font-mono-data font-semibold">
                  {stats.knowledge_graph.entities}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span>Relations</span>
                </span>
                <span className="font-mono-data font-semibold">
                  {stats.knowledge_graph.edges}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                  <span className="w-2 h-2 rounded-full bg-zinc-500" />
                  <span>Semantic</span>
                </span>
                <span className="font-mono-data font-semibold">
                  {stats.type_breakdown?.semantic ?? 4}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span>Episodic</span>
                </span>
                <span className="font-mono-data font-semibold">
                  {stats.type_breakdown?.episodic ?? 1}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigateTab('graph')}
            className="w-full px-4 py-2.5 hairline-border-t flex items-center justify-between text-xs hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span>Inspect Entity Topology</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Card 3: Tokens Saved via Context Distiller (Rows Synced Sparkline style) */}
        <div className="reui-card flex flex-col justify-between overflow-hidden">
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 font-semibold" style={{ color: 'var(--text-primary)' }}>
                <ArrowLeftRight className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
                <span>Tokens Saved</span>
              </span>
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {stats.token_efficiency.total_queries} runs
              </span>
            </div>

            <div>
              <div className="flex items-baseline gap-2">
                <span className="font-mono-data text-2xl font-bold tracking-tight">
                  {(stats.token_efficiency.tokens_saved_total / 1000).toFixed(1)}K
                </span>
                <span className="font-mono-data text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  ↑ {stats.token_efficiency.compression_savings_pct}%
                </span>
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                {stats.token_efficiency.distilled_tokens_total.toLocaleString()} distilled of{' '}
                {stats.token_efficiency.raw_tokens_total.toLocaleString()} raw
              </div>
            </div>

            {/* SVG Area Sparkline */}
            <div className="h-[52px] w-full pt-1">
              <svg viewBox="0 0 240 48" className="w-full h-full overflow-visible">
                <defs>
                  <linearGradient id="reuiEmeraldGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity="0.32" />
                    <stop offset="100%" stopColor="#10B981" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                <path
                  d="M0,28 C25,22 45,14 70,24 C95,32 120,16 145,14 C170,12 195,20 236,12 L236,46 L0,46 Z"
                  fill="url(#reuiEmeraldGrad)"
                />
                <path
                  d="M0,28 C25,22 45,14 70,24 C95,32 120,16 145,14 C170,12 195,20 236,12"
                  fill="none"
                  stroke="#10B981"
                  strokeWidth="2"
                />
                <circle cx="236" cy="12" r="3" fill="#10B981" />
              </svg>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigateTab('playground')}
            className="w-full px-4 py-2.5 hairline-border-t flex items-center justify-between text-xs hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span>Open Context Distiller</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Card 4: Recall Latency & Vector Runtime (Failed Syncs mini pill-bar style) */}
        <div className="reui-card flex flex-col justify-between overflow-hidden">
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 font-semibold" style={{ color: 'var(--text-primary)' }}>
                <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
                <span>Recall Latency</span>
              </span>
              <span className="text-[11px] font-mono-data" style={{ color: 'var(--text-muted)' }}>
                {stats.embedding_runtime.dimension}d vec0
              </span>
            </div>

            <div>
              <div className="flex items-baseline gap-2">
                <span className="font-mono-data text-2xl font-bold tracking-tight">
                  {stats.token_efficiency.avg_latency_ms}ms
                </span>
                <span className="font-mono-data text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  ↓ WAL fast
                </span>
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                {stats.embedding_runtime.mode === 'external'
                  ? '0 MB idle RAM (External API)'
                  : 'Local FastEmbed ONNX'}
              </div>
            </div>

            {/* 12 Mini Pill Bars */}
            <div className="h-[52px] flex items-end gap-1.5 pt-1">
              {(telemetry.slice(-11).length > 0
                ? telemetry.slice(-11)
                : Array.from({ length: 11 }, (_, i) => ({
                    id: i,
                    latency_ms: 11 + ((i * 3) % 9),
                  }))
              ).map((item, idx) => {
                const hPct = Math.max(18, Math.min(95, Math.round((item.latency_ms / 26) * 100)));
                const isLast = idx === 10;
                return (
                  <div
                    key={idx}
                    className="flex-1 h-full rounded-full flex items-end overflow-hidden"
                    style={{ backgroundColor: 'var(--bg-elevated)' }}
                  >
                    <div
                      className={`w-full rounded-full ${
                        isLast ? 'bg-emerald-400' : 'bg-emerald-500/55'
                      }`}
                      style={{ height: `${hPct}%` }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigateTab('settings')}
            className="w-full px-4 py-2.5 hairline-border-t flex items-center justify-between text-xs hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span>Configure Embedding Engine</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Row 2: ReUI Signal "Token Efficiency & Recall Activity" (8 cols) + "Procedural Guardrails" (4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left 8 Cols: Striped Pill-Bar Activity Chart (Zero-Jitter Hover Inspector) */}
        <div className="lg:col-span-8 reui-card p-5 flex flex-col justify-between">
          <div>
            {/* Card Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4">
              <div>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Token Efficiency &amp; Recall Activity
                </h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  {stats.token_efficiency.total_queries} recall runs in window,{' '}
                  {stats.token_efficiency.compression_savings_pct}% compressed via Context Distiller
                </p>
              </div>

              <div className="flex items-center gap-4 flex-wrap">
                {/* Legend */}
                <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span>Saved</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    <span>Distilled</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-rose-500" />
                    <span>Overhead</span>
                  </span>
                </div>

                {/* Segmented Mode Switch ("Tokens" | "Latency") */}
                <div
                  className="inline-flex rounded-[4px] hairline-border p-0.5 text-xs"
                  style={{ backgroundColor: 'var(--bg-elevated)' }}
                >
                  <button
                    type="button"
                    onClick={() => setChartMetricMode('tokens')}
                    className={`px-2.5 py-1 rounded-[3px] text-[11px] font-medium transition-colors cursor-pointer ${
                      chartMetricMode === 'tokens' ? 'reui-card shadow-xs' : 'opacity-70'
                    }`}
                  >
                    Tokens
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartMetricMode('latency')}
                    className={`px-2.5 py-1 rounded-[3px] text-[11px] font-medium transition-colors cursor-pointer ${
                      chartMetricMode === 'latency' ? 'reui-card shadow-xs' : 'opacity-70'
                    }`}
                  >
                    Latency
                  </button>
                </div>
              </div>
            </div>

            {/* Striped Pill-Bar Chart Body */}
            <div className="flex gap-3 pt-2">
              {/* Y-Axis Labels */}
              <div
                className="flex flex-col justify-between h-52 pb-6 text-[11px] font-mono-data select-none text-right w-9 shrink-0"
                style={{ color: 'var(--text-muted)' }}
              >
                {chartMetricMode === 'tokens' ? (
                  <>
                    <span>{(maxRawTokens / 1000).toFixed(1)}k</span>
                    <span>{((maxRawTokens * 0.66) / 1000).toFixed(1)}k</span>
                    <span>{((maxRawTokens * 0.33) / 1000).toFixed(1)}k</span>
                    <span>0</span>
                  </>
                ) : (
                  <>
                    <span>{Math.round(maxLatency)}ms</span>
                    <span>{Math.round(maxLatency * 0.66)}ms</span>
                    <span>{Math.round(maxLatency * 0.33)}ms</span>
                    <span>0ms</span>
                  </>
                )}
              </div>

              {/* Pill-Bar Columns */}
              <div className="flex-1">
                <div className="h-46 flex items-end gap-2">
                  {telemetry.map((t, idx) => {
                    const isHovered =
                      hoveredBarIdx === idx ||
                      (hoveredBarIdx === null && idx === telemetry.length - 1);

                    const totalRatio =
                      chartMetricMode === 'tokens'
                        ? Math.max(0.22, Math.min(0.96, t.raw_tokens / maxRawTokens))
                        : Math.max(0.22, Math.min(0.96, t.latency_ms / maxLatency));

                    const distilledRatio = Math.max(
                      0.08,
                      Math.min(0.22, t.distilled_tokens / maxRawTokens)
                    );

                    return (
                      <button
                        key={t.id || idx}
                        type="button"
                        onMouseEnter={() => setHoveredBarIdx(idx)}
                        onMouseLeave={() => setHoveredBarIdx(null)}
                        onFocus={() => setHoveredBarIdx(idx)}
                        className={`flex-1 h-full rounded-t-full flex flex-col justify-end overflow-hidden transition-opacity cursor-pointer ${
                          isHovered ? 'ring-1 ring-emerald-400/60' : 'opacity-90 hover:opacity-100'
                        }`}
                        style={{ backgroundColor: 'var(--bg-elevated)' }}
                        aria-label={`Query ${idx + 1}: ${t.raw_tokens} raw tokens compressed to ${t.distilled_tokens} tokens`}
                      >
                        <div
                          className="w-full flex flex-col justify-end rounded-t-full overflow-hidden transition-all duration-200"
                          style={{ height: `${Math.round(totalRatio * 100)}%` }}
                        >
                          {/* Top Cap (Distilled Context or Overhead) */}
                          <div
                            className={idx % 5 === 4 ? 'reui-stripe-rose' : 'reui-stripe-amber'}
                            style={{ height: `${Math.max(8, Math.round(distilledRatio * 100))}%` }}
                          />
                          {/* Main Striped Emerald Body (Tokens Saved / Fast Recall) */}
                          <div className="flex-1 w-full reui-stripe-emerald" />
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* X-Axis Timestamps */}
                <div
                  className="flex items-center justify-between pt-2 text-[11px] font-mono-data"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <span>18:00</span>
                  <span>22:00</span>
                  <span>02:00</span>
                  <span>06:00</span>
                  <span>10:00</span>
                  <span>Now</span>
                </div>
              </div>
            </div>
          </div>

          {/* Fixed-Height Inspector Footer (Prevents any layout shift on bar hover) */}
          <div
            className="mt-4 h-9 px-3 rounded-[4px] hairline-border flex items-center justify-between gap-3 text-xs"
            style={{ backgroundColor: 'var(--bg-elevated)' }}
          >
            {inspectedItem ? (
              <>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="px-1.5 py-0.5 rounded-[3px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-mono-data text-[10px] font-semibold shrink-0">
                    -{Math.round((1 - inspectedItem.distilled_tokens / Math.max(1, inspectedItem.raw_tokens)) * 100)}%
                  </span>
                  <span className="truncate font-mono-data text-[11px]" style={{ color: 'var(--text-primary)' }}>
                    &ldquo;{inspectedItem.query}&rdquo;
                  </span>
                </div>
                <div className="font-mono-data text-[11px] shrink-0" style={{ color: 'var(--text-secondary)' }}>
                  {inspectedItem.raw_tokens} →{' '}
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                    {inspectedItem.distilled_tokens} tok
                  </span>{' '}
                  • {inspectedItem.latency_ms}ms
                </div>
              </>
            ) : (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Hover any bar to inspect query compression telemetry
              </span>
            )}
          </div>
        </div>

        {/* Right 4 Cols: Procedural Directives & Guardrails ("Needs Attention" ReUI Signal style) */}
        <div className="lg:col-span-4 reui-card p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between gap-2 pb-4">
              <div>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Procedural Guardrails
                </h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  {proceduralRules.length} priority directives, anti-patterns first
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigateTab('explorer')}
                className="text-[11px] font-mono-data hover:underline cursor-pointer"
                style={{ color: 'var(--text-secondary)' }}
              >
                View all
              </button>
            </div>

            <div className="divide-y divide-[var(--border-hairline)]">
              {proceduralRules.slice(0, 5).map((rule) => {
                const isAntiPattern = rule.content.includes('[ANTI-PATTERN]');
                const cleanTitle = rule.content
                  .replace('[ANTI-PATTERN]', '')
                  .replace('[RULE]', '')
                  .trim();

                return (
                  <div
                    key={rule.id}
                    className="py-3 flex items-center justify-between gap-3 group"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className="w-7 h-7 rounded-[4px] hairline-border flex items-center justify-center shrink-0"
                        style={{ backgroundColor: 'var(--bg-elevated)' }}
                      >
                        {isAntiPattern ? (
                          <ShieldAlert className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                        ) : (
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="font-mono-data text-xs font-semibold truncate"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {rule.id}
                          </span>
                          {isAntiPattern ? (
                            <span className="px-1.5 py-0.2 rounded-[3px] text-[10px] font-medium bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/25 shrink-0">
                              Anti-Pattern
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.2 rounded-[3px] text-[10px] font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25 shrink-0">
                              Pinned Rule
                            </span>
                          )}
                        </div>
                        <p
                          className="text-[11px] truncate mt-0.5"
                          style={{ color: 'var(--text-secondary)' }}
                          title={cleanTitle}
                        >
                          {cleanTitle}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onTogglePin(rule)}
                      className="w-7 h-7 rounded-[4px] hairline-border flex items-center justify-center shrink-0 hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
                      style={{
                        color:
                          rule.is_pinned === 1
                            ? 'var(--accent-teal)'
                            : 'var(--text-secondary)',
                      }}
                      title={
                        rule.is_pinned === 1
                          ? 'Pinned to Core Directives (Click to Unpin)'
                          : 'Pin to Core Directives'
                      }
                    >
                      <Pin className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigateTab('explorer')}
            className="mt-3 w-full py-2 rounded-[4px] reui-btn-secondary text-xs flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <span>Manage All Procedural Rules</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Row 3: ReUI Signal "Hybrid Retrieval & Scoring Matrix" (Campaign Performance 6-column divided strip style) */}
      <div className="reui-card overflow-hidden">
        <div className="p-4 hairline-border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Hybrid Retrieval &amp; Scoring Performance
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {stats.active_memories} active memories •{' '}
              <span className="text-emerald-600 dark:text-emerald-400">
                {stats.pinned_memories} core directives
              </span>{' '}
              •{' '}
              <span className="text-rose-600 dark:text-rose-400">
                {stats.superseded_memories} superseded versions
              </span>{' '}
              • sqlite-vec WAL
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onNavigateTab('playground')}
              className="h-8 px-3 reui-btn-secondary text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <span>Test Recall</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('explorer')}
              className="h-8 px-3 reui-btn-primary text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <span>Explore Ledger</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 6-Column Divided Metric Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-[var(--border-hairline)]">
          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Raw Context
            </div>
            <div className="font-mono-data text-xl font-bold">
              {(stats.token_efficiency.raw_tokens_total / 1000).toFixed(1)}K
            </div>
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              100% baseline tokens
            </div>
          </div>

          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Distilled Output
            </div>
            <div className="font-mono-data text-xl font-bold">
              {(stats.token_efficiency.distilled_tokens_total / 1000).toFixed(1)}K
            </div>
            <div className="text-[11px] font-mono-data text-emerald-600 dark:text-emerald-400">
              -{stats.token_efficiency.compression_savings_pct}% compressed
            </div>
          </div>

          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Vector Weight
            </div>
            <div className="font-mono-data text-xl font-bold">0.55</div>
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Cosine similarity
            </div>
          </div>

          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Graph Boost
            </div>
            <div className="font-mono-data text-xl font-bold">0.20</div>
            <div className="text-[11px] font-mono-data text-violet-600 dark:text-violet-400">
              +1-hop entity BFS
            </div>
          </div>

          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Recency Decay
            </div>
            <div className="font-mono-data text-xl font-bold">0.15</div>
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Exponential λ=0.01
            </div>
          </div>

          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Confidence Weight
            </div>
            <div className="font-mono-data text-xl font-bold">0.10</div>
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Target &ge; 0.85
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
