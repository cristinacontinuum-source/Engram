import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock,
  CopyCheck,
  Eye,
  GitMerge,
  MoreHorizontal,
  Pin,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import { engramApi } from '../api/client';
import { Dictionary } from '../i18n';
import {
  HygieneAuditResponse,
  HygieneCandidatePair,
  HygieneIssueKind,
  HygieneSeverity,
} from '../types/engram';
import {
  buildMergedContent,
  filterHygieneIssues,
  HygieneFilterKind,
} from '../utils/hygiene';
import { paginateItems } from '../utils/pagination';
import { CustomSelect } from './ui/CustomSelect';
import { TablePagination } from './ui/TablePagination';

interface HygieneTabProps {
  activeWorkspace: string;
  dict: Dictionary;
  onRefresh: () => Promise<void>;
}

const STALE_WINDOW_OPTIONS = [
  { value: '14', label: '14d Stale', badge: 'STRICT' },
  { value: '30', label: '30d Stale', badge: 'STD' },
  { value: '60', label: '60d Stale', badge: 'RELAX' },
];

export const HygieneTab: React.FC<HygieneTabProps> = ({
  activeWorkspace,
  dict,
  onRefresh,
}) => {
  const [audit, setAudit] = useState<HygieneAuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [staleDays, setStaleDays] = useState<string>('30');
  const [kindFilter, setKindFilter] = useState<HygieneFilterKind>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [pageSize, setPageSize] = useState<string>('5');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Sticky Actions column shadow & single popover state
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [showActionsShadow, setShowActionsShadow] = useState(false);
  const [actionMenuState, setActionMenuState] = useState<{
    issue: HygieneCandidatePair;
    top: number;
    left: number;
    openUp: boolean;
  } | null>(null);

  // Floating Compare & Resolve Drawer
  const [selectedIssue, setSelectedIssue] = useState<HygieneCandidatePair | null>(null);
  const [draftContent, setDraftContent] = useState('');
  const [resolving, setResolving] = useState(false);

  const loadAudit = useCallback(async () => {
    setLoading(true);
    try {
      const data = await engramApi.getHygieneAudit(
        activeWorkspace,
        Number(staleDays) || 30
      );
      setAudit(data);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, staleDays]);

  useEffect(() => {
    loadAudit();
  }, [loadAudit]);

  const handleOpenResolver = (issue: HygieneCandidatePair) => {
    setSelectedIssue(issue);
    setDraftContent(
      buildMergedContent(issue.primary_memory, issue.secondary_memory)
    );
  };

  const filteredIssues = useMemo(
    () =>
      filterHygieneIssues(audit?.issues ?? [], {
        kind: kindFilter,
        search: searchQuery,
      }),
    [audit, kindFilter, searchQuery]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [activeWorkspace, kindFilter, searchQuery, staleDays]);

  const pagination = useMemo(
    () => paginateItems(filteredIssues, currentPage, Number(pageSize) || 5),
    [filteredIssues, currentPage, pageSize]
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

  const handleResolve = async (
    issue: HygieneCandidatePair,
    action:
      | 'supersede_secondary'
      | 'merge_keep_primary'
      | 'archive_stale'
      | 'extend_ttl'
      | 'pin_keep'
      | 'dismiss',
    customMergedContent?: string
  ) => {
    setResolving(true);
    setStatusMessage(null);
    try {
      await engramApi.resolveHygieneIssue({
        action,
        issue_id: issue.issue_id,
        primary_id: issue.primary_memory.id,
        secondary_id: issue.secondary_memory?.id ?? null,
        merged_content: customMergedContent,
        workspace: issue.workspace,
      });
      setSelectedIssue(null);
      setActionMenuState(null);
      setStatusMessage(
        action === 'dismiss'
          ? `Dismissed finding ${issue.issue_id}`
          : `Resolved ${issue.kind} (${action}) on ${issue.primary_memory.id}`
      );
      await loadAudit();
      await onRefresh();
    } finally {
      setResolving(false);
    }
  };

  const renderKindBadge = (kind: HygieneIssueKind) => {
    switch (kind) {
      case 'conflict':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] font-mono-data font-semibold bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30">
            <AlertTriangle className="w-3 h-3" />
            <span>CONFLICT</span>
          </span>
        );
      case 'duplicate':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] font-mono-data font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
            <CopyCheck className="w-3 h-3" />
            <span>DUPLICATE</span>
          </span>
        );
      case 'stale':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] font-mono-data font-semibold bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/30">
            <Archive className="w-3 h-3" />
            <span>STALE</span>
          </span>
        );
      case 'expiring':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] font-mono-data font-semibold bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30">
            <Clock className="w-3 h-3" />
            <span>EXPIRING TTL</span>
          </span>
        );
    }
  };

  const renderSeverityBadge = (severity: HygieneSeverity) => {
    const styleMap: Record<HygieneSeverity, string> = {
      high: 'bg-rose-500/15 text-rose-700 dark:text-rose-400',
      medium: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
      low: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    };
    return (
      <span
        className={`inline-block px-2 py-0.5 rounded-[3px] font-mono-data text-[10px] font-semibold uppercase ${styleMap[severity]}`}
      >
        {severity}
      </span>
    );
  };

  const healthScore = audit?.health_score ?? 100;
  const stripeClass =
    healthScore >= 80
      ? 'reui-stripe-emerald'
      : healthScore >= 55
        ? 'reui-stripe-amber'
        : 'reui-stripe-rose';

  return (
    <div className="space-y-4">
      {/* Top ReUI Signal Header + 4-Cell Segmented KPI Strip */}
      <div className="reui-card overflow-hidden">
        <div
          className="px-4 py-3.5 hairline-border-b flex flex-col lg:flex-row lg:items-center justify-between gap-3"
          style={{ backgroundColor: 'var(--bg-elevated)' }}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" />
              <h1 className="text-sm font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                {dict.hygiene.title}
              </h1>
              <span
                className="font-mono-data text-[10px] px-1.5 py-0.5 rounded-[3px] hairline-border"
                style={{ color: 'var(--text-secondary)' }}
              >
                {audit?.total_active_scanned ?? 0} active scanned
              </span>
            </div>
            <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {dict.hygiene.subtitle}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="w-36">
              <CustomSelect
                ariaLabel="Stale Threshold Window"
                value={staleDays}
                options={STALE_WINDOW_OPTIONS}
                onChange={(val) => setStaleDays(val)}
                size="xs"
                mono
              />
            </div>

            <button
              type="button"
              onClick={loadAudit}
              disabled={loading}
              data-testid="run-hygiene-audit-btn"
              className="h-7 px-3 reui-btn-primary text-xs flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{loading ? dict.hygiene.auditingBtn : dict.hygiene.runAuditBtn}</span>
            </button>
          </div>
        </div>

        {/* 4-Cell Segmented KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-[var(--border-hairline)]">
          {/* Cell 1: Health Score + Hatch Bar */}
          <div className="p-4 space-y-2">
            <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
              <span>{dict.hygiene.kpi.healthScore}</span>
              <span className="font-mono-data font-bold" data-testid="hygiene-kpi-score">
                {healthScore}%
              </span>
            </div>
            <div className="h-2 w-full rounded-[2px] reui-hatch-track overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${stripeClass}`}
                style={{ width: `${healthScore}%` }}
              />
            </div>
          </div>

          {/* Cell 2: Conflicts */}
          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {dict.hygiene.kpi.conflicts}
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className="font-mono-data text-xl font-bold text-rose-600 dark:text-rose-400"
                data-testid="hygiene-kpi-conflicts"
              >
                {audit?.counts.conflict ?? 0}
              </span>
              <span className="font-mono-data text-xs" style={{ color: 'var(--text-muted)' }}>
                high priority
              </span>
            </div>
          </div>

          {/* Cell 3: Near-Duplicates */}
          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {dict.hygiene.kpi.duplicates}
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className="font-mono-data text-xl font-bold text-amber-600 dark:text-amber-400"
                data-testid="hygiene-kpi-duplicates"
              >
                {audit?.counts.duplicate ?? 0}
              </span>
              <span className="font-mono-data text-xs" style={{ color: 'var(--text-muted)' }}>
                dedup {audit?.dedup_threshold.toFixed(2) ?? '0.85'}
              </span>
            </div>
          </div>

          {/* Cell 4: Stale / Expiring */}
          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {dict.hygiene.kpi.staleExpiring}
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className="font-mono-data text-xl font-bold"
                data-testid="hygiene-kpi-stale"
              >
                {(audit?.counts.stale ?? 0) + (audit?.counts.expiring ?? 0)}
              </span>
              <span className="font-mono-data text-xs" style={{ color: 'var(--text-muted)' }}>
                {audit?.counts.stale ?? 0} stale • {audit?.counts.expiring ?? 0} ttl
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
          data-testid="hygiene-status-banner"
        >
          <span className="flex items-center gap-2 font-mono-data">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span>{statusMessage}</span>
          </span>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="p-1 rounded hover:bg-[var(--bg-elevated)] cursor-pointer"
            aria-label="Dismiss hygiene notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Hygiene Findings Ledger Table Card */}
      <div className="reui-card overflow-hidden">
        <div
          className="px-4 py-2.5 hairline-border-b flex flex-col lg:flex-row lg:items-center justify-between gap-2.5"
          style={{ backgroundColor: 'var(--bg-elevated)' }}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: dict.hygiene.tabs.all, count: audit?.counts.all ?? 0 },
                { id: 'conflict', label: dict.hygiene.tabs.conflict, count: audit?.counts.conflict ?? 0 },
                { id: 'duplicate', label: dict.hygiene.tabs.duplicate, count: audit?.counts.duplicate ?? 0 },
                { id: 'stale', label: dict.hygiene.tabs.stale, count: audit?.counts.stale ?? 0 },
                { id: 'expiring', label: dict.hygiene.tabs.expiring, count: audit?.counts.expiring ?? 0 },
              ] as const
            ).map((tab) => {
              const active = kindFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setKindFilter(tab.id)}
                  className={`px-2.5 py-1 rounded-[4px] text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                    active ? 'reui-btn-primary' : 'reui-btn-secondary'
                  }`}
                >
                  <span>{tab.label}</span>
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
              placeholder={dict.hygiene.searchPlaceholder}
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
                aria-label="Clear hygiene filter"
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
          data-testid="hygiene-table-scroll"
        >
          <table className="w-full min-w-[1180px] text-left border-separate border-spacing-0">
            <thead>
              <tr
                className="text-[11px] font-medium whitespace-nowrap"
                style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
              >
                <th className="py-2.5 px-3 hairline-border-b">Finding Type</th>
                <th className="py-2.5 px-3 hairline-border-b">Severity</th>
                <th className="py-2.5 px-3 hairline-border-b">Workspace</th>
                <th className="py-2.5 px-3 min-w-[400px] hairline-border-b">Conflict / Overlap Summary</th>
                <th className="py-2.5 px-3 hairline-border-b">Affected Record(s)</th>
                <th className="py-2.5 px-3 hairline-border-b">Signal Score</th>
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
                    colSpan={7}
                    className="py-12 px-4 text-center text-xs"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {dict.hygiene.empty}
                  </td>
                </tr>
              ) : (
                pagination.items.map((issue) => {
                  const isSelected = selectedIssue?.issue_id === issue.issue_id;
                  const isMenuOpen = actionMenuState?.issue.issue_id === issue.issue_id;

                  return (
                    <tr
                      key={issue.issue_id}
                      onClick={() => handleOpenResolver(issue)}
                      className="transition-colors hover:bg-[var(--bg-elevated)]/60 cursor-pointer"
                      style={{
                        backgroundColor: isSelected ? 'var(--bg-elevated)' : 'transparent',
                      }}
                    >
                      <td className="py-2.5 px-3 whitespace-nowrap hairline-border-b">
                        {renderKindBadge(issue.kind)}
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap hairline-border-b">
                        {renderSeverityBadge(issue.severity)}
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap hairline-border-b">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded-[3px] font-mono-data text-[11px] border ${
                            issue.workspace === 'global'
                              ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25'
                              : 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/25'
                          }`}
                        >
                          {issue.workspace}
                        </span>
                      </td>

                      <td className="py-2.5 px-3 max-w-[460px] hairline-border-b">
                        <div className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {issue.title}
                        </div>
                        <div
                          className="text-[11px] truncate mt-0.5"
                          style={{ color: 'var(--text-muted)' }}
                          title={issue.reason}
                        >
                          {issue.reason}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap font-mono-data text-[11px] hairline-border-b">
                        <div className="flex items-center gap-1.5">
                          <span className="px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] hairline-border">
                            {issue.primary_memory.id}
                          </span>
                          {issue.secondary_memory && (
                            <>
                              <span style={{ color: 'var(--text-muted)' }}>↔</span>
                              <span className="px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] hairline-border">
                                {issue.secondary_memory.id}
                              </span>
                            </>
                          )}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap font-mono-data text-[11px] hairline-border-b">
                        {Math.round(issue.similarity_score * 100)}%
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
                            const openUp = window.innerHeight - rect.bottom < 190;
                            setActionMenuState({
                              issue,
                              top: openUp ? rect.top - 6 : rect.bottom + 6,
                              left: Math.min(window.innerWidth - 224, Math.max(12, rect.right - 208)),
                              openUp,
                            });
                          }}
                          aria-label={`Actions for ${issue.issue_id}`}
                          aria-haspopup="menu"
                          aria-expanded={isMenuOpen}
                          className={`w-7 h-7 rounded-[4px] inline-flex items-center justify-center transition-colors cursor-pointer ${
                            isMenuOpen
                              ? 'bg-[var(--bg-elevated)] hairline-border'
                              : 'hover:bg-[var(--bg-elevated)]'
                          }`}
                          style={{ color: 'var(--text-secondary)' }}
                          title="Open Hygiene Actions"
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
          testIdPrefix="hygiene"
        />
      </div>

      {/* Fixed Actions Popover Menu */}
      {actionMenuState && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-56 rounded-lg hairline-border shadow-xl py-1 text-xs"
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
              const target = actionMenuState.issue;
              setActionMenuState(null);
              handleOpenResolver(target);
            }}
            className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5 text-sky-500" />
            <span>Compare &amp; Resolve</span>
          </button>

          {actionMenuState.issue.secondary_memory && (
            <button
              type="button"
              role="menuitem"
              onClick={() =>
                handleResolve(actionMenuState.issue, 'supersede_secondary')
              }
              className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
            >
              <GitMerge className="w-3.5 h-3.5 text-emerald-500" />
              <span>Keep {actionMenuState.issue.primary_memory.id}</span>
            </button>
          )}

          {actionMenuState.issue.kind === 'stale' && (
            <button
              type="button"
              role="menuitem"
              onClick={() => handleResolve(actionMenuState.issue, 'archive_stale')}
              className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
            >
              <Archive className="w-3.5 h-3.5 text-violet-500" />
              <span>Archive Stale Memory</span>
            </button>
          )}

          {actionMenuState.issue.kind === 'expiring' && (
            <button
              type="button"
              role="menuitem"
              onClick={() => handleResolve(actionMenuState.issue, 'extend_ttl')}
              className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
            >
              <Clock className="w-3.5 h-3.5 text-sky-500" />
              <span>Extend TTL (+7 Days)</span>
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={() => handleResolve(actionMenuState.issue, 'dismiss')}
            className="w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
            style={{ color: 'var(--text-secondary)' }}
          >
            <X className="w-3.5 h-3.5" />
            <span>Dismiss Finding</span>
          </button>
        </div>
      )}

      {/* Floating Rounded-2xl Compare & Resolve Drawer (Tight 8px p-2 Margin, Flush Right Scrollbar) */}
      <AnimatePresence>
        {selectedIssue && (
          <motion.div
            key="hygiene-resolver-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex justify-end p-2 bg-black/50 backdrop-blur-[2px]"
            onClick={() => setSelectedIssue(null)}
          >
            <motion.div
              key="hygiene-resolver-panel"
              role="dialog"
              aria-label="Resolve Memory Hygiene Finding"
              initial={{ x: 500, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 500, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 34, mass: 0.9 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[500px] h-full rounded-2xl hairline-border shadow-2xl flex flex-col justify-between overflow-hidden"
              style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
            >
              {/* Header */}
              <div className="px-5 pt-4 pb-3.5 hairline-border-b flex items-center justify-between gap-3 shrink-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {renderKindBadge(selectedIssue.kind)}
                    {renderSeverityBadge(selectedIssue.severity)}
                  </div>
                  <h3 className="text-sm font-bold mt-1.5 truncate">{selectedIssue.title}</h3>
                  <p className="font-mono-data text-[10px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                    {selectedIssue.issue_id} • ws:{selectedIssue.workspace}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedIssue(null)}
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer shrink-0"
                  aria-label="Close hygiene resolver drawer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Scrollable Body (Flush Right Scrollbar) */}
              <div
                className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs"
                data-testid="hygiene-resolver-scroll"
              >
                <div
                  className="p-3 rounded-xl hairline-border leading-relaxed"
                  style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                >
                  <strong style={{ color: 'var(--text-primary)' }}>Audit Signal: </strong>
                  {selectedIssue.reason}
                </div>

                {/* Primary / Authoritative Memory */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                      Primary Record ({selectedIssue.primary_memory.id})
                    </span>
                    <span className="font-mono-data text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      conf {(selectedIssue.primary_memory.confidence * 100).toFixed(0)}% • {selectedIssue.primary_memory.access_count} recalls
                    </span>
                  </div>
                  <div
                    className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 leading-relaxed"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {selectedIssue.primary_memory.content}
                  </div>
                </div>

                {/* Secondary Conflicting / Duplicate Memory */}
                {selectedIssue.secondary_memory && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                        Conflicting / Duplicate Record ({selectedIssue.secondary_memory.id})
                      </span>
                      <span className="font-mono-data text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        conf {(selectedIssue.secondary_memory.confidence * 100).toFixed(0)}% • {selectedIssue.secondary_memory.access_count} recalls
                      </span>
                    </div>
                    <div
                      className="p-3.5 rounded-xl border border-rose-500/30 bg-rose-500/5 leading-relaxed"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {selectedIssue.secondary_memory.content}
                    </div>
                  </div>
                )}

                {/* Consolidated / Editable Textarea for Conflict & Duplicate Resolution */}
                {selectedIssue.secondary_memory && (
                  <div className="space-y-1.5 pt-2 hairline-border-t">
                    <label
                      htmlFor="hygiene-merged-content"
                      className="text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1.5"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                      Consolidated Target Content (for Primary Record)
                    </label>
                    <textarea
                      id="hygiene-merged-content"
                      rows={4}
                      value={draftContent}
                      onChange={(e) => setDraftContent(e.target.value)}
                      className="w-full p-3 rounded-xl hairline-border text-xs leading-relaxed focus:outline-none focus:border-[var(--border-focus)] resize-y"
                      style={{
                        backgroundColor: 'var(--bg-elevated)',
                        color: 'var(--text-primary)',
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Footer Resolution Buttons */}
              <div
                className="px-5 py-3.5 hairline-border-t flex flex-wrap items-center justify-between gap-2 shrink-0"
                style={{ backgroundColor: 'var(--bg-elevated)' }}
              >
                <button
                  type="button"
                  disabled={resolving}
                  onClick={() => handleResolve(selectedIssue, 'dismiss')}
                  className="px-3 py-1.5 reui-btn-secondary text-xs cursor-pointer disabled:opacity-50"
                >
                  Dismiss
                </button>

                <div className="flex flex-wrap items-center gap-2">
                  {selectedIssue.secondary_memory ? (
                    <>
                      <button
                        type="button"
                        disabled={resolving}
                        onClick={() =>
                          handleResolve(selectedIssue, 'supersede_secondary')
                        }
                        className="px-3 py-1.5 reui-btn-secondary text-xs cursor-pointer disabled:opacity-50"
                      >
                        Keep Primary As-Is
                      </button>
                      <button
                        type="button"
                        disabled={resolving || !draftContent.trim()}
                        data-testid="confirm-hygiene-merge-btn"
                        onClick={() =>
                          handleResolve(
                            selectedIssue,
                            'merge_keep_primary',
                            draftContent
                          )
                        }
                        className="px-3.5 py-1.5 reui-btn-primary text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <GitMerge className="w-3.5 h-3.5" />
                        <span>{resolving ? 'Resolving...' : 'Merge & Supersede'}</span>
                      </button>
                    </>
                  ) : selectedIssue.kind === 'stale' ? (
                    <>
                      <button
                        type="button"
                        disabled={resolving}
                        onClick={() => handleResolve(selectedIssue, 'pin_keep')}
                        className="px-3 py-1.5 reui-btn-secondary text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <Pin className="w-3.5 h-3.5" />
                        <span>Pin &amp; Keep</span>
                      </button>
                      <button
                        type="button"
                        disabled={resolving}
                        data-testid="confirm-hygiene-archive-btn"
                        onClick={() => handleResolve(selectedIssue, 'archive_stale')}
                        className="px-3.5 py-1.5 reui-btn-primary text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <Archive className="w-3.5 h-3.5" />
                        <span>{resolving ? 'Archiving...' : 'Archive Stale'}</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={resolving}
                        onClick={() => handleResolve(selectedIssue, 'pin_keep')}
                        className="px-3 py-1.5 reui-btn-secondary text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <Pin className="w-3.5 h-3.5" />
                        <span>Make Permanent</span>
                      </button>
                      <button
                        type="button"
                        disabled={resolving}
                        data-testid="confirm-hygiene-extend-btn"
                        onClick={() => handleResolve(selectedIssue, 'extend_ttl')}
                        className="px-3.5 py-1.5 reui-btn-primary text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        <span>{resolving ? 'Extending...' : 'Extend TTL (+7d)'}</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
