import { describe, expect, it, vi } from 'vitest';
import { Observable } from 'rxjs';
import type { BaseEvent, Message } from '@ag-ui/core';
import { runLocalTurn } from '../src/server/local-turn.js';
import { voiceReceiptMessagePrefix } from '../src/shared/voice-receipt.js';

function textEvent(text: string): BaseEvent {
  return {
    type: 'TEXT_MESSAGE_CONTENT',
    messageId: 'a1',
    delta: text,
  } as unknown as BaseEvent;
}

function runErrorEvent(message: string): BaseEvent {
  return { type: 'RUN_ERROR', message } as unknown as BaseEvent;
}

describe('runLocalTurn', () => {
  it('runs the prompt after history and returns the assistant reply', async () => {
    const seen: { messages?: Message[] } = {};
    const agentMessages: Message[] = [];
    const agent = { messages: agentMessages };
    const runner = {
      getThreadMessages: (_threadId: string): Message[] => [
        { id: 'h1', role: 'user', content: 'earlier' } as Message,
      ],
      run: (request: { input: { messages: Message[] } }) => {
        seen.messages = request.input.messages;
        return new Observable<BaseEvent>((sub) => {
          agentMessages.push(...request.input.messages, {
            id: 'a1',
            role: 'assistant',
            content: 'all done',
          } as Message);
          sub.next(textEvent('all done'));
          sub.complete();
        });
      },
      stop: async () => true,
    };
    const text = await runLocalTurn({
      runner,
      agent,
      threadId: 'thread',
      prompt: 'do the thing',
      signal: new AbortController().signal,
    });
    expect(text).toBe('all done');
    expect(seen.messages?.map((m) => m.content)).toEqual([
      'earlier',
      'do the thing',
    ]);
  });

  it('marks voice receipts so the chat hides the internal prompt', async () => {
    const seen: { messages?: Message[] } = {};
    const agent = { messages: [] as Message[] };
    const runner = {
      getThreadMessages: (): Message[] => [],
      run: (request: { input: { messages: Message[] } }) => {
        seen.messages = request.input.messages;
        return new Observable<BaseEvent>((sub) => {
          agent.messages.push({
            id: 'a1',
            role: 'assistant',
            content: 'receipt',
          } as Message);
          sub.complete();
        });
      },
      stop: async () => true,
    };
    await runLocalTurn({
      runner,
      agent,
      threadId: 'thread',
      prompt: 'Call ended after 30 seconds.',
      signal: new AbortController().signal,
      metadata: { opendotsSource: 'voice_receipt' },
    });
    const userMessage = seen.messages?.at(-1);
    expect(userMessage?.role).toBe('user');
    expect(String(userMessage?.id)).toMatch(
      new RegExp(`^${voiceReceiptMessagePrefix}`),
    );
    expect(
      (userMessage as { metadata?: { opendotsSource?: string } })?.metadata
        ?.opendotsSource,
    ).toBe('voice_receipt');
  });

  it('throws the run error when the turn produces no reply', async () => {
    const runner = {
      getThreadMessages: (): Message[] => [],
      run: () =>
        new Observable<BaseEvent>((sub) => {
          sub.next(runErrorEvent('model exploded'));
          sub.complete();
        }),
      stop: async () => true,
    };
    await expect(
      runLocalTurn({
        runner,
        agent: { messages: [] as Message[] },
        threadId: 'thread',
        prompt: 'do the thing',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('model exploded');
  });

  it('explains a busy thread instead of leaking runner internals', async () => {
    const runner = {
      getThreadMessages: (): Message[] => [],
      run: () => {
        throw new Error('Thread already running');
      },
      stop: async () => true,
    };
    await expect(
      runLocalTurn({
        runner,
        agent: { messages: [] as Message[] },
        threadId: 'thread',
        prompt: 'do the thing',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/still working on your last message/);
  });

  it('stops the run when the signal aborts mid-turn', async () => {
    const stop = vi.fn(async () => true);
    const holder: { complete: (() => void) | null } = { complete: null };
    const runner = {
      getThreadMessages: (): Message[] => [],
      run: () =>
        new Observable<BaseEvent>((sub) => {
          holder.complete = () => sub.complete();
        }),
      stop,
    };
    const controller = new AbortController();
    const pending = runLocalTurn({
      runner,
      agent: { messages: [] as Message[] },
      threadId: 'thread',
      prompt: 'do the thing',
      signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    // The runner finalizes after stop; complete the stream like it would.
    await new Promise((r) => setTimeout(r, 10));
    holder.complete?.();
    await expect(pending).rejects.toThrow();
    expect(stop).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'thread' }),
    );
  });
});
