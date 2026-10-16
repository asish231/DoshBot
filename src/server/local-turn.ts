import { randomUUID } from 'node:crypto';
import type { Observable } from 'rxjs';
import {
  EventType,
  type BaseEvent,
  type Message,
  type RunAgentInput,
} from '@ag-ui/core';
import { currentTurnText } from './headless.js';
import { systemMessagePrefix } from '../shared/voice-receipt.js';

export interface LocalTurnRunner {
  getThreadMessages(threadId: string): Message[];
  run(request: {
    threadId: string;
    agent: unknown;
    input: RunAgentInput;
  }): Observable<BaseEvent>;
  stop(request: { threadId: string; runId?: string }): Promise<unknown>;
}

/**
 * Runs a server-initiated turn on the local in-memory runner — the path
 * used when INTELLIGENCE_API_KEY=local, where there is no cloud
 * Intelligence runtime for runThreadTurn to talk to. The runner drives the
 * Dot and persists the run (live snapshot + SQLite) exactly like a browser
 * turn, so voice compute, call receipts, /btw and scheduled tasks land in
 * the same conversation.
 */
export async function runLocalTurn(options: {
  runner: LocalTurnRunner;
  agent: { messages: Message[] };
  threadId: string;
  prompt: string;
  signal: AbortSignal;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const { runner, agent, threadId, prompt, signal, metadata } = options;
  signal.throwIfAborted();
  const history = runner.getThreadMessages(threadId);
  const runId = randomUUID();
  const input: RunAgentInput = {
    threadId,
    runId,
    messages: [
      ...history,
      {
        id: `${systemMessagePrefix(
          metadata?.opendotsSource as string | undefined,
        )}${randomUUID()}`,
        role: 'user',
        content: prompt,
        ...(metadata ? { metadata } : {}),
      },
    ],
    tools: [],
    context: [],
  };
  let source: Observable<BaseEvent>;
  try {
    source = runner.run({ threadId, agent, input });
  } catch (error) {
    // Default InMemoryAgentRunner rejects a second concurrent run on a
    // thread ("Thread already running") — e.g. voice compute arriving
    // mid text turn. Say so plainly instead of leaking runner internals.
    const busy = /already running/i.test(
      error instanceof Error ? error.message : '',
    );
    throw new Error(
      busy
        ? 'The chat is still working on your last message — try the voice request again in a moment.'
        : error instanceof Error
          ? error.message
          : 'Could not start the local turn.',
      { cause: error },
    );
  }
  let runError: string | undefined;
  await new Promise<void>((resolve, reject) => {
    // Holder (not a plain let) so synchronously-completing streams can
    // finalize during subscribe() without hitting a TDZ on the binding.
    const state: { subscription?: { unsubscribe(): void } } = {};
    function cleanup() {
      signal.removeEventListener('abort', onAbort);
      state.subscription?.unsubscribe();
    }
    const onAbort = () => {
      void runner.stop({ threadId, runId }).catch(() => {});
    };
    state.subscription = source.subscribe({
      next: (event) => {
        if (event?.type === EventType.RUN_ERROR) {
          const message = (event as unknown as { message?: unknown })
            .message;
          if (typeof message === 'string' && message) runError = message;
        }
      },
      error: (error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      },
      complete: () => {
        cleanup();
        resolve();
      },
    });
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  signal.throwIfAborted();
  return currentTurnText(
    agent.messages,
    runError ? new Error(runError) : undefined,
  );
}
