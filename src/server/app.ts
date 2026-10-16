import { computerRoutes } from './computer-routes.js';
import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { MAX_UPLOAD_BYTES, Store } from './store.js';
import { Runner } from './runner.js';
import { configured, type Config } from './research.js';
import type { Platform } from './platform.js';
import { VoiceService } from './voice.js';
import { workspaceRoutes } from './workspace-routes.js';
import { redactSettings, resolveSettingsPatch } from './settings-redaction.js';
import { getTaskForceEngine } from './task-force.js';
import { skillInputSchema } from '../shared/skills.js';
import type { AuthRateLimiter } from './auth-rate-limit.js';
import type { WsTicketStore } from './ws-tickets.js';
import { AuthError, type AuthStore, type AuthUser } from './auth.js';
const interval = z.number().int().min(60).max(31_536_000).nullable();
/** The Hono app with an extra handle for shutdown-time voice-call cleanup. */
export type App = Hono<{
  Variables: { user?: AuthUser };
}> & { voiceService: VoiceService | undefined };
export interface AppOptions {
  store: Store;
  runner: Runner;
  config: Config;
  ownerToken?: string;
  origin?: string;
  platform?: Platform;
  /** Extra connect-src origins allowed by the CSP (e.g. the Intelligence WS origin). */
  connectOrigins?: string[];
  /** Counts and blocks repeated failed-token attempts per client. */
  authLimiter?: AuthRateLimiter;
  /** Issues single-use tickets for the voice WebSocket upgrade. */
  wsTickets?: WsTicketStore;
  /** User accounts and sessions; when present the app is multi-user. */
  auth?: AuthStore;
}
export function createApp({
  store,
  runner,
  config,
  ownerToken,
  origin,
  platform,
  connectOrigins = [],
  authLimiter,
  wsTickets,
  auth,
}: AppOptions): App {
  const app = new Hono() as App;
  // Request-size ceiling: 1MB for JSON, 200MB for the upload route so the
  // owner can send images and other binary data in one request. Per-file
  // size is enforced again by the upload handler itself.
  const UPLOAD_MAX = 200_000_000;
  app.use('/api/*', async (c, next) => {
    const limit =
      c.req.path === '/api/files' || c.req.path.startsWith('/api/files/')
        ? UPLOAD_MAX
        : 1_000_000;
    const contentLength = Number(c.req.header('content-length') ?? 0);
    if (contentLength > limit)
      return c.json({ error: 'Request is too large.' }, 413);
    await next();
  });
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${connectOrigins.join(' ')}; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
    );
    const requestUrl = new URL(c.req.url);
    const allowedHosts = new Set([
      'localhost',
      '127.0.0.1',
      '[::1]',
      ...(origin ? [new URL(origin).hostname] : []),
    ]);
    if (!ownerToken && !allowedHosts.has(requestUrl.hostname))
      return c.json({ error: 'Unrecognized host.' }, 403);
    const requestOrigin = c.req.header('origin');
    const expectedOrigin = origin ?? new URL(c.req.url).origin;
    // Loopback dev convenience: the Vite dev server answers on both
    // localhost and 127.0.0.1, and the browser's Origin header follows
    // whichever name it was opened under — same machine, two names.
    // A configured loopback origin therefore accepts its sibling; remote
    // origins stay strict, and foreign origins are still refused.
    const allowedOrigins = new Set([expectedOrigin]);
    try {
      const expected = new URL(expectedOrigin);
      const isLoopback =
        expected.hostname === 'localhost' || expected.hostname === '127.0.0.1';
      if (isLoopback) {
        allowedOrigins.add(
          `http://${expected.hostname === 'localhost' ? '127.0.0.1' : 'localhost'}:${expected.port}`,
        );
        if (expected.protocol === 'https:') {
          allowedOrigins.add(
            `https://${expected.hostname === 'localhost' ? '127.0.0.1' : 'localhost'}:${expected.port}`,
          );
        }
      }
    } catch {
      /* non-URL origin string — strict comparison only */
    }
    if (requestOrigin && !allowedOrigins.has(requestOrigin))
      return c.json({ error: 'Cross-origin requests are not allowed.' }, 403);
    if (c.req.header('sec-fetch-site') === 'cross-site')
      return c.json({ error: 'Cross-site requests are not allowed.' }, 403);
    // ── Authentication ──────────────────────────────────────────────
    // With an auth store the app is multi-user: a session token in the
    // Authorization header signs the request in as one user, and every
    // user sees only their own data. OWNER_TOKEN stays as break-glass
    // access to the owner account. Without an auth store the legacy
    // single-token gate applies unchanged.
    const bearer =
      c.req.header('authorization')?.replace(/^Bearer /, '') ?? '';
    const client =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      'local';
    if (authLimiter) {
      const waitMs = authLimiter.blockedFor(client);
      if (waitMs > 0)
        return c.json(
          { error: 'Too many failed attempts. Try again shortly.' },
          429,
          { 'Retry-After': String(Math.ceil(waitMs / 1000)) },
        );
    }
    let user: AuthUser | undefined;
    if (auth) {
      user = auth.validate(bearer);
      if (!user && ownerToken && bearer) {
        const expected = Buffer.from(ownerToken);
        const supplied = Buffer.from(bearer);
        if (
          expected.length === supplied.length &&
          timingSafeEqual(expected, supplied)
        )
          user = auth.breakGlassUser();
      }
      if (user) c.set('user', user);
      else {
        // Auth endpoints manage themselves; everything else requires a
        // signed-in session. A deployment without accounts is locked to
        // the setup screen until the owner account exists — nothing in
        // the app is usable before login.
        const isAuthRoute = c.req.path.startsWith('/api/auth/');
        if (!isAuthRoute) {
          // Only wrong-credential attempts feed the brute-force limiter;
          // a request without credentials is simply signed out. The
          // client drops dead tokens on the first 401, so an idle
          // polling client cannot lock itself out.
          if (bearer) authLimiter?.record(client);
          return c.json(
            auth.userCount() === 0
              ? {
                  error: 'Set up the owner account to start.',
                  code: 'SETUP_REQUIRED',
                }
              : { error: 'Sign in to continue.', code: 'AUTH_REQUIRED' },
            401,
          );
        }
      }
    } else if (ownerToken) {
      const expected = Buffer.from(ownerToken);
      const supplied = Buffer.from(bearer);
      if (
        expected.length !== supplied.length ||
        !timingSafeEqual(expected, supplied)
      ) {
        authLimiter?.record(client);
        return c.json(
          { error: 'Enter your owner access token to unlock OpenDots.' },
          401,
        );
      }
    }
    if (
      !['GET', 'HEAD'].includes(c.req.method) &&
      !c.req.header('content-type')?.includes('application/json')
    )
      return c.json({ error: 'Use application/json.' }, 415);
    await next();
  });
  if (platform) app.route('/api', computerRoutes(platform.computers));
  const voice = platform ? new VoiceService(platform) : undefined;
  if (platform && voice) app.route('/api', workspaceRoutes(platform, voice));
  // ── Accounts & sessions ────────────────────────────────────────────
  // A scheduled task is visible to its owner; the owner role sees all.
  const ownedTask = (
    c: {
      get: (key: string) => unknown;
      req: { param: (key: string) => string };
    },
    id: string,
  ): boolean => {
    const task = store.task(id);
    if (!task) return false;
    const actor = c.get('user') as AuthUser | undefined;
    if (!actor) return true; // open bootstrap/legacy mode
    return actor.role === 'owner' || task.ownerId === actor.id;
  };
  app.get('/api/auth/status', (c) =>
    c.json({
      needsSetup: auth ? auth.userCount() === 0 : false,
      authRequired: auth
        ? auth.userCount() > 0 || Boolean(ownerToken)
        : Boolean(ownerToken),
      // On externally-protected deployments the very first signup must
      // prove control of OWNER_TOKEN; loopback dev without it is open.
      setupRequiresToken: Boolean(
        auth && ownerToken && auth.userCount() === 0,
      ),
      user: c.get('user') ?? null,
    }),
  );
  app.post('/api/auth/signup', async (c) => {
    if (!auth)
      return c.json(
        { error: 'Accounts are not enabled on this deployment.' },
        501,
      );
    const parsed = z
      .object({
        email: z.string().trim().min(3).max(200),
        password: z.string().min(8).max(200),
        displayName: z.string().trim().max(60).optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        { error: 'Enter an email and a password of at least 8 characters.' },
        400,
      );
    if (
      auth.userCount() > 0 &&
      store.settings().allowSignups === false
    )
      return c.json({ error: 'New signups are disabled by the owner.' }, 403);
    // Owner-squat protection: the signup that bootstrap-creates the owner
    // account must prove control of this deployment when a break-glass
    // token is configured. The middleware has already validated the token
    // and set the user in that case.
    if (ownerToken && auth.userCount() === 0 && !c.get('user'))
      return c.json(
        {
          error:
            'This deployment requires the server owner token to create the first account. Enter OWNER_TOKEN from your .env.',
        },
        403,
      );
    const client =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      'local';
    const key = `signup|${client}`;
    const waitMs = authLimiter?.blockedFor(key) ?? 0;
    if (waitMs > 0)
      return c.json(
        { error: 'Too many attempts. Try again shortly.' },
        429,
        { 'Retry-After': String(Math.ceil(waitMs / 1000)) },
      );
    try {
      const { user, token } = auth.signup(
        parsed.data.email,
        parsed.data.password,
        parsed.data.displayName,
      );
      c.set('user', user);
      return c.json({ user, token });
    } catch (error) {
      authLimiter?.record(key);
      return c.json(
        {
          error:
            error instanceof AuthError
              ? error.message
              : 'Could not create the account.',
        },
        409,
      );
    }
  });
  app.post('/api/auth/login', async (c) => {
    if (!auth)
      return c.json(
        { error: 'Accounts are not enabled on this deployment.' },
        501,
      );
    const parsed = z
      .object({
        email: z.string().trim().min(3).max(200),
        password: z.string().min(1).max(200),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'Enter your email and password.' }, 400);
    const client =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      'local';
    const key = `login|${client}|${parsed.data.email.toLowerCase()}`;
    const waitMs = authLimiter?.blockedFor(key) ?? 0;
    if (waitMs > 0)
      return c.json(
        { error: 'Too many failed attempts. Try again shortly.' },
        429,
        { 'Retry-After': String(Math.ceil(waitMs / 1000)) },
      );
    try {
      const { user, token } = auth.login(
        parsed.data.email,
        parsed.data.password,
      );
      c.set('user', user);
      return c.json({ user, token });
    } catch (error) {
      authLimiter?.record(key);
      return c.json(
        {
          error:
            error instanceof AuthError
              ? error.message
              : 'Could not sign in.',
        },
        401,
      );
    }
  });
  app.post('/api/auth/logout', (c) => {
    auth?.logout(
      c.req.header('authorization')?.replace(/^Bearer /, '') ?? '',
    );
    return c.json({ ok: true });
  });
  app.get('/api/auth/me', (c) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Sign in to continue.' }, 401);
    return c.json({ user });
  });
  app.get('/api/state', (c) =>
    c.json({
      settings: redactSettings(store.settings()),
      tasks: store.tasks(c.get('user')?.id),
      memories: store.memories(undefined, c.get('user')?.id),
      mode: config.mode,
      configured: configured(config),
    }),
  );
  // Single-use voice WebSocket ticket. The owner token travels in the
  // Authorization header; the URL the WebSocket opens afterwards carries
  // only a short-lived, one-time ticket bound to the signed-in user.
  app.post('/api/voice/ws-ticket', (c) => {
    if (!wsTickets)
      return c.json(
        { error: 'Voice WebSocket tickets are not available.' },
        501,
      );
    return c.json(wsTickets.create(c.get('user')?.id));
  });
  // Local/custom OpenAI-compatible provider: test an endpoint and list its
  // models, or auto-detect the usual local suspects (Ollama :11434,
  // LM Studio :1234, llama.cpp :8080). Owner-only, like Settings itself.
  const providerListModels = async (
    baseUrl: string,
    apiKey: string | undefined,
    timeoutMs: number,
  ): Promise<string[]> => {
    const base = baseUrl.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base))
      throw new Error('Use an http(s) endpoint URL.');
    const headers: Record<string, string> = {};
    if (apiKey?.trim()) headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    const res = await fetch(`${base}/models`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok)
      throw new Error(
        `Endpoint returned HTTP ${res.status}. Check the URL and key.`,
      );
    const body = (await res.json().catch(() => null)) as {
      data?: Array<{ id?: unknown }>;
    } | null;
    const ids =
      body && Array.isArray(body.data)
        ? body.data
            .map((m) => m?.id)
            .filter(
              (id): id is string => typeof id === 'string' && id.trim().length > 0,
            )
            .map((id) => id.trim())
        : [];
    if (ids.length === 0)
      throw new Error('The endpoint answered but listed no models.');
    return Array.from(new Set(ids));
  };
  const requireProviderOwner = (c: {
    get: (key: string) => unknown;
  }): boolean =>
    Boolean(
      auth &&
        auth.userCount() > 0 &&
        (c.get('user') as AuthUser | undefined)?.role !== 'owner',
    );
  app.post('/api/provider/test', async (c) => {
    if (requireProviderOwner(c))
      return c.json(
        { error: 'Only the owner can change these settings.' },
        403,
      );
    const parsed = z
      .object({
        baseUrl: z.string().trim().min(1).max(500),
        apiKey: z.string().max(500).optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'Provide an endpoint URL.' }, 400);
    try {
      const models = await providerListModels(
        parsed.data.baseUrl,
        parsed.data.apiKey,
        8000,
      );
      return c.json({
        baseUrl: parsed.data.baseUrl.trim().replace(/\/+$/, ''),
        models,
        count: models.length,
      });
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Could not reach the endpoint.',
        },
        502,
      );
    }
  });
  app.post('/api/provider/detect', async (c) => {
    if (requireProviderOwner(c))
      return c.json(
        { error: 'Only the owner can change these settings.' },
        403,
      );
    const candidates = [
      'http://127.0.0.1:11434/v1',
      'http://localhost:11434/v1',
      'http://127.0.0.1:1234/v1',
      'http://localhost:1234/v1',
      'http://127.0.0.1:8080/v1',
      'http://localhost:8080/v1',
    ];
    for (const baseUrl of candidates) {
      try {
        const models = await providerListModels(baseUrl, undefined, 2500);
        return c.json({ baseUrl, models, count: models.length });
      } catch {
        /* try the next candidate */
      }
    }
    return c.json(
      {
        error:
          'No local provider answered on the usual ports (Ollama :11434, LM Studio :1234, llama.cpp :8080). Start one and use Test connection.',
      },
      404,
    );
  });
  app.post('/api/tasks', async (c) => {
    const parsed = z
      .object({
        prompt: z.string().trim().min(3).max(4000),
        intervalSeconds: interval.optional(),
        threadId: z.string().optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        {
          error:
            'Enter a request between 3 and 4,000 characters; repeat intervals must be at least 60 seconds.',
        },
        400,
      );
    if (!store.settings().researchAllowed)
      return c.json({ error: 'Research is disabled in Settings.' }, 403);
    if (platform) {
      if (platform.setup().missing.length)
        return c.json(
          { error: `Setup required: ${platform.setup().missing.join(', ')}.` },
          503,
        );
      if (!parsed.data.threadId)
        return c.json(
          { error: 'Select a conversation for this scheduled task.' },
          400,
        );
      try {
        platform.workspace.requireThread(
          parsed.data.threadId,
          undefined,
          c.get('user')?.id,
        );
      } catch {
        return c.json(
          { error: 'Conversation is not owned by this workspace.' },
          403,
        );
      }
    }
    const task = store.createTask(
      parsed.data.prompt,
      parsed.data.intervalSeconds,
      c.get('user')?.id,
    );
    if (platform && parsed.data.threadId)
      platform.workspace.bindTask(task.id, parsed.data.threadId);
    return c.json(task, 201);
  });
  app.get('/api/tasks/:id', (c) => {
    const detail = store.detail(c.req.param('id'));
    return detail && ownedTask(c, detail.task.id)
      ? c.json(detail)
      : c.json({ error: 'Task not found.' }, 404);
  });
  app.post('/api/tasks/:id/actions', async (c) => {
    const parsed = z
      .object({ action: z.enum(['run', 'pause', 'cancel']) })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Unknown task action.' }, 400);
    if (parsed.data.action === 'run' && !store.settings().researchAllowed)
      return c.json({ error: 'Research is disabled in Settings.' }, 403);
    if (!ownedTask(c, c.req.param('id')))
      return c.json({ error: 'Task not found.' }, 404);
    const task = store.action(c.req.param('id'), parsed.data.action);
    if (parsed.data.action !== 'run') runner.abort(c.req.param('id'));
    return task ? c.json(task) : c.json({ error: 'Task not found.' }, 404);
  });
  app.put('/api/tasks/:id/schedule', async (c) => {
    const parsed = z
      .object({ intervalSeconds: interval })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        { error: 'Repeat interval must be 60 seconds to one year, or null.' },
        400,
      );
    if (!ownedTask(c, c.req.param('id')))
      return c.json({ error: 'Task not found.' }, 404);
    const task = store.schedule(c.req.param('id'), parsed.data.intervalSeconds);
    return task ? c.json(task) : c.json({ error: 'Task not found.' }, 404);
  });
  app.delete('/api/tasks/:id', (c) => {
    const id = c.req.param('id');
    if (!ownedTask(c, id)) return c.json({ error: 'Task not found.' }, 404);
    runner.abort(id);
    if (platform) platform.workspace.unbindTask(id);
    const deleted = store.deleteTask(id);
    return deleted
      ? c.json({ ok: true })
      : c.json({ error: 'Task not found.' }, 404);
  });
  app.patch('/api/settings', async (c) => {
    // Server-wide settings (API keys, models, permissions) are the
    // owner's levers; members cannot change them.
    const actor = c.get('user');
    if (auth && auth.userCount() > 0 && actor?.role !== 'owner')
      return c.json({ error: 'Only the owner can change these settings.' }, 403);
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(40).optional(),
        paused: z.boolean().optional(),
        researchAllowed: z.boolean().optional(),
        memoryAllowed: z.boolean().optional(),
        model: z.string().trim().max(120).nullable().optional(),
        reasoningEffort: z.string().trim().max(50).nullable().optional(),
        customBaseUrl: z.string().trim().max(500).nullable().optional(),
        customApiKey: z.string().trim().max(500).nullable().optional(),
        voiceProvider: z.string().trim().max(50).nullable().optional(),
        voiceModel: z.string().trim().max(100).nullable().optional(),
        voiceName: z.string().trim().max(50).nullable().optional(),
        voiceApiKeys: z.string().max(8192).nullable().optional(),
        telegramBotToken: z.string().trim().max(256).nullable().optional(),
        telegramAllowedUsers: z.string().trim().max(512).nullable().optional(),
        connectors: z.string().max(32768).nullable().optional(),
        codingDirectory: z.string().trim().max(1000).nullable().optional(),
        codingEnabled: z.boolean().optional(),
        codingPermissions: z.string().max(4096).nullable().optional(),
        opencodeVariant: z.string().trim().max(50).nullable().optional(),
        taskForceMaxHours: z.number().int().min(1).max(24).nullable().optional(),
        taskForceMaxWorkers: z
          .number()
          .int()
          .min(16)
          .max(100000)
          .nullable()
          .optional(),
        taskForceConcurrency: z.number().int().min(1).max(64).nullable().optional(),
        allowSignups: z.boolean().optional(),
        computerEnvironment: z.string().trim().max(50).nullable().optional(),
        voiceTelephonyProvider: z.string().trim().max(50).nullable().optional(),
        whatsappPhoneNumberId: z.string().trim().max(100).nullable().optional(),
        whatsappAccessToken: z.string().trim().max(256).nullable().optional(),
        whatsappVerifyToken: z.string().trim().max(256).nullable().optional(),
        twilioAccountSid: z.string().trim().max(100).nullable().optional(),
        twilioAuthToken: z.string().trim().max(256).nullable().optional(),
        twilioPhoneNumber: z.string().trim().max(50).nullable().optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid settings.' }, 400);
    const previous = store.settings();
    const settings = store.updateSettings(
      resolveSettingsPatch(parsed.data, previous),
    );
    if (
      settings.paused ||
      !settings.researchAllowed ||
      previous.memoryAllowed !== settings.memoryAllowed
    )
      runner.abortAll();
    if (settings.paused) voice?.abortAll();
    else void voice?.resumePending();
    return c.json(redactSettings(settings));
  });
  app.get('/api/memories', (c) => {
    const category = c.req.query('category');
    return c.json(
      store.memories(category || undefined, c.get('user')?.id),
    );
  });
  app.post('/api/memories', async (c) => {
    const parsed = z
      .object({
        text: z.string().trim().min(1).max(2000),
        category: z.string().trim().max(50).optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        { error: 'Memory must be between 1 and 2,000 characters.' },
        400,
      );
    return c.json(
      store.saveMemory(
        parsed.data.text,
        undefined,
        parsed.data.category,
        c.get('user')?.id,
      ),
      201,
    );
  });
  app.put('/api/memories/:id', async (c) => {
    const parsed = z
      .object({
        text: z.string().trim().min(1).max(2000),
        category: z.string().trim().max(50).optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        { error: 'Memory must be between 1 and 2,000 characters.' },
        400,
      );
    const actorId = c.get('user')?.id;
    if (
      !store
        .memories(undefined, actorId)
        .some((m) => m.id === c.req.param('id'))
    )
      return c.json({ error: 'Memory not found.' }, 404);
    return c.json(
      store.saveMemory(
        parsed.data.text,
        c.req.param('id'),
        parsed.data.category,
        actorId,
      ),
    );
  });
  app.delete('/api/memories/:id', (c) => {
    const actorId = c.get('user')?.id;
    if (
      !store
        .memories(undefined, actorId)
        .some((m) => m.id === c.req.param('id'))
    )
      return c.json({ error: 'Memory not found.' }, 404);
    return store.deleteMemory(c.req.param('id'))
      ? c.json({ ok: true })
      : c.json({ error: 'Memory not found.' }, 404);
  });
  app.get('/api/memories/graph', (c) =>
    c.json(store.memoryGraph(c.get('user')?.id)),
  );
  app.post('/api/files', async (c) => {
    const form = await c.req.parseBody({ all: true }).catch(() => null);
    const files = Object.values(form ?? {}).filter(
      (entry): entry is File => entry instanceof File,
    );
    if (files.length === 0)
      return c.json({ error: 'No files were sent.' }, 400);
    if (files.length > 32)
      return c.json({ error: 'At most 32 files per upload.' }, 400);
    const threadId = Object.values(form ?? {}).find(
      (entry) => typeof entry === 'string',
    ) as string | undefined;
    if (threadId)
      try {
        platform?.workspace.requireThread(
          threadId,
          undefined,
          c.get('user')?.id,
        );
      } catch {
        return c.json(
          { error: 'Conversation is not owned by this workspace.' },
          403,
        );
      }
    const saved = [];
    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) {
        return c.json(
          {
            error: `"${file.name}" is ${Math.round(file.size / 1024 / 1024)}MB; the limit is 50MB per file.`,
          },
          413,
        );
      }
      saved.push(
        await store.saveUpload(
          file.name || 'upload',
          file.type || 'application/octet-stream',
          Buffer.from(await file.arrayBuffer()),
          threadId ?? null,
        ),
      );
    }
    return c.json({ uploads: saved }, 201);
  });
  app.get('/api/files', (c) => c.json(store.uploads()));
  app.get('/api/files/:id', (c) => {
    const upload = store.upload(c.req.param('id'));
    return upload ? c.json(upload) : c.json({ error: 'File not found.' }, 404);
  });
  app.get('/api/files/:id/data', async (c) => {
    const upload = store.upload(c.req.param('id'));
    if (!upload) return c.json({ error: 'File not found.' }, 404);
    const bytes = await readFile(store.uploadPath(upload.id));
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': upload.mime || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${upload.name.replace(/"/g, '')}"`,
        'Cache-Control': 'no-store',
      },
    });
  });
  app.delete('/api/files/:id', (c) =>
    store.deleteUpload(c.req.param('id'))
      ? c.json({ ok: true })
      : c.json({ error: 'File not found.' }, 404),
  );
  app.get('/api/monitors', (c) => c.json(store.monitors()));
  // ── Long-horizon task force: session introspection & control ─────────
  app.get('/api/task-force', (c) => {
    const engine = getTaskForceEngine();
    if (!engine)
      return c.json(
        { error: 'The task force engine is not running on this server.' },
        503,
      );
    return c.json(engine.listSessions());
  });
  app.get('/api/task-force/:id', (c) => {
    const engine = getTaskForceEngine();
    if (!engine)
      return c.json(
        { error: 'The task force engine is not running on this server.' },
        503,
      );
    try {
      const detail = engine.status(c.req.param('id'));
      const threadId = engine.sessionThreadId(c.req.param('id'));
      if (threadId)
        platform?.workspace.requireThread(
          threadId,
          undefined,
          c.get('user')?.id,
        );
      return c.json(detail);
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Task force session not found.',
        },
        404,
      );
    }
  });
  app.post('/api/task-force/:id/:action', async (c) => {
    const engine = getTaskForceEngine();
    if (!engine)
      return c.json(
        { error: 'The task force engine is not running on this server.' },
        503,
      );
    const action = c.req.param('action');
    if (!['pause', 'resume', 'cancel'].includes(action))
      return c.json({ error: 'Unknown task force action.' }, 400);
    try {
      const threadId = engine.sessionThreadId(c.req.param('id'));
      if (threadId)
        platform?.workspace.requireThread(
          threadId,
          undefined,
          c.get('user')?.id,
        );
      const session =
        action === 'pause'
          ? engine.pause(c.req.param('id'))
          : action === 'resume'
            ? engine.resume(c.req.param('id'))
            : engine.cancel(c.req.param('id'));
      if (!session) return c.json({ error: 'Session not found.' }, 404);
      return c.json(session);
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Could not update the session.',
        },
        404,
      );
    }
  });
  app.delete('/api/monitors/:id', (c) =>
    store.deleteMonitor(c.req.param('id'))
      ? c.json({ ok: true })
      : c.json({ error: 'Monitor not found.' }, 404),
  );
  app.get('/api/artifacts', (c) =>
    c.json(store.artifacts(c.req.query('threadId') || undefined)),
  );
  app.post('/api/artifacts', async (c) => {
    const parsed = z
      .object({
        title: z.string().trim().min(1).max(200),
        kind: z.enum(['markdown', 'code', 'text']),
        language: z.string().trim().max(60).nullable().optional(),
        content: z.string().min(1).max(200_000),
        threadId: z.string().trim().max(100).nullable().optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        { error: 'An artifact needs a title, kind, and content.' },
        400,
      );
    return c.json(
      store.saveArtifact(
        parsed.data.title,
        parsed.data.kind,
        parsed.data.content,
        parsed.data.language ?? null,
        parsed.data.threadId ?? null,
      ),
      201,
    );
  });
  app.delete('/api/artifacts/:id', (c) =>
    store.deleteArtifact(c.req.param('id'))
      ? c.json({ ok: true })
      : c.json({ error: 'Artifact not found.' }, 404),
  );  app.post('/api/memories/:id/links', async (c) => {
    const parsed = z
      .object({
        toId: z.string().trim().min(1).max(100),
        relation: z.string().trim().min(1).max(80).optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'Link needs a toId and optional relation.' }, 400);
    try {
      return c.json(
        {
          fromId: c.req.param('id'),
          links: store.linkMemories(
            c.req.param('id'),
            parsed.data.toId,
            parsed.data.relation,
          ),
        },
        201,
      );
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error ? error.message : 'Could not link memories.',
        },
        404,
      );
    }
  });
  app.delete('/api/memories/:id/links/:toId', (c) =>
    store.unlinkMemories(c.req.param('id'), c.req.param('toId'))
      ? c.json({ ok: true })
      : c.json({ error: 'Link not found.' }, 404),
  );
  app.get('/api/skills', (c) => {
    if (!store.skills) return c.json({ error: 'Skills storage is not configured.' }, 503);
    return c.json(store.skills.list());
  });
  app.get('/api/skills/:name', (c) => {
    if (!store.skills) return c.json({ error: 'Skills storage is not configured.' }, 503);
    const skill = store.skills.get(c.req.param('name'));
    return skill ? c.json(skill) : c.json({ error: 'Skill not found.' }, 404);
  });
  app.post('/api/skills', async (c) => {
    if (!store.skills) return c.json({ error: 'Skills storage is not configured.' }, 503);
    const parsed = skillInputSchema
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        { error: 'Skill needs a lowercase-hyphen name (1-60), description (1-400), and instructions (1-100000).' },
        400,
      );
    try {
      return c.json(store.skills.create(parsed.data), 201);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Could not create skill.' },
        409,
      );
    }
  });
  app.put('/api/skills/:name', async (c) => {
    if (!store.skills) return c.json({ error: 'Skills storage is not configured.' }, 503);
    const parsed = z
      .object({
        name: skillInputSchema.shape.name.optional(),
        description: skillInputSchema.shape.description.optional(),
        instructions: skillInputSchema.shape.instructions.optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || Object.keys(parsed.data).length === 0)
      return c.json({ error: 'Provide a name, description, or instructions to update.' }, 400);
    try {
      return c.json(store.skills.update(c.req.param('name'), parsed.data));
    } catch (error) {
      const status = error instanceof Error && /not found/i.test(error.message) ? 404 : 409;
      return c.json(
        { error: error instanceof Error ? error.message : 'Could not update skill.' },
        status,
      );
    }
  });
  app.delete('/api/skills/:name', (c) => {
    if (!store.skills) return c.json({ error: 'Skills storage is not configured.' }, 503);
    return store.skills.delete(c.req.param('name'))
      ? c.json({ ok: true })
      : c.json({ error: 'Skill not found.' }, 404);
  });
  app.onError((error, c) => {
    console.error('API request failed:', error.name);
    return c.json(
      {
        error:
          'The server could not complete this request. Check server logs and database access.',
      },
      500,
    );
  });
  app.voiceService = voice;
  return app;
}
