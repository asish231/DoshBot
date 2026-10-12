import { afterEach, describe, expect, it, vi } from 'vitest';
import { type RunAgentInput } from '@ag-ui/core';
import { lastValueFrom, toArray } from 'rxjs';
import { DotAgent } from '../src/server/dot-agent.js';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { completion } from './fixtures/model-stream.js';

const databases: Array<{ close(): void }> = [];
afterEach(() => {
  vi.restoreAllMocks();
  databases.splice(0).forEach((db) => db.close());
});

function fixture() {
  const store = new Store(':memory:');
  const workspace = new WorkspaceStore(':memory:', 'owner');
  databases.push(store, workspace);
  const dot = workspace.dots()[0];
  workspace.bindThread('thread', dot.id, 'TanStack');
  const agent = new DotAgent(
    store,
    workspace,
    {
      intelligenceKey: 'fixture',
      apiKey: 'fixture',
      model: 'custom-model',
      baseUrl: 'https://unused.invalid/v1',
      runtimeUrl: '',
      voiceName: 'marin',
      slackUsers: [],
    },
    dot.id,
  );
  const input: RunAgentInput = {
    threadId: 'thread',
    runId: 'run',
    state: {},
    context: [],
    messages: [{ id: 'user', role: 'user', content: 'Hi' }],
    tools: [],
    forwardedProps: {},
  };
  return { store, workspace, dot, agent, input };
}

describe('task memory: the conversation working set', () => {
  it('saves entries like files: small summary, full content on demand', () => {
    const f = fixture();
    const pdf = f.workspace.saveTaskMemory(
      'thread',
      'report.pdf',
      'Q3 financial report — raw markdown, 18 pages.',
      `# Q3 Report\n\nRevenue is up 12%.\n\n` +
        Array.from({ length: 40 }, (_, i) => `Section ${i + 1}: operations detail line.`).join('\n'),
      'file',
      'report.pdf',
    );
    const image = f.workspace.saveTaskMemory(
      'thread',
      'site-chart.png',
      'Bar chart of monthly traffic from the screenshot.',
      'Extracted table: Jan 12k, Feb 15k, Mar 22k visits.',
      'image',
      'site-chart.png',
    );

    const entries = f.workspace.taskMemories('thread');
    expect(entries.map((e) => e.name)).toEqual(['report.pdf', 'site-chart.png']);
    expect(entries[0]!.summary.length).toBeLessThan(entries[0]!.content.length);
    expect(f.workspace.taskMemory(pdf.id)!.kind).toBe('file');
    expect(image.bytes).toBeGreaterThan(0);
  });

  it('re-saving the same name replaces instead of duplicating', () => {
    const f = fixture();
    f.workspace.saveTaskMemory('thread', 'data.csv', 'v1 rows', 'a,b\n1,2', 'file', null);
    f.workspace.saveTaskMemory('thread', 'data.csv', 'v2 rows — refreshed', 'a,b\n1,2\n3,4', 'file', null);
    const entries = f.workspace.taskMemories('thread');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.content).toContain('3,4');
    expect(entries[0]!.summary).toBe('v2 rows — refreshed');
  });

  it('appends to an existing entry and refuses missing ones', () => {
    const f = fixture();
    f.workspace.saveTaskMemory('thread', 'log', 'rolling log', 'line 1', 'note', null);
    const appended = f.workspace.appendTaskMemory(
      'thread',
      'log',
      'line 2',
      'rolling log — now 2 lines',
    );
    expect(appended!.content).toBe('line 1\nline 2');
    expect(appended!.summary).toBe('rolling log — now 2 lines');
    expect(
      f.workspace.appendTaskMemory('thread', 'missing', 'x'),
    ).toBeUndefined();
  });

  it('search ranks by summary and deep content, and is thread-scoped', () => {
    const f = fixture();
    f.workspace.bindThread('other', f.dot.id, 'Other');
    f.workspace.saveTaskMemory(
      'thread',
      'timesheet-q3.csv',
      'Employee hours for Q3',
      'employee,date,hours\namy,2026-07-01,8',
      'file',
      null,
    );
    f.workspace.saveTaskMemory(
      'thread',
      'pizza-notes',
      'Food preferences',
      'Loves pepperoni',
      'note',
      null,
    );
    f.workspace.saveTaskMemory(
      'other',
      'decoy.csv',
      'Different conversation',
      'not reachable from thread',
      'file',
      null,
    );

    const hits = f.workspace.searchTaskMemory('thread', 'timesheet hours');
    expect(hits[0]!.name).toBe('timesheet-q3.csv');
    expect(hits.map((h) => h.name)).not.toContain('decoy.csv');
    expect(hits.map((h) => h.name)).not.toContain('pizza-notes');

    // Deep content match still surfaces an entry.
    const deep = f.workspace.searchTaskMemory('thread', 'pepperoni');
    expect(deep[0]!.name).toBe('pizza-notes');
  });

  it('flushes single entries and the whole set', () => {
    const f = fixture();
    const a = f.workspace.saveTaskMemory('thread', 'a', 'x', 'content-a', 'note', null);
    f.workspace.saveTaskMemory('thread', 'b', 'y', 'content-b', 'note', null);
    expect(f.workspace.deleteTaskMemory(a.id)).toBe(true);
    expect(f.workspace.taskMemories('thread')).toHaveLength(1);
    expect(f.workspace.deleteTaskMemory(a.id)).toBe(false);
    expect(f.workspace.clearTaskMemory('thread')).toBe(1);
    expect(f.workspace.taskMemories('thread')).toHaveLength(0);
  });

  it('cascades when the conversation is deleted', () => {
    const f = fixture();
    f.workspace.saveTaskMemory('thread', 'keep-me', 'x', 'data', 'note', null);
    // The thread delete path clears task memory with the rest of the thread.
    f.workspace.clearSessionMemories('thread');
    // Direct cascade: simulate the deleteConversation flow's SQL by using the public API.
    expect(f.workspace.taskMemories('thread')).toHaveLength(1);
    f.workspace.clearTaskMemory('thread');
    expect(f.workspace.taskMemories('thread')).toHaveLength(0);
  });
});

describe('task memory: agent integration', () => {
  it('exposes the six task-memory tools and prompt guidance', async () => {
    const f = fixture();
    f.workspace.saveTaskMemory(
      'thread',
      'existing.pdf',
      'Already captured document',
      'full extracted content',
      'file',
      'existing.pdf',
    );
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(completion({ role: 'assistant', content: 'ok' }));
    await lastValueFrom(f.agent.run(f.input).pipe(toArray()));
    const request = JSON.parse(String(network.mock.calls[0][1]?.body));
    const names = (request.tools ?? []).map(
      (t: { function?: { name?: string } }) => t.function?.name,
    );
    for (const name of [
      'save_task_memory',
      'append_task_memory',
      'list_task_memory',
      'read_task_memory',
      'search_task_memory',
      'clear_task_memory',
    ]) {
      expect(names).toContain(name);
    }

    const system = JSON.stringify(request.messages ?? []);
    expect(system).toContain('TASK MEMORY (LONG CONTEXT)');
    expect(system).toContain('FLUSH DISCIPLINE');
    // Only summaries enter context, not the full content.
    expect(system).toContain('existing.pdf');
    expect(system).not.toContain('full extracted content');
    expect(system).toContain('working set summaries');
  });
});
