import {
  IntegrationClientId,
  McpResourceDescriptor,
  McpToolDescriptor,
  McpTransportKind,
} from '../types/engram';

export interface ClientPresetMeta {
  id: IntegrationClientId;
  label: string;
  configPath: string;
  format: 'json' | 'bash' | 'yaml';
  supportsTransportToggle: boolean;
}

export const INTEGRATION_CLIENTS: ClientPresetMeta[] = [
  {
    id: 'hermes_agent',
    label: 'Hermes Agent',
    configPath: '~/.hermes/config.yaml',
    format: 'yaml',
    supportsTransportToggle: true,
  },
  {
    id: 'claude_desktop',
    label: 'Claude Desktop',
    configPath: '~/Library/Application Support/Claude/claude_desktop_config.json',
    format: 'json',
    supportsTransportToggle: true,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    configPath: '.cursor/mcp.json',
    format: 'json',
    supportsTransportToggle: true,
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    configPath: '~/.codeium/windsurf/mcp_config.json',
    format: 'json',
    supportsTransportToggle: true,
  },
  {
    id: 'claude_code',
    label: 'Claude Code CLI',
    configPath: 'Terminal (claude mcp add)',
    format: 'bash',
    supportsTransportToggle: true,
  },
  {
    id: 'continue',
    label: 'Continue.dev',
    configPath: '.continue/mcpServers/engram.yaml',
    format: 'yaml',
    supportsTransportToggle: true,
  },
  {
    id: 'curl',
    label: 'Webhook & cURL',
    configPath: 'HTTP REST + MCP Probe',
    format: 'bash',
    supportsTransportToggle: false,
  },
];

export const MCP_TOOLS_CATALOG: McpToolDescriptor[] = [
  {
    name: 'recall_memory',
    description:
      'Executes hybrid vector (0.55) + 1-hop knowledge graph (0.20) + recency decay (0.15) + confidence (0.10) + pinned retrieval and optional Fast LLM context distillation.',
    params: [
      { name: 'query', type: 'string', required: true, description: 'Natural language recall query or task context' },
      { name: 'workspace', type: 'string', required: false, defaultValue: '"global"', description: 'Target agent workspace (automatically unions with global)' },
      { name: 'top_k', type: 'integer', required: false, defaultValue: '5', description: 'Number of top ranked memory candidates to synthesize' },
      { name: 'distill', type: 'boolean', required: false, defaultValue: 'true', description: 'Compress retrieved rows via Fast LLM into high-density bullets' },
    ],
    sampleCall: JSON.stringify(
      {
        tool: 'recall_memory',
        arguments: {
          query: 'How should Hermes authenticate to production gateway?',
          workspace: 'hermes',
          top_k: 5,
          distill: true,
        },
      },
      null,
      2
    ),
  },
  {
    name: 'store_memory',
    description:
      'Runs regex credential scrubbing and enqueues a durable fact, decision, or procedural rule into the async sqlite-vec deduplication & graph-extraction worker.',
    params: [
      { name: 'content', type: 'string', required: true, description: 'Memory text to scrub, embed, and store' },
      { name: 'memory_type', type: '"semantic" | "procedural" | "episodic"', required: false, defaultValue: '"semantic"', description: 'Classification category' },
      { name: 'workspace', type: 'string', required: false, defaultValue: '"global"', description: 'Isolation scope' },
      { name: 'source', type: 'string', required: false, defaultValue: '"agent_inferred"', description: 'Provenance tag' },
      { name: 'confidence', type: 'number', required: false, defaultValue: '0.85', description: 'Confidence weight between 0.0 and 1.0' },
      { name: 'ttl_hours', type: 'integer | null', required: false, defaultValue: 'null', description: 'Optional expiration window in hours' },
    ],
    sampleCall: JSON.stringify(
      {
        tool: 'store_memory',
        arguments: {
          content: 'Staging settlement batch size is capped at 100 line items per HTTP request.',
          memory_type: 'semantic',
          workspace: 'hermes',
          confidence: 0.92,
        },
      },
      null,
      2
    ),
  },
  {
    name: 'learn_from_mistake',
    description:
      'Records a high-priority auto-pinned procedural guardrail (source=tool_error, confidence=0.95) so agents never repeat resolved errors in future sessions.',
    params: [
      { name: 'context', type: 'string', required: true, description: 'Task or subsystem where the error occurred' },
      { name: 'mistake_or_error', type: 'string', required: true, description: 'What failed or caused the error' },
      { name: 'rule_learned', type: 'string', required: true, description: 'Corrective rule to enforce going forward' },
      { name: 'workspace', type: 'string', required: false, defaultValue: '"global"', description: 'Workspace scope (or global for all agents)' },
    ],
    sampleCall: JSON.stringify(
      {
        tool: 'learn_from_mistake',
        arguments: {
          context: 'Calling /v2/settlements/batch',
          mistake_or_error: 'Sending >250 line items caused HTTP 504 timeout',
          rule_learned: 'Split payloads into chunks of 100 line items max',
          workspace: 'hermes',
        },
      },
      null,
      2
    ),
  },
  {
    name: 'supersede_memory',
    description:
      'Non-destructively invalidates an outdated memory (status=superseded, valid_until=now) and links a replacement record with full bi-temporal audit lineage.',
    params: [
      { name: 'old_memory_id', type: 'string', required: true, description: 'Existing active memory ID to replace' },
      { name: 'new_content', type: 'string', required: true, description: 'Updated authoritative fact or rule' },
      { name: 'reason', type: 'string', required: true, description: 'Why the previous fact changed' },
      { name: 'workspace', type: 'string', required: false, defaultValue: '"global"', description: 'Workspace scope' },
    ],
    sampleCall: JSON.stringify(
      {
        tool: 'supersede_memory',
        arguments: {
          old_memory_id: 'mem-hermes-old-01',
          new_content: 'Gateway now requires mTLS client cert + OAuth2 Bearer JWT on port 443.',
          reason: 'Migrated off static X-Gateway-Token in v2.4',
          workspace: 'hermes',
        },
      },
      null,
      2
    ),
  },
];

export const MCP_RESOURCES_CATALOG: McpResourceDescriptor[] = [
  {
    uriTemplate: 'memory://core-directives/{workspace}',
    name: 'Core Directives Baseline',
    description:
      'Auto-injected set of up to 30 pinned rules & procedural guardrails scoped to {workspace} + global.',
    sampleUri: (ws) => `memory://core-directives/${ws || 'global'}`,
  },
  {
    uriTemplate: 'memory://session-summary/{workspace}',
    name: 'Active Session Briefing',
    description:
      'Concise bullet briefing synthesized from the 15 most recent active memories for {workspace} + global.',
    sampleUri: (ws) => `memory://session-summary/${ws || 'global'}`,
  },
];

export function normalizeServerBaseUrl(rawUrl: string, fallback: string = 'http://localhost:8080'): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return fallback.replace(/\/+$/, '');
  return trimmed.replace(/\/+$/, '');
}

export function buildIntegrationConfigSnippet(options: {
  clientId: IntegrationClientId;
  baseUrl: string;
  transport: McpTransportKind;
  workspace: string;
  bearerToken: string;
}): string {
  const base = normalizeServerBaseUrl(options.baseUrl);
  const ws = (options.workspace === 'all' || !options.workspace.trim()) ? 'global' : options.workspace.trim();
  const token = (options.bearerToken || '${ENGRAM_MCP_API_KEY}').trim();
  const endpointPath = options.transport === 'sse' ? '/sse' : '/mcp';
  const fullUrl = `${base}${endpointPath}`;

  switch (options.clientId) {
    case 'hermes_agent':
      return [
        `# Put token in ~/.hermes/.env then apply live in Hermes CLI with: /reload-mcp`,
        `mcp_servers:`,
        `  engram:`,
        `    url: "${fullUrl}"`,
        `    headers:`,
        `      Authorization: "Bearer ${token}"`,
        `      X-Engram-Workspace: "${ws}"`,
        `    timeout: 180`,
        `    connect_timeout: 60`,
      ].join('\n');

    case 'claude_desktop':
      return JSON.stringify(
        {
          mcpServers: {
            engram: {
              command: 'npx',
              args: [
                '-y',
                'mcp-remote',
                fullUrl,
                '--header',
                `Authorization:Bearer ${token}`,
              ],
              env: {
                ENGRAM_DEFAULT_WORKSPACE: ws,
              },
            },
          },
        },
        null,
        2
      );

    case 'cursor':
      return JSON.stringify(
        {
          mcpServers: {
            engram: {
              url: fullUrl,
              type: options.transport === 'sse' ? 'sse' : 'http',
              headers: {
                Authorization: `Bearer ${token}`,
                'X-Engram-Workspace': ws,
              },
            },
          },
        },
        null,
        2
      );

    case 'windsurf':
      return JSON.stringify(
        {
          mcpServers: {
            engram: {
              serverUrl: fullUrl,
              headers: {
                Authorization: `Bearer ${token}`,
                'X-Engram-Workspace': ws,
              },
            },
          },
        },
        null,
        2
      );

    case 'claude_code': {
      const cliTransport = options.transport === 'sse' ? 'sse' : 'http';
      return [
        `# Register Engram (${cliTransport.toUpperCase()}) for workspace "${ws}"`,
        `claude mcp add --transport ${cliTransport} engram \\`,
        `  "${fullUrl}" \\`,
        `  --header "Authorization: Bearer ${token}" \\`,
        `  --header "X-Engram-Workspace: ${ws}"`,
        ``,
        `# Verify registered tool & resource list`,
        `claude mcp list`,
      ].join('\n');
    }

    case 'continue':
      return [
        `name: Engram Agent Memory (${ws})`,
        `version: 1.0.0`,
        `schema: v1`,
        `mcpServers:`,
        `  - name: engram`,
        `    type: ${options.transport === 'sse' ? 'sse' : 'streamable-http'}`,
        `    url: ${fullUrl}`,
        `    requestOptions:`,
        `      headers:`,
        `        Authorization: Bearer ${token}`,
        `        X-Engram-Workspace: ${ws}`,
      ].join('\n');

    case 'curl':
      return [
        `# 1. Stream raw chat transcript into background extraction worker (/api/v1/ingest)`,
        `curl -sS -X POST "${base}/api/v1/ingest" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -H "Authorization: Bearer ${token}" \\`,
        `  -d '{`,
        `    "workspace": "${ws}",`,
        `    "messages": [`,
        `      {"role": "user", "content": "Always chunk settlement batches to 100 items."},`,
        `      {"role": "assistant", "content": "Noted. Storing procedural rule in ${ws}."}`,
        `    ]`,
        `  }'`,
        ``,
        `# 2. Check container & sqlite-vec health`,
        `curl -sS "${base}/health"`,
      ].join('\n');
  }
}

export function buildAgentSystemRulesSnippet(workspace: string): string {
  const ws = (workspace === 'all' || !workspace.trim()) ? 'global' : workspace.trim();
  return [
    `## Engram Memory Protocol (Workspace: ${ws})`,
    `1. At session start, read \`memory://core-directives/${ws}\` and \`memory://session-summary/${ws}\` for baseline constraints.`,
    `2. Before non-trivial changes, call \`recall_memory(query="...", workspace="${ws}", top_k=5, distill=true)\` instead of requesting huge raw logs.`,
    `3. When fixing a subtle bug or hitting a tool failure, immediately log the guardrail via \`learn_from_mistake(workspace="${ws}", ...)\`.`,
    `4. When architecture facts change, call \`supersede_memory(old_memory_id=..., new_content=..., reason=..., workspace="${ws}")\`.`,
  ].join('\n');
}
