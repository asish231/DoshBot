import { describe, expect, it } from 'vitest';
import {
  connectMcpConnectors,
  mcpToolName,
} from '../src/server/mcp-connectors.js';
import type { Connector } from '../src/shared/types.js';

function connector(overrides: Partial<Connector>): Connector {
  return {
    id: 'conn-1',
    name: 'Test Server',
    type: 'remote_sse',
    url: 'http://127.0.0.1:9/mcp',
    enabled: true,
    ...overrides,
  };
}

describe('MCP connector tool naming', () => {
  it('builds stable sanitized tool names', () => {
    expect(mcpToolName('conn-1', 'search_docs')).toBe('mcp_conn_1_search_docs');
    expect(mcpToolName('My Server!', 'query')).toBe('mcp_my_server_query');
  });
});

describe('MCP connector connection', () => {
  it('returns empty sessions and no errors when nothing is configured', async () => {
    const result = await connectMcpConnectors(null);
    expect(result.sessions).toEqual([]);
    expect(result.errors).toEqual([]);
    const empty = await connectMcpConnectors('[]');
    expect(empty.sessions).toEqual([]);
  });

  it('skips invalid JSON without throwing', async () => {
    const result = await connectMcpConnectors('{not json');
    expect(result.sessions).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('ignores disabled and unsupported connectors', async () => {
    const json = JSON.stringify([
      connector({ id: 'off', name: 'Off', enabled: false }),
      connector({
        id: 'cloud',
        name: 'Cloud',
        type: 'openwork_cloud',
        url: 'https://example.invalid',
      }),
    ]);
    const result = await connectMcpConnectors(json);
    expect(result.sessions).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('reports unreachable servers as errors instead of throwing', async () => {
    const json = JSON.stringify([
      connector({
        id: 'dead',
        name: 'Dead Server',
        url: 'http://127.0.0.1:1/mcp',
      }),
    ]);
    const result = await connectMcpConnectors(json);
    expect(result.sessions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Dead Server');
  }, 15_000);
});
