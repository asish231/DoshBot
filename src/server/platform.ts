import { ComputerService } from './computer-service.js';
import { PageService } from './page-service.js';
import { randomUUID } from 'node:crypto';
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
          identifyUser: async () => ({
            id: workspace.ownerId,
            name: 'OpenDots owner',
          }),
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
  async createConversation(dotId: string, title: string) {
    this.requireReady();
    if (!this.workspace.dot(dotId)) throw new Error('Dot not found.');
    const id = randomUUID();
    if (this.intelligence) {
      try {
        await this.intelligence.createThread({
          threadId: id,
          userId: this.workspace.ownerId,
          agentId: dotId,
          name: title,
        });
      } catch {
        throw new Error(
          'Intelligence could not create this conversation. Check the runtime key and connection.',
        );
      }
    }
    return this.workspace.bindThread(id, dotId, title);
  }
  async history(threadId: string): Promise<string> {
    this.requireReady();
    this.workspace.requireThread(threadId);
    let messages: { role: string; content?: unknown }[] = [];
    if (this.intelligence) {
      const history = await this.intelligence.getThreadMessages({
        threadId,
        userId: this.workspace.ownerId,
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
  async handle(request: Request): Promise<Response> {
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
      validateRuntimeScope(request, this.workspace, body);
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
          this.workspace.updateThread(threadId, { title: data.name });
        }
        return Response.json({
          id: threadId,
          name: data.name,
          archived: false,
        });
      }
      if (request.method === 'DELETE') {
        this.workspace.deleteThread(threadId);
        return Response.json({ id: threadId, deleted: true });
      }
    }
    return this.handler.fetch(request);
  }
  async turn(
    threadId: string,
    prompt: string,
    signal: AbortSignal,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    this.requireReady();
    const thread = this.workspace.requireThread(threadId);
    return runThreadTurn(
      this.config.runtimeUrl,
      this.config.ownerToken
        ? { Authorization: `Bearer ${this.config.ownerToken}` }
        : {},
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
  ): Promise<string> {
    const thread = this.workspace.requireThread(threadId);
    const tempId = `btw-${randomUUID()}`;
    this.workspace.bindThread(
      tempId,
      thread.dotId,
      `BTW: ${question.slice(0, 80)}`,
    );
    try {
      return await this.turn(tempId, question, signal, {
        opendotsSource: 'btw',
      });
    } finally {
      this.workspace.deleteThread(tempId);
    }
  }
}
