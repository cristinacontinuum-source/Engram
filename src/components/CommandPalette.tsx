import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CornerDownLeft,
  Database,
  Download,
  FlaskConical,
  Globe,
  Moon,
  Network,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sun,
  Upload,
  X,
} from 'lucide-react';
import { Dictionary, Locale } from '../i18n';
import { MemoryRecord, TabId } from '../types/engram';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  dict: Dictionary;
  locale: Locale;
  theme: 'dark' | 'light';
  memories: MemoryRecord[];
  onSelectTab: (tab: TabId) => void;
  onTriggerNewMemory: () => void;
  onTriggerBulkSeed: () => void;
  onTriggerReindex: () => void;
  onToggleTheme: () => void;
  onToggleLocale: () => void;
  onExportJson: () => void;
  onInspectMemory: (memory: MemoryRecord) => void;
}

interface CommandItem {
  id: string;
  section: 'navigation' | 'actions' | 'memories';
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  shortcut?: string;
  action: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onClose,
  dict,
  locale,
  theme,
  memories,
  onSelectTab,
  onTriggerNewMemory,
  onTriggerBulkSeed,
  onTriggerReindex,
  onToggleTheme,
  onToggleLocale,
  onExportJson,
  onInspectMemory,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [open]);

  const items = useMemo<CommandItem[]>(() => {
    const baseItems: CommandItem[] = [
      {
        id: 'nav-overview',
        section: 'navigation',
        label: dict.sidebar.overview,
        sublabel: 'KPI telemetry, token compression chart & procedural rules',
        icon: <Activity className="w-4 h-4 text-indigo-400" />,
        shortcut: '1',
        action: () => {
          onSelectTab('overview');
          onClose();
        },
      },
      {
        id: 'nav-explorer',
        section: 'navigation',
        label: dict.sidebar.explorer,
        sublabel: 'Search, pin, edit, bulk-seed, or roll back superseded memories',
        icon: <Database className="w-4 h-4 text-emerald-400" />,
        shortcut: '2',
        action: () => {
          onSelectTab('explorer');
          onClose();
        },
      },
      {
        id: 'nav-graph',
        section: 'navigation',
        label: dict.sidebar.graph,
        sublabel: 'Interactive 1-hop entity-relation force-directed canvas',
        icon: <Network className="w-4 h-4 text-purple-400" />,
        shortcut: '3',
        action: () => {
          onSelectTab('graph');
          onClose();
        },
      },
      {
        id: 'nav-playground',
        section: 'navigation',
        label: dict.sidebar.playground,
        sublabel: 'Hybrid recall score debugger & context distillation',
        icon: <FlaskConical className="w-4 h-4 text-amber-400" />,
        shortcut: '4',
        action: () => {
          onSelectTab('playground');
          onClose();
        },
      },
      {
        id: 'nav-settings',
        section: 'navigation',
        label: dict.sidebar.settings,
        sublabel: 'LLM config, Zero-RAM embedding switcher & auto-ingest webhook',
        icon: <Settings className="w-4 h-4 text-sky-400" />,
        shortcut: '5',
        action: () => {
          onSelectTab('settings');
          onClose();
        },
      },
      {
        id: 'act-new-memory',
        section: 'actions',
        label: dict.commandPalette.actions.newMemory,
        sublabel: 'POST /api/v1/memories',
        icon: <Plus className="w-4 h-4 text-emerald-400" />,
        shortcut: 'N',
        action: () => {
          onClose();
          onTriggerNewMemory();
        },
      },
      {
        id: 'act-bulk-seed',
        section: 'actions',
        label: dict.commandPalette.actions.bulkSeed,
        sublabel: 'POST /api/v1/import (JSON or multiline rules)',
        icon: <Upload className="w-4 h-4 text-indigo-400" />,
        shortcut: 'I',
        action: () => {
          onClose();
          onTriggerBulkSeed();
        },
      },
      {
        id: 'act-reindex',
        section: 'actions',
        label: dict.commandPalette.actions.reindex,
        sublabel: 'POST /api/v1/settings/reindex',
        icon: <RefreshCw className="w-4 h-4 text-amber-400" />,
        shortcut: 'R',
        action: () => {
          onClose();
          onTriggerReindex();
        },
      },
      {
        id: 'act-export',
        section: 'actions',
        label: dict.commandPalette.actions.exportJson,
        sublabel: 'GET /api/v1/export',
        icon: <Download className="w-4 h-4 text-sky-400" />,
        shortcut: 'E',
        action: () => {
          onClose();
          onExportJson();
        },
      },
      {
        id: 'act-theme',
        section: 'actions',
        label: dict.commandPalette.actions.toggleTheme,
        sublabel: `Current: ${theme.toUpperCase()}`,
        icon: theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-400" />,
        shortcut: 'T',
        action: () => {
          onToggleTheme();
          onClose();
        },
      },
      {
        id: 'act-lang',
        section: 'actions',
        label: dict.commandPalette.actions.switchLang,
        sublabel: `Active Locale: ${locale.toUpperCase()}`,
        icon: <Globe className="w-4 h-4 text-purple-400" />,
        shortcut: 'L',
        action: () => {
          onToggleLocale();
          onClose();
        },
      },
    ];

    const memMatches: CommandItem[] = memories
      .filter((m) => m.status === 'active')
      .slice(0, 12)
      .map((m) => ({
        id: `mem-${m.id}`,
        section: 'memories',
        label: m.content.length > 88 ? `${m.content.slice(0, 88)}...` : m.content,
        sublabel: `${m.workspace} • ${m.type} • conf ${(m.confidence * 100).toFixed(0)}%`,
        icon: <Database className="w-4 h-4 text-slate-400" />,
        shortcut: m.id.slice(0, 8),
        action: () => {
          onClose();
          onInspectMemory(m);
        },
      }));

    const all = [...baseItems, ...memMatches];
    if (!query.trim()) return all.slice(0, 14);

    const q = query.trim().toLowerCase();
    return all.filter(
      (item) => item.label.toLowerCase().includes(q) || item.sublabel.toLowerCase().includes(q)
    );
  }, [
    dict,
    locale,
    theme,
    memories,
    query,
    onSelectTab,
    onClose,
    onTriggerNewMemory,
    onTriggerBulkSeed,
    onTriggerReindex,
    onToggleTheme,
    onToggleLocale,
    onExportJson,
    onInspectMemory,
  ]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (items.length > 0 ? (prev + 1) % items.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (items.length > 0 ? (prev - 1 + items.length) % items.length : 0));
      } else if (e.key === 'Enter' && items[selectedIndex]) {
        e.preventDefault();
        items[selectedIndex].action();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, items, selectedIndex, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-lg overflow-hidden hairline-border shadow-2xl"
        style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 hairline-border-b" style={{ backgroundColor: 'var(--bg-elevated)' }}>
          <Search className="w-4 h-4 shrink-0" style={{ color: 'var(--text-secondary)' }} />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={dict.commandPalette.placeholder}
            className="w-full bg-transparent text-sm focus:outline-none"
            style={{ color: 'var(--text-primary)' }}
          />
          <button
            onClick={onClose}
            className="p-1 rounded hover:opacity-80 transition-opacity"
            style={{ color: 'var(--text-secondary)' }}
            aria-label="Close command palette"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto p-2 space-y-1">
          {items.length === 0 ? (
            <div className="py-10 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>
              {dict.commandPalette.noResults}
            </div>
          ) : (
            items.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={item.action}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-[4px] text-left transition-colors cursor-pointer"
                  style={{
                    backgroundColor: isSelected ? 'var(--bg-elevated)' : 'transparent',
                  }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="shrink-0">{item.icon}</div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {item.label}
                      </div>
                      <div className="text-[11px] truncate" style={{ color: 'var(--text-secondary)' }}>
                        {item.sublabel}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.shortcut && (
                      <span
                        className="font-mono-data text-[10px] px-1.5 py-0.5 rounded hairline-border"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {item.shortcut}
                      </span>
                    )}
                    {isSelected && <CornerDownLeft className="w-3.5 h-3.5 text-indigo-400" />}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div
          className="px-4 py-2 hairline-border-t flex items-center justify-between text-[11px]"
          style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
        >
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Execute</span>
            <span>ESC Close</span>
          </div>
          <span className="font-mono-data">Engram Command Palette</span>
        </div>
      </div>
    </div>
  );
};
