import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CheckCircle2,
  Clock,
  Database,
  Download,
  Edit3,
  Eye,
  FileJson,
  Filter,
  FolderGit2,
  History,
  Layers,
  MessageSquare,
  MoreHorizontal,
  Pause,
  Pin,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { engramApi } from '../api/client';
import { Dictionary } from '../i18n';
import {
  MemoryHistoryChain,
  MemoryRecord,
  MemoryType,
  StatsResponse,
} from '../types/engram';
import { CustomSelect } from './ui/CustomSelect';

interface ExplorerTabProps {
  memories: MemoryRecord[];
  stats?: StatsResponse | null;
  activeWorkspace: string;
  workspaces: string[];
  dict: Dictionary;
  openImportModalExternal: boolean;
  onCloseImportModalExternal: () => void;
  openNewMemoryExternal: boolean;
  onCloseNewMemoryExternal: () => void;
  inspectedMemoryExternal: MemoryRecord | null;
  onClearInspectedMemoryExternal: () => void;
  onRefresh: () => Promise<void>;
  onExportJson: () => Promise<void>;
}

const MEMORY_TYPE_OPTIONS = [
  { value: 'semantic', label: 'Semantic', sublabel: 'Facts, architecture & domain state', badge: 'fact' },
  { value: 'procedural', label: 'Procedural', sublabel: 'Rules, directives & anti-patterns', badge: 'rule' },
  { value: 'episodic', label: 'Episodic', sublabel: 'Session events & temporal logs', badge: 'event' },
];

const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10' },
  { value: '20', label: '20' },
  { value: '50', label: '50' },
];

function extractKeywords(content: string, workspace: string): string[] {
  const tags = new Set<string>();
  const lower = content.toLowerCase();
  if (lower.includes('mtls') || lower.includes('tls') || lower.includes('oauth')) tags.add('mTLS / OAuth2');
  if (lower.includes('sqlite') || lower.includes('wal')) tags.add('SQLite WAL');
  if (lower.includes('vec') || lower.includes('embedding')) tags.add('sqlite-vec');
  if (lower.includes('mcp') || lower.includes('sse')) tags.add('Dual-Transport MCP');
  if (lower.includes('payment') || lower.includes('gateway')) tags.add('Payment Gateway');
  if (lower.includes('fastembed') || lower.includes('onnx')) tags.add('FastEmbed ONNX');
  if (lower.includes('settlement') || lower.includes('batch')) tags.add('Batch Settlement');
  tags.add(`ws:${workspace}`);
  return Array.from(tags).slice(0, 4);
}

export const ExplorerTab: React.FC<ExplorerTabProps> = ({
  memories,
  stats,
  activeWorkspace,
  workspaces,
  dict,
  openImportModalExternal,
  onCloseImportModalExternal,
  openNewMemoryExternal,
  onCloseNewMemoryExternal,
  inspectedMemoryExternal,
  onClearInspectedMemoryExternal,
  onRefresh,
  onExportJson,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showFilterBar, setShowFilterBar] = useState(false);

  // Selection & Pagination state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState<string>('10');
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Horizontal scroll shadow & single popover menu for pinned Actions column
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const [showActionsShadow, setShowActionsShadow] = useState(false);
  const [actionMenuState, setActionMenuState] = useState<{
    memory: MemoryRecord;
    top: number;
    left: number;
    openUp: boolean;
  } | null>(null);

  // Floating Rounded Inspector & Rollback Drawer state
  const [drawerMemory, setDrawerMemory] = useState<MemoryRecord | null>(null);
  const [historyChain, setHistoryChain] = useState<MemoryHistoryChain | null>(null);
  const [rollingBack, setRollingBack] = useState(false);

  // Import / Bulk Seed Modal state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importTab, setImportTab] = useState<'json' | 'bulk'>('bulk');
  const [bulkText, setBulkText] = useState(
    '- [RULE] Always use parameterized SQL queries in SQLite WAL mode.\n- [ANTI-PATTERN] Never store unmasked Bearer or sk- API keys in raw memory rows.'
  );
  const [jsonInputText, setJsonInputText] = useState('');
  const [seedWorkspace, setSeedWorkspace] = useState(
    activeWorkspace === 'all' ? 'global' : activeWorkspace
  );
  const [seedType, setSeedType] = useState<MemoryType>('procedural');
  const [autoPinAll, setAutoPinAll] = useState(true);
  const [importing, setImporting] = useState(false);

  // Create / Edit Memory Modal state
  const [showEditorModal, setShowEditorModal] = useState(false);
  const [editingMemory, setEditingMemory] = useState<MemoryRecord | null>(null);
  const [editorWorkspace, setEditorWorkspace] = useState('global');
  const [editorContent, setEditorContent] = useState('');
  const [editorType, setEditorType] = useState<MemoryType>('semantic');
  const [editorConfidence, setEditorConfidence] = useState(0.95);
  const [editorPinned, setEditorPinned] = useState(false);
  const [editorSupersedesId, setEditorSupersedesId] = useState<string>('');
  const [savingEditor, setSavingEditor] = useState(false);

  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  const workspaceSelectOptions = workspaces
    .filter((w) => w !== 'all')
    .map((w) => ({
      value: w,
      label: w,
      badge: w === 'global' ? 'root' : 'ws',
    }));

  useEffect(() => {
    if (openImportModalExternal) {
      setShowImportModal(true);
      onCloseImportModalExternal();
    }
  }, [openImportModalExternal, onCloseImportModalExternal]);

  useEffect(() => {
    if (openNewMemoryExternal) {
      handleOpenCreateModal();
      onCloseNewMemoryExternal();
    }
  }, [openNewMemoryExternal, onCloseNewMemoryExternal]);

  useEffect(() => {
    if (inspectedMemoryExternal) {
      handleOpenHistoryDrawer(inspectedMemoryExternal);
      onClearInspectedMemoryExternal();
    }
  }, [inspectedMemoryExternal, onClearInspectedMemoryExternal]);

  const filteredMemories = useMemo(() => {
    return memories.filter((m) => {
      if (activeWorkspace !== 'all' && m.workspace !== activeWorkspace) return false;
      if (typeFilter !== 'all' && m.type !== typeFilter) return false;
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hay = `${m.content} ${m.id} ${m.source} ${m.workspace} ${m.type}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [memories, activeWorkspace, typeFilter, statusFilter, searchQuery]);

  const numericPageSize = Number(pageSize) || 10;
  const totalPages = Math.max(1, Math.ceil(filteredMemories.length / numericPageSize));
  const paginatedMemories = useMemo(() => {
    const start = (currentPage - 1) * numericPageSize;
    return filteredMemories.slice(start, start + numericPageSize);
  }, [filteredMemories, currentPage, numericPageSize]);

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
  }, [updateActionsShadow, paginatedMemories.length, activeWorkspace, typeFilter, statusFilter]);

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

  // Domain-accurate KPI metrics
  const totalCount = memories.length;
  const activeCount = stats ? stats.active_memories : memories.filter((m) => m.status === 'active').length;
  const supersededCount = stats
    ? stats.superseded_memories
    : memories.filter((m) => m.status === 'superseded').length;
  const pinnedCount = stats
    ? stats.pinned_memories
    : memories.filter((m) => m.is_pinned === 1).length;
  const avgLatency = stats ? `${stats.token_efficiency.avg_latency_ms}ms` : '13.2ms';
  const avgConfidencePct = useMemo(() => {
    if (memories.length === 0) return 95;
    const sum = memories.reduce((acc, m) => acc + m.confidence, 0);
    return Math.round((sum / memories.length) * 100);
  }, [memories]);

  const handleOpenHistoryDrawer = async (memory: MemoryRecord) => {
    setDrawerMemory(memory);
    const chain = await engramApi.getMemoryHistory(memory.id);
    setHistoryChain(chain);
  };

  const handleRollback = async (memoryId: string) => {
    setRollingBack(true);
    try {
      const res = await engramApi.rollbackMemory(memoryId);
      await onRefresh();
      const updatedChain = await engramApi.getMemoryHistory(res.restored_memory.id);
      setDrawerMemory(res.restored_memory);
      setHistoryChain(updatedChain);
      setBannerMessage(`Rolled back memory ${memoryId} to active head status.`);
      setTimeout(() => setBannerMessage(null), 4000);
    } finally {
      setRollingBack(false);
    }
  };

  const handleTogglePin = async (memory: MemoryRecord) => {
    const nextPinned = memory.is_pinned !== 1;
    const updated = await engramApi.updateMemory(memory.id, { is_pinned: nextPinned });
    if (drawerMemory?.id === memory.id) {
      setDrawerMemory(updated);
    }
    await onRefresh();
    setBannerMessage(
      nextPinned
        ? `Pinned ${memory.id} to core-directives.`
        : `Unpinned ${memory.id} from core-directives.`
    );
    setTimeout(() => setBannerMessage(null), 3000);
  };

  const handleDeleteMemory = async (memoryId: string) => {
    await engramApi.deleteMemory(memoryId);
    if (drawerMemory?.id === memoryId) {
      setDrawerMemory(null);
    }
    setSelectedIds((prev) => prev.filter((id) => id !== memoryId));
    await onRefresh();
    setBannerMessage(`Deleted memory ${memoryId}.`);
    setTimeout(() => setBannerMessage(null), 3000);
  };

  // Real Bulk Actions on selected checkboxes
  const handleBulkTogglePin = async () => {
    if (selectedIds.length === 0) return;
    const targets = memories.filter((m) => selectedIds.includes(m.id));
    for (const mem of targets) {
      await engramApi.updateMemory(mem.id, { is_pinned: mem.is_pinned !== 1 });
    }
    await onRefresh();
    setBannerMessage(`Updated pin status for ${targets.length} selected memories.`);
    setTimeout(() => setBannerMessage(null), 3000);
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    const count = selectedIds.length;
    for (const id of selectedIds) {
      await engramApi.deleteMemory(id);
      if (drawerMemory?.id === id) {
        setDrawerMemory(null);
      }
    }
    setSelectedIds([]);
    await onRefresh();
    setBannerMessage(`Deleted ${count} selected memories.`);
    setTimeout(() => setBannerMessage(null), 3000);
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = paginatedMemories.map((m) => m.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const handleOpenCreateModal = () => {
    setEditingMemory(null);
    setEditorWorkspace(activeWorkspace === 'all' ? 'global' : activeWorkspace);
    setEditorContent('');
    setEditorType('semantic');
    setEditorConfidence(0.95);
    setEditorPinned(false);
    setEditorSupersedesId('');
    setShowEditorModal(true);
  };

  const handleOpenEditModal = (memory: MemoryRecord) => {
    setEditingMemory(memory);
    setEditorWorkspace(memory.workspace);
    setEditorContent(memory.content);
    setEditorType(memory.type);
    setEditorConfidence(memory.confidence);
    setEditorPinned(memory.is_pinned === 1);
    setEditorSupersedesId(memory.supersedes_id || '');
    setShowEditorModal(true);
  };

  const handleSaveEditor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editorContent.trim()) return;
    setSavingEditor(true);
    try {
      if (editingMemory) {
        const updated = await engramApi.updateMemory(editingMemory.id, {
          workspace: editorWorkspace,
          content: editorContent,
          type: editorType,
          confidence: editorConfidence,
          is_pinned: editorPinned,
        });
        if (drawerMemory?.id === editingMemory.id) {
          setDrawerMemory(updated);
        }
        setBannerMessage(`Updated memory ${editingMemory.id}`);
      } else {
        const res = await engramApi.createMemory({
          workspace: editorWorkspace,
          content: editorContent,
          type: editorType,
          confidence: editorConfidence,
          is_pinned: editorPinned,
          supersedes_id: editorSupersedesId.trim() || null,
        });
        setBannerMessage(`Stored memory ${res.memory.id} (${res.action})`);
      }
      setShowEditorModal(false);
      await onRefresh();
      setTimeout(() => setBannerMessage(null), 4000);
    } finally {
      setSavingEditor(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setJsonInputText(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handleRunImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setImporting(true);
    try {
      if (importTab === 'bulk') {
        const res = await engramApi.importBackup({
          workspace: seedWorkspace,
          type: seedType,
          auto_pin: autoPinAll,
          bulk_text: bulkText,
        });
        setBannerMessage(`Bulk seeded ${res.imported_count} memories into "${seedWorkspace}".`);
      } else {
        const parsed = JSON.parse(jsonInputText || '{}');
        const memArray = Array.isArray(parsed) ? parsed : parsed.memories || [];
        const res = await engramApi.importBackup({
          workspace: seedWorkspace,
          type: seedType,
          auto_pin: autoPinAll,
          memories: memArray,
        });
        setBannerMessage(`Imported ${res.imported_count} memories from JSON backup.`);
      }
      setShowImportModal(false);
      await onRefresh();
      setTimeout(() => setBannerMessage(null), 4000);
    } catch (err) {
      setBannerMessage(`Import error: ${err instanceof Error ? err.message : 'Invalid JSON'}`);
    } finally {
      setImporting(false);
    }
  };

  const allOnPageSelected =
    paginatedMemories.length > 0 &&
    paginatedMemories.every((m) => selectedIds.includes(m.id));

  return (
    <div className="space-y-4 pb-6">
      {/* Feedback Banner */}
      {bannerMessage && (
        <div className="px-3.5 py-2.5 rounded-[4px] bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs flex items-center justify-between">
          <span className="flex items-center gap-2 font-mono-data">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {bannerMessage}
          </span>
          <button type="button" onClick={() => setBannerMessage(null)}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Unified ReUI Signal "Memory Scorecard & Ledger" Card */}
      <div className="reui-card overflow-hidden">
        {/* Card Header Bar: Title on Left, Search + Filter + Bulk Actions + Import/Export/Add on Right */}
        <div className="px-4 py-3 hairline-border-b flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {dict.explorer.title}
            </h1>
            <span className="text-xs hidden md:inline" style={{ color: 'var(--text-muted)' }}>
              •
            </span>
            <span
              className="text-xs truncate hidden md:inline"
              style={{ color: 'var(--text-secondary)' }}
            >
              {activeWorkspace === 'all' ? 'All Workspaces' : `ws:${activeWorkspace}`}, bi-temporal sqlite-vec ledger
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Bulk Pin & Bulk Delete (Strictly tied to selectedIds, disabled when 0 selected) */}
            <button
              type="button"
              disabled={selectedIds.length === 0}
              onClick={handleBulkTogglePin}
              className="h-7 px-2 reui-btn-secondary flex items-center gap-1 text-xs disabled:opacity-35 cursor-pointer"
              title={
                selectedIds.length > 0
                  ? `Pin / Unpin ${selectedIds.length} selected memories`
                  : 'Select memories via checkbox to bulk pin/unpin'
              }
            >
              <Pin className="w-3.5 h-3.5 text-emerald-400" />
              {selectedIds.length > 0 && (
                <span className="font-mono-data text-[11px]">{selectedIds.length}</span>
              )}
            </button>

            <button
              type="button"
              disabled={selectedIds.length === 0}
              onClick={handleBulkDelete}
              className="h-7 px-2 reui-btn-secondary flex items-center gap-1 text-xs text-rose-400 disabled:opacity-35 cursor-pointer"
              title={
                selectedIds.length > 0
                  ? `Delete ${selectedIds.length} selected memories`
                  : 'Select memories via checkbox to bulk delete'
              }
            >
              <Trash2 className="w-3.5 h-3.5" />
              {selectedIds.length > 0 && (
                <span className="font-mono-data text-[11px]">{selectedIds.length}</span>
              )}
            </button>

            {/* Search Input */}
            <div
              className="h-7 px-2.5 rounded-[4px] hairline-border flex items-center gap-2 w-48 sm:w-56"
              style={{ backgroundColor: 'var(--bg-elevated)' }}
            >
              <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-secondary)' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search memories..."
                className="w-full bg-transparent text-xs focus:outline-none"
                style={{ color: 'var(--text-primary)' }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Filter Toggle */}
            <button
              type="button"
              onClick={() => setShowFilterBar((prev) => !prev)}
              className={`h-7 px-2.5 rounded-[4px] hairline-border text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                showFilterBar || typeFilter !== 'all' || statusFilter !== 'all'
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : 'reui-btn-secondary'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Filter</span>
            </button>

            {/* Refresh */}
            <button
              type="button"
              onClick={() => onRefresh()}
              className="h-7 w-7 reui-btn-secondary flex items-center justify-center cursor-pointer"
              title="Refresh Memory Table"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            {/* Import / Bulk Seed */}
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="h-7 px-2.5 reui-btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              title="Import JSON or Bulk Seed Memories"
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Import</span>
            </button>

            {/* Export JSON */}
            <button
              type="button"
              onClick={onExportJson}
              className="h-7 px-2.5 reui-btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              title="Export Workspace JSON"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export</span>
            </button>

            {/* Primary CTA: + Add Memory */}
            <button
              type="button"
              onClick={handleOpenCreateModal}
              className="h-7 px-3 reui-btn-primary text-xs flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Memory</span>
            </button>
          </div>
        </div>

        {/* Collapsible Filter Bar */}
        {showFilterBar && (
          <div
            className="px-4 py-2.5 hairline-border-b flex flex-wrap items-center justify-between gap-3"
            style={{ backgroundColor: 'var(--bg-elevated)' }}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold mr-1" style={{ color: 'var(--text-secondary)' }}>
                Type:
              </span>
              {[
                { id: 'all', label: dict.explorer.typeAll },
                { id: 'semantic', label: dict.explorer.typeSemantic },
                { id: 'procedural', label: dict.explorer.typeProcedural },
                { id: 'episodic', label: dict.explorer.typeEpisodic },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTypeFilter(t.id);
                    setCurrentPage(1);
                  }}
                  className={`px-2 py-0.5 rounded-[3px] text-[11px] font-medium transition-all cursor-pointer ${
                    typeFilter === t.id ? 'reui-btn-primary' : 'reui-btn-secondary'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold mr-1" style={{ color: 'var(--text-secondary)' }}>
                Status:
              </span>
              {[
                { id: 'all', label: dict.explorer.statusAll },
                { id: 'active', label: dict.explorer.statusActive },
                { id: 'superseded', label: dict.explorer.statusSuperseded },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setStatusFilter(s.id);
                    setCurrentPage(1);
                  }}
                  className={`px-2 py-0.5 rounded-[3px] text-[11px] font-medium transition-all cursor-pointer ${
                    statusFilter === s.id ? 'reui-btn-primary' : 'reui-btn-secondary'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ReUI Signal 4-Column Divided Summary Header Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-[var(--border-hairline)] hairline-border-b">
          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Active Ratio
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono-data text-xl font-bold">
                {Math.round((activeCount / Math.max(1, totalCount)) * 100)}%
              </span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {activeCount} of {totalCount} active in WAL
              </span>
            </div>
          </div>

          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Core Directives
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono-data text-xl font-bold">{pinnedCount}</span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                pinned to engram://core-directives
              </span>
            </div>
          </div>

          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Confidence Avg
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono-data text-xl font-bold">{avgConfidencePct}%</span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Recall latency {avgLatency}
              </span>
            </div>
          </div>

          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Ledger Status
            </div>
            <div className="flex items-center gap-3 text-xs font-mono-data pt-0.5">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <strong style={{ color: 'var(--text-primary)' }}>{activeCount}</strong>
                <span style={{ color: 'var(--text-muted)' }}>Active</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <strong style={{ color: 'var(--text-primary)' }}>{supersededCount}</strong>
                <span style={{ color: 'var(--text-muted)' }}>Superseded</span>
              </span>
            </div>
          </div>
        </div>

        {/* High-Density ReUI Signal Data Table with Pinned Actions Column & Scroll-Aware Shadow */}
        <div
          ref={tableScrollRef}
          onScroll={updateActionsShadow}
          className="overflow-x-auto relative"
          data-testid="explorer-table-scroll"
        >
          <table className="w-full min-w-[1360px] text-left border-separate border-spacing-0">
            <thead>
              <tr
                className="text-[11px] font-medium whitespace-nowrap"
                style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
              >
                <th className="py-2.5 px-3 w-8 hairline-border-b">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleSelectAllOnPage}
                    className="w-3.5 h-3.5 rounded-[3px] accent-emerald-500 cursor-pointer"
                    aria-label="Select all memories on page"
                  />
                </th>
                <th className="py-2.5 px-3 hairline-border-b">Memory ID</th>
                <th className="py-2.5 px-3 min-w-[360px] hairline-border-b">Objective &amp; Memory Content</th>
                <th className="py-2.5 px-3 hairline-border-b">Workspace</th>
                <th className="py-2.5 px-3 hairline-border-b">Type</th>
                <th className="py-2.5 px-3 hairline-border-b">Status</th>
                <th className="py-2.5 px-3 hairline-border-b">Conf.</th>
                <th className="py-2.5 px-3 hairline-border-b">Source</th>
                <th className="py-2.5 px-3 hairline-border-b">Valid From</th>
                <th
                  className="sticky right-0 z-10 py-2.5 px-3 text-center w-[76px] hairline-border-b transition-shadow duration-150"
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
              {paginatedMemories.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="py-12 text-center text-xs"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {dict.explorer.table.empty}
                  </td>
                </tr>
              ) : (
                paginatedMemories.map((m) => {
                  const isSelected =
                    selectedIds.includes(m.id) || drawerMemory?.id === m.id;
                  const isActive = m.status === 'active';
                  const confPct = Math.round(m.confidence * 100);
                  const isMenuOpen = actionMenuState?.memory.id === m.id;

                  return (
                    <tr
                      key={m.id}
                      onClick={() => handleOpenHistoryDrawer(m)}
                      className="group transition-colors cursor-pointer hover:bg-[var(--bg-elevated)]"
                      style={{
                        backgroundColor: isSelected ? 'var(--bg-row-selected)' : undefined,
                      }}
                    >
                      {/* Checkbox */}
                      <td
                        className="py-2.5 px-3 whitespace-nowrap hairline-border-b"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(m.id)}
                          onChange={() => toggleSelectRow(m.id)}
                          className="w-3.5 h-3.5 rounded-[3px] accent-emerald-500 cursor-pointer"
                        />
                      </td>

                      {/* Memory ID */}
                      <td className="py-2.5 px-3 whitespace-nowrap hairline-border-b">
                        <div className="flex items-center gap-1.5">
                          {m.is_pinned === 1 && (
                            <Pin className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          )}
                          <span
                            className="font-mono-data font-semibold text-[11px]"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {m.id}
                          </span>
                        </div>
                      </td>

                      {/* Memory Content */}
                      <td className="py-2.5 px-3 max-w-[380px] hairline-border-b">
                        <div
                          className="line-clamp-2 leading-relaxed font-normal text-xs"
                          style={{ color: 'var(--text-primary)' }}
                          title={m.content}
                        >
                          {m.content}
                        </div>
                      </td>

                      {/* Workspace */}
                      <td className="py-2.5 px-3 whitespace-nowrap hairline-border-b">
                        <span className="inline-flex items-center gap-1.5 font-mono-data text-[11px]">
                          <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                          <span>{m.workspace}</span>
                        </span>
                      </td>

                      {/* Memory Type */}
                      <td className="py-2.5 px-3 whitespace-nowrap hairline-border-b">
                        <span
                          className={`font-mono-data text-[11px] px-1.5 py-0.5 rounded-[3px] border ${
                            m.type === 'procedural'
                              ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/25'
                              : m.type === 'semantic'
                                ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/25'
                                : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/25'
                          }`}
                        >
                          {m.type}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-2.5 px-3 whitespace-nowrap hairline-border-b">
                        {isActive ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[3px] text-[11px] font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                            <span>Active</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[3px] text-[11px] font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/25">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
                            <span>Superseded</span>
                          </span>
                        )}
                      </td>

                      {/* Confidence with ReUI Scorecard Tinted Cell Pill */}
                      <td className="py-2.5 px-3 whitespace-nowrap hairline-border-b">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-[3px] font-mono-data text-[11px] font-semibold ${
                            confPct >= 90
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                              : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {confPct}%
                        </span>
                      </td>

                      {/* Source */}
                      <td
                        className="py-2.5 px-3 whitespace-nowrap font-mono-data text-[11px] hairline-border-b"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {m.source}
                      </td>

                      {/* Valid From */}
                      <td
                        className="py-2.5 px-3 whitespace-nowrap font-mono-data text-[11px] hairline-border-b"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {m.valid_from.slice(0, 10)}
                      </td>

                      {/* Pinned Sticky Right Actions Column (Single Trigger -> Popover Menu List) */}
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
                            const openUp = window.innerHeight - rect.bottom < 200;
                            setActionMenuState({
                              memory: m,
                              top: openUp ? rect.top - 6 : rect.bottom + 6,
                              left: Math.min(window.innerWidth - 224, Math.max(12, rect.right - 208)),
                              openUp,
                            });
                          }}
                          aria-label={`Actions for ${m.id}`}
                          aria-haspopup="menu"
                          aria-expanded={isMenuOpen}
                          className={`w-7 h-7 rounded-[4px] inline-flex items-center justify-center transition-colors cursor-pointer ${
                            isMenuOpen ? 'bg-[var(--bg-elevated)] hairline-border' : 'hover:bg-[var(--bg-elevated)]'
                          }`}
                          style={{ color: 'var(--text-secondary)' }}
                          title="Open Actions Menu"
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

        {/* Single-Action Row Popover Menu List */}
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
                handleOpenHistoryDrawer(target);
              }}
              className="w-full px-2.5 py-1.5 rounded-[4px] flex items-center gap-2.5 text-left hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-secondary)' }} />
              <span>Inspect Snapshot &amp; Lineage</span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const target = actionMenuState.memory;
                setActionMenuState(null);
                handleOpenEditModal(target);
              }}
              className="w-full px-2.5 py-1.5 rounded-[4px] flex items-center gap-2.5 text-left hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
            >
              <Edit3 className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-secondary)' }} />
              <span>Edit Memory</span>
            </button>

            <div className="my-1 hairline-border-t" />

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const targetId = actionMenuState.memory.id;
                setActionMenuState(null);
                handleDeleteMemory(targetId);
              }}
              className="w-full px-2.5 py-1.5 rounded-[4px] flex items-center gap-2.5 text-left text-rose-600 dark:text-rose-400 hover:bg-rose-500/15 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" />
              <span>Delete Memory</span>
            </button>
          </div>
        )}

        {/* Bottom ReUI Signal Summary & Pagination Footer */}
        <div
          className="px-4 py-3 hairline-border-t flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
          style={{ backgroundColor: 'var(--bg-elevated)' }}
        >
          <div className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
            <span>Showing</span>
            <div className="w-16">
              <CustomSelect
                ariaLabel="Items per page"
                value={pageSize}
                options={PAGE_SIZE_OPTIONS}
                onChange={(val) => {
                  setPageSize(val);
                  setCurrentPage(1);
                }}
                size="xs"
                mono
                dropUp
              />
            </div>
            <span>items per page ({filteredMemories.length} total)</span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="px-2.5 py-1 rounded-[4px] reui-btn-secondary text-xs disabled:opacity-40 cursor-pointer"
            >
              Previous
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => setCurrentPage(page)}
                className={`w-7 h-7 rounded-[4px] text-xs font-mono-data font-medium transition-colors cursor-pointer ${
                  page === currentPage ? 'reui-btn-primary' : 'reui-btn-secondary'
                }`}
              >
                {page}
              </button>
            ))}

            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="px-2.5 py-1 rounded-[4px] reui-btn-secondary text-xs disabled:opacity-40 cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Floating Rounded-2xl Inspector & Rollback Drawer (Tight 8px Margin, Flush Right Scrollbar) */}
      <AnimatePresence>
        {drawerMemory && (
          <motion.div
            key="explorer-drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex justify-end p-2 bg-black/50 backdrop-blur-[2px]"
            onClick={() => setDrawerMemory(null)}
          >
            <motion.div
              key="explorer-drawer-panel"
              role="dialog"
              aria-label={`Memory Inspector: ${drawerMemory.id}`}
              initial={{ x: 440, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 440, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 34, mass: 0.9 }}
              className="w-full max-w-[430px] h-full rounded-2xl hairline-border flex flex-col justify-between shadow-2xl overflow-hidden"
              style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drawer Header */}
              <div className="space-y-3 px-5 pt-4 pb-3.5 hairline-border-b shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <h2 className="text-base font-bold font-mono-data truncate">
                      {drawerMemory.id}
                    </h2>
                    {drawerMemory.status === 'active' ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[3px] text-[11px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                        <span>Active</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[3px] text-[11px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
                        <span>Superseded</span>
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setDrawerMemory(null)}
                    className="p-1.5 rounded-lg hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
                    style={{ color: 'var(--text-secondary)' }}
                    aria-label="Close drawer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Action Buttons Row */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleTogglePin(drawerMemory)}
                    className="px-3 py-1.5 reui-btn-secondary text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <Pin className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                    <span>{drawerMemory.is_pinned === 1 ? 'Unpin' : 'Pin Directive'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpenEditModal(drawerMemory)}
                    className="px-3 py-1.5 reui-btn-secondary text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDeleteMemory(drawerMemory.id)}
                    className="px-3 py-1.5 rounded-[4px] border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-medium flex items-center gap-1.5 hover:bg-rose-500/20 transition-colors cursor-pointer ml-auto"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                </div>
              </div>

              {/* Scrollable Drawer Content (Flush to Right Edge) */}
              <div
                className="flex-1 overflow-y-auto px-5 py-4 space-y-5"
                data-testid="inspector-drawer-scroll"
              >
                {/* Memory Overview Key-Value List */}
                <div className="space-y-2.5">
                  <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    Memory Overview
                  </h3>
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                        Workspace
                      </span>
                      <span className="px-2 py-0.5 rounded-[3px] font-mono-data text-[11px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                        {drawerMemory.workspace}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                        Type &amp; Source
                      </span>
                      <span className="font-mono-data">
                        {drawerMemory.type} • {drawerMemory.source}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                        Confidence Score
                      </span>
                      <span className="font-mono-data font-semibold">
                        {Math.round(drawerMemory.confidence * 100)}% ({drawerMemory.confidence.toFixed(2)})
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                        Valid From
                      </span>
                      <span className="font-mono-data text-[11px]">
                        {drawerMemory.valid_from.slice(0, 19).replace('T', ' ')}
                      </span>
                    </div>
                    {drawerMemory.valid_until && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                          Valid Until
                        </span>
                        <span className="font-mono-data text-[11px] text-amber-600 dark:text-amber-400">
                          {drawerMemory.valid_until.slice(0, 19).replace('T', ' ')}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Memory Snapshot Quote Box + Extracted Entities */}
                <div className="pt-3 hairline-border-t space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    Memory Snapshot
                  </h3>

                  <div
                    className="p-3.5 rounded-xl hairline-border space-y-1.5"
                    style={{ backgroundColor: 'var(--bg-elevated)' }}
                  >
                    <div
                      className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <MessageSquare className="w-3 h-3" />
                      <span>STORED PAYLOAD</span>
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                      “{drawerMemory.content}”
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <div
                      className="text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      EXTRACTED TAGS &amp; SCOPE
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {extractKeywords(drawerMemory.content, drawerMemory.workspace).map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 rounded-[3px] text-[11px] font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Bi-Temporal Lineage & 1-Click Rollback Timeline */}
                <div className="pt-3 hairline-border-t space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                    <History className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                    <span>Bi-Temporal Lineage &amp; Trace</span>
                  </h3>

                  <div className="relative pl-6 space-y-3.5 before:content-[''] before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[1.5px] before:bg-[var(--border-hairline)]">
                    <div className="relative">
                      <span
                        className="absolute -left-6 top-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px]"
                        style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                      >
                        <Sparkles className="w-2.5 h-2.5" />
                      </span>
                      <div className="font-mono-data text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                        Secret Scrubber &amp; sqlite-vec
                      </div>
                      <div className="text-xs">
                        Indexed into vec0 table ({drawerMemory.type})
                      </div>
                    </div>

                    {historyChain &&
                      historyChain.history.map((ver, idx) => (
                        <div
                          key={ver.id}
                          className="relative p-2.5 rounded-xl hairline-border space-y-1.5"
                          style={{ backgroundColor: 'var(--bg-elevated)' }}
                        >
                          <span
                            className="absolute -left-6 top-2.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px]"
                            style={{
                              backgroundColor: 'var(--bg-elevated)',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            <Clock className="w-2.5 h-2.5" />
                          </span>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono-data text-[11px] font-semibold">
                              v{idx + 1} • {ver.id}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`px-1.5 py-0.5 rounded-[3px] font-mono-data text-[10px] font-semibold ${
                                  ver.status === 'active'
                                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                                }`}
                              >
                                {ver.status}
                              </span>
                              {ver.status === 'superseded' && (
                                <button
                                  type="button"
                                  disabled={rollingBack}
                                  onClick={() => handleRollback(ver.id)}
                                  className="px-2 py-0.5 rounded-[3px] text-[10px] font-semibold bg-amber-500 text-zinc-950 hover:bg-amber-400 flex items-center gap-1 cursor-pointer"
                                >
                                  <RotateCcw className="w-2.5 h-2.5" />
                                  Rollback
                                </button>
                              )}
                            </div>
                          </div>
                          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                            {ver.content}
                          </p>
                        </div>
                      ))}
                  </div>
                </div>
              </div>

              {/* Drawer Footer */}
              <div className="px-5 py-3.5 hairline-border-t flex items-center justify-between gap-2.5 shrink-0">
                {drawerMemory.status === 'superseded' ? (
                  <button
                    type="button"
                    disabled={rollingBack}
                    onClick={() => handleRollback(drawerMemory.id)}
                    className="px-3.5 py-2 rounded-[4px] text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-zinc-950 flex items-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{rollingBack ? 'Restoring...' : dict.explorer.drawer.rollbackBtn}</span>
                  </button>
                ) : (
                  <span className="font-mono-data text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                    ✓ Active Head Version
                  </span>
                )}

                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => setDrawerMemory(null)}
                    className="px-4 py-1.5 reui-btn-secondary text-xs cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenEditModal(drawerMemory)}
                    className="px-4 py-1.5 reui-btn-primary text-xs cursor-pointer"
                  >
                    Edit Memory
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Import / Bulk Seed Drawer (Replaces Modal Dialog) */}
      <AnimatePresence>
        {showImportModal && (
          <motion.div
            key="import-drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex justify-end p-2 bg-black/50 backdrop-blur-[2px]"
            onClick={() => setShowImportModal(false)}
          >
            <motion.form
              key="import-drawer-panel"
              role="dialog"
              aria-label={dict.explorer.importModal.title}
              initial={{ x: 480, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 480, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 34, mass: 0.9 }}
              onSubmit={handleRunImport}
              className="w-full max-w-[460px] h-full rounded-2xl hairline-border flex flex-col justify-between shadow-2xl overflow-hidden"
              style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drawer Header */}
              <div
                className="px-5 pt-4 pb-3.5 hairline-border-b flex items-center justify-between shrink-0"
                style={{ backgroundColor: 'var(--bg-elevated)' }}
              >
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Upload className="w-4 h-4" style={{ color: 'var(--accent-teal)' }} />
                  {dict.explorer.importModal.title}
                </h2>
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-surface)] transition-colors cursor-pointer"
                  style={{ color: 'var(--text-secondary)' }}
                  aria-label="Close import drawer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Scrollable Drawer Body (Flush Right Edge) */}
              <div
                className="flex-1 overflow-y-auto px-5 py-4 space-y-4"
                data-testid="import-drawer-scroll"
              >
                <div
                  className="grid grid-cols-2 gap-2 p-1 rounded-xl hairline-border"
                  style={{ backgroundColor: 'var(--bg-elevated)' }}
                >
                  <button
                    type="button"
                    onClick={() => setImportTab('json')}
                    className={`py-1.5 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      importTab === 'json' ? 'reui-btn-primary shadow-xs' : ''
                    }`}
                    style={importTab !== 'json' ? { color: 'var(--text-secondary)' } : undefined}
                  >
                    <FileJson className="w-3.5 h-3.5" />
                    {dict.explorer.importModal.tabJson}
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportTab('bulk')}
                    className={`py-1.5 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      importTab === 'bulk' ? 'reui-btn-primary shadow-xs' : ''
                    }`}
                    style={importTab !== 'bulk' ? { color: 'var(--text-secondary)' } : undefined}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {dict.explorer.importModal.tabBulk}
                  </button>
                </div>

                {importTab === 'json' ? (
                  <div className="space-y-3">
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      {dict.explorer.importModal.jsonDesc}
                    </p>
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={handleFileUpload}
                      className="block w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[var(--accent-primary)] file:text-[var(--accent-primary-fg)] cursor-pointer"
                    />
                    <textarea
                      rows={7}
                      value={jsonInputText}
                      onChange={(e) => setJsonInputText(e.target.value)}
                      placeholder='{"memories": [{"workspace": "global", "content": "Always use WAL mode", "type": "procedural", "is_pinned": 1}]}'
                      className="w-full p-3 rounded-lg hairline-border font-mono-data text-xs focus:outline-none"
                      style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      {dict.explorer.importModal.bulkDesc}
                    </p>
                    <textarea
                      rows={8}
                      value={bulkText}
                      onChange={(e) => setBulkText(e.target.value)}
                      className="w-full p-3 rounded-lg hairline-border font-mono-data text-xs focus:outline-none"
                      style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                    />
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <CustomSelect
                    label={dict.explorer.importModal.targetWorkspace}
                    value={seedWorkspace}
                    options={workspaceSelectOptions}
                    onChange={setSeedWorkspace}
                    icon={<FolderGit2 className="w-3.5 h-3.5" />}
                    mono
                  />

                  <CustomSelect
                    label={dict.explorer.importModal.memoryType}
                    value={seedType}
                    options={MEMORY_TYPE_OPTIONS}
                    onChange={(val) => setSeedType(val as MemoryType)}
                    icon={<Layers className="w-3.5 h-3.5" />}
                    mono
                  />
                </div>

                <label className="flex items-center gap-2 text-xs cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={autoPinAll}
                    onChange={(e) => setAutoPinAll(e.target.checked)}
                    className="rounded accent-emerald-500"
                  />
                  <span>{dict.explorer.importModal.autoPinAll}</span>
                </label>
              </div>

              {/* Drawer Footer */}
              <div
                className="px-5 py-3.5 hairline-border-t flex items-center justify-end gap-2 shrink-0"
                style={{ backgroundColor: 'var(--bg-elevated)' }}
              >
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-3.5 py-1.5 reui-btn-secondary text-xs cursor-pointer"
                >
                  {dict.explorer.importModal.cancel}
                </button>
                <button
                  type="submit"
                  disabled={importing}
                  className="px-4 py-1.5 reui-btn-primary text-xs cursor-pointer"
                >
                  {importing ? 'Importing...' : dict.explorer.importModal.submitImport}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create / Edit Memory Drawer (Replaces Modal Dialog) */}
      <AnimatePresence>
        {showEditorModal && (
          <motion.div
            key="editor-drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex justify-end p-2 bg-black/50 backdrop-blur-[2px]"
            onClick={() => setShowEditorModal(false)}
          >
            <motion.form
              key="editor-drawer-panel"
              role="dialog"
              aria-label={editingMemory ? `Edit Memory (${editingMemory.id})` : 'Create New Memory'}
              initial={{ x: 460, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 460, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 34, mass: 0.9 }}
              onSubmit={handleSaveEditor}
              className="w-full max-w-[440px] h-full rounded-2xl hairline-border flex flex-col justify-between shadow-2xl overflow-hidden"
              style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drawer Header */}
              <div
                className="px-5 pt-4 pb-3.5 hairline-border-b flex items-center justify-between shrink-0"
                style={{ backgroundColor: 'var(--bg-elevated)' }}
              >
                <h2 className="text-sm font-semibold">
                  {editingMemory ? `Edit Memory (${editingMemory.id})` : 'Create New Memory'}
                </h2>
                <button
                  type="button"
                  onClick={() => setShowEditorModal(false)}
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-surface)] transition-colors cursor-pointer"
                  style={{ color: 'var(--text-secondary)' }}
                  aria-label="Close memory editor drawer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Scrollable Drawer Body (Flush Right Edge) */}
              <div
                className="flex-1 overflow-y-auto px-5 py-4 space-y-4"
                data-testid="editor-drawer-scroll"
              >
                <div>
                  <label
                    className="block text-[11px] font-medium mb-1.5"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Memory Content (Secret Scrubber Active)
                  </label>
                  <textarea
                    rows={6}
                    required
                    value={editorContent}
                    onChange={(e) => setEditorContent(e.target.value)}
                    placeholder="Enter factual context, procedural directive, or anti-pattern..."
                    className="w-full p-3 rounded-lg hairline-border text-xs focus:outline-none leading-relaxed"
                    style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <CustomSelect
                    label="Workspace"
                    value={editorWorkspace}
                    options={workspaceSelectOptions}
                    onChange={setEditorWorkspace}
                    mono
                  />

                  <CustomSelect
                    label="Type"
                    value={editorType}
                    options={MEMORY_TYPE_OPTIONS}
                    onChange={(val) => setEditorType(val as MemoryType)}
                    mono
                  />
                </div>

                <div>
                  <label
                    className="block text-[11px] font-medium mb-1.5"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Confidence Score
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.1"
                    max="1.0"
                    value={editorConfidence}
                    onChange={(e) => setEditorConfidence(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg hairline-border text-xs font-mono-data"
                    style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                  />
                </div>

                {!editingMemory && (
                  <div>
                    <label
                      className="block text-[11px] font-medium mb-1.5"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Supersedes Memory ID (Optional — for bi-temporal state evolution)
                    </label>
                    <input
                      type="text"
                      value={editorSupersedesId}
                      onChange={(e) => setEditorSupersedesId(e.target.value)}
                      placeholder="e.g., mem-hermes-new-02"
                      className="w-full px-3 py-2 rounded-lg hairline-border text-xs font-mono-data"
                      style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                    />
                  </div>
                )}

                <label className="flex items-center gap-2 text-xs cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={editorPinned}
                    onChange={(e) => setEditorPinned(e.target.checked)}
                    className="rounded accent-emerald-500"
                  />
                  <span>Pin to Core Directives (`memory://core-directives/&#123;workspace&#125;`)</span>
                </label>
              </div>

              {/* Drawer Footer */}
              <div
                className="px-5 py-3.5 hairline-border-t flex items-center justify-end gap-2 shrink-0"
                style={{ backgroundColor: 'var(--bg-elevated)' }}
              >
                <button
                  type="button"
                  onClick={() => setShowEditorModal(false)}
                  className="px-3.5 py-1.5 reui-btn-secondary text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEditor}
                  className="px-4 py-1.5 reui-btn-primary text-xs cursor-pointer"
                >
                  {savingEditor ? 'Saving...' : editingMemory ? 'Update Memory' : 'Store Memory'}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
