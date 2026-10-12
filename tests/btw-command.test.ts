import { afterEach, describe, expect, it, vi } from 'vitest';
import { Platform } from '../src/server/platform.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { workspaceRoutes } from '../src/server/workspace-routes.js';
import type { VoiceService } from '../src/server/voice.js';

const databases: Array<{ close(): void }> = [];
afterEach(() => {
  vi.restoreAllMocks();
  databases.splice(0).forEach((db) => db.close());
});

function fixture() {
  const workspace = new WorkspaceStore(':memory:', 'owner');
  databases.push(workspace);
  const dot = workspace.dots()[0];
  workspace.bindThread('thread', dot.id, 'Main chat');
  // The real method without running Platform.start(): the prototype method
  // only needs `workspace` and a stubbed `turn`.
  const platform = Object.create(Platform.prototype) as Platform;
  Object.assign(platform, { workspace });
  return { workspace, dot, platform };
}

describe('Platform.askSideQuestion (/btw)', () => {
  it('answers in a throwaway thread that is deleted afterwards', async () => {
    const f = fixture();
    const turn = vi
      .spyOn(f.platform, 'turn')
      .mockResolvedValue('The deploy command is `npm run build`.');
    const reply = await f.platform.askSideQuestion(
      'thread',
      'What is the deploy command?',
      new AbortController().signal,
    );

    expect(reply).toBe('The deploy command is `npm run build`.');
    expect(turn).toHaveBeenCalledTimes(1);
    const [tempId, prompt, , metadata] = turn.mock.calls[0]!;
    expect(tempId).not.toBe('thread');
    expect(tempId.startsWith('btw-')).toBe(true);
    expect(prompt).toBe('What is the deploy command?');
    expect(metadata).toEqual({ opendotsSource: 'btw' });

    // The throwaway thread is gone; the main chat is untouched.
    const threads = f.workspace.conversations();
    expect(threads.some((t) => t.id === tempId)).toBe(false);
    expect(threads.some((t) => t.id === 'thread')).toBe(true);
  });

  it('cleans up the throwaway thread even when the turn fails', async () => {
    const f = fixture();
    let tempId = '';
    vi.spyOn(f.platform, 'turn').mockImplementation(
      async (id: string) => {
        tempId = id;
        throw new Error('runtime exploded');
      },
    );
    await expect(
      f.platform.askSideQuestion('thread', 'anything', new AbortController().signal),
    ).rejects.toThrow('runtime exploded');
    expect(tempId.startsWith('btw-')).toBe(true);
    expect(
      f.workspace.conversations().some((t) => t.id === tempId),
    ).toBe(false);
  });

  it('rejects unknown conversations before creating anything', async () => {
    const f = fixture();
    const turn = vi.spyOn(f.platform, 'turn');
    await expect(
      f.platform.askSideQuestion('ghost', 'hi', new AbortController().signal),
    ).rejects.toThrow();
    expect(turn).not.toHaveBeenCalled();
  });
});

describe('POST /conversations/:threadId/btw', () => {
  const call = (app: ReturnType<typeof workspaceRoutes>, body: unknown) =>
    app.request('/conversations/thread/btw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });

  it('returns the side reply', async () => {
    const f = fixture();
    const askSideQuestion = vi
      .spyOn(f.platform, 'askSideQuestion')
      .mockResolvedValue('Side answer.');
    const app = workspaceRoutes(f.platform, {} as unknown as VoiceService);
    const response = await call(app, { question: 'Quick one?' });
    expect(response.status).toBe(200);
    expect((await response.json()).reply).toBe('Side answer.');
    expect(askSideQuestion.mock.calls[0]![0]).toBe('thread');
  });

  it('validates the question', async () => {
    const f = fixture();
    const app = workspaceRoutes(f.platform, {} as unknown as VoiceService);
    expect((await call(app, {})).status).toBe(400);
    expect(
      (await call(app, { question: '   ' })).status,
    ).toBe(400);
    expect(
      (await call(app, { question: 'x'.repeat(8001) })).status,
    ).toBe(400);
  });

  it('maps failures to 500 with the message', async () => {
    const f = fixture();
    vi.spyOn(f.platform, 'askSideQuestion').mockRejectedValue(
      new Error('runtime exploded'),
    );
    const app = workspaceRoutes(f.platform, {} as unknown as VoiceService);
    const response = await call(app, { question: 'hi' });
    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain('runtime exploded');
  });
});
