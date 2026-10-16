import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceStore } from '../src/server/workspace.js';

const databases: Array<{ close(): void }> = [];
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
});

function fixture() {
  const workspace = new WorkspaceStore(':memory:', 'opendots-owner');
  databases.push(workspace);
  const dot = workspace.dots()[0];
  const alice = 'user-alice';
  const bob = 'user-bob';
  return { workspace, dot, alice, bob };
}

describe('per-user thread ownership', () => {
  it('lists only the owner’s conversations', () => {
    const { workspace, dot, alice, bob } = fixture();
    workspace.bindThread('thread-a', dot.id, 'Alice chat', alice);
    workspace.bindThread('thread-b', dot.id, 'Bob chat', bob);
    expect(workspace.conversations(alice).map((t) => t.id)).toEqual([
      'thread-a',
    ]);
    expect(workspace.conversations(bob).map((t) => t.id)).toEqual(['thread-b']);
    // Default (bootstrap/legacy) owner sees only its own.
    expect(workspace.conversations().map((t) => t.id)).toEqual([]);
  });

  it('requireThread hides other users’ threads when scoped', () => {
    const { workspace, dot, alice, bob } = fixture();
    workspace.bindThread('thread-a', dot.id, 'Alice chat', alice);
    expect(workspace.requireThread('thread-a', undefined, alice).id).toBe(
      'thread-a',
    );
    expect(() => workspace.requireThread('thread-a', undefined, bob)).toThrow(
      /not belong/,
    );
    // Unscoped (server-internal) lookups still resolve.
    expect(workspace.requireThread('thread-a').ownerId).toBe(alice);
  });

  it('keeps each user’s session memories behind thread ownership', () => {
    const { workspace, dot, alice, bob } = fixture();
    workspace.bindThread('thread-a', dot.id, 'Alice chat', alice);
    workspace.saveSessionMemory('thread-a', 'alice note', undefined, 'note');
    // Bob cannot even resolve the thread, so the memory is unreachable.
    expect(() => workspace.requireThread('thread-a', undefined, bob)).toThrow(
      /not belong/,
    );
    expect(
      workspace.sessionMemories('thread-a').map((m) => m.text),
    ).toEqual(['alice note']);
  });

  it('forks into the forking user’s space from their own thread only', () => {
    const { workspace, dot, alice, bob } = fixture();
    workspace.bindThread('thread-a', dot.id, 'Alice chat', alice);
    // Bob cannot fork Alice's thread.
    expect(() => workspace.forkThread('thread-a', undefined, 'Copy', bob)).toThrow(
      /not belong/,
    );
    const forked = workspace.forkThread('thread-a', undefined, 'Copy', alice);
    expect(forked.ownerId).toBe(alice);
    expect(workspace.conversations(alice).map((t) => t.id)).toContain(forked.id);
  });

  it('delete and rename only touch the owning user’s thread', () => {
    const { workspace, dot, alice, bob } = fixture();
    workspace.bindThread('thread-a', dot.id, 'Alice chat', alice);
    // Bob's rename/delete attempts are no-ops on Alice's thread.
    workspace.updateThread('thread-a', { title: 'Hacked' }, bob);
    expect(workspace.requireThread('thread-a', undefined, alice).title).toBe(
      'Alice chat',
    );
    workspace.deleteThread('thread-a', bob);
    expect(workspace.requireThread('thread-a', undefined, alice).id).toBe(
      'thread-a',
    );
    // Alice's own delete works.
    workspace.deleteThread('thread-a', alice);
    expect(() => workspace.requireThread('thread-a', undefined, alice)).toThrow(
      /not belong/,
    );
  });

  it('voice calls stay reachable only through their owning thread', () => {
    const { workspace, dot, alice, bob } = fixture();
    workspace.bindThread('thread-a', dot.id, 'Alice chat', alice);
    const call = workspace.createCall('thread-a');
    // The call's thread resolves for Alice, not for Bob — the route-level
    // ownedCall guard chains exactly these two lookups.
    expect(
      workspace.requireThread(workspace.call(call.id).threadId, undefined, alice)
        .id,
    ).toBe('thread-a');
    expect(() =>
      workspace.requireThread(workspace.call(call.id).threadId, undefined, bob),
    ).toThrow(/not belong/);
  });
});
