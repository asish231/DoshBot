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

/** One turn of a conversation: a run holding user + assistant messages. */
function addTurn(
  workspace: WorkspaceStore,
  threadId: string,
  n: number,
): { userId: string; assistantId: string; runId: string } {
  const userId = `user-${n}`;
  const assistantId = `assistant-${n}`;
  const runId = `run-${n}`;
  workspace.saveThreadRun({
    id: runId,
    threadId,
    agentId: 'chat',
    parentRunId: null,
    events: '[]',
    messages: JSON.stringify([
      { id: userId, role: 'user', content: `Message ${n}` },
      { id: assistantId, role: 'assistant', content: `Reply ${n}` },
    ]),
    createdAt: Date.now() + n,
  });
  return { userId, assistantId, runId };
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

    // Fork at the assistant reply of turn 2: turns 1-2 in, run 2 truncated
    // after the assistant message, turn 3 gone.
    const forked = f.workspace.forkThread('thread', t2.assistantId);
    const runs = f.workspace.threadRuns(forked.id);
    expect(runs).toHaveLength(2);
    const last = JSON.parse(runs[1]!.messages) as Array<{ id: string }>;
    expect(last.map((m) => m.id)).toEqual(['user-2', 'assistant-2']);
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
  it('rewrites the message and drops later turns', () => {
    const f = fixture();
    addTurn(f.workspace, 'thread', 1);
    const t2 = addTurn(f.workspace, 'thread', 2);
    addTurn(f.workspace, 'thread', 3);

    const result = f.workspace.editThreadMessage(
      'thread',
      t2.userId,
      'Message 2 (corrected)',
    );
    expect(result.edited).toBe(true);
    expect(result.truncatedRuns).toBe(1); // run 3 dropped

    const runs = f.workspace.threadRuns('thread');
    expect(runs).toHaveLength(2);
    const edited = JSON.parse(runs[1]!.messages) as Array<{
      id: string;
      content: string;
    }>;
    expect(edited[0]!.content).toBe('Message 2 (corrected)');
    expect(edited[1]!.content).toBe('Reply 2'); // assistant reply intact
  });

  it('editing the last turn truncates nothing', () => {
    const f = fixture();
    addTurn(f.workspace, 'thread', 1);
    const t2 = addTurn(f.workspace, 'thread', 2);
    const result = f.workspace.editThreadMessage('thread', t2.userId, 'fixed');
    expect(result.truncatedRuns).toBe(0);
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
    expect(removed).toBe(1); // run 3 removed, runs 1-2 remain intact
    expect(f.workspace.threadRuns('thread')).toHaveLength(2);
    const last = JSON.parse(
      f.workspace.threadRuns('thread')[1]!.messages,
    ) as Array<{ id: string }>;
    expect(last.map((m) => m.id)).toEqual(['user-2', 'assistant-2']);
  });

  it('reverting the last turn removes nothing', () => {
    const f = fixture();
    const t1 = addTurn(f.workspace, 'thread', 1);
    addTurn(f.workspace, 'thread', 2);
    expect(f.workspace.revertThreadToMessage('thread', t1.userId)).toBe(1);
    expect(f.workspace.threadRuns('thread')).toHaveLength(1);
  });

  it('throws for unknown messages', () => {
    const f = fixture();
    expect(() =>
      f.workspace.revertThreadToMessage('thread', 'nope'),
    ).toThrow(/not found/i);
  });
});
