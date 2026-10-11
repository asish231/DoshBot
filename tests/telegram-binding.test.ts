import { describe, expect, it, vi } from 'vitest';
import { TelegramChannel } from '../src/server/telegram-channel.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import type { Platform } from '../src/server/platform.js';

function fixture() {
  const workspace = new WorkspaceStore(':memory:', 'owner');
  const dot = workspace.dots()[0];
  const created: string[] = [];
  const platform: Pick<
    Platform,
    'workspace' | 'turn' | 'createConversation' | 'store'
  > = {
    workspace,
    turn: async (threadId, prompt) => `turn:${threadId}:${prompt}`,
    createConversation: async (dotId, title) => {
      const id = `t-${created.length + 1}`;
      created.push(id);
      workspace.bindThread(id, dotId, title);
      return { id, dotId, ownerId: 'owner', title, createdAt: Date.now() };
    },
    store: vi.fn() as never,
  };
  const sent: Array<{ chatId: number; text: string }> = [];
  const transport: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      chat_id?: number;
      text?: string;
      action?: string;
    };
    if (String(input).includes('sendMessage'))
      sent.push({ chatId: body.chat_id ?? 0, text: body.text ?? '' });
    return Response.json({ ok: true, result: [] });
  };
  const channel = new TelegramChannel(
    platform,
    {
      getToken: () => 'fixture-token',
      getAllowedUsers: () => '42',
      isPaused: () => false,
    },
    transport,
  );
  return { workspace, dot, channel, sent, created };
}

describe('Telegram channel durable thread bindings', () => {
  it('keeps chat -> thread bindings across channel restarts', async () => {
    const f = fixture();
    const channel2 = new TelegramChannel(
      {
        workspace: f.workspace,
        turn: async (threadId, prompt) => `turn:${threadId}:${prompt}`,
        createConversation: async (dotId, title) => {
          const id = 't-new';
          f.workspace.bindThread(id, dotId, title);
          return {
            id,
            dotId,
            ownerId: 'owner',
            title,
            createdAt: Date.now(),
          };
        },
        store: vi.fn() as never,
      },
      {
        getToken: () => 't',
        getAllowedUsers: () => '42',
        isPaused: () => false,
      },
      async () => Response.json({ ok: true }),
    );
    // First message creates and persists a binding.
    await channel2.handleMessage('token', {
      message_id: 1,
      from: { id: 42 },
      chat: { id: 100, type: 'private' },
      text: 'hello',
    });
    expect(f.created.length + 1).toBeGreaterThanOrEqual(1);
    expect(f.workspace.telegramThread(100)).toBeDefined();
  });

  it('refuses users outside the allowlist', async () => {
    const f = fixture();
    await f.channel.handleMessage('token', {
      message_id: 2,
      from: { id: 999 },
      chat: { id: 200, type: 'private' },
      text: 'let me in',
    });
    expect(f.sent.at(-1)?.text).toContain('not authorized');
    expect(f.workspace.telegramThread(200)).toBeUndefined();
  });

  it('clears the binding when the bound thread is deleted', async () => {
    const f = fixture();
    await f.channel.handleMessage('token', {
      message_id: 3,
      from: { id: 42 },
      chat: { id: 300, type: 'private' },
      text: 'hi',
    });
    const threadId = f.workspace.telegramThread(300);
    expect(threadId).toBeDefined();
    f.workspace.deleteThread(threadId!);
    expect(f.workspace.telegramThread(300)).toBeUndefined();
  });
});
