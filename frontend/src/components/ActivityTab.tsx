import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  Eye,
  Filter,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Webhook,
  X,
} from 'lucide-react';
import { engramApi } from '../api/client';
import { Dictionary } from '../i18n';
import {
  WorkerActivityResponse,
  WorkerJobRecord,
  WorkerJobStatus,
  WorkerJobType,
} from '../types/engram';
import {
  computeActivitySummary,
  extractMemoriesFromTranscriptText,
  filterWorkerJobs,
  JobTypeFilter,
} from '../utils/activity';
import { paginateItems } from '../utils/pagination';
import { CustomSelect } from './ui/CustomSelect';
import { TablePagination } from './ui/TablePagination';

interface ActivityTabProps {
  activeWorkspace: string;
  workspaces: string[];
  dict: Dictionary;
  onRefresh: () => Promise<void>;
  onSelectWorkspace?: (workspace: string) => void;
}

const DEFAULT_SAMPLE_TRANSCRIPT =
  'user: Always require idempotency keys for stripe webhook handlers in payment workers.\n' +
  'assistant: Confirmed. Also tested API staging token sk-proj-99887766554433221100aabbccddeeff before rotating.\n' +
  'user: Never drop vector indexes during hot production migrations without WAL snapshots.';

function formatShortTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().replace('T', ' ').slice(0, 19);
  } catch {
    return iso;
  }
}

export const ActivityTab: React.FC<ActivityTabProps> = ({
  activeWorkspace,
  workspaces,
  dict,
  onRefresh,
  onSelectWorkspace,
}) => {
  const [activity, setActivity] = useState<WorkerActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobTypeFilter, setJobTypeFilter] = useState<JobTypeFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [pageSize, setPageSize] = useState<string>('5');
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Action states
  const [sweepingTtl, setSweepingTtl] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Sticky Actions column shadow & single popover state
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [showActionsShadow, setShowActionsShadow] = useState(false);
  const [actionMenuState, setActionMenuState] = useState<{
    job: WorkerJobRecord;
    top: number;
    left: number;
    openUp: boolean;
  } | null>(null);

  // Floating Drawers (Tight 8px p-2 margin, flush right scrollbar)
  const [inspectedJob, setInspectedJob] = useState<WorkerJobRecord | null>(null);
  const [showIngestDrawer, setShowIngestDrawer] = useState(false);
  const [ingestWorkspace, setIngestWorkspace] = useState(
    activeWorkspace === 'all' ? 'hermes' : activeWorkspace
  );
  const [ingestTranscript, setIngestTranscript] = useState(DEFAULT_SAMPLE_TRANSCRIPT);
  const [submittingIngest, setSubmittingIngest] = useState(false);

  const loadActivity = useCallback(async () => {
    setLoading(true);
    try {
      const data = await engramApi.getWorkerActivity(activeWorkspace, 'all');
      setActivity(data);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    loadActivity();
  }, [loadActivity]);

  useEffect(() => {
    setIngestWorkspace(activeWorkspace === 'all' ? 'hermes' : activeWorkspace);
  }, [activeWorkspace]);

  const updateActionsShadow = useCallback(() => {
    const el = tableScrollRef.current;
    if (!el) return;
    const remainingRight = el.scrollWidth - (el.scrollLeft + el.clientWidth);
    setShowActionsShadow(el.scrollWidth > el.clientWidth + 2 && remainingRight > 2);
  }, []);

  const allJobs = useMemo(() => activity?.jobs ?? [], [activity]);

  const summary = useMemo(() => computeActivitySummary(allJobs), [allJobs]);

  const filteredJobs = useMemo(
    () =>
      filterWorkerJobs(allJobs, {
        workspace: activeWorkspace,
        jobType: jobTypeFilter,
        search: searchQuery,
      }),
    [allJobs, activeWorkspace, jobTypeFilter, searchQuery]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [activeWorkspace, jobTypeFilter, searchQuery]);

  const pagination = useMemo(
    () => paginateItems(filteredJobs, currentPage, Number(pageSize) || 5),
    [filteredJobs, currentPage, pageSize]
  );

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

  const workspaceSelectOptions = useMemo(() => {
    const clean = workspaces.filter((w) => w !== 'all');
    const final = clean.length > 0 ? clean : ['global', 'hermes', 'ops-agent'];
    return final.map((ws) => ({
      value: ws,
      label: ws,
      badge: ws === 'global' ? 'ROOT' : 'WS',
    }));
  }, [workspaces]);

  const previewIngestCandidates = useMemo(
    () => extractMemoriesFromTranscriptText(ingestTranscript),
    [ingestTranscript]
  );

  const previewRedactionsCount = useMemo(
    () => previewIngestCandidates.reduce((acc, item) => acc + item.secrets_redacted, 0),
    [previewIngestCandidates]
  );

  const handleRunTtlSweep = async () => {
    setSweepingTtl(true);
    setStatusMessage(null);
    try {
      const res = await engramApi.runTtlSweep();
      setStatusMessage(
        `TTL sweep finished • ${res.expired_cleaned} expired record(s) removed`
      );
      await loadActivity();
      await onRefresh();
    } finally {
      setSweepingTtl(false);
    }
  };

  const handleTriggerReindex = async () => {
    setReindexing(true);
    setStatusMessage(null);
    try {
      const res = await engramApi.triggerReindex();
      setStatusMessage(
        `Vector re-index complete • target dimension ${res.target_dimension}d`
      );
      await loadActivity();
      await onRefresh();
    } finally {
      setReindexing(false);
    }
  };

  const handleSubmitIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ingestTranscript.trim() || submittingIngest) return;
    setSubmittingIngest(true);
    setStatusMessage(null);
    try {
      const res = await engramApi.simulateWebhookIngest({
        workspace: ingestWorkspace,
        transcript: ingestTranscript,
      });
      setShowIngestDrawer(false);
      setStatusMessage(
        `Queued & processed ${res.job_id} • extracted ${res.extracted_count} memories (${res.secrets_redacted} secrets scrubbed)`
      );
      await loadActivity();
      await onRefresh();
    } finally {
      setSubmittingIngest(false);
    }
  };

  const renderJobTypeBadge = (type: WorkerJobType) => {
    switch (type) {
      case 'ingest_messages':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] font-mono-data font-semibold bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30">
            <Webhook className="w-3 h-3" />
            <span>ingest_messages</span>
          </span>
        );
      case 'store_memory':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] font-mono-data font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
            <Database className="w-3 h-3" />
            <span>store_memory</span>
          </span>
        );
      case 'reindex_all':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] font-mono-data font-semibold bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/30">
            <RefreshCw className="w-3 h-3" />
            <span>reindex_all</span>
          </span>
        );
      case 'ttl_cleanup':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] font-mono-data font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
            <Clock className="w-3 h-3" />
            <span>ttl_cleanup</span>
          </span>
        );
    }
  };

  const renderStatusBadge = (status: WorkerJobStatus) => {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] font-mono-data text-[10px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            completed
          </span>
        );
      case 'running':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] font-mono-data text-[10px] font-semibold bg-sky-500/15 text-sky-700 dark:text-sky-300">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
            running
          </span>
        );
      case 'queued':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] font-mono-data text-[10px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300">
            queued
          </span>
        );
      case 'failed':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] font-mono-data text-[10px] font-semibold bg-rose-500/15 text-rose-700 dark:text-rose-400">
            failed
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Top ReUI Signal Header Card + 4-Cell Segmented KPI Strip */}
      <div className="reui-card overflow-hidden">
        <div
          className="px-4 py-3.5 hairline-border-b flex flex-col lg:flex-row lg:items-center justify-between gap-3"
          style={{ backgroundColor: 'var(--bg-elevated)' }}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
              <h1 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                {dict.activity.title}
              </h1>
              <span className="font-mono-data text-[10px] px-1.5 py-0.5 rounded-[3px] hairline-border" style={{ color: 'var(--text-secondary)' }}>
                asyncio.Queue
              </span>
            </div>
            <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {dict.activity.subtitle}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={loadActivity}
              className="h-7 w-7 reui-btn-secondary flex items-center justify-center cursor-pointer"
              title="Refresh Worker Activity"
              aria-label="Refresh Worker Activity"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <button
              type="button"
              onClick={handleRunTtlSweep}
              disabled={sweepingTtl}
              data-testid="run-ttl-sweep-btn"
              className="h-7 px-2.5 reui-btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
              <span>{sweepingTtl ? dict.activity.runningTtlBtn : dict.activity.runTtlBtn}</span>
            </button>

            <button
              type="button"
              onClick={handleTriggerReindex}
              disabled={reindexing}
              data-testid="trigger-reindex-btn"
              className="h-7 px-2.5 reui-btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-violet-500 dark:text-violet-400 ${reindexing ? 'animate-spin' : ''}`} />
              <span>{dict.activity.reindexBtn}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowIngestDrawer(true)}
              data-testid="open-simulate-ingest-btn"
              className="h-7 px-3 reui-btn-primary text-xs flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Webhook className="w-3.5 h-3.5" />
              <span>{dict.activity.simulateIngestBtn}</span>
            </button>
          </div>
        </div>

        {/* 4-Cell Segmented KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-[var(--border-hairline)]">
          {/* Cell 1: Worker Loop & Queue Depth */}
          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {dict.activity.kpi.workerLoop}
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className="font-mono-data text-xl font-bold flex items-center gap-2"
                data-testid="activity-kpi-loop"
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    activity?.worker_running !== false ? 'bg-emerald-500' : 'bg-rose-500'
                  }`}
                />
                {activity?.worker_running !== false ? 'Running' : 'Stopped'}
              </span>
              <span className="font-mono-data text-xs" style={{ color: 'var(--text-muted)' }}>
                {activity?.queue_depth ?? 0} queued
              </span>
            </div>
          </div>

          {/* Cell 2: Jobs Processed & Speed */}
          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {dict.activity.kpi.jobsProcessed}
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className="font-mono-data text-xl font-bold text-emerald-600 dark:text-emerald-400"
                data-testid="activity-kpi-processed"
              >
                {summary.totalJobs}
              </span>
              <span className="font-mono-data text-xs" style={{ color: 'var(--text-muted)' }}>
                {summary.avgLatencyMs}ms • {summary.successRatePct}% ok
              </span>
            </div>
          </div>

          {/* Cell 3: Auto-Ingest Webhook */}
          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {dict.activity.kpi.webhookStatus}
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className={`font-mono-data text-xl font-bold ${
                  activity?.auto_ingest_enabled !== false
                    ? 'text-sky-600 dark:text-sky-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
                data-testid="activity-kpi-webhook"
              >
                {activity?.auto_ingest_enabled !== false ? '202 Ready' : '403 Locked'}
              </span>
              <span className="font-mono-data text-xs" style={{ color: 'var(--text-muted)' }}>
                {summary.totalSecretsRedacted} redacted
              </span>
            </div>
          </div>

          {/* Cell 4: Re-index & TTL Sweeps */}
          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {dict.activity.kpi.vectorMaintenance}
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className="font-mono-data text-xl font-bold"
                data-testid="activity-kpi-ttl"
              >
                {activity?.ttl_sweeps_count ?? 0} sweeps
              </span>
              <span className="font-mono-data text-xs" style={{ color: 'var(--text-muted)' }}>
                {activity?.expired_cleaned_total ?? 0} expired cleaned
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Inline Status Feedback Banner */}
      {statusMessage && (
        <div
          className="px-3.5 py-2.5 rounded-[4px] hairline-border flex items-center justify-between gap-3 text-xs"
          style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
          data-testid="activity-status-banner"
        >
          <span className="flex items-center gap-2 font-mono-data">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span>{statusMessage}</span>
          </span>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="p-1 rounded hover:bg-[var(--bg-elevated)] cursor-pointer"
            aria-label="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Worker Jobs Ledger Table Card */}
      <div className="reui-card overflow-hidden">
        {/* Filter Tabs + Search Row */}
        <div
          className="px-4 py-2.5 hairline-border-b flex flex-col lg:flex-row lg:items-center justify-between gap-2.5"
          style={{ backgroundColor: 'var(--bg-elevated)' }}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: dict.activity.tabs.all, count: summary.totalJobs },
                {
                  id: 'ingest_messages',
                  label: dict.activity.tabs.ingest_messages,
                  count: summary.countsByType.ingest_messages,
                },
                {
                  id: 'store_memory',
                  label: dict.activity.tabs.store_memory,
                  count: summary.countsByType.store_memory,
                },
                {
                  id: 'reindex_all',
                  label: dict.activity.tabs.reindex_all,
                  count: summary.countsByType.reindex_all,
                },
                {
                  id: 'ttl_cleanup',
                  label: dict.activity.tabs.ttl_cleanup,
                  count: summary.countsByType.ttl_cleanup,
                },
              ] as const
            ).map((tab) => {
              const active = jobTypeFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setJobTypeFilter(tab.id)}
                  className={`px-2.5 py-1 rounded-[4px] text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                    active ? 'reui-btn-primary' : 'reui-btn-secondary'
                  }`}
                >
                  <span className={tab.id === 'all' ? '' : 'font-mono-data'}>{tab.label}</span>
                  <span className="font-mono-data text-[10px] opacity-75">{tab.count}</span>
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
              placeholder={dict.activity.searchPlaceholder}
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
                aria-label="Clear filter"
              >
                <X className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
              </button>
            )}
          </div>
        </div>

        {/* High-Density Scrollable Table with Pinned Right Actions Column & Scroll-Aware Shadow */}
        <div
          ref={tableScrollRef}
          onScroll={updateActionsShadow}
          className="overflow-x-auto relative"
          data-testid="activity-table-scroll"
        >
          <table className="w-full min-w-[940px] text-left border-separate border-spacing-0">
            <thead>
              <tr
                className="text-[11px] font-medium whitespace-nowrap"
                style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
              >
                <th className="py-2.5 px-3 hairline-border-b">Job Type</th>
                <th className="py-2.5 px-3 hairline-border-b">Workspace</th>
                <th className="py-2.5 px-3 min-w-[300px] hairline-border-b">Summary &amp; Payload Detail</th>
                <th className="py-2.5 px-3 hairline-border-b">Status</th>
                <th className="py-2.5 px-3 hairline-border-b">Items / Scrubbed</th>
                <th className="py-2.5 px-3 hairline-border-b">Latency</th>
                <th className="py-2.5 px-3 hairline-border-b">Timestamp</th>
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
                    {dict.activity.empty}
                  </td>
                </tr>
              ) : (
                pagination.items.map((job) => {
                  const isSelected = inspectedJob?.job_id === job.job_id;
                  const isMenuOpen = actionMenuState?.job.job_id === job.job_id;

                  return (
                    <tr
                      key={job.job_id}
                      onClick={() => setInspectedJob(job)}
                      className="transition-colors hover:bg-[var(--bg-elevated)]/60 cursor-pointer"
                      style={{
                        backgroundColor: isSelected ? 'var(--bg-elevated)' : 'transparent',
                      }}
                    >
                      <td className="py-2.5 px-3 whitespace-nowrap hairline-border-b">
                        {renderJobTypeBadge(job.job_type)}
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap hairline-border-b">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded-[3px] font-mono-data text-[11px] border ${
                            job.workspace === 'global'
                              ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25'
                              : 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/25'
                          }`}
                        >
                          {job.workspace}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 max-w-[360px] hairline-border-b">
                        <div className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {job.summary}
                        </div>
                        <div
                          className="font-mono-data text-[10px] truncate mt-0.5"
                          style={{ color: 'var(--text-muted)' }}
                          title={job.detail}
                        >
                          {job.job_id} • {job.detail}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap hairline-border-b">
                        {renderStatusBadge(job.status)}
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap hairline-border-b">
                        <div className="flex items-center gap-1.5 font-mono-data text-[11px]">
                          <span>{job.items_processed} item(s)</span>
                          {job.secrets_redacted > 0 && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[3px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[10px] font-semibold">
                              <ShieldCheck className="w-3 h-3" />
                              {job.secrets_redacted} redacted
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap font-mono-data text-[11px] hairline-border-b">
                        {job.latency_ms.toFixed(1)} ms
                      </td>

                      <td
                        className="py-2.5 px-3 whitespace-nowrap font-mono-data text-[11px] hairline-border-b"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {formatShortTimestamp(job.created_at)}
                      </td>

                      {/* Pinned Sticky Right Actions Column */}
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
                            const openUp = window.innerHeight - rect.bottom < 190;
                            setActionMenuState({
                              job,
                              top: openUp ? rect.top - 6 : rect.bottom + 6,
                              left: Math.min(window.innerWidth - 224, Math.max(12, rect.right - 208)),
                              openUp,
                            });
                          }}
                          aria-label={`Actions for ${job.job_id}`}
                          aria-haspopup="menu"
                          aria-expanded={isMenuOpen}
                          className={`w-7 h-7 rounded-[4px] inline-flex items-center justify-center transition-colors cursor-pointer ${
                            isMenuOpen
                              ? 'bg-[var(--bg-elevated)] hairline-border'
                              : 'hover:bg-[var(--bg-elevated)]'
                          }`}
                          style={{ color: 'var(--text-secondary)' }}
                          title="Open Job Actions"
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
          testIdPrefix="activity"
        />
      </div>

      {/* Fixed Actions Popover Menu */}
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
              setInspectedJob(actionMenuState.job);
              setActionMenuState(null);
            }}
            className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5 text-sky-500" />
            <span>Inspect Job Payload</span>
          </button>

          {onSelectWorkspace && actionMenuState.job.workspace !== 'global' && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onSelectWorkspace(actionMenuState.job.workspace);
                setActionMenuState(null);
              }}
              className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
            >
              <Filter className="w-3.5 h-3.5 text-violet-500" />
              <span>Filter Workspace ({actionMenuState.job.workspace})</span>
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setActionMenuState(null);
              handleRunTtlSweep();
            }}
            className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5 text-amber-500" />
            <span>Re-run TTL Sweep</span>
          </button>
        </div>
      )}

      {/* Floating Rounded-2xl Job Inspector Drawer (Tight 8px p-2 Margin, Flush Right Scrollbar) */}
      <AnimatePresence>
        {inspectedJob && (
          <motion.div
            key="activity-inspector-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex justify-end p-2 bg-black/50 backdrop-blur-[2px]"
            onClick={() => setInspectedJob(null)}
          >
            <motion.div
              key="activity-inspector-panel"
              role="dialog"
              aria-label="Inspect Worker Job"
              initial={{ x: 460, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 460, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 34, mass: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[460px] h-full rounded-2xl hairline-border shadow-2xl flex flex-col justify-between overflow-hidden"
              style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
            >
              {/* Header */}
              <div className="px-5 pt-4 pb-3.5 hairline-border-b flex items-center justify-between gap-3 shrink-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-500 shrink-0" />
                    <h3 className="text-sm font-bold truncate">Worker Job Payload</h3>
                  </div>
                  <p className="font-mono-data text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
                    {inspectedJob.job_id}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectedJob(null)}
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer shrink-0"
                  aria-label="Close job inspector drawer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Scrollable Body (Flush Right Scrollbar) */}
              <div
                className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs"
                data-testid="activity-inspector-scroll"
              >
                <div className="flex items-center justify-between gap-2">
                  {renderJobTypeBadge(inspectedJob.job_type)}
                  {renderStatusBadge(inspectedJob.status)}
                </div>

                <div className="space-y-2.5 pt-2 hairline-border-t">
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--text-secondary)' }}>Target Workspace</span>
                    <span className="font-mono-data font-semibold">{inspectedJob.workspace}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--text-secondary)' }}>Items Processed</span>
                    <span className="font-mono-data font-semibold">{inspectedJob.items_processed}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--text-secondary)' }}>Secrets Scrubbed</span>
                    <span className="font-mono-data font-semibold text-emerald-600 dark:text-emerald-400">
                      {inspectedJob.secrets_redacted} redacted
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--text-secondary)' }}>Execution Latency</span>
                    <span className="font-mono-data font-semibold">
                      {inspectedJob.latency_ms.toFixed(1)} ms
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--text-secondary)' }}>Enqueued At</span>
                    <span className="font-mono-data text-[11px]">
                      {formatShortTimestamp(inspectedJob.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--text-secondary)' }}>Completed At</span>
                    <span className="font-mono-data text-[11px]">
                      {inspectedJob.completed_at ? formatShortTimestamp(inspectedJob.completed_at) : '—'}
                    </span>
                  </div>
                </div>

                <div className="pt-3 hairline-border-t space-y-1.5">
                  <div
                    className="text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Execution Summary
                  </div>
                  <div
                    className="p-3 rounded-xl hairline-border leading-relaxed"
                    style={{ backgroundColor: 'var(--bg-elevated)' }}
                  >
                    {inspectedJob.summary}
                  </div>
                </div>

                <div className="pt-2 space-y-1.5">
                  <div
                    className="text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Raw Worker Payload &amp; Log Detail
                  </div>
                  <pre
                    className="p-3.5 rounded-xl hairline-border font-mono-data text-[11px] whitespace-pre-wrap break-words leading-relaxed"
                    style={{ backgroundColor: 'var(--bg-elevated)' }}
                  >
                    {inspectedJob.detail}
                  </pre>
                </div>
              </div>

              {/* Footer */}
              <div
                className="px-5 py-3.5 hairline-border-t flex items-center justify-end gap-2 shrink-0"
                style={{ backgroundColor: 'var(--bg-elevated)' }}
              >
                <button
                  type="button"
                  onClick={() => setInspectedJob(null)}
                  className="px-3.5 py-1.5 reui-btn-secondary text-xs cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Rounded-2xl Simulate Transcript Ingest Drawer (Tight 8px p-2 Margin, Flush Right Scrollbar) */}
      <AnimatePresence>
        {showIngestDrawer && (
          <motion.div
            key="activity-ingest-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex justify-end p-2 bg-black/50 backdrop-blur-[2px]"
            onClick={() => setShowIngestDrawer(false)}
          >
            <motion.form
              key="activity-ingest-panel"
              role="dialog"
              aria-label="Simulate Transcript Ingest"
              initial={{ x: 480, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 480, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 34, mass: 0.9 }}
              onSubmit={handleSubmitIngest}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[480px] h-full rounded-2xl hairline-border shadow-2xl flex flex-col justify-between overflow-hidden"
              style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
            >
              {/* Header */}
              <div className="px-5 pt-4 pb-3.5 hairline-border-b flex items-center justify-between gap-3 shrink-0">
                <div>
                  <div className="flex items-center gap-2">
                    <Webhook className="w-4 h-4 text-sky-500" />
                    <h3 className="text-sm font-bold">Simulate POST /api/v1/ingest</h3>
                  </div>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                    Enqueue chat turns for automated fact extraction, procedural rule pinning &amp; secret scrubbing.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIngestDrawer(false)}
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer shrink-0"
                  aria-label="Close transcript ingest drawer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Scrollable Body (Flush Right Scrollbar) */}
              <div
                className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs"
                data-testid="activity-ingest-scroll"
              >
                <div>
                  <label className="block font-semibold mb-1.5">Target Workspace</label>
                  <CustomSelect
                    ariaLabel="Ingest Target Workspace"
                    value={ingestWorkspace}
                    options={workspaceSelectOptions}
                    onChange={(ws) => setIngestWorkspace(ws)}
                    size="sm"
                    mono
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="font-semibold" htmlFor="ingest-transcript-textarea">
                      Raw Conversation Transcript
                    </label>
                    <button
                      type="button"
                      onClick={() => setIngestTranscript(DEFAULT_SAMPLE_TRANSCRIPT)}
                      className="text-[11px] font-mono-data text-sky-600 dark:text-sky-400 hover:underline cursor-pointer"
                    >
                      Load Secret-Scrubbing Sample
                    </button>
                  </div>
                  <textarea
                    id="ingest-transcript-textarea"
                    rows={7}
                    value={ingestTranscript}
                    onChange={(e) => setIngestTranscript(e.target.value)}
                    placeholder="user: Always enable SQLite WAL mode...&#10;assistant: Verified API secret sk-..."
                    className="w-full p-3 rounded-xl hairline-border font-mono-data text-[11px] leading-relaxed focus:outline-none focus:border-[var(--border-focus)] resize-y"
                    style={{
                      backgroundColor: 'var(--bg-elevated)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>

                {/* Live Extraction & Secret Scrubbing Preview Box */}
                <div
                  className="p-3.5 rounded-xl hairline-border space-y-2"
                  style={{ backgroundColor: 'var(--bg-elevated)' }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                      Pre-Flight Worker Preview
                    </span>
                    <div className="flex items-center gap-1.5 font-mono-data text-[10px]">
                      <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300">
                        {previewIngestCandidates.length} extractable
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                        {previewRedactionsCount} secrets scrubbed
                      </span>
                    </div>
                  </div>

                  {previewIngestCandidates.length === 0 ? (
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      Add at least one line (&gt;= 16 chars) to preview fact extraction.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {previewIngestCandidates.map((cand, idx) => (
                        <li
                          key={idx}
                          className="text-[11px] p-2 rounded-[4px] hairline-border flex items-start justify-between gap-2"
                          style={{ backgroundColor: 'var(--bg-surface)' }}
                        >
                          <span className="leading-relaxed break-words">{cand.content}</span>
                          <span className="font-mono-data text-[10px] shrink-0 uppercase px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-700 dark:text-violet-300">
                            {cand.type}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div
                className="px-5 py-3.5 hairline-border-t flex items-center justify-end gap-2 shrink-0"
                style={{ backgroundColor: 'var(--bg-elevated)' }}
              >
                <button
                  type="button"
                  onClick={() => setShowIngestDrawer(false)}
                  className="px-3 py-1.5 reui-btn-secondary text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingIngest || !ingestTranscript.trim()}
                  data-testid="submit-simulate-ingest-btn"
                  className="px-3.5 py-1.5 reui-btn-primary text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Webhook className="w-3.5 h-3.5" />
                  <span>{submittingIngest ? 'Enqueueing...' : 'Submit to Worker Queue'}</span>
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
