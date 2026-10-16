process.env.COPILOTKIT_TELEMETRY_DISABLED = 'true';
process.env.DO_NOT_TRACK = '1';

import { Agent as UndiciAgent, setGlobalDispatcher } from 'undici';

// Long reasoning / research turns can idle the model stream for minutes
// between body chunks.  Undici's default 300 s body timeout would sever
// those mid-stream — zero disables it; explicit AbortSignal timeouts
// from the runner, DotAgent, and tools still apply independently.
setGlobalDispatcher(
  new UndiciAgent({ bodyTimeout: 0, headersTimeout: 600_000 }),
);

import { webSearchProvider } from './parallel.js';
import { createShutdown } from './shutdown.js';
import { reportChannelFailure, safeFailure } from './slack-channel.js';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Store } from './store.js';
import { Runner } from './runner.js';
import { MonitorService } from './monitors.js';
import { createApp, type App } from './app.js';
import { WorkspaceStore } from './workspace.js';
import { Platform } from './platform.js';
import { TelegramChannel } from './telegram-channel.js';
import { attachGeminiLiveHandler } from './gemini-live.js';
import { AuthRateLimiter } from './auth-rate-limit.js';
import { WsTicketStore } from './ws-tickets.js';
import { AuthStore } from './auth.js';
import type { PlatformConfig } from './platform-config.js';
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 4310);
const ownerToken = process.env.OWNER_TOKEN;
if (
  !['127.0.0.1', '::1', 'localhost'].includes(host) &&
  (!ownerToken || ownerToken.length < 24)
)
  throw new Error(
    'External binding requires an OWNER_TOKEN of at least 24 characters.',
  );
const database = process.env.DATABASE_PATH ?? 'data/opendots.sqlite';
// Stable identity that owns pre-existing data; the first signed-up account
// adopts it so old conversations and memories carry over.
const ownerId = process.env.OWNER_ID ?? 'opendots-owner';
const store = new Store(database, {
  skillsDir: process.env.SKILLS_DIR ?? 'data/skills',
  uploadsDir: process.env.UPLOADS_DIR ?? 'data/uploads',
  ownerId,
});
const workspace = new WorkspaceStore(database, ownerId);
const auth = new AuthStore(database, ownerId);
const config: PlatformConfig = {
  intelligenceKey: process.env.INTELLIGENCE_API_KEY,
  intelligenceApiUrl: process.env.INTELLIGENCE_API_URL || undefined,
  intelligenceWsUrl: process.env.INTELLIGENCE_WS_URL || undefined,
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL,
  baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  webSearchProvider: webSearchProvider(process.env.WEB_SEARCH_PROVIDER),
  parallelApiKey: process.env.PARALLEL_API_KEY,
  browserUrl: process.env.BROWSER_URL,
  browserSecret: process.env.BROWSER_SECRET,
  computerSupervisorUrl: process.env.COMPUTER_SUPERVISOR_URL,
  computerSupervisorToken: process.env.COMPUTER_SUPERVISOR_TOKEN,
  computerToken: process.env.COMPUTER_TOKEN,
  computerNamespace: process.env.COMPUTER_NAMESPACE,
  voiceKey: process.env.VOICE_API_KEY,
  voiceModel: process.env.VOICE_MODEL,
  voiceProvider: process.env.VOICE_PROVIDER || undefined,
  voiceName: process.env.VOICE_NAME ?? 'marin',
  slackChannel: process.env.SLACK_CHANNEL_NAME,
  slackTeam: process.env.SLACK_TEAM_ID,
  slackUsers: (process.env.SLACK_USER_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  slackDotId: process.env.SLACK_DOT_ID || undefined,
  runtimeUrl: `http://${host === '::1' ? '[::1]' : '127.0.0.1'}:${port}/api/copilotkit`,
  ownerToken,
};
const platform = new Platform(store, workspace, { ...config, auth });
const researchConfig = {
  mode: 'live' as const,
  apiKey: config.apiKey,
  model: config.model,
  baseUrl: config.baseUrl,
  webSearchProvider: config.webSearchProvider,
  parallelApiKey: config.parallelApiKey,
  browserUrl: config.browserUrl,
  browserSecret: config.browserSecret,
};
const runner = new Runner(
  store,
  researchConfig,
  async (claim, _memories, signal, progress) => {
    const threadId = workspace.taskThread(claim.id);
    if (!threadId)
      throw new Error(
        'This legacy task has no Intelligence conversation. Create a new scheduled task from a conversation.',
      );
    progress('Running this task in its Intelligence conversation.');
    const text = await platform.turn(threadId, claim.prompt, signal);
    return { text, sources: [], sample: false };
  },
);
const monitors = new MonitorService(store, workspace);
const wsOrigin = new URL(
  config.intelligenceWsUrl ?? 'wss://realtime.intelligence.copilotkit.ai',
).origin;
const origin =
  process.env.APP_ORIGIN ??
  (process.env.NODE_ENV === 'development'
    ? 'http://127.0.0.1:5173'
    : undefined);
const authLimiter = new AuthRateLimiter();
const wsTickets = new WsTicketStore();
const app: App = createApp({
  store,
  runner,
  config: researchConfig,
  ownerToken,
  origin,
  platform,
  connectOrigins: [wsOrigin],
  authLimiter,
  wsTickets,
  auth,
});
app.get('/api/*', (c) => c.json({ error: 'Not found.' }, 404));
app.use('/*', serveStatic({ root: './dist/client' }));
app.get('*', serveStatic({ path: './dist/client/index.html' }));
const telegram = new TelegramChannel(platform, {
  getToken: () =>
    store.settings().telegramBotToken || process.env.TELEGRAM_BOT_TOKEN,
  getAllowedUsers: () =>
    store.settings().telegramAllowedUsers || process.env.TELEGRAM_ALLOWED_USERS,
  isPaused: () => store.settings().paused,
});
const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`OpenDots template listening on http://${host}:${info.port}`);
  runner.start();
  monitors.start();
  telegram.start();
  void platform
    .start()
    .catch((error) =>
      reportChannelFailure(
        'Slack Channels activation failed; check setup status',
        [safeFailure(error)],
      ),
    );
});
attachGeminiLiveHandler(server, platform, {
  ownerToken,
  origin,
  wsTickets,
  auth,
});
const shutdown = createShutdown({
  stopRunner: () => {
    runner.stop();
    monitors.stop();
    telegram.stop();
  },
  stopPlatform: () => platform.stop(),
  stopVoice: () => {
    app.voiceService?.abortAll();
  },
  closeServer: () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
  exit: (code) => process.exit(code),
  report: (operation, error) =>
    reportChannelFailure(operation, [safeFailure(error)]),
});
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
