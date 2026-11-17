import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDownRight,
  BarChart3,
  Coins,
  Cpu,
  Download,
  Eye,
  FlaskConical,
  Layers,
  MoreHorizontal,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import { engramApi } from '../api/client';
import { Dictionary } from '../i18n';
import {
  AnalyticsSummaryResponse,
  AnalyticsTelemetryRun,
  ModelPricingProfileId,
  TabId,
} from '../types/engram';
import {
  buildAnalyticsCsv,
  filterAnalyticsRuns,
  MODEL_PRICING_PROFILES,
} from '../utils/analytics';
import { paginateItems } from '../utils/pagination';
import { CustomSelect } from './ui/CustomSelect';
import { TablePagination } from './ui/TablePagination';

interface AnalyticsTabProps {
  activeWorkspace: string;
  workspaces: string[];
  dict: Dictionary;
  onSelectWorkspace: (ws: string) => void;
  onNavigateTab: (tab: TabId) => void;
}

const SESSION_TURN_PRESETS = [10, 20, 30, 50] as const;

export const AnalyticsTab: React.FC<AnalyticsTabProps> = ({
  activeWorkspace,
  workspaces,
  dict,
  onSelectWorkspace,
  onNavigateTab,
}) => {
  const [modelId, setModelId] = useState<ModelPricingProfileId>('claude_sonnet_4');
  const [sessionTurns, setSessionTurns] = useState<number>(20);
  const [summary, setSummary] = useState<AnalyticsSummaryResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [runWsFilter, setRunWsFilter] = useState<string>('all');
  const [pageSize, setPageSize] = useState<string>('5');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [selectedRun, setSelectedRun] = useState<AnalyticsTelemetryRun | null>(null);

  // Sticky Actions column shadow & single popover state
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [showActionsShadow, setShowActionsShadow] = useState(false);
  const [actionMenuState, setActionMenuState] = useState<{
    run: AnalyticsTelemetryRun;
    top: number;
    left: number;
    openUp: boolean;
  } | null>(null);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const data = await engramApi.getTokenAnalytics({
        workspace: activeWorkspace,
        modelId,
        sessionTurns,
      });
      setSummary(data);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, modelId, sessionTurns]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  useEffect(() => {
    setRunWsFilter('all');
    setCurrentPage(1);
  }, [activeWorkspace]);

  useEffect(() => {
    setCurrentPage(1);
  }, [runWsFilter, searchQuery]);

  const modelOptions = useMemo(
    () =>
      MODEL_PRICING_PROFILES.map((m) => ({
        value: m.id,
        label: m.label,
        badge: m.badge,
      })),
    []
  );

  const filteredRuns = useMemo(
    () =>
      filterAnalyticsRuns(summary?.recent_runs ?? [], {
        workspace: runWsFilter,
        search: searchQuery,
      }),
    [summary, runWsFilter, searchQuery]
  );

  const pagination = useMemo(
    () => paginateItems(filteredRuns, currentPage, Number(pageSize) || 5),
    [filteredRuns, currentPage, pageSize]
  );

  const updateActionsShadow = useCallback(() => {
    const el = tableScrollRef.current;
    if (!el) return;
    const remainingRight = el.scrollWidth - (el.scrollLeft + el.clientWidth);
    setShowActionsShadow(el.scrollWidth > el.clientWidth + 2 && remainingRight > 2);
  }, []);

  useEffect(() => {
    updateActionsShadow();
    window.addEventListener('resize', updateActionsShadow);
    return () => window.removeEventListener('resize', updateActionsShadow);
  }, [updateActionsShadow, pagination.items.length]);

  useEffect(() => {
    if (!actionMenuState) return;
    const handleOutside = () => setActionMenuState(null);
    window.addEventListener('click', handleOutside);
    window.addEventListener('scroll', handleOutside, true);
    return () => {
      window.removeEventListener('click', handleOutside);
      window.removeEventListener('scroll', handleOutside, true);
    };
  }, [actionMenuState]);

  const handleExportCsv = () => {
    if (!summary) return;
    const csv = buildAnalyticsCsv(filteredRuns, summary.model_label);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `engram-token-analytics-${activeWorkspace}-${summary.model_id}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const totals = summary?.totals;
  const projection = summary?.session_projection;
  const maxProjTokens = Math.max(1, projection?.without_engram_tokens ?? 1);
  const withEngramBarPct = projection
    ? Math.max(6, Math.round((projection.with_engram_tokens / maxProjTokens) * 100))
    : 22;

  return (
    <div className="space-y-4 pb-6">
      {/* Top Signal Header + 4-Cell Segmented KPI Strip */}
      <div className="reui-card overflow-hidden">
        <div
          className="px-4 py-3.5 hairline-border-b flex flex-col lg:flex-row lg:items-center justify-between gap-3"
          style={{ backgroundColor: 'var(--bg-elevated)' }}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
              <h1 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                {dict.analytics.title}
              </h1>
              <span
                className="font-mono-data text-[10px] px-1.5 py-0.5 rounded-[3px] hairline-border"
                style={{ color: 'var(--text-secondary)' }}
              >
                {summary ? `$${summary.input_price_per_1m.toFixed(2)}/1M input` : '$3.00/1M input'}
              </span>
            </div>
            <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {dict.analytics.subtitle}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="w-60">
              <CustomSelect
                ariaLabel="LLM Cost Pricing Model"
                value={modelId}
                options={modelOptions}
                onChange={(val) => setModelId(val as ModelPricingProfileId)}
                icon={<Cpu className="w-3.5 h-3.5" />}
                size="xs"
                mono
              />
            </div>

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={!summary || filteredRuns.length === 0}
              data-testid="export-analytics-csv-btn"
              className="h-7 px-3 reui-btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{dict.analytics.exportCsvBtn}</span>
            </button>

            <button
              type="button"
              onClick={loadAnalytics}
              disabled={loading}
              data-testid="refresh-analytics-btn"
              className="h-7 px-3 reui-btn-primary text-xs flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{dict.analytics.refreshBtn}</span>
            </button>
          </div>
        </div>

        {/* 4-Cell Segmented KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-[var(--border-hairline)]">
          {/* Cell 1: Total Tokens Saved */}
          <div className="p-4 space-y-2">
            <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
              <span>{dict.analytics.kpi.tokensSaved}</span>
              <span
                className="font-mono-data font-bold text-emerald-600 dark:text-emerald-400"
                data-testid="analytics-kpi-tokens-saved"
              >
                {(totals?.tokens_saved_total ?? 0).toLocaleString()}
              </span>
            </div>
            <div className="h-2 w-full rounded-[2px] reui-hatch-track overflow-hidden">
              <div
                className="h-full reui-stripe-emerald transition-all duration-300"
                style={{ width: `${Math.min(100, totals?.compression_savings_pct ?? 0)}%` }}
              />
            </div>
            <div className="font-mono-data text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {totals?.distilled_tokens_total.toLocaleString() ?? 0} sent vs{' '}
              {totals?.raw_tokens_total.toLocaleString() ?? 0} raw
            </div>
          </div>

          {/* Cell 2: Estimated USD Saved */}
          <div className="p-4 space-y-1">
            <div className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
              <Coins className="w-3.5 h-3.5 text-amber-500" />
              <span>{dict.analytics.kpi.costSaved}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className="font-mono-data text-xl font-bold text-emerald-600 dark:text-emerald-400"
                data-testid="analytics-kpi-usd-saved"
              >
                ${(totals?.estimated_usd_saved ?? 0).toFixed(4)}
              </span>
              <span className="font-mono-data text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {summary?.model_label ?? 'Claude Sonnet 4'}
              </span>
            </div>
            <div className="font-mono-data text-[10px]" style={{ color: 'var(--text-muted)' }}>
              ${(totals?.distilled_cost_usd ?? 0).toFixed(4)} vs ${(totals?.raw_cost_usd ?? 0).toFixed(4)} unpruned
            </div>
          </div>

          {/* Cell 3: Compression Ratio & Speed */}
          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {dict.analytics.kpi.compression}
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className="font-mono-data text-xl font-bold"
                data-testid="analytics-kpi-compression"
              >
                {totals?.compression_savings_pct ?? 0}%
              </span>
              <span className="font-mono-data text-[10px] text-emerald-600 dark:text-emerald-400">
                {totals?.avg_latency_ms ?? 0}ms avg
              </span>
            </div>
            <div className="font-mono-data text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {totals?.total_queries ?? 0} recall runs • {totals?.directive_baseline_tokens ?? 0} baseline tok
            </div>
          </div>

          {/* Cell 4: Short-Session ROI */}
          <div className="p-4 space-y-1">
            <div className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
              <TrendingUp className="w-3.5 h-3.5 text-sky-500" />
              <span>{dict.analytics.kpi.sessionRoi}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className="font-mono-data text-xl font-bold text-sky-600 dark:text-sky-400"
                data-testid="analytics-kpi-session-roi"
              >
                -{projection?.savings_pct ?? 0}%
              </span>
              <span className="font-mono-data text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {sessionTurns} turns
              </span>
            </div>
            <div className="font-mono-data text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {((projection?.saved_tokens ?? 0) / 1000).toFixed(1)}K tokens avoided per session
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Short-Session Bloat Simulator (7 cols) + Workspace Cost Breakdown (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left 7 Cols: Context Bloat Simulator */}
        <div className="lg:col-span-7 reui-card flex flex-col justify-between overflow-hidden">
          <div className="px-4 py-3 hairline-border-b flex flex-col sm:flex-row sm:items-center justify-between gap-2.5" style={{ backgroundColor: 'var(--bg-elevated)' }}>
            <div className="min-w-0">
              <h2 className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span>{dict.analytics.simulator.title}</span>
              </h2>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                {dict.analytics.simulator.subtitle}
              </p>
            </div>

            <div className="flex items-center gap-1 shrink-0" role="group" aria-label={dict.analytics.simulator.turnsLabel}>
              {SESSION_TURN_PRESETS.map((turns) => {
                const active = sessionTurns === turns;
                return (
                  <button
                    key={turns}
                    type="button"
                    onClick={() => setSessionTurns(turns)}
                    data-testid={`session-turns-${turns}`}
                    className={`px-2.5 py-1 rounded-[4px] font-mono-data text-[11px] font-medium transition-colors cursor-pointer ${
                      active ? 'reui-btn-primary' : 'reui-btn-secondary'
                    }`}
                  >
                    {turns}t
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-4 space-y-4">
            {/* Bar 1: Without Engram (Quadratic Bloat) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                  {dict.analytics.simulator.withoutLabel}
                </span>
                <span className="font-mono-data text-xs text-rose-600 dark:text-rose-400 font-semibold" data-testid="projection-without-tokens">
                  {(projection?.without_engram_tokens ?? 0).toLocaleString()} tok • $
                  {(projection?.without_engram_cost_usd ?? 0).toFixed(4)}
                </span>
              </div>
              <div className="h-3.5 w-full rounded-[3px] reui-hatch-track overflow-hidden">
                <div className="h-full reui-stripe-rose w-full transition-all duration-300" />
              </div>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Re-sending unpruned chat transcript + full reference snippets on all {sessionTurns} turns (O(N²) input token growth).
              </p>
            </div>

            {/* Bar 2: With Engram Short Session + Distiller */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                  <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                  <span>{dict.analytics.simulator.withLabel}</span>
                </span>
                <span className="font-mono-data text-xs text-emerald-600 dark:text-emerald-400 font-semibold" data-testid="projection-with-tokens">
                  {(projection?.with_engram_tokens ?? 0).toLocaleString()} tok • $
                  {(projection?.with_engram_cost_usd ?? 0).toFixed(4)}
                </span>
              </div>
              <div className="h-3.5 w-full rounded-[3px] reui-hatch-track overflow-hidden">
                <div
                  className="h-full reui-stripe-emerald transition-all duration-300"
                  style={{ width: `${withEngramBarPct}%` }}
                />
              </div>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Lean <code className="font-mono-data">core-directives</code> ({totals?.directive_baseline_tokens ?? 0} tok) + selective distilled{' '}
                <code className="font-mono-data">hybrid_recall</code> + compact sliding window (O(N) linear footprint).
              </p>
            </div>

            {/* Summary Callout Strip */}
            <div
              className="p-3 rounded-[4px] hairline-border flex flex-wrap items-center justify-between gap-2 text-xs"
              style={{ backgroundColor: 'var(--bg-elevated)' }}
            >
              <span className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                <ArrowDownRight className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>
                  Net savings over <strong style={{ color: 'var(--text-primary)' }}>{sessionTurns} turns</strong> on{' '}
                  <strong style={{ color: 'var(--text-primary)' }}>{summary?.model_label ?? 'Claude Sonnet 4'}</strong>:
                </span>
              </span>
              <span className="font-mono-data font-bold text-emerald-600 dark:text-emerald-400">
                {(projection?.saved_tokens ?? 0).toLocaleString()} tok saved (${(projection?.saved_usd ?? 0).toFixed(4)})
              </span>
            </div>
          </div>
        </div>

        {/* Right 5 Cols: Workspace Breakdown */}
        <div className="lg:col-span-5 reui-card flex flex-col justify-between overflow-hidden">
          <div className="px-4 py-3 hairline-border-b flex items-center justify-between gap-2" style={{ backgroundColor: 'var(--bg-elevated)' }}>
            <div>
              <h2 className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                <Layers className="w-3.5 h-3.5 text-sky-500" />
                <span>{dict.analytics.workspaceTitle}</span>
              </h2>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                {dict.analytics.workspaceSubtitle}
              </p>
            </div>
          </div>

          <div className="p-4 space-y-3 flex-1">
            {(summary?.workspace_breakdown ?? []).length === 0 ? (
              <div className="py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                No workspace recall telemetry recorded yet.
              </div>
            ) : (
              (summary?.workspace_breakdown ?? []).map((ws) => (
                <button
                  key={ws.workspace}
                  type="button"
                  onClick={() => onSelectWorkspace(ws.workspace)}
                  className="w-full text-left p-2.5 rounded-[4px] hairline-border hover:bg-[var(--bg-elevated)] transition-colors space-y-1.5 cursor-pointer"
                  style={{ backgroundColor: 'var(--bg-surface)' }}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`px-1.5 py-0.5 rounded-[3px] font-mono-data text-[10px] border ${
                          ws.workspace === 'global'
                            ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25'
                            : 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/25'
                        }`}
                      >
                        {ws.workspace}
                      </span>
                      <span className="font-mono-data text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {ws.queries} runs • {ws.avg_latency_ms}ms
                      </span>
                    </div>
                    <span className="font-mono-data text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      -{ws.savings_pct}% (${ws.estimated_usd_saved.toFixed(4)})
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-[2px] reui-hatch-track overflow-hidden">
                    <div
                      className="h-full reui-stripe-emerald"
                      style={{ width: `${Math.min(100, ws.savings_pct)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between font-mono-data text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    <span>{ws.raw_tokens.toLocaleString()} raw → {ws.distilled_tokens.toLocaleString()} distilled</span>
                    <span>{ws.tokens_saved.toLocaleString()} saved</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Row 3: Recall Telemetry & Savings Ledger Table */}
      <div className="reui-card overflow-hidden">
        <div
          className="px-4 py-2.5 hairline-border-b flex flex-col lg:flex-row lg:items-center justify-between gap-2.5"
          style={{ backgroundColor: 'var(--bg-elevated)' }}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {['all', ...workspaces.filter((w) => w !== 'all')].map((ws) => {
              const active = runWsFilter === ws;
              return (
                <button
                  key={ws}
                  type="button"
                  onClick={() => setRunWsFilter(ws)}
                  className={`px-2.5 py-1 rounded-[4px] text-[11px] font-medium font-mono-data transition-colors cursor-pointer ${
                    active ? 'reui-btn-primary' : 'reui-btn-secondary'
                  }`}
                >
                  {ws === 'all' ? 'All Runs' : ws}
                </button>
              );
            })}
          </div>

          <div className="relative w-full lg:w-72">
            <Search
              className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-muted)' }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={dict.analytics.searchPlaceholder}
              className="w-full h-7 pl-8 pr-7 rounded-[4px] hairline-border text-xs focus:outline-none focus:border-[var(--border-focus)]"
              style={{
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-primary)',
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:opacity-80 cursor-pointer"
                aria-label="Clear telemetry filter"
              >
                <X className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Table with Sticky Right Actions Column & Scroll-Aware Shadow */}
        <div
          ref={tableScrollRef}
          onScroll={updateActionsShadow}
          className="overflow-x-auto relative"
          data-testid="analytics-table-scroll"
        >
          <table className="w-full min-w-[1160px] text-left border-separate border-spacing-0">
            <thead>
              <tr
                className="text-[11px] font-medium whitespace-nowrap"
                style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
              >
                <th className="py-2.5 px-3 hairline-border-b">Run ID</th>
                <th className="py-2.5 px-3 hairline-border-b">Workspace</th>
                <th className="py-2.5 px-3 min-w-[380px] hairline-border-b">Agent Recall Query</th>
                <th className="py-2.5 px-3 hairline-border-b">Raw → Distilled</th>
                <th className="py-2.5 px-3 hairline-border-b">Compression</th>
                <th className="py-2.5 px-3 hairline-border-b">USD Saved</th>
                <th className="py-2.5 px-3 hairline-border-b">Latency</th>
                <th
                  className="sticky right-0 z-10 py-2.5 px-3 text-center w-[72px] hairline-border-b transition-shadow duration-150"
                  data-pinned-shadow={showActionsShadow ? 'visible' : 'hidden'}
                  style={{
                    backgroundColor: 'var(--bg-elevated)',
                    borderLeft: '1px solid var(--border-hairline)',
                    boxShadow: showActionsShadow ? 'var(--sticky-col-shadow)' : 'none',
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute top-0 bottom-0 -left-5 w-5 transition-opacity duration-150"
                    style={{
                      opacity: showActionsShadow ? 1 : 0,
                      background: 'linear-gradient(to left, var(--sticky-col-fade), transparent)',
                    }}
                  />
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="text-xs">
              {pagination.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="py-12 px-4 text-center text-xs"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {dict.analytics.empty}
                  </td>
                </tr>
              ) : (
                pagination.items.map((run) => {
                  const isSelected = selectedRun?.id === run.id;
                  const isMenuOpen = actionMenuState?.run.id === run.id;

                  return (
                    <tr
                      key={run.id}
                      onClick={() => setSelectedRun(run)}
                      className="transition-colors hover:bg-[var(--bg-elevated)]/60 cursor-pointer"
                      style={{
                        backgroundColor: isSelected ? 'var(--bg-elevated)' : 'transparent',
                      }}
                    >
                      <td className="py-2.5 px-3 whitespace-nowrap font-mono-data text-[11px] hairline-border-b">
                        #{run.id}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap hairline-border-b">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded-[3px] font-mono-data text-[11px] border ${
                            run.workspace === 'global'
                              ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25'
                              : 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/25'
                          }`}
                        >
                          {run.workspace}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 max-w-[440px] hairline-border-b">
                        <div className="truncate font-medium" style={{ color: 'var(--text-primary)' }} title={run.query}>
                          {run.query}
                        </div>
                        <div className="font-mono-data text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {new Date(run.created_at).toLocaleString()}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap font-mono-data text-[11px] hairline-border-b">
                        <span>{run.raw_tokens.toLocaleString()}</span>
                        <span className="mx-1.5" style={{ color: 'var(--text-muted)' }}>→</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {run.distilled_tokens.toLocaleString()}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap hairline-border-b">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-[3px] font-mono-data text-[10px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                          -{run.savings_pct}% ({run.tokens_saved.toLocaleString()})
                        </span>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap font-mono-data text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hairline-border-b">
                        ${run.usd_saved.toFixed(5)}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap font-mono-data text-[11px] hairline-border-b">
                        {run.latency_ms}ms
                      </td>

                      {/* Sticky Right Actions Column */}
                      <td
                        className="sticky right-0 z-10 py-2.5 px-3 text-center whitespace-nowrap hairline-border-b transition-shadow duration-150"
                        style={{
                          backgroundColor: isSelected ? 'var(--bg-elevated)' : 'var(--bg-surface)',
                          borderLeft: '1px solid var(--border-hairline)',
                          boxShadow: showActionsShadow ? 'var(--sticky-col-shadow)' : 'none',
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute top-0 bottom-0 -left-5 w-5 transition-opacity duration-150"
                          style={{
                            opacity: showActionsShadow ? 1 : 0,
                            background: 'linear-gradient(to left, var(--sticky-col-fade), transparent)',
                          }}
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isMenuOpen) {
                              setActionMenuState(null);
                              return;
                            }
                            const rect = e.currentTarget.getBoundingClientRect();
                            const openUp = window.innerHeight - rect.bottom < 160;
                            setActionMenuState({
                              run,
                              top: openUp ? rect.top - 6 : rect.bottom + 6,
                              left: Math.min(window.innerWidth - 220, Math.max(12, rect.right - 204)),
                              openUp,
                            });
                          }}
                          aria-label={`Actions for telemetry run ${run.id}`}
                          aria-haspopup="menu"
                          aria-expanded={isMenuOpen}
                          className={`w-7 h-7 rounded-[4px] inline-flex items-center justify-center transition-colors cursor-pointer ${
                            isMenuOpen ? 'bg-[var(--bg-elevated)] hairline-border' : 'hover:bg-[var(--bg-elevated)]'
                          }`}
                          style={{ color: 'var(--text-secondary)' }}
                          title="Run Actions"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          currentPage={pagination.currentPage}
          totalPages={pagination.totalPages}
          totalItems={pagination.totalItems}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          onPageSizeChange={(val) => {
            setPageSize(val);
            setCurrentPage(1);
          }}
          testIdPrefix="analytics"
        />
      </div>

      {/* Single Floating Popover Menu */}
      {actionMenuState && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-52 rounded-lg hairline-border shadow-xl py-1 text-xs"
          style={{
            top: actionMenuState.top,
            left: actionMenuState.left,
            transform: actionMenuState.openUp ? 'translateY(-100%)' : 'none',
            backgroundColor: 'var(--bg-surface)',
            color: 'var(--text-primary)',
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const target = actionMenuState.run;
              setActionMenuState(null);
              setSelectedRun(target);
            }}
            className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5 text-sky-500" />
            <span>Inspect Cost Breakdown</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const targetWs = actionMenuState.run.workspace;
              setActionMenuState(null);
              onSelectWorkspace(targetWs);
              onNavigateTab('playground');
            }}
            className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
          >
            <FlaskConical className="w-3.5 h-3.5 text-emerald-500" />
            <span>Re-run in Playground</span>
          </button>
        </div>
      )}

      {/* Floating Rounded-2xl Cost Breakdown Drawer (Tight 8px p-2 Margin, Flush Right Scrollbar) */}
      <AnimatePresence>
        {selectedRun && (
          <motion.div
            key="analytics-run-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex justify-end p-2 bg-black/50 backdrop-blur-[2px]"
            onClick={() => setSelectedRun(null)}
          >
            <motion.div
              key="analytics-run-panel"
              role="dialog"
              aria-label="Inspect Recall Cost Breakdown"
              initial={{ x: 480, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 480, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 34, mass: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[460px] h-full rounded-2xl hairline-border shadow-2xl flex flex-col justify-between overflow-hidden"
              style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
            >
              {/* Header */}
              <div className="px-5 pt-4 pb-3.5 hairline-border-b flex items-center justify-between gap-3 shrink-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-[3px] font-mono-data text-[10px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                      -{selectedRun.savings_pct}% SAVED
                    </span>
                    <span className="font-mono-data text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      Run #{selectedRun.id} • ws:{selectedRun.workspace}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold mt-1.5 truncate">Recall Token &amp; Cost Breakdown</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedRun(null)}
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer shrink-0"
                  aria-label="Close cost breakdown drawer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Scrollable Body (Flush Right Scrollbar) */}
              <div
                className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs"
                data-testid="analytics-inspector-scroll"
              >
                <div className="space-y-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    Agent Query Prompt
                  </span>
                  <div
                    className="p-3.5 rounded-xl hairline-border leading-relaxed"
                    style={{ backgroundColor: 'var(--bg-elevated)' }}
                  >
                    {selectedRun.query}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3.5 rounded-xl border border-rose-500/30 bg-rose-500/5 space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                      Raw Unpruned
                    </div>
                    <div className="font-mono-data text-lg font-bold">
                      {selectedRun.raw_tokens.toLocaleString()} tok
                    </div>
                    <div className="font-mono-data text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      ${selectedRun.raw_cost_usd.toFixed(5)} USD
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                      Distilled Output
                    </div>
                    <div className="font-mono-data text-lg font-bold">
                      {selectedRun.distilled_tokens.toLocaleString()} tok
                    </div>
                    <div className="font-mono-data text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      ${selectedRun.distilled_cost_usd.toFixed(5)} USD
                    </div>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl hairline-border space-y-2" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--text-secondary)' }}>Pricing Tier</span>
                    <span className="font-mono-data font-semibold">
                      {summary?.model_label} (${summary?.input_price_per_1m.toFixed(2)}/1M)
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--text-secondary)' }}>Net Tokens Saved</span>
                    <span className="font-mono-data font-semibold text-emerald-600 dark:text-emerald-400">
                      {selectedRun.tokens_saved.toLocaleString()} tok (-{selectedRun.savings_pct}%)
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--text-secondary)' }}>Net Cost Saved (This Call)</span>
                    <span className="font-mono-data font-semibold text-emerald-600 dark:text-emerald-400">
                      ${selectedRun.usd_saved.toFixed(5)} USD
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--text-secondary)' }}>1,000x Monthly Scale Projection</span>
                    <span className="font-mono-data font-semibold">
                      ${(selectedRun.usd_saved * 1000).toFixed(2)} USD / 1k calls
                    </span>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div
                className="px-5 py-3.5 hairline-border-t flex items-center justify-between gap-2 shrink-0"
                style={{ backgroundColor: 'var(--bg-elevated)' }}
              >
                <button
                  type="button"
                  onClick={() => setSelectedRun(null)}
                  className="px-3 py-1.5 reui-btn-secondary text-xs cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const targetWs = selectedRun.workspace;
                    setSelectedRun(null);
                    onSelectWorkspace(targetWs);
                    onNavigateTab('playground');
                  }}
                  className="px-3.5 py-1.5 reui-btn-primary text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <FlaskConical className="w-3.5 h-3.5" />
                  <span>Open in Playground</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
