import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceStore } from '../src/server/workspace.js';

const databases: Array<{ close(): void }> = [];
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
});

function fixture() {
  const workspace = new WorkspaceStore(':memory:', 'owner');
  databases.push(workspace);
  const dot = workspace.dots()[0];
  workspace.bindThread('thread', dot.id, 'Original');
  return { workspace, dot };
}

/**
 * One turn of a conversation. Run rows are full conversation snapshots —
 * each new row repeats the whole history plus the turn's two messages —
 * mirroring how the runner persists threads.
 */
function addTurn(
  workspace: WorkspaceStore,
  threadId: string,
  n: number,
): { userId: string; assistantId: string; runId: string } {
  const userId = `user-${n}`;
  const assistantId = `assistant-${n}`;
  const runId = `run-${n}`;
  const previous = workspace.threadRuns(threadId).at(-1);
  const history = previous
    ? (JSON.parse(previous.messages) as Array<unknown>)
    : [];
  workspace.saveThreadRun({
    id: runId,
    threadId,
    agentId: 'chat',
    parentRunId: null,
    events: '[]',
    messages: JSON.stringify([
      ...history,
      { id: userId, role: 'user', content: `Message ${n}` },
      { id: assistantId, role: 'assistant', content: `Reply ${n}` },
    ]),
    createdAt: Date.now() + n,
  });
  return { userId, assistantId, runId };
}

function ids(workspace: WorkspaceStore, threadId: string): string[] {
  const last = workspace.threadRuns(threadId).at(-1);
  return (
    JSON.parse(last?.messages ?? '[]') as Array<{ id: string }>
  ).map((m) => m.id);
}

describe('fork', () => {
  it('copies runs, session memories, and task memory into a new chat', () => {
    const f = fixture();
    addTurn(f.workspace, 'thread', 1);
    addTurn(f.workspace, 'thread', 2);
    f.workspace.saveSessionMemory('thread', 'likes tea', undefined, 'preference');
    f.workspace.saveTaskMemory(
      'thread',
      'report.pdf',
      'extracted q3 report',
      'full raw markdown',
      'file',
      'report.pdf',
    );

    const forked = f.workspace.forkThread('thread');
    expect(forked.id).not.toBe('thread');
    expect(forked.dotId).toBe(f.dot.id);
    expect(forked.title).toContain('Fork of Original');

    expect(f.workspace.threadRuns(forked.id)).toHaveLength(2);
    expect(f.workspace.sessionMemories(forked.id)[0]!.text).toBe('likes tea');
    expect(f.workspace.taskMemories(forked.id)[0]!.name).toBe('report.pdf');

    // The source is untouched.
    expect(f.workspace.threadRuns('thread')).toHaveLength(2);
    expect(f.workspace.taskMemories('thread')).toHaveLength(1);
  });

  it('fork up to a message keeps history only up to and including it', () => {
    const f = fixture();
    addTurn(f.workspace, 'thread', 1);
    const t2 = addTurn(f.workspace, 'thread', 2);
    addTurn(f.workspace, 'thread', 3);

    // Fork at the assistant reply of turn 2: the fork's transcript ends
    // there; turn 3 never made it in.
    const forked = f.workspace.forkThread('thread', t2.assistantId);
    expect(f.workspace.threadRuns(forked.id)).toHaveLength(2);
    expect(ids(f.workspace, forked.id)).toEqual([
      'user-1',
      'assistant-1',
      'user-2',
      'assistant-2',
    ]);
  });

  it('forking from an unknown message safely copies the whole conversation', () => {
    const f = fixture();
    addTurn(f.workspace, 'thread', 1);
    addTurn(f.workspace, 'thread', 2);
    // Unknown cutoff (e.g. a stale id after compaction): nothing matches,
    // so the fork degrades gracefully to a full copy instead of an empty chat.
    const forked = f.workspace.forkThread('thread', 'does-not-exist');
    expect(f.workspace.threadRuns(forked.id)).toHaveLength(2);
  });

  it('supports a custom title and keeps the learning container', () => {
    const f = fixture();
    addTurn(f.workspace, 'thread', 1);
    const forked = f.workspace.forkThread('thread', undefined, 'My branch');
    expect(forked.title).toBe('My branch');
  });
});

describe('edit (edit-and-resend semantics)', () => {
  it('drops the target and everything after; returns the tail for undo', () => {
    const f = fixture();
    addTurn(f.workspace, 'thread', 1);
    const t2 = addTurn(f.workspace, 'thread', 2);
    addTurn(f.workspace, 'thread', 3);

    // The corrected content is re-sent by the client as a fresh message;
    // the server just removes the target + tail from every snapshot.
    const result = f.workspace.editThreadMessage(
      'thread',
      t2.userId,
      'Message 2 (corrected)',
    );
    expect(result.edited).toBe(true);
    expect(result.removed.map((m) => m.id)).toEqual([
      'user-2',
      'assistant-2',
      'user-3',
      'assistant-3',
    ]);
    expect(ids(f.workspace, 'thread')).toEqual(['user-1', 'assistant-1']);
  });

  it('editing the last turn removes just that turn', () => {
    const f = fixture();
    addTurn(f.workspace, 'thread', 1);
    const t2 = addTurn(f.workspace, 'thread', 2);
    const result = f.workspace.editThreadMessage('thread', t2.userId, 'fixed');
    expect(result.removed.map((m) => m.id)).toEqual([
      'user-2',
      'assistant-2',
    ]);
    expect(ids(f.workspace, 'thread')).toEqual(['user-1', 'assistant-1']);
  });

  it('throws for unknown messages', () => {
    const f = fixture();
    addTurn(f.workspace, 'thread', 1);
    expect(() =>
      f.workspace.editThreadMessage('thread', 'ghost', 'x'),
    ).toThrow(/not found/i);
  });
});

describe('revert', () => {
  it('keeps history up to the message and drops the rest in place', () => {
    const f = fixture();
    addTurn(f.workspace, 'thread', 1);
    const t2 = addTurn(f.workspace, 'thread', 2);
    addTurn(f.workspace, 'thread', 3);

    const removed = f.workspace.revertThreadToMessage('thread', t2.assistantId);
    expect(removed.map((m) => m.id)).toEqual(['user-3', 'assistant-3']);
    expect(ids(f.workspace, 'thread')).toEqual([
      'user-1',
      'assistant-1',
      'user-2',
      'assistant-2',
    ]);
  });

  it('reverting to an early message keeps only that message', () => {
    const f = fixture();
    const t1 = addTurn(f.workspace, 'thread', 1);
    addTurn(f.workspace, 'thread', 2);
    const removed = f.workspace.revertThreadToMessage('thread', t1.userId);
    expect(removed.map((m) => m.id)).toEqual([
      'assistant-1',
      'user-2',
      'assistant-2',
    ]);
    expect(ids(f.workspace, 'thread')).toEqual(['user-1']);
  });

  it('throws for unknown messages', () => {
    const f = fixture();
    expect(() =>
      f.workspace.revertThreadToMessage('thread', 'nope'),
    ).toThrow(/not found/i);
  });
});

describe('restore (undo for revert/edit)', () => {
  it('appends the removed tail back as a fresh snapshot row', () => {
    const f = fixture();
    addTurn(f.workspace, 'thread', 1);
    const t2 = addTurn(f.workspace, 'thread', 2);
    addTurn(f.workspace, 'thread', 3);

    const tail = f.workspace.revertThreadToMessage('thread', t2.assistantId);
    const result = f.workspace.restoreThreadMessages('thread', tail);
    expect(result.restored).toBe(2);
    expect(ids(f.workspace, 'thread')).toEqual([
      'user-1',
      'assistant-1',
      'user-2',
      'assistant-2',
      'user-3',
      'assistant-3',
    ]);
  });
});
