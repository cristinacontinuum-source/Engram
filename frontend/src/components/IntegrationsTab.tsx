import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Code2,
  Copy,
  FileCode,
  KeyRound,
  Lock,
  Plug2,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  Webhook,
  Wrench,
  X,
} from 'lucide-react';
import { engramApi } from '../api/client';
import { Dictionary } from '../i18n';
import {
  IntegrationClientId,
  IntegrationProbeResponse,
  IntegrationsStatusResponse,
  McpResourceDescriptor,
  McpToolDescriptor,
  McpTransportKind,
  SettingsPayload,
} from '../types/engram';
import {
  buildAgentSystemRulesSnippet,
  buildIntegrationConfigSnippet,
  INTEGRATION_CLIENTS,
  MCP_RESOURCES_CATALOG,
  MCP_TOOLS_CATALOG,
  normalizeServerBaseUrl,
} from '../utils/integrations';
import { CustomSelect } from './ui/CustomSelect';

interface IntegrationsTabProps {
  activeWorkspace: string;
  workspaces: string[];
  settings: SettingsPayload | null;
  dict: Dictionary;
}

export const IntegrationsTab: React.FC<IntegrationsTabProps> = ({
  activeWorkspace,
  workspaces,
  settings,
  dict,
}) => {
  const defaultOrigin = useMemo(() => {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin;
    }
    return 'http://localhost:8080';
  }, []);

  const [selectedClient, setSelectedClient] = useState<IntegrationClientId>('hermes_agent');
  const [transport, setTransport] = useState<McpTransportKind>('streamable_http');
  const [serverUrl, setServerUrl] = useState<string>(defaultOrigin);
  const [targetWorkspace, setTargetWorkspace] = useState<string>(
    activeWorkspace === 'all' ? 'global' : activeWorkspace
  );
  const [bearerTokenInput, setBearerTokenInput] = useState<string>('${ENGRAM_MCP_API_KEY}');

  const [statusInfo, setStatusInfo] = useState<IntegrationsStatusResponse | null>(null);
  const [probeResult, setProbeResult] = useState<IntegrationProbeResponse | null>(null);
  const [probing, setProbing] = useState(false);

  const [copiedConfig, setCopiedConfig] = useState(false);
  const [copiedRules, setCopiedRules] = useState(false);

  // Floating Rounded-2xl Tool / Resource Schema Inspector Drawer (NO centered dialog)
  const [inspectedTool, setInspectedTool] = useState<McpToolDescriptor | null>(null);
  const [inspectedResource, setInspectedResource] = useState<McpResourceDescriptor | null>(null);

  useEffect(() => {
    if (activeWorkspace !== 'all') {
      setTargetWorkspace(activeWorkspace);
    }
  }, [activeWorkspace]);

  const loadStatus = useCallback(async () => {
    const res = await engramApi.getIntegrationsStatus();
    setStatusInfo(res);
  }, []);

  const runProbe = useCallback(
    async (kind: McpTransportKind = transport) => {
      setProbing(true);
      try {
        const res = await engramApi.probeMcpTransport(kind);
        setProbeResult(res);
      } finally {
        setProbing(false);
      }
    },
    [transport]
  );

  useEffect(() => {
    loadStatus();
    runProbe('streamable_http');
  }, [loadStatus]);

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

  const activeClientMeta = useMemo(
    () => INTEGRATION_CLIENTS.find((c) => c.id === selectedClient) ?? INTEGRATION_CLIENTS[0],
    [selectedClient]
  );

  const generatedConfig = useMemo(
    () =>
      buildIntegrationConfigSnippet({
        clientId: selectedClient,
        baseUrl: serverUrl,
        transport,
        workspace: targetWorkspace,
        bearerToken: bearerTokenInput,
      }),
    [selectedClient, serverUrl, transport, targetWorkspace, bearerTokenInput]
  );

  const generatedRulesSnippet = useMemo(
    () => buildAgentSystemRulesSnippet(targetWorkspace),
    [targetWorkspace]
  );

  const handleCopyConfig = async () => {
    try {
      await navigator.clipboard.writeText(generatedConfig);
      setCopiedConfig(true);
      setTimeout(() => setCopiedConfig(false), 1800);
    } catch {
      // Clipboard blocked silently in headless browser without breaking UI
    }
  };

  const handleCopyRules = async () => {
    try {
      await navigator.clipboard.writeText(generatedRulesSnippet);
      setCopiedRules(true);
      setTimeout(() => setCopiedRules(false), 1800);
    } catch {
      // Clipboard blocked silently
    }
  };

  const autoIngestActive =
    statusInfo?.auto_ingest_enabled ?? settings?.auto_ingest_enabled ?? false;
  const normalizedBase = normalizeServerBaseUrl(serverUrl, defaultOrigin);

  return (
    <div className="space-y-4">
      {/* Top ReUI Signal Header Card + 4-Column Segmented KPI Strip */}
      <div className="reui-card overflow-hidden">
        <div className="px-4 py-3 hairline-border-b flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {dict.integrations.title}
            </h1>
            <span className="text-xs hidden md:inline" style={{ color: 'var(--text-muted)' }}>
              •
            </span>
            <span
              className="text-xs truncate hidden md:inline"
              style={{ color: 'var(--text-secondary)' }}
            >
              FastMCP v1 Dual-Transport (/mcp + /sse)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setServerUrl(defaultOrigin)}
              className="h-7 px-2.5 reui-btn-secondary text-xs flex items-center gap-1.5 cursor-pointer"
              title="Reset Server Base URL to current browser origin"
            >
              <Server className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Use Current Origin</span>
            </button>

            <button
              type="button"
              onClick={() => runProbe(transport)}
              disabled={probing}
              className="h-7 px-3 reui-btn-primary text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${probing ? 'animate-spin' : ''}`} />
              <span>{probing ? dict.integrations.probingBtn : dict.integrations.probeBtn}</span>
            </button>
          </div>
        </div>

        {/* 4-Cell Segmented KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-[var(--border-hairline)]">
          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {dict.integrations.kpi.transports}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono-data text-xl font-bold text-emerald-600 dark:text-emerald-400">
                /mcp &amp; /sse
              </span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Single-Port
              </span>
            </div>
          </div>

          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {dict.integrations.kpi.authBoundary}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono-data text-xl font-bold">Bearer</span>
              <span className="text-xs font-mono-data" style={{ color: 'var(--text-muted)' }}>
                hint {statusInfo?.mcp_key_hint ?? 'sk-m...cret'}
              </span>
            </div>
          </div>

          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {dict.integrations.kpi.webhook}
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className={`font-mono-data text-xl font-bold ${
                  autoIngestActive
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {autoIngestActive ? 'Live (202)' : 'Locked (403)'}
              </span>
              <span className="text-xs font-mono-data" style={{ color: 'var(--text-muted)' }}>
                /api/v1/ingest
              </span>
            </div>
          </div>

          <div className="p-4 space-y-1">
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {dict.integrations.kpi.capabilities}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono-data text-xl font-bold">
                {MCP_TOOLS_CATALOG.length} Tools
              </span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {MCP_RESOURCES_CATALOG.length} Resources
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Split Grid: Left Config Generator | Right Endpoint Health & Catalog */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(380px,1fr)] gap-4 items-start">
        {/* Left Card: Client Config Generator + Agent Protocol */}
        <div className="reui-card overflow-hidden">
          <div className="px-4 py-3 hairline-border-b flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Plug2 className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {dict.integrations.generator.title}
                </h2>
              </div>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                {dict.integrations.generator.subtitle}
              </p>
            </div>

            <button
              type="button"
              onClick={handleCopyConfig}
              className="h-7 px-2.5 reui-btn-secondary text-xs flex items-center gap-1.5 cursor-pointer"
            >
              {copiedConfig ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span>{dict.integrations.copiedBtn}</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>{dict.integrations.copyBtn}</span>
                </>
              )}
            </button>
          </div>

          {/* Client Selector Tabs */}
          <div
            className="px-4 py-2.5 hairline-border-b flex flex-wrap items-center gap-1.5"
            style={{ backgroundColor: 'var(--bg-elevated)' }}
          >
            {INTEGRATION_CLIENTS.map((client) => {
              const isSelected = selectedClient === client.id;
              return (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => setSelectedClient(client.id)}
                  className={`px-2.5 py-1 rounded-[4px] text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    isSelected ? 'reui-btn-primary' : 'reui-btn-secondary'
                  }`}
                >
                  {client.label}
                </button>
              );
            })}
          </div>

          {/* Connection Parameters Form */}
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label
                  htmlFor="mcp-server-url"
                  className="block text-[11px] font-semibold mb-1.5"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {dict.integrations.generator.baseUrlLabel}
                </label>
                <input
                  id="mcp-server-url"
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="https://engram.internal:8080"
                  className="w-full h-8 px-2.5 rounded-[4px] hairline-border font-mono-data text-xs focus:outline-none"
                  style={{
                    backgroundColor: 'var(--bg-elevated)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>

              <div>
                <label
                  className="block text-[11px] font-semibold mb-1.5"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {dict.integrations.generator.workspaceLabel}
                </label>
                <CustomSelect
                  ariaLabel="Target Workspace"
                  value={targetWorkspace}
                  options={workspaceSelectOptions}
                  onChange={(val) => setTargetWorkspace(val)}
                  size="sm"
                  mono
                />
              </div>

              <div>
                <span
                  className="block text-[11px] font-semibold mb-1.5"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {dict.integrations.generator.transportLabel}
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    disabled={!activeClientMeta.supportsTransportToggle}
                    onClick={() => setTransport('streamable_http')}
                    className={`h-8 px-2 rounded-[4px] font-mono-data text-[11px] whitespace-nowrap transition-colors cursor-pointer disabled:opacity-45 ${
                      transport === 'streamable_http' ? 'reui-btn-primary' : 'reui-btn-secondary'
                    }`}
                  >
                    Streamable (/mcp)
                  </button>
                  <button
                    type="button"
                    disabled={!activeClientMeta.supportsTransportToggle}
                    onClick={() => setTransport('sse')}
                    className={`h-8 px-2 rounded-[4px] font-mono-data text-[11px] whitespace-nowrap transition-colors cursor-pointer disabled:opacity-45 ${
                      transport === 'sse' ? 'reui-btn-primary' : 'reui-btn-secondary'
                    }`}
                  >
                    Legacy SSE (/sse)
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="mcp-bearer-placeholder"
                  className="block text-[11px] font-semibold mb-1.5"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {dict.integrations.generator.tokenLabel}
                </label>
                <div className="relative">
                  <input
                    id="mcp-bearer-placeholder"
                    type="text"
                    value={bearerTokenInput}
                    onChange={(e) => setBearerTokenInput(e.target.value)}
                    className="w-full h-8 pl-7 pr-2.5 rounded-[4px] hairline-border font-mono-data text-xs focus:outline-none"
                    style={{
                      backgroundColor: 'var(--bg-elevated)',
                      color: 'var(--text-primary)',
                    }}
                  />
                  <KeyRound
                    className="w-3.5 h-3.5 absolute left-2.5 top-2.25 pointer-events-none"
                    style={{ color: 'var(--text-muted)' }}
                  />
                </div>
              </div>
            </div>

            {/* Generated Snippet Header & Monospace Code Block */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span
                  className="font-mono-data flex items-center gap-1.5 truncate"
                  style={{ color: 'var(--text-secondary)' }}
                  data-testid="integration-config-path"
                >
                  <FileCode className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span>{activeClientMeta.configPath}</span>
                </span>
                <span
                  className="px-1.5 py-0.5 rounded-[3px] hairline-border font-mono-data text-[10px] uppercase shrink-0"
                  style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
                >
                  {activeClientMeta.format}
                </span>
              </div>

              <pre
                data-testid="client-config-output"
                className="p-3.5 rounded-lg hairline-border font-mono-data text-[11px] leading-relaxed overflow-x-auto max-h-[280px]"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                }}
              >
                {generatedConfig}
              </pre>
            </div>

            {/* System Prompt / AGENTS.md Protocol Box */}
            <div className="pt-2 hairline-border-t space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <BookOpen className="w-3.5 h-3.5 text-violet-500 dark:text-violet-400" />
                  <span>{dict.integrations.generator.rulesTitle}</span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyRules}
                  className="h-6 px-2 reui-btn-secondary text-[11px] flex items-center gap-1 cursor-pointer"
                >
                  {copiedRules ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-500" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy Rules</span>
                    </>
                  )}
                </button>
              </div>
              <pre
                className="p-3 rounded-lg hairline-border font-mono-data text-[11px] leading-relaxed whitespace-pre-wrap break-words"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  color: 'var(--text-secondary)',
                }}
              >
                {generatedRulesSnippet}
              </pre>
            </div>
          </div>
        </div>

        {/* Right Card: Endpoint Health Probe + Registered MCP Tools & Resources */}
        <div className="space-y-4">
          {/* Endpoint Health Probe Card */}
          <div className="reui-card overflow-hidden">
            <div className="px-4 py-3 hairline-border-b flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
                  <h2 className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                    {dict.integrations.probe.title}
                  </h2>
                </div>
                <p className="text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--text-secondary)' }}>
                  {dict.integrations.probe.subtitle}
                </p>
              </div>
              {probeResult && (
                <span className="font-mono-data text-[10px] px-2 py-0.5 rounded-[3px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 shrink-0">
                  {probeResult.overall_latency_ms}ms total
                </span>
              )}
            </div>

            <div className="divide-y divide-[var(--border-hairline)]" data-testid="probe-endpoint-list">
              {(probeResult?.endpoints ?? []).map((ep) => {
                const isOnline = ep.status === 'online';
                const isLocked = ep.status === 'locked';
                return (
                  <div
                    key={ep.id}
                    className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            isOnline
                              ? 'bg-emerald-500'
                              : isLocked
                                ? 'bg-amber-500'
                                : 'bg-rose-500'
                          }`}
                        />
                        <span className="font-medium truncate">{ep.label}</span>
                        <span className="font-mono-data text-[10px] px-1.5 py-0.2 rounded-[3px] hairline-border" style={{ color: 'var(--text-secondary)' }}>
                          {ep.method} {ep.path}
                        </span>
                      </div>
                      <p className="text-[11px] truncate pl-4" style={{ color: 'var(--text-muted)' }}>
                        {ep.detail}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono-data text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                        {ep.latency_ms}ms
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-[3px] font-mono-data text-[10px] font-semibold ${
                          isOnline
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25'
                            : isLocked
                              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/25'
                              : 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/25'
                        }`}
                      >
                        {ep.http_status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Registered MCP Tools & Resources Catalog */}
          <div className="reui-card overflow-hidden">
            <div
              className="px-4 py-2 hairline-border-b flex items-center justify-between text-[11px] font-semibold"
              style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
            >
              <span className="flex items-center gap-1.5">
                <Wrench className="w-3.5 h-3.5 text-emerald-500" />
                <span>{dict.integrations.probe.toolsHeading}</span>
              </span>
              <span className="font-mono-data text-[10px]" style={{ color: 'var(--text-muted)' }}>
                Click to inspect schema
              </span>
            </div>

            <div className="divide-y divide-[var(--border-hairline)]">
              {MCP_TOOLS_CATALOG.map((tool) => (
                <button
                  key={tool.name}
                  type="button"
                  onClick={() => {
                    setInspectedResource(null);
                    setInspectedTool(tool);
                  }}
                  className="w-full px-4 py-2.5 text-left flex items-center justify-between gap-3 hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Terminal className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span className="font-mono-data text-xs font-semibold">{tool.name}</span>
                      <span
                        className="font-mono-data text-[10px] px-1.5 py-0.2 rounded-[3px] hairline-border"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {tool.params.length} params
                      </span>
                    </div>
                    <p className="text-[11px] line-clamp-1 pl-5.5" style={{ color: 'var(--text-secondary)' }}>
                      {tool.description}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 shrink-0 opacity-50" />
                </button>
              ))}
            </div>

            <div
              className="px-4 py-2 hairline-border-t hairline-border-b flex items-center justify-between text-[11px] font-semibold"
              style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
            >
              <span className="flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-violet-500" />
                <span>{dict.integrations.probe.resourcesHeading}</span>
              </span>
              <span className="font-mono-data text-[10px]" style={{ color: 'var(--text-muted)' }}>
                Read-Only URIs
              </span>
            </div>

            <div className="divide-y divide-[var(--border-hairline)]">
              {MCP_RESOURCES_CATALOG.map((res) => (
                <button
                  key={res.uriTemplate}
                  type="button"
                  onClick={() => {
                    setInspectedTool(null);
                    setInspectedResource(res);
                  }}
                  className="w-full px-4 py-2.5 text-left flex items-center justify-between gap-3 hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Code2 className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                      <span className="font-mono-data text-xs font-semibold truncate">
                        {res.uriTemplate}
                      </span>
                    </div>
                    <p className="text-[11px] line-clamp-1 pl-5.5" style={{ color: 'var(--text-secondary)' }}>
                      {res.description}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 shrink-0 opacity-50" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Floating Rounded-2xl MCP Schema & Sample Invocation Drawer (Tight 8px Margin, Flush Right Scrollbar) */}
      <AnimatePresence>
        {(inspectedTool || inspectedResource) && (
          <motion.div
            key="mcp-schema-drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex justify-end p-2 bg-black/50 backdrop-blur-[2px]"
            onClick={() => {
              setInspectedTool(null);
              setInspectedResource(null);
            }}
          >
            <motion.div
              key="mcp-schema-drawer-panel"
              role="dialog"
              aria-label={
                inspectedTool
                  ? `MCP Tool Schema: ${inspectedTool.name}`
                  : `MCP Resource Schema: ${inspectedResource?.name}`
              }
              initial={{ x: 450, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 450, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 34, mass: 0.9 }}
              className="w-full max-w-[450px] h-full rounded-2xl hairline-border flex flex-col justify-between shadow-2xl overflow-hidden"
              style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-5 pt-4 pb-3.5 hairline-border-b flex items-center justify-between gap-2 shrink-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-[3px] text-[10px] font-mono-data font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                      {inspectedTool ? 'MCP TOOL' : 'MCP RESOURCE'}
                    </span>
                    <h2 className="text-sm font-bold font-mono-data truncate">
                      {inspectedTool ? inspectedTool.name : inspectedResource?.name}
                    </h2>
                  </div>
                  <p className="text-[11px] mt-1 font-mono-data truncate" style={{ color: 'var(--text-secondary)' }}>
                    {inspectedTool
                      ? `${normalizedBase}${transport === 'sse' ? '/sse' : '/mcp'}`
                      : inspectedResource?.sampleUri(targetWorkspace)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setInspectedTool(null);
                    setInspectedResource(null);
                  }}
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
                  aria-label="Close MCP inspector drawer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Scrollable Body (Flush Right Edge) */}
              <div
                className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs"
                data-testid="integration-inspector-scroll"
              >
                <div
                  className="p-3.5 rounded-xl hairline-border leading-relaxed"
                  style={{ backgroundColor: 'var(--bg-elevated)' }}
                >
                  {inspectedTool ? inspectedTool.description : inspectedResource?.description}
                </div>

                {inspectedTool && (
                  <>
                    <div className="space-y-2">
                      <h3
                        className="text-[10px] font-semibold uppercase tracking-wider"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        Input Parameters
                      </h3>
                      <div className="space-y-2">
                        {inspectedTool.params.map((p) => (
                          <div
                            key={p.name}
                            className="p-3 rounded-lg hairline-border space-y-1"
                            style={{ backgroundColor: 'var(--bg-elevated)' }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono-data font-semibold text-xs">
                                {p.name}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="font-mono-data text-[10px]"
                                  style={{ color: 'var(--text-muted)' }}
                                >
                                  {p.type}
                                </span>
                                {p.required ? (
                                  <span className="px-1.5 py-0.2 rounded-[3px] text-[10px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-400">
                                    required
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.2 rounded-[3px] text-[10px] font-mono-data hairline-border">
                                    default: {p.defaultValue}
                                  </span>
                                )}
                              </div>
                            </div>
                            <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                              {p.description}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h3
                        className="text-[10px] font-semibold uppercase tracking-wider"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        Sample JSON-RPC Arguments
                      </h3>
                      <pre
                        className="p-3 rounded-xl hairline-border font-mono-data text-[11px] whitespace-pre-wrap break-words"
                        style={{ backgroundColor: 'var(--bg-elevated)' }}
                      >
                        {inspectedTool.sampleCall}
                      </pre>
                    </div>
                  </>
                )}

                {inspectedResource && (
                  <div className="space-y-2">
                    <h3
                      className="text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Resolved Resource URI
                    </h3>
                    <pre
                      className="p-3 rounded-xl hairline-border font-mono-data text-[11px] whitespace-pre-wrap break-words"
                      style={{ backgroundColor: 'var(--bg-elevated)' }}
                    >
                      {inspectedResource.sampleUri(targetWorkspace)}
                    </pre>
                    <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      Open <strong>Core Directives</strong> in the sidebar to inspect the live rendered
                      markdown payload and exact token budget for this resource URI.
                    </p>
                  </div>
                )}

                <div className="p-3 rounded-lg hairline-border flex items-start gap-2 text-[11px]" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                  <Lock className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                  <span style={{ color: 'var(--text-secondary)' }}>
                    Protected by constant-time Bearer Auth (<code>Authorization: Bearer MCP_API_KEY</code>) on both <code>/mcp</code> and <code>/sse</code>.
                  </span>
                </div>
              </div>

              {/* Footer */}
              <div
                className="px-5 py-3.5 hairline-border-t flex items-center justify-end gap-2 shrink-0"
                style={{ backgroundColor: 'var(--bg-elevated)' }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setInspectedTool(null);
                    setInspectedResource(null);
                  }}
                  className="px-3.5 py-1.5 reui-btn-secondary text-xs cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
