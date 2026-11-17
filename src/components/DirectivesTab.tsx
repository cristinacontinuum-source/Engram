import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Edit3,
  Eye,
  Globe,
  MoreHorizontal,
  Pin,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { engramApi } from '../api/client';
import { Dictionary } from '../i18n';
import { DirectivesPreviewResponse, MemoryRecord, MemoryType } from '../types/engram';
import {
  classifyDirective,
  DirectiveFilterCategory,
  estimateTokens,
  filterAndSortDirectives,
  formatDirectivePromptLine,
} from '../utils/directives';
import { paginateItems } from '../utils/pagination';
import { CustomSelect } from './ui/CustomSelect';
import { TablePagination } from './ui/TablePagination';

interface DirectivesTabProps {
  memories: MemoryRecord[];
  activeWorkspace: string;
  workspaces: string[];
  dict: Dictionary;
  onRefresh: () => Promise<void>;
}

type DirectivePreset = 'rule' | 'anti_pattern' | 'custom';

export const DirectivesTab: React.FC<DirectivesTabProps> = ({
  memories,
  activeWorkspace,
  workspaces,
  dict,
  onRefresh,
}) => {
  const [previewData, setPreviewData] = useState<DirectivesPreviewResponse | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const [categoryFilter, setCategoryFilter] = useState<DirectiveFilterCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [pageSize, setPageSize] = useState<string>('5');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [previewResource, setPreviewResource] = useState<'core' | 'session'>('core');
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  // Horizontal scroll shadow & single popover menu for pinned Actions column
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const [showActionsShadow, setShowActionsShadow] = useState(false);
  const [actionMenuState, setActionMenuState] = useState<{
    memory: MemoryRecord;
    top: number;
    left: number;
    openUp: boolean;
  } | null>(null);

  // Floating Inspect Drawer
  const [inspectedDirective, setInspectedDirective] = useState<MemoryRecord | null>(null);

  // Floating Create / Edit Directive Drawer (NO centered modal)
  const [showEditorDrawer, setShowEditorDrawer] = useState(false);
  const [editingDirective, setEditingDirective] = useState<MemoryRecord | null>(null);
  const [presetKind, setPresetKind] = useState<DirectivePreset>('rule');
  const [editorWorkspace, setEditorWorkspace] = useState(
    activeWorkspace === 'all' ? 'global' : activeWorkspace
  );
  const [editorContent, setEditorContent] = useState('');
  const [antiContext, setAntiContext] = useState('');
  const [antiAvoid, setAntiAvoid] = useState('');
  const [antiRule, setAntiRule] = useState('');
  const [editorConfidence, setEditorConfidence] = useState(0.96);
  const [editorPinned, setEditorPinned] = useState(true);
  const [savingEditor, setSavingEditor] = useState(false);

  const effectivePreviewWorkspace = activeWorkspace === 'all' ? 'global' : activeWorkspace;

  const loadPreview = useCallback(async () => {
    setLoadingPreview(true);
    try {
      const res = await engramApi.getDirectivesPreview(activeWorkspace);
      setPreviewData(res);
    } finally {
      setLoadingPreview(false);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview, memories]);

  const workspaceSelectOptions = useMemo(
    () =>
      workspaces
        .filter((w) => w !== 'all')
        .map((w) => ({
          value: w,
          label: w,
          badge: w === 'global' ? 'root' : 'ws',
        })),
    [workspaces]
  );

  // Candidate list across workspace + global (matching MCP injection scope)
  const allScopedDirectives = useMemo(
    () =>
      filterAndSortDirectives(memories, activeWorkspace, {
        category: 'all',
        includeGlobal: true,
      }),
    [memories, activeWorkspace]
  );

  const categoryCounts = useMemo(() => {
    let anti = 0;
    let pinned = 0;
    let procedural = 0;
    for (const d of allScopedDirectives) {
      const cat = classifyDirective(d);
      if (cat === 'anti_pattern') anti++;
      else if (cat === 'pinned_rule') pinned++;
      else procedural++;
    }
    return {
      all: allScopedDirectives.length,
      anti_pattern: anti,
      pinned_rule: pinned,
      procedural,
    };
  }, [allScopedDirectives]);

  const filteredDirectives = useMemo(
    () =>
      filterAndSortDirectives(memories, activeWorkspace, {
        category: categoryFilter,
        search: searchQuery,
        includeGlobal: true,
      }),
    [memories, activeWorkspace, categoryFilter, searchQuery]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [activeWorkspace, categoryFilter, searchQuery]);

  const pagination = useMemo(
    () => paginateItems(filteredDirectives, currentPage, Number(pageSize) || 5),
    [filteredDirectives, currentPage, pageSize]
  );

  const updateActionsShadow = useCallback(() => {
    const el = tableScrollRef.current;
    if (!el) return;
    const remainingRight = el.scrollWidth - el.clientWidth - el.scrollLeft;
    setShowActionsShadow(remainingRight > 2);
  }, []);

  useEffect(() => {
    updateActionsShadow();
    window.addEventListener('resize', updateActionsShadow);
    const el = tableScrollRef.current;
    let observer: ResizeObserver | null = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateActionsShadow);
      observer.observe(el);
    }
    return () => {
      window.removeEventListener('resize', updateActionsShadow);
      observer?.disconnect();
    };
  }, [updateActionsShadow, pagination.items.length, activeWorkspace, categoryFilter]);

  useEffect(() => {
    if (!actionMenuState) return;
    const closeMenu = () => setActionMenuState(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    window.addEventListener('click', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [actionMenuState]);

  const handleOpenCreateDrawer = (initialPreset: DirectivePreset = 'rule') => {
    setEditingDirective(null);
    setPresetKind(initialPreset);
    setEditorWorkspace(activeWorkspace === 'all' ? 'global' : activeWorkspace);
    setEditorContent(initialPreset === 'rule' ? '[RULE] ' : '');
    setAntiContext('');
    setAntiAvoid('');
    setAntiRule('');
    setEditorConfidence(0.96);
    setEditorPinned(true);
    setShowEditorDrawer(true);
  };

  const handleOpenEditDrawer = (memory: MemoryRecord) => {
    setEditingDirective(memory);
    setPresetKind('custom');
    setEditorWorkspace(memory.workspace);
    setEditorContent(memory.content);
    setEditorConfidence(memory.confidence);
    setEditorPinned(memory.is_pinned === 1);
    setShowEditorDrawer(true);
  };

  const handleTogglePin = async (memory: MemoryRecord) => {
    const nextPin = memory.is_pinned !== 1;
    await engramApi.updateMemory(memory.id, { is_pinned: nextPin });
    if (inspectedDirective?.id === memory.id) {
      setInspectedDirective({ ...memory, is_pinned: nextPin ? 1 : 0 });
    }
    await onRefresh();
    await loadPreview();
    setBannerMessage(
      nextPin
        ? `Pinned ${memory.id} to memory://core-directives/${effectivePreviewWorkspace}`
        : `Unpinned ${memory.id} from core directives`
    );
  };

  const handlePromoteGlobal = async (memory: MemoryRecord) => {
    await engramApi.updateMemory(memory.id, { workspace: 'global', is_pinned: true });
    if (inspectedDirective?.id === memory.id) {
      setInspectedDirective({ ...memory, workspace: 'global', is_pinned: 1 });
    }
    await onRefresh();
    await loadPreview();
    setBannerMessage(`Promoted ${memory.id} to global workspace directives.`);
  };

  const handleDeleteDirective = async (memoryId: string) => {
    await engramApi.deleteMemory(memoryId);
    if (inspectedDirective?.id === memoryId) {
      setInspectedDirective(null);
    }
    await onRefresh();
    await loadPreview();
    setBannerMessage(`Removed directive ${memoryId}.`);
  };

  const composedContent = useMemo(() => {
    if (!editingDirective && presetKind === 'anti_pattern') {
      const ctx = antiContext.trim();
      const avd = antiAvoid.trim();
      const rul = antiRule.trim();
      if (!ctx && !avd && !rul) return '';
      return `[ANTI-PATTERN] When: ${ctx || 'task execution'} | Avoid: ${avd || 'unsafe operation'} | Directive: ${rul || 'apply verified guardrail'}`;
    }
    return editorContent.trim();
  }, [editingDirective, presetKind, antiContext, antiAvoid, antiRule, editorContent]);

  const handleSaveEditor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!composedContent) return;
    setSavingEditor(true);
    try {
      if (editingDirective) {
        await engramApi.updateMemory(editingDirective.id, {
          content: composedContent,
          workspace: editorWorkspace,
          type: editingDirective.type,
          confidence: editorConfidence,
          is_pinned: editorPinned,
        });
        if (inspectedDirective?.id === editingDirective.id) {
          setInspectedDirective({
            ...editingDirective,
            content: composedContent,
            workspace: editorWorkspace,
            confidence: editorConfidence,
            is_pinned: editorPinned ? 1 : 0,
          });
        }
        setBannerMessage(`Updated directive ${editingDirective.id}.`);
      } else {
        const memType: MemoryType = 'procedural';
        const source = presetKind === 'anti_pattern' ? 'tool_error' : 'user_explicit';
        const created = await engramApi.createMemory({
          workspace: editorWorkspace,
          content: composedContent,
          type: memType,
          source,
          confidence: editorConfidence,
          is_pinned: editorPinned,
        });
        setBannerMessage(`Created directive ${created.memory.id} in ws:${editorWorkspace}.`);
      }
      setShowEditorDrawer(false);
      await onRefresh();
      await loadPreview();
    } finally {
      setSavingEditor(false);
    }
  };

  const activePromptText = useMemo(() => {
    if (!previewData) return '';
    return previewResource === 'core'
      ? previewData.core_directives_text
      : previewData.session_summary_text;
  }, [previewData, previewResource]);

  const handleCopyPrompt = async () => {
    if (!activePromptText) return;
    try {
      await navigator.clipboard.writeText(activePromptText);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 1800);
    } catch {
      setBannerMessage('Clipboard permission unavailable in headless environment.');
    }
  };

  const tokenBudget = previewData?.token_budget ?? {
    directives_tokens: 0,
    session_tokens: 0,
    total_tokens: 0,
    budget_limit: 1500,
    utilization_pct: 0,
    health: 'healthy' as const,
  };

  const healthMeta = useMemo(() => {
    if (tokenBudget.health === 'heavy') {
      return {
        label: dict.directives.preview.heavy,
        badgeClass:
          'bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30',
        fillClass: 'reui-stripe-rose',
      };
    }
    if (tokenBudget.health === 'warning') {
      return {
        label: dict.directives.preview.warning,
        badgeClass:
          'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30',
        fillClass: 'reui-stripe-amber',
      };
    }
    return {
      label: dict.directives.preview.healthy,
      badgeClass:
        'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30',
      fillClass: 'reui-stripe-emerald',
    };
  }, [tokenBudget.health, dict.directives.preview]);

  return (
    <div className="space-y-4">
      {bannerMessage && (
        <div className="px-3.5 py-2.5 rounded-[4px] bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-xs flex items-center justify-between">
          <span className="flex items-center gap-2 font-mono-data">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {bannerMessage}
          </span>
          <button
            type="button"
            onClick={() => setBannerMessage(null)}
            className="cursor-pointer"
            aria-label="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top ReUI Signal Header + 4-Column Divided KPI Strip */}
      <div className="reui-card overflow-hidden">
        <div className="px-4 py-3 hairline-border-b flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {dict.directives.title}
            </h1>
            <span className="text-xs hidden md:inline" style={{ color: 'var(--text-muted)' }}>
              •
            </span>
            <span
              className="text-xs truncate hidden md:inline"
              style={{ color: 'var(--text-secondary)' }}
            >
              {activeWorkspace === 'all'
                ? 'global scope'
                : `ws:${activeWorkspace} + global`}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              className="h-7 px-2.5 rounded-[4px] hairline-border flex items-center gap-2 w-48 sm:w-56"
              style={{ backgroundColor: 'var(--bg-elevated)' }}
            >
              <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-secondary)' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={dict.directives.searchPlaceholder}
                className="w-full bg-transparent text-xs focus:outline-none"
                style={{ color: 'var(--text-primary)' }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="cursor-pointer"
                  style={{ color: 'var(--text-secondary)' }}
                  aria-label="Clear filter"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => loadPreview()}
              className="h-7 w-7 reui-btn-secondary flex items-center justify-center cursor-pointer"
              title="Refresh Directives & MCP Preview"
              aria-label="Refresh Directives"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${loadingPreview ? 'animate-spin' : ''}`} />
            </button>

            <button
              type="button"
              onClick={() => handleOpenCreateDrawer('anti_pattern')}
              className="h-7 px-2.5 reui-btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
              <span className="hidden sm:inline">+ Anti-Pattern</span>
            </button>

            <button
              type="button"
              onClick={() => handleOpenCreateDrawer('rule')}
              className="h-7 px-3 reui-btn-primary text-xs flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{dict.directives.addBtn}</span>
            </button>
          </div>
        </div>

        {/* 4-Column Divided KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-[var(--border-hairline)]">
          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {dict.directives.kpi.activeDirectives}
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className="font-mono-data text-xl font-bold"
                data-testid="directives-kpi-total"
              >
                {categoryCounts.all}
              </span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {previewData?.pinned_count ?? categoryCounts.pinned_rule + categoryCounts.anti_pattern} pinned
              </span>
            </div>
          </div>

          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {dict.directives.kpi.antiPatterns}
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className="font-mono-data text-xl font-bold text-amber-600 dark:text-amber-400"
                data-testid="directives-kpi-anti"
              >
                {categoryCounts.anti_pattern}
              </span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                learn_from_mistake
              </span>
            </div>
          </div>

          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {dict.directives.kpi.coreTokens}
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className="font-mono-data text-xl font-bold text-emerald-600 dark:text-emerald-400"
                data-testid="directives-kpi-core-tokens"
              >
                {tokenBudget.directives_tokens} tok
              </span>
              <span className="text-xs font-mono-data truncate" style={{ color: 'var(--text-muted)' }}>
                core-directives
              </span>
            </div>
          </div>

          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {dict.directives.kpi.sessionTokens}
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className="font-mono-data text-xl font-bold"
                data-testid="directives-kpi-session-tokens"
              >
                {tokenBudget.session_tokens} tok
              </span>
              <span className="text-xs font-mono-data" style={{ color: 'var(--text-muted)' }}>
                {tokenBudget.total_tokens}/{tokenBudget.budget_limit} total
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Split Workspace: Left Ledger Table | Right Live MCP Prompt Preview */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(390px,1fr)] gap-4 items-start">
        {/* Left Card: Guardrails & Core Directives Table */}
        <div className="reui-card overflow-hidden">
          {/* Category Segmented Tabs */}
          <div
            className="px-4 py-2.5 hairline-border-b flex flex-wrap items-center justify-between gap-2"
            style={{ backgroundColor: 'var(--bg-elevated)' }}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { id: 'all' as const, label: dict.directives.tabs.all, count: categoryCounts.all },
                {
                  id: 'anti_pattern' as const,
                  label: dict.directives.tabs.antiPattern,
                  count: categoryCounts.anti_pattern,
                },
                {
                  id: 'pinned_rule' as const,
                  label: dict.directives.tabs.pinnedRule,
                  count: categoryCounts.pinned_rule,
                },
                {
                  id: 'procedural' as const,
                  label: dict.directives.tabs.procedural,
                  count: categoryCounts.procedural,
                },
              ].map((tab) => {
                const active = categoryFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setCategoryFilter(tab.id)}
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

            <span className="font-mono-data text-[10px]" style={{ color: 'var(--text-muted)' }}>
              Priority: Pinned → Conf → Recency
            </span>
          </div>

          {/* Scrollable Table with Pinned Right Actions Column & Scroll-Aware Shadow */}
          <div
            ref={tableScrollRef}
            onScroll={updateActionsShadow}
            className="overflow-x-auto relative"
            data-testid="directives-table-scroll"
          >
            <table className="w-full min-w-[820px] text-left border-separate border-spacing-0">
              <thead>
                <tr
                  className="text-[11px] font-medium whitespace-nowrap"
                  style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                >
                  <th className="py-2.5 px-3 hairline-border-b">Category</th>
                  <th className="py-2.5 px-3 min-w-[300px] hairline-border-b">Directive &amp; Guardrail Content</th>
                  <th className="py-2.5 px-3 hairline-border-b">Scope</th>
                  <th className="py-2.5 px-3 hairline-border-b">Tokens</th>
                  <th className="py-2.5 px-3 hairline-border-b">Conf.</th>
                  <th className="py-2.5 px-3 hairline-border-b">Source</th>
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
                      {dict.directives.empty}
                    </td>
                  </tr>
                ) : (
                  pagination.items.map((d) => {
                    const cat = classifyDirective(d);
                    const isSelected = inspectedDirective?.id === d.id;
                    const isMenuOpen = actionMenuState?.memory.id === d.id;
                    const lineTok = estimateTokens(formatDirectivePromptLine(d));

                    return (
                      <tr
                        key={d.id}
                        onClick={() => setInspectedDirective(d)}
                        className="group transition-colors cursor-pointer hover:bg-[var(--bg-elevated)]"
                        style={{
                          backgroundColor: isSelected ? 'var(--bg-row-selected)' : undefined,
                        }}
                      >
                        {/* Category Badge */}
                        <td className="py-2.5 px-3 whitespace-nowrap hairline-border-b">
                          {cat === 'anti_pattern' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                              <AlertTriangle className="w-3 h-3" />
                              <span>ANTI-PATTERN</span>
                            </span>
                          ) : cat === 'pinned_rule' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                              <Pin className="w-3 h-3" />
                              <span>PINNED</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] font-semibold bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/30">
                              <Sparkles className="w-3 h-3" />
                              <span>PROCEDURAL</span>
                            </span>
                          )}
                        </td>

                        {/* Content */}
                        <td className="py-2.5 px-3 max-w-[340px] hairline-border-b">
                          <div
                            className="line-clamp-2 leading-relaxed text-xs"
                            style={{ color: 'var(--text-primary)' }}
                            title={d.content}
                          >
                            {d.content}
                          </div>
                          <div
                            className="font-mono-data text-[10px] mt-0.5"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            {d.id}
                          </div>
                        </td>

                        {/* Workspace Scope */}
                        <td className="py-2.5 px-3 whitespace-nowrap hairline-border-b">
                          <span
                            className={`inline-flex items-center gap-1.5 font-mono-data text-[11px] px-1.5 py-0.5 rounded-[3px] border ${
                              d.workspace === 'global'
                                ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25'
                                : 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/25'
                            }`}
                          >
                            {d.workspace === 'global' && <Globe className="w-3 h-3" />}
                            <span>{d.workspace}</span>
                          </span>
                        </td>

                        {/* Tokens */}
                        <td className="py-2.5 px-3 whitespace-nowrap font-mono-data text-[11px] hairline-border-b">
                          ~{lineTok} tok
                        </td>

                        {/* Confidence */}
                        <td className="py-2.5 px-3 whitespace-nowrap hairline-border-b">
                          <span className="inline-block px-2 py-0.5 rounded-[3px] font-mono-data text-[11px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                            {Math.round(d.confidence * 100)}%
                          </span>
                        </td>

                        {/* Source */}
                        <td
                          className="py-2.5 px-3 whitespace-nowrap font-mono-data text-[11px] hairline-border-b"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {d.source}
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
                              background:
                                'linear-gradient(to left, var(--sticky-col-fade), transparent)',
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
                              const openUp = window.innerHeight - rect.bottom < 220;
                              setActionMenuState({
                                memory: d,
                                top: openUp ? rect.top - 6 : rect.bottom + 6,
                                left: Math.min(window.innerWidth - 224, Math.max(12, rect.right - 208)),
                                openUp,
                              });
                            }}
                            aria-label={`Actions for ${d.id}`}
                            aria-haspopup="menu"
                            aria-expanded={isMenuOpen}
                            className={`w-7 h-7 rounded-[4px] inline-flex items-center justify-center transition-colors cursor-pointer ${
                              isMenuOpen
                                ? 'bg-[var(--bg-elevated)] hairline-border'
                                : 'hover:bg-[var(--bg-elevated)]'
                            }`}
                            style={{ color: 'var(--text-secondary)' }}
                            title="Open Directive Actions"
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
            testIdPrefix="directives"
          />
        </div>

        {/* Right Card: Live MCP Prompt Injection Preview */}
        <div className="reui-card overflow-hidden">
          <div className="px-4 py-3 hairline-border-b flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
                <h2 className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                  {dict.directives.preview.title}
                </h2>
              </div>
              <p className="text-[11px] leading-snug mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                {dict.directives.preview.subtitle}
              </p>
            </div>

            <button
              type="button"
              onClick={handleCopyPrompt}
              className="h-7 px-2.5 reui-btn-secondary text-xs flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              {copiedPrompt ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span>{dict.directives.copiedPromptBtn}</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>{dict.directives.copyPromptBtn}</span>
                </>
              )}
            </button>
          </div>

          {/* Resource URI Switcher */}
          <div
            className="px-4 py-2.5 hairline-border-b"
            style={{ backgroundColor: 'var(--bg-elevated)' }}
          >
            <div className="grid grid-cols-2 gap-1.5 w-full">
              <button
                type="button"
                onClick={() => setPreviewResource('core')}
                title={`memory://core-directives/${effectivePreviewWorkspace}`}
                className={`px-2 py-1.5 rounded-[4px] font-mono-data text-[10.5px] whitespace-nowrap truncate transition-colors cursor-pointer ${
                  previewResource === 'core' ? 'reui-btn-primary' : 'reui-btn-secondary'
                }`}
              >
                memory://core-directives/{effectivePreviewWorkspace}
              </button>
              <button
                type="button"
                onClick={() => setPreviewResource('session')}
                title={`memory://session-summary/${effectivePreviewWorkspace}`}
                className={`px-2 py-1.5 rounded-[4px] font-mono-data text-[10.5px] whitespace-nowrap truncate transition-colors cursor-pointer ${
                  previewResource === 'session' ? 'reui-btn-primary' : 'reui-btn-secondary'
                }`}
              >
                memory://session-summary/{effectivePreviewWorkspace}
              </button>
            </div>
          </div>

          {/* Baseline Token Budget Meter */}
          <div className="px-4 py-3 hairline-border-b space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>
                {dict.directives.preview.budgetLabel}
              </span>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-[3px] text-[10px] font-semibold ${healthMeta.badgeClass}`}>
                  {healthMeta.label}
                </span>
                <span className="font-mono-data text-[11px] font-semibold">
                  {tokenBudget.total_tokens} / {tokenBudget.budget_limit} tok
                </span>
              </div>
            </div>

            <div className="h-2 w-full rounded-[2px] reui-hatch-track overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${healthMeta.fillClass}`}
                style={{ width: `${Math.max(4, tokenBudget.utilization_pct)}%` }}
              />
            </div>

            <div
              className="flex items-center justify-between text-[11px] font-mono-data"
              style={{ color: 'var(--text-muted)' }}
            >
              <span>core: {tokenBudget.directives_tokens} tok</span>
              <span>session: {tokenBudget.session_tokens} tok</span>
              <span>{tokenBudget.utilization_pct}% budget</span>
            </div>
          </div>

          {/* Monospace Synthesized Prompt Box */}
          <div className="p-4">
            <pre
              data-testid="mcp-preview-output"
              className="p-3.5 rounded-lg hairline-border font-mono-data text-[11px] leading-relaxed whitespace-pre-wrap break-words max-h-[380px] overflow-y-auto"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
              }}
            >
              {activePromptText || '# Loading MCP resource payload...'}
            </pre>

            <div
              className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
              <span>
                Agents subscribe to these two MCP resources at session boot (~{tokenBudget.total_tokens} tok
                total) instead of stuffing long raw conversation histories.
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Single-Action Row Popover Menu */}
      {actionMenuState && (
        <div
          role="menu"
          aria-label={`Menu for ${actionMenuState.memory.id}`}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-52 rounded-lg hairline-border p-1.5 shadow-2xl space-y-0.5 text-xs"
          style={{
            top: `${actionMenuState.top}px`,
            left: `${actionMenuState.left}px`,
            transform: actionMenuState.openUp ? 'translateY(-100%)' : undefined,
            backgroundColor: 'var(--bg-surface)',
            color: 'var(--text-primary)',
          }}
        >
          <div
            className="px-2.5 py-1 text-[10px] font-mono-data truncate hairline-border-b mb-1"
            style={{ color: 'var(--text-muted)' }}
          >
            {actionMenuState.memory.id}
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const target = actionMenuState.memory;
              setActionMenuState(null);
              handleTogglePin(target);
            }}
            className="w-full px-2.5 py-1.5 rounded-[4px] flex items-center gap-2.5 text-left hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
          >
            <Pin
              className={`w-3.5 h-3.5 shrink-0 ${
                actionMenuState.memory.is_pinned === 1
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : ''
              }`}
            />
            <span>
              {actionMenuState.memory.is_pinned === 1
                ? 'Unpin from Core Directives'
                : 'Pin to Core Directives'}
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const target = actionMenuState.memory;
              setActionMenuState(null);
              setInspectedDirective(target);
            }}
            className="w-full px-2.5 py-1.5 rounded-[4px] flex items-center gap-2.5 text-left hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-secondary)' }} />
            <span>Inspect Directive</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const target = actionMenuState.memory;
              setActionMenuState(null);
              handleOpenEditDrawer(target);
            }}
            className="w-full px-2.5 py-1.5 rounded-[4px] flex items-center gap-2.5 text-left hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
          >
            <Edit3 className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-secondary)' }} />
            <span>Edit Directive</span>
          </button>

          {actionMenuState.memory.workspace !== 'global' && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const target = actionMenuState.memory;
                setActionMenuState(null);
                handlePromoteGlobal(target);
              }}
              className="w-full px-2.5 py-1.5 rounded-[4px] flex items-center gap-2.5 text-left hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5 shrink-0 text-sky-500" />
              <span>Promote to Global</span>
            </button>
          )}

          <div className="my-1 hairline-border-t" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const targetId = actionMenuState.memory.id;
              setActionMenuState(null);
              handleDeleteDirective(targetId);
            }}
            className="w-full px-2.5 py-1.5 rounded-[4px] flex items-center gap-2.5 text-left text-rose-600 dark:text-rose-400 hover:bg-rose-500/15 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5 shrink-0" />
            <span>Delete Directive</span>
          </button>
        </div>
      )}

      {/* Floating Rounded-2xl Directive Inspector Drawer (Tight 8px Margin, Flush Right Scrollbar) */}
      <AnimatePresence>
        {inspectedDirective && (
          <motion.div
            key="directive-inspector-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex justify-end p-2 bg-black/50 backdrop-blur-[2px]"
            onClick={() => setInspectedDirective(null)}
          >
            <motion.div
              key="directive-inspector-panel"
              role="dialog"
              aria-label={`Directive Inspector: ${inspectedDirective.id}`}
              initial={{ x: 440, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 440, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 34, mass: 0.9 }}
              className="w-full max-w-[430px] h-full rounded-2xl hairline-border flex flex-col justify-between shadow-2xl overflow-hidden"
              style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="space-y-3 px-5 pt-4 pb-3.5 hairline-border-b shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <h2 className="text-base font-bold font-mono-data truncate">
                      {inspectedDirective.id}
                    </h2>
                    <span className="px-2 py-0.5 rounded-[3px] text-[10px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                      {classifyDirective(inspectedDirective).toUpperCase()}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setInspectedDirective(null)}
                    className="p-1.5 rounded-lg hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
                    style={{ color: 'var(--text-secondary)' }}
                    aria-label="Close inspector drawer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleTogglePin(inspectedDirective)}
                    className="px-3 py-1.5 reui-btn-secondary text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <Pin className="w-3.5 h-3.5 text-emerald-500" />
                    <span>{inspectedDirective.is_pinned === 1 ? 'Unpin' : 'Pin Directive'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpenEditDrawer(inspectedDirective)}
                    className="px-3 py-1.5 reui-btn-secondary text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>

                  {inspectedDirective.workspace !== 'global' && (
                    <button
                      type="button"
                      onClick={() => handlePromoteGlobal(inspectedDirective)}
                      className="px-3 py-1.5 reui-btn-secondary text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <Globe className="w-3.5 h-3.5 text-sky-500" />
                      <span>Global</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Scrollable Body (Flush to Right Edge) */}
              <div
                className="flex-1 overflow-y-auto px-5 py-4 space-y-4"
                data-testid="directive-inspector-scroll"
              >
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--text-secondary)' }}>Workspace Scope</span>
                    <span className="font-mono-data font-semibold">{inspectedDirective.workspace}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--text-secondary)' }}>Type &amp; Provenance</span>
                    <span className="font-mono-data">
                      {inspectedDirective.type} • {inspectedDirective.source}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--text-secondary)' }}>Confidence</span>
                    <span className="font-mono-data font-semibold">
                      {Math.round(inspectedDirective.confidence * 100)}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--text-secondary)' }}>Injection Weight</span>
                    <span className="font-mono-data font-semibold">
                      ~{estimateTokens(formatDirectivePromptLine(inspectedDirective))} tokens
                    </span>
                  </div>
                </div>

                <div className="pt-3 hairline-border-t space-y-2">
                  <div
                    className="text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Stored Directive Content
                  </div>
                  <div
                    className="p-3.5 rounded-xl hairline-border text-xs leading-relaxed"
                    style={{ backgroundColor: 'var(--bg-elevated)' }}
                  >
                    {inspectedDirective.content}
                  </div>
                </div>

                <div className="pt-3 hairline-border-t space-y-2">
                  <div
                    className="text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Exact MCP Prompt Line
                  </div>
                  <pre
                    className="p-3 rounded-xl hairline-border font-mono-data text-[11px] whitespace-pre-wrap break-words"
                    style={{ backgroundColor: 'var(--bg-elevated)' }}
                  >
                    {formatDirectivePromptLine(inspectedDirective)}
                  </pre>
                </div>
              </div>

              <div
                className="px-5 py-3.5 hairline-border-t flex items-center justify-between shrink-0"
                style={{ backgroundColor: 'var(--bg-elevated)' }}
              >
                <button
                  type="button"
                  onClick={() => handleDeleteDirective(inspectedDirective.id)}
                  className="px-3 py-1.5 rounded-[4px] border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-medium flex items-center gap-1.5 hover:bg-rose-500/20 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInspectedDirective(null)}
                  className="px-3 py-1.5 reui-btn-secondary text-xs cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Rounded-2xl Create / Edit Directive Drawer (Tight 8px Margin, Flush Right Scrollbar) */}
      <AnimatePresence>
        {showEditorDrawer && (
          <motion.div
            key="directive-editor-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex justify-end p-2 bg-black/50 backdrop-blur-[2px]"
            onClick={() => setShowEditorDrawer(false)}
          >
            <motion.form
              key="directive-editor-panel"
              role="dialog"
              aria-label={editingDirective ? 'Edit Core Directive' : 'Create Core Directive'}
              initial={{ x: 460, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 460, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 34, mass: 0.9 }}
              onSubmit={handleSaveEditor}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[460px] h-full rounded-2xl hairline-border shadow-2xl flex flex-col justify-between overflow-hidden"
              style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
            >
              {/* Header */}
              <div className="px-5 pt-4 pb-3.5 hairline-border-b flex items-center justify-between shrink-0">
                <div>
                  <h3 className="text-sm font-bold">
                    {editingDirective ? 'Edit Core Directive' : 'Create Core Directive'}
                  </h3>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                    Injected automatically via memory://core-directives
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowEditorDrawer(false)}
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
                  aria-label="Close directive editor drawer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Scrollable Body (Flush Right Scrollbar) */}
              <div
                className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs"
                data-testid="directive-editor-scroll"
              >
                {!editingDirective && (
                  <div>
                    <label className="block font-semibold mb-1.5">Directive Template</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'rule' as const, label: '[RULE] Standard' },
                        { id: 'anti_pattern' as const, label: 'Anti-Pattern' },
                        { id: 'custom' as const, label: 'Custom Text' },
                      ].map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            setPresetKind(opt.id);
                            if (opt.id === 'rule' && !editorContent.trim()) {
                              setEditorContent('[RULE] ');
                            }
                          }}
                          className={`px-2.5 py-2 rounded-[4px] text-xs font-medium cursor-pointer transition-colors ${
                            presetKind === opt.id ? 'reui-btn-primary' : 'reui-btn-secondary'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block font-semibold mb-1.5">Workspace Scope</label>
                  <CustomSelect
                    ariaLabel="Directive Workspace Scope"
                    value={editorWorkspace}
                    options={workspaceSelectOptions}
                    onChange={(ws) => setEditorWorkspace(ws)}
                    size="sm"
                    mono
                  />
                </div>

                {!editingDirective && presetKind === 'anti_pattern' ? (
                  <div className="space-y-3">
                    <div>
                      <label htmlFor="anti-context" className="block font-semibold mb-1">
                        When (Context / Trigger)
                      </label>
                      <input
                        id="anti-context"
                        type="text"
                        required
                        value={antiContext}
                        onChange={(e) => setAntiContext(e.target.value)}
                        placeholder="e.g. Editing database connection pool or migration scripts"
                        className="w-full px-3 py-2 rounded-[4px] hairline-border text-xs focus:outline-none"
                        style={{
                          backgroundColor: 'var(--bg-elevated)',
                          color: 'var(--text-primary)',
                        }}
                      />
                    </div>
                    <div>
                      <label htmlFor="anti-avoid" className="block font-semibold mb-1">
                        Avoid (Mistake / Failure Mode)
                      </label>
                      <input
                        id="anti-avoid"
                        type="text"
                        required
                        value={antiAvoid}
                        onChange={(e) => setAntiAvoid(e.target.value)}
                        placeholder="e.g. Opening unpooled connections inside async loops"
                        className="w-full px-3 py-2 rounded-[4px] hairline-border text-xs focus:outline-none"
                        style={{
                          backgroundColor: 'var(--bg-elevated)',
                          color: 'var(--text-primary)',
                        }}
                      />
                    </div>
                    <div>
                      <label htmlFor="anti-rule" className="block font-semibold mb-1">
                        Directive (Correct Action)
                      </label>
                      <textarea
                        id="anti-rule"
                        rows={3}
                        required
                        value={antiRule}
                        onChange={(e) => setAntiRule(e.target.value)}
                        placeholder="e.g. Always reuse the shared SQLite WAL context manager get_db()."
                        className="w-full px-3 py-2 rounded-[4px] hairline-border text-xs focus:outline-none"
                        style={{
                          backgroundColor: 'var(--bg-elevated)',
                          color: 'var(--text-primary)',
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label htmlFor="directive-content" className="font-semibold">
                        Directive Content
                      </label>
                      <span
                        className="font-mono-data text-[10px]"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        ~{estimateTokens(composedContent)} tok
                      </span>
                    </div>
                    <textarea
                      id="directive-content"
                      rows={5}
                      required
                      value={editorContent}
                      onChange={(e) => setEditorContent(e.target.value)}
                      placeholder="[RULE] Keep agent instructions crisp, verifiable, and non-redundant..."
                      className="w-full p-3 rounded-[4px] hairline-border text-xs leading-relaxed focus:outline-none"
                      style={{
                        backgroundColor: 'var(--bg-elevated)',
                        color: 'var(--text-primary)',
                      }}
                    />
                  </div>
                )}

                {composedContent && (
                  <div
                    className="p-3 rounded-lg hairline-border space-y-1"
                    style={{ backgroundColor: 'var(--bg-elevated)' }}
                  >
                    <div
                      className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <span>Live Injection Output</span>
                      <span className="font-mono-data">~{estimateTokens(composedContent)} tok</span>
                    </div>
                    <p className="font-mono-data text-[11px] break-words">{composedContent}</p>
                  </div>
                )}

                <div>
                  <label className="block font-semibold mb-1.5">
                    Confidence Score: {(editorConfidence * 100).toFixed(0)}%
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="1"
                    step="0.01"
                    value={editorConfidence}
                    onChange={(e) => setEditorConfidence(Number(e.target.value))}
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                </div>

                <label className="flex items-center gap-2 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={editorPinned}
                    onChange={(e) => setEditorPinned(e.target.checked)}
                    className="rounded accent-emerald-500 cursor-pointer"
                  />
                  <span>Pin to memory://core-directives (Always-On Prompt Baseline)</span>
                </label>
              </div>

              {/* Footer */}
              <div
                className="px-5 py-3.5 hairline-border-t flex items-center justify-end gap-2 shrink-0"
                style={{ backgroundColor: 'var(--bg-elevated)' }}
              >
                <button
                  type="button"
                  onClick={() => setShowEditorDrawer(false)}
                  className="px-3 py-1.5 reui-btn-secondary text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEditor || !composedContent}
                  className="px-3.5 py-1.5 reui-btn-primary text-xs cursor-pointer disabled:opacity-45"
                >
                  {savingEditor
                    ? 'Saving...'
                    : editingDirective
                      ? 'Save Changes'
                      : 'Create Directive'}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
