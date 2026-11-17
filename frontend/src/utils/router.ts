import { useCallback, useEffect, useState } from 'react';
import { TabId } from '../types/engram';

const VALID_TABS: TabId[] = ['overview', 'explorer', 'directives', 'graph', 'playground', 'activity', 'hygiene', 'analytics', 'integrations', 'settings'];

function parseRouteFromLocation(): { tab: TabId; workspace: string } {
  if (typeof window === 'undefined') {
    return { tab: 'explorer', workspace: 'all' };
  }
  const cleanPath = window.location.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  const matchedTab = VALID_TABS.find((t) => t === cleanPath) || 'explorer';

  const params = new URLSearchParams(window.location.search);
  const ws = params.get('workspace') || 'all';
  return { tab: matchedTab, workspace: ws };
}

export function useEngramRouter() {
  const initial = parseRouteFromLocation();
  const [activeTab, setActiveTabState] = useState<TabId>(initial.tab);
  const [activeWorkspace, setActiveWorkspaceState] = useState<string>(initial.workspace);

  // Ensure initial URL has a canonical route path (/explorer, /overview, etc.)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const cleanPath = window.location.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
    if (!VALID_TABS.includes(cleanPath as TabId)) {
      const search = window.location.search || '';
      window.history.replaceState(
        { tab: 'explorer', workspace: activeWorkspace },
        '',
        `/explorer${search}`
      );
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const parsed = parseRouteFromLocation();
      setActiveTabState(parsed.tab);
      setActiveWorkspaceState(parsed.workspace);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTab = useCallback(
    (nextTab: TabId) => {
      setActiveTabState(nextTab);
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        if (activeWorkspace && activeWorkspace !== 'all') {
          params.set('workspace', activeWorkspace);
        } else {
          params.delete('workspace');
        }
        const qs = params.toString();
        const nextUrl = `/${nextTab}${qs ? `?${qs}` : ''}`;
        if (window.location.pathname + window.location.search !== nextUrl) {
          window.history.pushState({ tab: nextTab, workspace: activeWorkspace }, '', nextUrl);
        }
      }
    },
    [activeWorkspace]
  );

  const setWorkspaceRoute = useCallback(
    (nextWorkspace: string) => {
      setActiveWorkspaceState(nextWorkspace);
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        if (nextWorkspace && nextWorkspace !== 'all') {
          params.set('workspace', nextWorkspace);
        } else {
          params.delete('workspace');
        }
        const qs = params.toString();
        const nextUrl = `/${activeTab}${qs ? `?${qs}` : ''}`;
        window.history.pushState({ tab: activeTab, workspace: nextWorkspace }, '', nextUrl);
      }
    },
    [activeTab]
  );

  const currentRoutePath = `/${activeTab}${
    activeWorkspace && activeWorkspace !== 'all' ? `?workspace=${activeWorkspace}` : ''
  }`;

  return {
    activeTab,
    activeWorkspace,
    currentRoutePath,
    navigateTab,
    setWorkspaceRoute,
  };
}
