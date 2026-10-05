import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import {
  calculateTokenUsage,
  estimateMessageTokens,
  getModelContextWindow,
  formatTokenNumber,
} from '../src/client/token-counter.js';
import { SLASH_COMMANDS } from '../src/client/SlashCommandsMenu.js';
import type { Connector } from '../src/shared/types.js';

const resources: { store?: Store; ws?: WorkspaceStore; dir: string }[] = [];

function createFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-test-'));
  const storePath = join(dir, 'store.sqlite');
  const wsPath = join(dir, 'ws.sqlite');
  const store = new Store(storePath);
  const ws = new WorkspaceStore(wsPath, 'owner-test');
  resources.push({ store, ws, dir });
  return { store, ws, dir };
}

afterEach(() => {
  resources.splice(0).forEach(({ store, ws, dir }) => {
    store?.close();
    ws?.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('DeepSeek Harness (DSH) Token Counter', () => {
  it('correctly maps context window limits across different model families', () => {
    expect(getModelContextWindow('gemini-2.5-pro')).toBe(2_000_000);
    expect(getModelContextWindow('gemini-2.5-flash')).toBe(1_000_000);
    expect(getModelContextWindow('claude-3-7-sonnet')).toBe(200_000);
    expect(getModelContextWindow('kimi-k2.6')).toBe(200_000);
    expect(getModelContextWindow('deepseek-chat')).toBe(128_000);
    expect(getModelContextWindow('gpt-4o')).toBe(128_000);
    expect(getModelContextWindow('auto-code')).toBe(128_000);
  });

  it('formats token numbers nicely with k and M units', () => {
    expect(formatTokenNumber(500)).toBe('500');
    expect(formatTokenNumber(1500)).toBe('1.5k');
    expect(formatTokenNumber(12500)).toBe('12.5k');
    expect(formatTokenNumber(1500000)).toBe('1.5M');
  });

  it('estimates message tokens and calculates usage percentages and warning statuses', () => {
    const messages = [
      { role: 'user', content: 'Hello, please help me plan a system architecture.' },
      { role: 'assistant', content: 'Here is a phased breakdown of the architecture components...' },
    ];
    const usage = calculateTokenUsage(messages, 'deepseek-chat');
    expect(usage.estimatedTokens).toBeGreaterThan(0);
    expect(usage.maxTokens).toBe(128_000);
    expect(usage.percentage).toBeLessThan(10);
    expect(usage.status).toBe('normal');

    // Simulate high usage
    const hugeMessages = [
      { role: 'user', content: 'x'.repeat(400_000) },
    ];
    const highUsage = calculateTokenUsage(hugeMessages, 'deepseek-chat');
    expect(highUsage.percentage).toBeGreaterThan(70);
    expect(['warning', 'critical']).toContain(highUsage.status);
  });
});

describe('Slash Commands Menu definitions', () => {
  it('includes all required commands: goal, plan, compact, memory, schedule, search, browse, clear, help', () => {
    const commandNames = SLASH_COMMANDS.map((c) => c.command);
    expect(commandNames).toContain('/goal');
    expect(commandNames).toContain('/plan');
    expect(commandNames).toContain('/compact');
    expect(commandNames).toContain('/memory');
    expect(commandNames).toContain('/schedule');
    expect(commandNames).toContain('/search');
    expect(commandNames).toContain('/browse');
    expect(commandNames).toContain('/clear');
    expect(commandNames).toContain('/help');
  });
});

describe('DSH Categorized Memories', () => {
  it('saves and filters memories with categories', () => {
    const { store } = createFixture();

    store.saveMemory('Keep answers concise', undefined, 'preference');
    store.saveMemory('Parent company is SafarNow', undefined, 'fact');
    store.saveMemory('Always use markdown checklists', undefined, 'instruction');

    const all = store.memories();
    expect(all).toHaveLength(3);

    const preferences = store.memories('preference');
    expect(preferences).toHaveLength(1);
    expect(preferences[0]?.text).toBe('Keep answers concise');

    const facts = store.memories('fact');
    expect(facts).toHaveLength(1);
    expect(facts[0]?.text).toBe('Parent company is SafarNow');
  });
});

describe('DSH Context Compactor & OpenWork Thread Management', () => {
  it('clears thread messages without destroying conversation session', () => {
    const { ws } = createFixture();
    const dot = ws.createDot(ws.spaces()[0]!.id, 'TestDot', 'Help', true, true);
    const thread = ws.bindThread('thread-123', dot.id, 'Test Thread');

    ws.saveThreadRun({
      id: 'run-1',
      threadId: thread.id,
      agentId: dot.id,
      parentRunId: null,
      events: '[]',
      messages: JSON.stringify([{ role: 'user', content: 'Hello' }]),
      createdAt: Date.now(),
    });

    expect(ws.threadRuns(thread.id)).toHaveLength(1);
    ws.clearThreadMessages(thread.id);
    expect(ws.threadRuns(thread.id)).toHaveLength(0);
    expect(ws.requireThread(thread.id)).toBeTruthy();
  });

  it('compacts multiple thread runs into a single summarized context checkpoint', () => {
    const { ws } = createFixture();
    const dot = ws.createDot(ws.spaces()[0]!.id, 'TestDot', 'Help', true, true);
    const thread = ws.bindThread('thread-456', dot.id, 'Compact Thread');

    // Create 3 historical runs
    for (let i = 1; i <= 3; i++) {
      ws.saveThreadRun({
        id: `run-${i}`,
        threadId: thread.id,
        agentId: dot.id,
        parentRunId: null,
        events: '[]',
        messages: JSON.stringify([
          { role: 'user', content: `Question turn ${i}` },
          { role: 'assistant', content: `Detailed response turn ${i}` },
        ]),
        createdAt: Date.now() + i * 1000,
      });
    }

    expect(ws.threadRuns(thread.id)).toHaveLength(3);
    const result = ws.compactThreadMessages(thread.id);
    expect(result.compacted).toBe(true);

    const remainingRuns = ws.threadRuns(thread.id);
    expect(remainingRuns).toHaveLength(1);
    const parsedMessages = JSON.parse(remainingRuns[0]!.messages);
    expect(parsedMessages[0].content).toContain('Context Compacted');
    expect(parsedMessages[0].content).toContain('Question turn');
  });
});

describe('OpenWork Connectors Settings', () => {
  it('persists remote MCP and OpenWork Cloud connectors in settings', () => {
    const { store } = createFixture();

    const sampleConnectors: Connector[] = [
      {
        id: 'openwork-cloud',
        name: 'OpenWork Cloud MCP',
        type: 'openwork_cloud',
        url: 'https://api.openworklabs.com/mcp/agent',
        enabled: true,
        status: 'connected',
      },
      {
        id: 'postgres-mcp',
        name: 'PostgreSQL MCP',
        type: 'remote_mcp',
        url: 'http://localhost:3456/sse',
        token: 'mcp_live_sec_123',
        enabled: true,
        status: 'connected',
      },
    ];

    store.updateSettings({
      connectors: JSON.stringify(sampleConnectors),
    });

    const retrieved = store.settings();
    expect(retrieved.connectors).toBeTruthy();
    const parsed: Connector[] = JSON.parse(retrieved.connectors!);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.name).toBe('OpenWork Cloud MCP');
    expect(parsed[1]?.token).toBe('mcp_live_sec_123');
  });
});
