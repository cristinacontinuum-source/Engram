import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart2,
  ChevronDown,
  ChevronRight,
  Compass,
  FolderGit2,
  Globe,
  Home,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
} from 'lucide-react';
import { engramApi } from './api/client';
import { CommandPalette } from './components/CommandPalette';
import { ExplorerTab } from './components/ExplorerTab';
import { GraphTab } from './components/GraphTab';
import { OverviewTab } from './components/OverviewTab';
import { PlaygroundTab } from './components/PlaygroundTab';
import { SettingsTab } from './components/SettingsTab';
import { CustomSelect } from './components/ui/CustomSelect';
import { getDictionary, Locale } from './i18n';
import {
  GraphResponse,
  MemoryRecord,
  SettingsPayload,
  StatsResponse,
} from './types/engram';
import { useEngramRouter } from './utils/router';

// ReUI Signal style circular progress ring icon for Active Workspaces list
const RingProgressIcon: React.FC<{
  percent: number;
  color: string;
}> = ({ percent, color }) => {
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(12, Math.min(100, percent));
  const strokeDashoffset = circumference - (clamped / 100) * circumference;

  return (
    <svg className="w-4 h-4 -rotate-90 shrink-0" viewBox="0 0 16 16">
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="opacity-20"
      />
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
      />
    </svg>
  );
};

export default function App() {
  const {
    activeTab,
    activeWorkspace,
    currentRoutePath,
    navigateTab,
    setWorkspaceRoute,
  } = useEngramRouter();

  const [locale, setLocale] = useState<Locale>('en');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Collapsible tree groups in sidebar (ReUI Signal pattern)
  const [strategyGroupOpen, setStrategyGroupOpen] = useState(true);
  const [analyzeGroupOpen, setAnalyzeGroupOpen] = useState(true);
  const [workspacesGroupOpen, setWorkspacesGroupOpen] = useState(true);

  // External triggers for Explorer modals
  const [triggerImportModal, setTriggerImportModal] = useState(false);
  const [triggerNewMemoryModal, setTriggerNewMemoryModal] = useState(false);
  const [inspectedMemory, setInspectedMemory] = useState<MemoryRecord | null>(null);

  // Core data state
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [graph, setGraph] = useState<GraphResponse>({ workspace: 'all', nodes: [], edges: [] });
  const [settings, setSettings] = useState<SettingsPayload | null>(null);

  const dict = useMemo(() => getDictionary(locale), [locale]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const refreshAll = useCallback(async () => {
    const [statsRes, memRes, graphRes, settingsRes] = await Promise.all([
      engramApi.getStats(activeWorkspace),
      engramApi.listMemories({ workspace: activeWorkspace }),
      engramApi.getGraph(activeWorkspace),
      engramApi.getSettings(),
    ]);
    setStats(statsRes);
    setMemories(memRes.items);
    setGraph(graphRes);
    setSettings(settingsRes);
  }, [activeWorkspace]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Global Cmd/Ctrl + K or "/" shortcut for Command Palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
        return;
      }
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (!isInput && e.key === '/') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const availableWorkspaces = useMemo(() => {
    const set = new Set<string>(['all', 'global', 'hermes', 'ops-agent']);
    for (const m of memories) {
      if (m.workspace) set.add(m.workspace);
    }
    return Array.from(set);
  }, [memories]);

  const workspaceSelectOptions = useMemo(
    () =>
      availableWorkspaces.map((ws) => ({
        value: ws,
        label: ws === 'all' ? 'All Workspaces' : ws,
        badge: ws === 'all' ? 'ALL' : ws === 'global' ? 'ROOT' : 'WS',
      })),
    [availableWorkspaces]
  );

  const handleTogglePin = async (memory: MemoryRecord) => {
    await engramApi.updateMemory(memory.id, { is_pinned: memory.is_pinned !== 1 });
    await refreshAll();
  };

  const handleExportJson = async () => {
    const payload = await engramApi.exportBackup(activeWorkspace);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `engram-backup-${activeWorkspace}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleQuickReindex = async () => {
    await engramApi.triggerReindex();
    await refreshAll();
    navigateTab('settings');
  };

  // Breadcrumb metadata based on activeTab
  const breadcrumbMeta = useMemo(() => {
    switch (activeTab) {
      case 'overview':
        return { group: null, page: 'Home' };
      case 'graph':
        return { group: 'Memory Hub', page: 'Knowledge Graph' };
      case 'explorer':
        return { group: 'Memory Hub', page: 'Memory Explorer' };
      case 'playground':
        return { group: 'Analyze', page: 'Retrieval Playground' };
      case 'settings':
        return { group: 'System', page: 'Settings' };
      default:
        return { group: null, page: 'Home' };
    }
  }, [activeTab]);

  // Active Workspaces ring items
  const workspaceRingItems = useMemo(() => {
    const ringColors = ['#10B981', '#8B5CF6', '#3B82F6', '#F59E0B', '#F43F5E'];
    return availableWorkspaces.map((ws, idx) => {
      const count =
        ws === 'all'
          ? stats
            ? stats.active_memories
            : memories.filter((m) => m.status === 'active').length
          : memories.filter((m) => m.workspace === ws && m.status === 'active').length;
      const total = Math.max(1, stats ? stats.active_memories : memories.length || 8);
      const pct = ws === 'all' ? 88 : Math.min(95, Math.max(25, Math.round((count / total) * 100)));
      return {
        id: ws,
        label: ws === 'all' ? 'All workspaces' : ws,
        count,
        pct,
        color: ringColors[idx % ringColors.length],
      };
    });
  }, [availableWorkspaces, memories, stats]);

  const activeMemoriesCount = stats?.active_memories ?? 8;
  const supersededMemoriesCount = stats?.superseded_memories ?? 2;
  const totalMemoriesCount = Math.max(1, activeMemoriesCount + supersededMemoriesCount);
  const activeRatioPct = Math.round((activeMemoriesCount / totalMemoriesCount) * 100);
  const supersededRatioPct = 100 - activeRatioPct;

  return (
    <div
      className="min-h-screen w-full"
      style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)' }}
    >
      {/* Fixed Left Sidebar (240px width, ReUI Signal Template architecture) */}
      <aside
        className="w-full md:fixed md:inset-y-0 md:left-0 md:w-[240px] flex flex-col justify-between px-3 pt-14 md:pt-3 pb-3 select-none z-30 hairline-border-r"
        style={{ backgroundColor: 'var(--bg-sidebar)' }}
      >
        <div className="space-y-3.5">
          {/* Top Brand Row */}
          <div className="flex items-center justify-between px-1">
            <button
              type="button"
              onClick={() => navigateTab('overview')}
              className="flex items-center gap-2 cursor-pointer group"
            >
              <div
                className="w-6 h-6 rounded-[4px] flex items-center justify-center font-extrabold text-xs tracking-tighter shrink-0"
                style={{
                  backgroundColor: 'var(--accent-primary)',
                  color: 'var(--accent-primary-fg)',
                }}
              >
                E
              </div>
              <span
                className="text-sm font-semibold tracking-tight"
                style={{ color: 'var(--text-primary)' }}
              >
                Engram
              </span>
            </button>

            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              className="w-7 h-7 rounded-[4px] flex items-center justify-center hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
              style={{ color: 'var(--text-secondary)' }}
              title="Toggle Dark / Light Theme"
              aria-label="Toggle Dark / Light Theme"
            >
              {theme === 'dark' ? (
                <Sun className="w-3.5 h-3.5" />
              ) : (
                <Moon className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {/* ReUI Signal Search Trigger ("Search... [/]") */}
          <div>
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              className="w-full h-8 px-2.5 rounded-[4px] hairline-border flex items-center justify-between text-xs transition-colors hover:bg-[var(--bg-elevated)] cursor-pointer"
              style={{
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-secondary)',
              }}
            >
              <span className="flex items-center gap-2">
                <Search className="w-3.5 h-3.5 opacity-75" />
                <span>Search...</span>
              </span>
              <kbd
                className="font-mono-data text-[10px] px-1.5 py-0.2 rounded-[3px] hairline-border"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  color: 'var(--text-secondary)',
                }}
              >
                /
              </kbd>
            </button>
          </div>

          {/* Workspace Tree Navigation (Zero Duplicate Links) */}
          <div className="space-y-1">
            <div
              className="px-2 py-1 text-[11px] font-medium"
              style={{ color: 'var(--text-muted)' }}
            >
              Workspace
            </div>

            <ul className="space-y-0.5 text-xs">
              {/* 1. Home (/overview) */}
              <li>
                <button
                  type="button"
                  onClick={() => navigateTab('overview')}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[4px] transition-colors cursor-pointer ${
                    activeTab === 'overview'
                      ? 'font-medium'
                      : 'hover:bg-[var(--bg-elevated)]'
                  }`}
                  style={{
                    backgroundColor:
                      activeTab === 'overview' ? 'var(--bg-sidebar-active)' : 'transparent',
                    color:
                      activeTab === 'overview'
                        ? 'var(--text-primary)'
                        : 'var(--text-secondary)',
                  }}
                >
                  <Home className="w-3.5 h-3.5 shrink-0" />
                  <span>Home</span>
                </button>
              </li>

              {/* 2. Memory Hub Tree Group (/graph & /explorer) */}
              <li>
                <button
                  type="button"
                  onClick={() => setStrategyGroupOpen((v) => !v)}
                  className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-[4px] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
                  style={{
                    color:
                      activeTab === 'graph' || activeTab === 'explorer'
                        ? 'var(--text-primary)'
                        : 'var(--text-secondary)',
                  }}
                >
                  <span className="flex items-center gap-2.5">
                    <Compass className="w-3.5 h-3.5 shrink-0" />
                    <span>Memory Hub</span>
                  </span>
                  {strategyGroupOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 opacity-60" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                  )}
                </button>

                {strategyGroupOpen && (
                  <ul className="mt-0.5 ml-4 pl-2.5 hairline-border-l space-y-0.5">
                    <li>
                      <button
                        type="button"
                        onClick={() => navigateTab('graph')}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[4px] text-left transition-colors cursor-pointer ${
                          activeTab === 'graph'
                            ? 'font-medium'
                            : 'hover:bg-[var(--bg-elevated)]'
                        }`}
                        style={{
                          backgroundColor:
                            activeTab === 'graph'
                              ? 'var(--bg-sidebar-active)'
                              : 'transparent',
                          color:
                            activeTab === 'graph'
                              ? 'var(--text-primary)'
                              : 'var(--text-secondary)',
                        }}
                      >
                        <span>Knowledge Graph</span>
                        {stats && (
                          <span className="font-mono-data text-[10px] opacity-60">
                            {stats.knowledge_graph.entities}
                          </span>
                        )}
                      </button>
                    </li>
                    <li>
                      <button
                        type="button"
                        onClick={() => navigateTab('explorer')}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[4px] text-left transition-colors cursor-pointer ${
                          activeTab === 'explorer'
                            ? 'font-medium'
                            : 'hover:bg-[var(--bg-elevated)]'
                        }`}
                        style={{
                          backgroundColor:
                            activeTab === 'explorer'
                              ? 'var(--bg-sidebar-active)'
                              : 'transparent',
                          color:
                            activeTab === 'explorer'
                              ? 'var(--text-primary)'
                              : 'var(--text-secondary)',
                        }}
                      >
                        <span>Memory Explorer</span>
                        {stats && (
                          <span className="font-mono-data text-[10px] opacity-60">
                            {stats.active_memories}
                          </span>
                        )}
                      </button>
                    </li>
                  </ul>
                )}
              </li>

              {/* 3. Analyze Tree Group (/playground) */}
              <li>
                <button
                  type="button"
                  onClick={() => setAnalyzeGroupOpen((v) => !v)}
                  className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-[4px] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
                  style={{
                    color:
                      activeTab === 'playground'
                        ? 'var(--text-primary)'
                        : 'var(--text-secondary)',
                  }}
                >
                  <span className="flex items-center gap-2.5">
                    <BarChart2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Analyze</span>
                  </span>
                  {analyzeGroupOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 opacity-60" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                  )}
                </button>

                {analyzeGroupOpen && (
                  <ul className="mt-0.5 ml-4 pl-2.5 hairline-border-l space-y-0.5">
                    <li>
                      <button
                        type="button"
                        onClick={() => navigateTab('playground')}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[4px] text-left transition-colors cursor-pointer ${
                          activeTab === 'playground'
                            ? 'font-medium'
                            : 'hover:bg-[var(--bg-elevated)]'
                        }`}
                        style={{
                          backgroundColor:
                            activeTab === 'playground'
                              ? 'var(--bg-sidebar-active)'
                              : 'transparent',
                          color:
                            activeTab === 'playground'
                              ? 'var(--text-primary)'
                              : 'var(--text-secondary)',
                        }}
                      >
                        <span>Retrieval Playground</span>
                      </button>
                    </li>
                  </ul>
                )}
              </li>

              {/* 4. Settings (/settings) */}
              <li>
                <button
                  type="button"
                  onClick={() => navigateTab('settings')}
                  className={`w-full flex items-center justify-between gap-2.5 px-2.5 py-1.5 rounded-[4px] transition-colors cursor-pointer ${
                    activeTab === 'settings'
                      ? 'font-medium'
                      : 'hover:bg-[var(--bg-elevated)]'
                  }`}
                  style={{
                    backgroundColor:
                      activeTab === 'settings' ? 'var(--bg-sidebar-active)' : 'transparent',
                    color:
                      activeTab === 'settings'
                        ? 'var(--text-primary)'
                        : 'var(--text-secondary)',
                  }}
                >
                  <span className="flex items-center gap-2.5">
                    <Settings className="w-3.5 h-3.5 shrink-0" />
                    <span>Settings</span>
                  </span>
                  {settings?.dimension_mismatch && (
                    <span className="px-1.5 py-0.2 rounded-[3px] bg-amber-500/20 text-amber-400 font-mono-data text-[10px] font-bold">
                      !
                    </span>
                  )}
                </button>
              </li>
            </ul>
          </div>

          {/* ReUI Signal "Active Workspaces" Ring List */}
          <div className="pt-1 space-y-1">
            <button
              type="button"
              onClick={() => setWorkspacesGroupOpen((v) => !v)}
              className="w-full flex items-center justify-between px-2 py-1 text-[11px] font-medium cursor-pointer"
              style={{ color: 'var(--text-muted)' }}
            >
              <span>Active Workspaces</span>
              {workspacesGroupOpen ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </button>

            {workspacesGroupOpen && (
              <ul className="space-y-0.5 text-xs">
                {workspaceRingItems.map((item) => {
                  const isCurrent = activeWorkspace === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setWorkspaceRoute(item.id)}
                        className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-[4px] transition-colors cursor-pointer ${
                          isCurrent ? 'font-medium' : 'hover:bg-[var(--bg-elevated)]'
                        }`}
                        style={{
                          backgroundColor: isCurrent
                            ? 'var(--bg-sidebar-active)'
                            : 'transparent',
                          color: isCurrent
                            ? 'var(--text-primary)'
                            : 'var(--text-secondary)',
                        }}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <RingProgressIcon percent={item.pct} color={item.color} />
                          <span className="truncate">{item.label}</span>
                        </span>
                        <span className="font-mono-data text-[10px] opacity-65 shrink-0">
                          {item.count}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Bottom Section: ReUI Signal "Memory Index Volume" Box + Operator Footer */}
        <div className="space-y-3 pt-3">
          {/* Memory Index Volume Widget (ReUI Signal Event Volume pattern) */}
          <div className="rounded-[4px] hairline-border overflow-hidden" style={{ backgroundColor: 'var(--bg-surface)' }}>
            <div className="px-3 py-1.5 hairline-border-b flex items-center justify-between">
              <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                Memory Index Volume
              </span>
              <span
                className="font-mono-data text-[10px]"
                style={{ color: 'var(--text-muted)' }}
              >
                vec0[{settings?.current_vec_dimension || 1536}]
              </span>
            </div>
            <div className="p-3 space-y-2">
              <p
                className="text-[11px] leading-relaxed"
                style={{ color: 'var(--text-secondary)' }}
              >
                Vectors indexed in sqlite-vec WAL ({totalMemoriesCount} total).{' '}
                {settings?.embedding_mode === 'local' ? 'ONNX Active.' : '0 MB idle RAM.'}
              </p>

              {/* Striped Progress Bar */}
              <div className="h-2 w-full rounded-[2px] reui-hatch-track overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${activeRatioPct}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] font-mono-data">
                <div>
                  <span className="font-bold" style={{ color: 'var(--text-primary)' }}>
                    {activeRatioPct}%
                  </span>{' '}
                  <span style={{ color: 'var(--text-muted)' }}>Active</span>
                </div>
                <div>
                  <span className="font-bold" style={{ color: 'var(--text-primary)' }}>
                    {supersededRatioPct}%
                  </span>{' '}
                  <span style={{ color: 'var(--text-muted)' }}>History</span>
                </div>
              </div>
            </div>
          </div>

          {/* Operator Profile Row */}
          <div className="flex items-center justify-between px-1 pt-0.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="w-7 h-7 rounded-[4px] hairline-border flex items-center justify-center font-mono-data text-[11px] font-bold shrink-0"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                }}
              >
                EC
              </div>
              <div className="min-w-0">
                <div
                  className="text-xs font-semibold truncate leading-tight"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Engram Core
                </div>
                <div
                  className="flex items-center gap-1.5 text-[11px] truncate mt-0.5"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <span className="w-2 h-2 rounded-full bg-violet-500 shrink-0" />
                  <span className="truncate font-mono-data text-[10px]">
                    {activeWorkspace === 'all' ? 'All Workspaces' : activeWorkspace}
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setLocale((l) => (l === 'en' ? 'id' : 'en'))}
              className="px-1.5 py-1 rounded-[4px] hover:bg-[var(--bg-elevated)] transition-colors font-mono-data text-[10px] font-semibold flex items-center gap-1 cursor-pointer shrink-0"
              style={{ color: 'var(--text-secondary)' }}
              title="Switch Language (EN / ID)"
            >
              <Globe className="w-3 h-3" />
              {locale.toUpperCase()}
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area (Natural Body Scroll, Offset by Fixed 240px Sidebar) */}
      <div className="md:pl-[240px] min-h-screen flex flex-col">
        {/* Fixed Flush Top Header Bar (Menempel Fixed) */}
        <header
          className="fixed top-0 left-0 md:left-[240px] right-0 z-30 h-12 hairline-border-b px-4 sm:px-5 md:px-6 flex items-center justify-between gap-4 backdrop-blur-md"
          style={{ backgroundColor: 'var(--bg-surface-translucent)' }}
        >
          <div
            className={
              activeTab === 'graph'
                ? 'w-full flex items-center justify-between gap-4'
                : 'max-w-[1400px] w-full mx-auto flex items-center justify-between gap-4'
            }
          >
            {/* Left: Breadcrumb Navigation */}
            <nav aria-label="breadcrumb" className="flex items-center gap-2 text-xs min-w-0">
              <button
                type="button"
                onClick={() => navigateTab('overview')}
                className="flex items-center gap-2 hover:opacity-85 transition-opacity cursor-pointer shrink-0"
                style={{ color: 'var(--text-secondary)' }}
              >
                <span className="w-3.5 h-3.5 rounded-full bg-gradient-to-tr from-violet-600 to-indigo-400 shrink-0" />
                <span className="font-medium">Engram</span>
              </button>

              {breadcrumbMeta.group && (
                <>
                  <ChevronRight
                    className="w-3.5 h-3.5 shrink-0"
                    style={{ color: 'var(--text-muted)' }}
                  />
                  <span
                    className="truncate hidden sm:inline"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {breadcrumbMeta.group}
                  </span>
                </>
              )}

              <ChevronRight
                className="w-3.5 h-3.5 shrink-0"
                style={{ color: 'var(--text-muted)' }}
              />
              <span
                className="font-semibold truncate"
                style={{ color: 'var(--text-primary)' }}
                title={`Route: ${currentRoutePath}`}
              >
                {breadcrumbMeta.page}
              </span>
            </nav>

            {/* Right: Workspace Selector + Primary High-Contrast Action Button */}
            <div className="flex items-center gap-2.5 shrink-0">
              <div className="w-52 hidden sm:block">
                <CustomSelect
                  ariaLabel="Active Workspace"
                  value={activeWorkspace}
                  options={workspaceSelectOptions}
                  onChange={(ws) => setWorkspaceRoute(ws)}
                  icon={<FolderGit2 className="w-3.5 h-3.5" />}
                  size="xs"
                  mono
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  navigateTab('explorer');
                  setTriggerNewMemoryModal(true);
                }}
                className="h-7 px-3 reui-btn-primary text-xs flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Store Memory</span>
              </button>
            </div>
          </div>
        </header>

        {/* Main Viewport Content */}
        <main className="flex-1 px-4 sm:px-5 md:px-6 pt-4 md:pt-16 pb-6">
          <div className={activeTab === 'graph' ? 'w-full mx-auto' : 'max-w-[1400px] w-full mx-auto'}>
            {activeTab === 'overview' && stats && (
              <OverviewTab
                stats={stats}
                dict={dict}
                onNavigateTab={(tab) => navigateTab(tab)}
                onTogglePin={handleTogglePin}
              />
            )}

            {activeTab === 'explorer' && (
              <ExplorerTab
                memories={memories}
                stats={stats}
                activeWorkspace={activeWorkspace}
                workspaces={availableWorkspaces}
                dict={dict}
                openImportModalExternal={triggerImportModal}
                onCloseImportModalExternal={() => setTriggerImportModal(false)}
                openNewMemoryExternal={triggerNewMemoryModal}
                onCloseNewMemoryExternal={() => setTriggerNewMemoryModal(false)}
                inspectedMemoryExternal={inspectedMemory}
                onClearInspectedMemoryExternal={() => setInspectedMemory(null)}
                onRefresh={refreshAll}
                onExportJson={handleExportJson}
              />
            )}

            {activeTab === 'graph' && (
              <GraphTab graph={graph} memories={memories} dict={dict} />
            )}

            {activeTab === 'playground' && (
              <PlaygroundTab
                activeWorkspace={activeWorkspace}
                workspaces={availableWorkspaces}
                dict={dict}
                onAfterQuery={refreshAll}
              />
            )}

            {activeTab === 'settings' && settings && (
              <SettingsTab
                settings={settings}
                dict={dict}
                onRefresh={refreshAll}
              />
            )}
          </div>
        </main>
      </div>

      {/* Command Palette Overlay (Cmd/Ctrl + K or /) */}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        dict={dict}
        locale={locale}
        theme={theme}
        memories={memories}
        onSelectTab={(tab) => navigateTab(tab)}
        onTriggerNewMemory={() => {
          navigateTab('explorer');
          setTriggerNewMemoryModal(true);
        }}
        onTriggerBulkSeed={() => {
          navigateTab('explorer');
          setTriggerImportModal(true);
        }}
        onTriggerReindex={handleQuickReindex}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        onToggleLocale={() => setLocale((l) => (l === 'en' ? 'id' : 'en'))}
        onExportJson={handleExportJson}
        onInspectMemory={(mem) => {
          navigateTab('explorer');
          setInspectedMemory(mem);
        }}
      />
    </div>
  );
}
