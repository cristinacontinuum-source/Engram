import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAgentSystemRulesSnippet,
  buildIntegrationConfigSnippet,
  MCP_RESOURCES_CATALOG,
  MCP_TOOLS_CATALOG,
  normalizeServerBaseUrl,
} from './integrations';

test('normalizeServerBaseUrl strips trailing slashes and uses safe fallback', () => {
  assert.equal(normalizeServerBaseUrl('https://engram.dev///'), 'https://engram.dev');
  assert.equal(normalizeServerBaseUrl('   ', 'http://localhost:8080/'), 'http://localhost:8080');
});

test('buildIntegrationConfigSnippet generates valid JSON for Claude Desktop, Cursor, and Windsurf', () => {
  const claudeRaw = buildIntegrationConfigSnippet({
    clientId: 'claude_desktop',
    baseUrl: 'https://mem.acme.internal/',
    transport: 'streamable_http',
    workspace: 'hermes',
    bearerToken: 'sk-test-123',
  });
  const claudeParsed = JSON.parse(claudeRaw);
  assert.equal(claudeParsed.mcpServers.engram.command, 'npx');
  assert.ok(claudeParsed.mcpServers.engram.args.includes('https://mem.acme.internal/mcp'));
  assert.equal(claudeParsed.mcpServers.engram.env.ENGRAM_DEFAULT_WORKSPACE, 'hermes');

  const cursorRaw = buildIntegrationConfigSnippet({
    clientId: 'cursor',
    baseUrl: 'https://mem.acme.internal',
    transport: 'sse',
    workspace: 'all',
    bearerToken: 'sk-test-123',
  });
  const cursorParsed = JSON.parse(cursorRaw);
  assert.equal(cursorParsed.mcpServers.engram.url, 'https://mem.acme.internal/sse');
  assert.equal(cursorParsed.mcpServers.engram.type, 'sse');
  assert.equal(cursorParsed.mcpServers.engram.headers['X-Engram-Workspace'], 'global');

  const windsurfRaw = buildIntegrationConfigSnippet({
    clientId: 'windsurf',
    baseUrl: 'https://mem.acme.internal',
    transport: 'streamable_http',
    workspace: 'ops-agent',
    bearerToken: 'sk-test-123',
  });
  const windsurfParsed = JSON.parse(windsurfRaw);
  assert.equal(windsurfParsed.mcpServers.engram.serverUrl, 'https://mem.acme.internal/mcp');
});

test('buildIntegrationConfigSnippet generates Claude Code CLI, Continue YAML, and cURL ingest snippets', () => {
  const cli = buildIntegrationConfigSnippet({
    clientId: 'claude_code',
    baseUrl: 'http://localhost:8080',
    transport: 'streamable_http',
    workspace: 'hermes',
    bearerToken: '${ENGRAM_MCP_API_KEY}',
  });
  assert.match(cli, /claude mcp add --transport http engram/);
  assert.match(cli, /http:\/\/localhost:8080\/mcp/);

  const cont = buildIntegrationConfigSnippet({
    clientId: 'continue',
    baseUrl: 'http://localhost:8080',
    transport: 'sse',
    workspace: 'hermes',
    bearerToken: 'sk-abc',
  });
  assert.match(cont, /type: sse/);
  assert.match(cont, /url: http:\/\/localhost:8080\/sse/);

  const hermesYaml = buildIntegrationConfigSnippet({
    clientId: 'hermes_agent',
    baseUrl: 'http://localhost:8080/',
    transport: 'streamable_http',
    workspace: 'hermes',
    bearerToken: '${ENGRAM_MCP_API_KEY}',
  });
  assert.match(hermesYaml, /mcp_servers:/);
  assert.match(hermesYaml, /url: "http:\/\/localhost:8080\/mcp"/);
  assert.match(hermesYaml, /Authorization: "Bearer \$\{ENGRAM_MCP_API_KEY\}"/);
  assert.match(hermesYaml, /X-Engram-Workspace: "hermes"/);
  assert.match(hermesYaml, /\/reload-mcp/);

  const curl = buildIntegrationConfigSnippet({
    clientId: 'curl',
    baseUrl: 'http://localhost:8080',
    transport: 'streamable_http',
    workspace: 'ops-agent',
    bearerToken: 'sk-abc',
  });
  assert.match(curl, /\/api\/v1\/ingest/);
  assert.match(curl, /"workspace": "ops-agent"/);
});

test('MCP catalog and system protocol snippet expose all 4 tools and 2 resources', () => {
  assert.deepEqual(
    MCP_TOOLS_CATALOG.map((t) => t.name),
    ['recall_memory', 'store_memory', 'learn_from_mistake', 'supersede_memory']
  );
  assert.equal(MCP_RESOURCES_CATALOG.length, 2);
  const rules = buildAgentSystemRulesSnippet('hermes');
  assert.match(rules, /memory:\/\/core-directives\/hermes/);
  assert.match(rules, /memory:\/\/session-summary\/hermes/);
});
