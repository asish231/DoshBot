import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Connector } from '../shared/types.js';

const CONNECT_TIMEOUT_MS = 8_000;
const CALL_TIMEOUT_MS = 45_000;
const MAX_TOOLS_PER_CONNECTOR = 20;
const MAX_SESSIONS = 5;

export interface McpRemoteTool {
  connectorId: string;
  connectorName: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpSession {
  connector: Connector;
  client: Client;
  tools: McpRemoteTool[];
}

function sanitizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
}

/** Stable, provider-safe tool name for a remote MCP tool. */
export function mcpToolName(connectorId: string, toolName: string): string {
  return `mcp_${sanitizeName(connectorId)}_${sanitizeName(toolName)}`;
}

function parseConnectors(
  connectorsJson: string | null | undefined,
): Connector[] {
  if (!connectorsJson) return [];
  try {
    const parsed = JSON.parse(connectorsJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is Connector =>
        !!c &&
        typeof c.id === 'string' &&
        typeof c.name === 'string' &&
        (c.type === 'local_stdio' ||
          c.type === 'remote_sse' ||
          c.type === 'remote_mcp') &&
        typeof c.url === 'string' &&
        c.enabled !== false,
    );
  } catch {
    return [];
  }
}

function splitCommand(command: string): { command: string; args: string[] } {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  return { command: parts[0] ?? '', args: parts.slice(1) };
}

async function connectOne(
  connector: Connector,
): Promise<{ session?: McpSession; error?: string }> {
  const client = new Client(
    { name: `opendots-${sanitizeName(connector.id)}`, version: '0.2.0' },
    { capabilities: {} },
  );
  try {
    let transport;
    if (connector.type === 'local_stdio') {
      const { command, args } = splitCommand(connector.command || '');
      if (!command) return { error: `${connector.name}: empty command.` };
      transport = new StdioClientTransport({ command, args });
    } else if (connector.type === 'remote_sse') {
      transport = new SSEClientTransport(new URL(connector.url), {
        requestInit:
          connector.token && connector.token !== '__saved__'
            ? { headers: { Authorization: `Bearer ${connector.token}` } }
            : undefined,
      });
    } else {
      transport = new StreamableHTTPClientTransport(new URL(connector.url), {
        requestInit:
          connector.token && connector.token !== '__saved__'
            ? { headers: { Authorization: `Bearer ${connector.token}` } }
            : undefined,
      });
    }
    await Promise.race([
      client.connect(transport),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('connect timeout')),
          CONNECT_TIMEOUT_MS,
        ),
      ),
    ]);
    const list = await client.listTools();
    const tools = (list.tools ?? [])
      .filter((tool) => typeof tool.name === 'string')
      .slice(0, MAX_TOOLS_PER_CONNECTOR)
      .map((tool) => ({
        connectorId: connector.id,
        connectorName: connector.name,
        toolName: tool.name,
        description:
          typeof tool.description === 'string' && tool.description
            ? tool.description
            : `Tool ${tool.name} from MCP server ${connector.name}.`,
        inputSchema: (tool.inputSchema as
          Record<string, unknown> | undefined) ?? {
          type: 'object',
        },
      }));
    if (!tools.length) return { error: `${connector.name}: no tools exposed.` };
    return { session: { connector, client, tools } };
  } catch (error) {
    try {
      await client.close();
    } catch {
      /* already closed */
    }
    return {
      error: `${connector.name}: ${
        error instanceof Error ? error.message : 'connection failed.'
      }`,
    };
  }
}

/**
 * Connects to every enabled MCP connector in settings.
 * Never throws — failing connectors are skipped and reported.
 */
export async function connectMcpConnectors(
  connectorsJson: string | null | undefined,
): Promise<{ sessions: McpSession[]; errors: string[] }> {
  const connectors = parseConnectors(connectorsJson).slice(0, MAX_SESSIONS);
  if (!connectors.length) return { sessions: [], errors: [] };
  const results = await Promise.all(connectors.map(connectOne));
  return {
    sessions: results.map((r) => r.session).filter((s): s is McpSession => !!s),
    errors: results.map((r) => r.error).filter((e): e is string => !!e),
  };
}

/** Executes a remote tool previously surfaced as `mcpToolName`. */
export async function callMcpTool(
  sessions: McpSession[],
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  for (const session of sessions) {
    const tool = session.tools.find(
      (t) => mcpToolName(t.connectorId, t.toolName) === toolName,
    );
    if (!tool) continue;
    const result = (await Promise.race([
      session.client.callTool({ name: tool.toolName, arguments: args }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('tool call timeout')),
          CALL_TIMEOUT_MS,
        ),
      ),
    ])) as CallToolResult;
    if (result.isError)
      throw new Error(
        `${tool.connectorName} tool ${tool.toolName} returned an error.`,
      );
    const content = result.content;
    if (!Array.isArray(content) || content.length === 0) return { ok: true };
    const text = content
      .map((part) =>
        part && typeof part === 'object' && 'text' in part
          ? String((part as { text: unknown }).text)
          : '',
      )
      .filter(Boolean)
      .join('\n');
    return text || { ok: true };
  }
  throw new Error(`MCP tool ${toolName} is not connected.`);
}

export async function closeMcpSessions(sessions: McpSession[]) {
  await Promise.all(
    sessions.map((s) => s.client.close().catch(() => undefined)),
  );
}
