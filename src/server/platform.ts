import { ComputerService } from './computer-service.js';
import { PageService } from './page-service.js';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  CopilotKitIntelligence,
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotHonoHandler,
  type CopilotHonoApp,
} from '@copilotkit/runtime/v2';
import { PersistentLocalRunner } from './local-runner.js';
import type { AbstractAgent } from '@ag-ui/client';
import { createSlackChannel } from './slack-channel.js';
export { slackIdentity } from './slack-channel.js';
import { Store } from './store.js';
import { WorkspaceStore } from './workspace.js';
import { DotAgent } from './dot-agent.js';
import { runThreadTurn } from './headless.js';
import { setupStatus, type PlatformConfig } from './platform-config.js';
import { validateRuntimeScope } from './runtime-scope.js';
import { learningSelector } from './learning.js';
export class Platform {
  private channelStartupFailed = false;
  readonly pages: PageService;
  readonly computers: ComputerService;
  readonly intelligence?: CopilotKitIntelligence;
  readonly runner?: InMemoryAgentRunner;
  readonly handler?: CopilotHonoApp;
  constructor(
    readonly store: Store,
    readonly workspace: WorkspaceStore,
    readonly config: PlatformConfig,
  ) {
    this.computers = new ComputerService(
      workspace,
      config,
      () => store.settings().paused,
    );
    const isCloudIntelligence =
      config.intelligenceKey && config.intelligenceKey !== 'local';
    if (isCloudIntelligence) {
      this.intelligence = new CopilotKitIntelligence({
        apiKey: config.intelligenceKey!,
        apiUrl: config.intelligenceApiUrl,
        wsUrl: config.intelligenceWsUrl,
        getLearningContainerId: learningSelector(
          workspace,
          config.slackDotId ?? workspace.dots()[0]?.id,
        ),
      });
    } else if (config.intelligenceKey === 'local') {
      this.runner = new PersistentLocalRunner(this.workspace);
    }
    const localRunner = this.runner;
    this.pages = new PageService(workspace, () => {
      this.requireReady();
      if (this.intelligence) return this.intelligence;
      return {
        async getOrCreateThread(input: {
          threadId: string;
          userId: string;
          agentId: string;
          name: string;
        }) {
          const existing = workspace
            .conversations()
            .find((t) => t.id === input.threadId);
          if (!existing) {
            workspace.bindThread(input.threadId, input.agentId, input.name);
          }
          return { id: input.threadId };
        },
        async getThreadMessages(input: { threadId: string; userId: string }) {
          if (localRunner) {
            const msgs = localRunner.getThreadMessages(input.threadId);
            return {
              messages: msgs.map((m: { role: string; content?: unknown }) => ({
                role: m.role,
                content: m.content,
              })),
            };
          }
          return { messages: [] };
        },
      };
    });
    const channels = [];
    if (
      this.intelligence &&
      config.slackChannel &&
      config.slackTeam &&
      config.slackUsers.length
    ) {
      const dotId = config.slackDotId ?? workspace.dots()[0].id;
      if (!workspace.dot(dotId))
        throw new Error('SLACK_DOT_ID does not identify an existing Dot.');
      const slack = createSlackChannel({
        name: config.slackChannel,
        config,
        ownerId: workspace.ownerId,
        paused: () => store.settings().paused,
        agent: () => new DotAgent(store, workspace, config, dotId, true),
      });
      channels.push(slack);
    }
    const runtime = this.intelligence
      ? new CopilotRuntime({
          intelligence: this.intelligence,
          // The runtime stores every thread under the identified user, so
          // this must resolve the actual signed-in account per request —
          // not a single hardcoded identity — or every user's chats
          // would pile up under one provider user.
          identifyUser: async (request: Request) => {
            const bearer =
              request.headers.get('authorization')?.replace(
                /^Bearer /,
                '',
              ) ?? '';
            const identity = this.resolveRequestIdentity(bearer);
            if (identity) return identity;
            return { id: workspace.ownerId, name: 'OpenDots owner' };
          },
          agents: async (): Promise<Record<string, AbstractAgent>> =>
            Object.fromEntries(
              workspace
                .dots()
                .map((dot) => [
                  dot.id,
                  new DotAgent(store, workspace, config, dot.id),
                ]),
            ),
          channels,
          generateThreadNames: true,
        })
      : this.runner
        ? new CopilotRuntime({
            runner: this.runner,
            agents: async (): Promise<Record<string, AbstractAgent>> =>
              Object.fromEntries(
                workspace
                  .dots()
                  .map((dot) => [
                    dot.id,
                    new DotAgent(store, workspace, config, dot.id),
                  ]),
              ),
          })
        : undefined;
    if (runtime) {
      this.handler = createCopilotHonoHandler({
        runtime,
        basePath: '/api/copilotkit',
        cors: { origin: [] },
      });
    }
  }
  setup() {
    const status = setupStatus(
      this.config,
      this.handler?.channels?.status().overall ??
        (this.config.slackChannel ? 'setup_required' : 'not_configured'),
      this.channelStartupFailed,
    );
    const settings = this.store.settings();
    let hasDbKeys = false;
    try {
      const keys = JSON.parse(settings.voiceApiKeys || '[]');
      hasDbKeys = Array.isArray(keys) && keys.length > 0;
    } catch {
      /* ignore */
    }
    const keyReady = !!(this.config.voiceKey || hasDbKeys);
    const modelReady = !!(this.config.voiceModel || settings.voiceModel);
    status.voice = keyReady && modelReady && !status.missing.length;
    return status;
  }
  requireReady() {
    const missing = this.setup().missing;
    if (missing.length)
      throw new Error(`Setup required: ${missing.join(', ')}.`);
  }
  async start() {
    if (this.handler?.channels) {
      try {
        await this.handler.channels.ready({ timeoutMs: 15000 });
        this.channelStartupFailed = false;
      } catch (error) {
        this.channelStartupFailed = true;
        throw error;
      }
    }
    if (this.computers.configured) {
      for (const dot of this.workspace.dots()) {
        const policy = this.workspace.computers.permissions(dot.id);
        if (policy.enabled) {
          try {
            await this.computers.start(dot.id);
            if (policy.browser) {
              try {
                const snap = (await this.computers.action(
                  dot.id,
                  'snapshot',
                  {},
                  'owner',
                )) as { url?: string };
                if (!snap?.url || snap.url === 'about:blank') {
                  await this.computers.action(
                    dot.id,
                    'navigate',
                    { url: 'https://example.com' },
                    'owner',
                  );
                }
              } catch {
                /* Non-fatal: browser may still be booting */
              }
            }
          } catch {
            /* Non-fatal if supervisor is still booting or offline */
          }
        }
      }
    }
  }
  async stop() {
    await this.handler?.channels?.stop();
    if (this.computers.configured) {
      for (const dot of this.workspace.dots()) {
        const policy = this.workspace.computers.permissions(dot.id);
        if (policy.enabled) {
          try {
            await this.computers.stop(dot.id);
          } catch {
            /* Non-fatal */
          }
        }
      }
    }
  }
  async createConversation(dotId: string, title: string, ownerId?: string) {
    this.requireReady();
    if (!this.workspace.dot(dotId)) throw new Error('Dot not found.');
    const id = randomUUID();
    const threadOwner = ownerId ?? this.workspace.ownerId;
    if (this.intelligence) {
      try {
        await this.intelligence.createThread({
          threadId: id,
          userId: threadOwner,
          agentId: dotId,
          name: title,
        });
      } catch {
        throw new Error(
          'Intelligence could not create this conversation. Check the runtime key and connection.',
        );
      }
    }
    return this.workspace.bindThread(id, dotId, title, threadOwner);
  }
  async history(threadId: string): Promise<string> {
    this.requireReady();
    const thread = this.workspace.requireThread(threadId);
    let messages: { role: string; content?: unknown }[] = [];
    if (this.intelligence) {
      const history = await this.intelligence.getThreadMessages({
        threadId,
        userId: thread.ownerId,
      });
      messages = history.messages;
    } else if (this.runner) {
      messages = this.runner.getThreadMessages(threadId);
    }
    return messages
      .filter((message) => ['user', 'assistant'].includes(message.role))
      .slice(-12)
      .map(
        (message) =>
          `${message.role}: ${typeof message.content === 'string' ? message.content : ''}`,
      )
      .join('\n')
      .slice(-12000);
  }
  async handle(request: Request, ownerId?: string): Promise<Response> {
    if (!this.handler)
      return Response.json(
        { error: 'Setup required: INTELLIGENCE_API_KEY.' },
        { status: 503 },
      );
    let body: unknown;
    if (request.method !== 'GET' && request.method !== 'HEAD')
      body = await request
        .clone()
        .json()
        .catch(() => null);
    try {
      validateRuntimeScope(request, this.workspace, body, ownerId);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Conversation scope denied.',
        },
        { status: 403 },
      );
    }
    const url = new URL(request.url);
    const threadMatch = url.pathname.match(
      /^\/api\/copilotkit\/threads\/([^/]+)$/,
    );
    if (threadMatch && this.runner) {
      const threadId = decodeURIComponent(threadMatch[1]);
      if (request.method === 'PATCH') {
        const data = (body && typeof body === 'object' ? body : {}) as Record<
          string,
          unknown
        >;
        if (typeof data.name === 'string') {
          this.workspace.updateThread(threadId, { title: data.name }, ownerId);
        }
        return Response.json({
          id: threadId,
          name: data.name,
          archived: false,
        });
      }
      if (request.method === 'DELETE') {
        this.workspace.deleteThread(threadId, ownerId);
        return Response.json({ id: threadId, deleted: true });
      }
    }
    return this.handler.fetch(request);
  }
  /**
   * Resolves a bearer credential to the runtime identity it grants:
   * a session token maps to its user; the break-glass OWNER_TOKEN maps
   * to the owner account. Undefined when the credential is absent or
   * unknown — callers apply their own fallback.
   */
  private resolveRequestIdentity(
    bearer: string,
  ): { id: string; name: string } | undefined {
    if (!bearer) return undefined;
    if (this.config.auth) {
      const user = this.config.auth.validate(bearer);
      if (user) return { id: user.id, name: user.displayName };
      if (this.config.ownerToken) {
        const expected = Buffer.from(this.config.ownerToken);
        const supplied = Buffer.from(bearer);
        if (
          expected.length === supplied.length &&
          timingSafeEqual(expected, supplied)
        ) {
          const owner = this.config.auth.breakGlassUser();
          return { id: owner.id, name: owner.displayName };
        }
      }
    }
    return undefined;
  }
  /**
   * Authorization for a server-side turn on a thread: a short-lived
   * internal session minted for the thread's owner, so the runtime
   * records the turn under the same provider identity the browser uses
   * for that thread. Falls back to the break-glass token when the owner
   * has no account yet.
   */
  private internalTurnHeaders(ownerId: string): Record<string, string> {
    const token = this.config.auth?.mintInternalToken(ownerId);
    if (token) return { Authorization: `Bearer ${token}` };
    return this.config.ownerToken
      ? { Authorization: `Bearer ${this.config.ownerToken}` }
      : {};
  }
  async turn(
    threadId: string,
    prompt: string,
    signal: AbortSignal,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    this.requireReady();
    const thread = this.workspace.requireThread(threadId);
    // Local workspaces (INTELLIGENCE_API_KEY=local) run the in-memory
    // runner, not the cloud Intelligence runtime: server-initiated turns
    // (voice compute, call receipts, /btw, schedules) execute the Dot
    // directly and persist into the same conversation.
    if (this.runner) {
      const { runLocalTurn } = await import('./local-turn.js');
      return runLocalTurn({
        runner: this.runner,
        agent: new DotAgent(this.store, this.workspace, this.config, thread.dotId),
        threadId,
        prompt,
        signal,
        metadata,
      });
    }
    return runThreadTurn(
      this.config.runtimeUrl,
      this.internalTurnHeaders(thread.ownerId),
      thread.dotId,
      threadId,
      prompt,
      signal,
      metadata,
    );
  }
  /**
   * A side question (/btw): answered in a throwaway conversation bound to
   * the same Dot, then deleted. The calling conversation's context is never
   * touched — the question and answer exist only in the ephemeral thread,
   * which is removed even when the turn fails.
   */
  async askSideQuestion(
    threadId: string,
    question: string,
    signal: AbortSignal,
    ownerId?: string,
  ): Promise<string> {
    const thread = this.workspace.requireThread(threadId, undefined, ownerId);
    const tempId = `btw-${randomUUID()}`;
    this.workspace.bindThread(
      tempId,
      thread.dotId,
      `BTW: ${question.slice(0, 80)}`,
      ownerId,
    );
    try {
      return await this.turn(tempId, question, signal, {
        opendotsSource: 'btw',
      });
    } finally {
      this.workspace.deleteThread(tempId, ownerId);
    }
  }
}
