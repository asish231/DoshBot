import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { getOpenCodeStatus, runOpenCode } from './opencode.js';
import { pageRoutes } from './page-routes.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { Platform } from './platform.js';
import { VoiceService } from './voice.js';
import {
  learningContainerIdSchema,
  validateLearningSettings,
} from '../shared/learning.js';
const dotSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    instructions: z.string().trim().min(3).max(2000),
    researchAllowed: z.boolean(),
    memoryAllowed: z.boolean(),
    learningContainerId: learningContainerIdSchema.optional(),
    skillDeliveryEnabled: z.boolean().optional(),
    spaceIds: z.array(z.string().min(1)).min(1).max(100).optional(),
    spaceId: z.string().min(1).optional(),
    model: z.string().trim().max(120).nullable().optional(),
    reasoningEffort: z.string().trim().max(50).nullable().optional(),
  })
  .strict();
export function workspaceRoutes(platform: Platform, voice: VoiceService) {
  const app = new Hono();
  app.route('/', pageRoutes(platform));
  app.get('/workspace', (c) =>
    c.json({
      spaces: platform.workspace.spaces(),
      dots: platform.workspace.dots(),
      conversations: platform.workspace.conversations(),
      setup: platform.setup(),
      calls: platform.workspace.calls(),
    }),
  );
  let cachedModels: string[] = [];
  let lastFetchTime = 0;

  app.get('/models', async (c) => {
    const now = Date.now();
    if (cachedModels.length === 0 || now - lastFetchTime > 60_000) {
      try {
        const url = `${platform.config.baseUrl.replace(/\/+$/, '')}/models`;
        const headers: Record<string, string> = {};
        if (platform.config.apiKey) {
          headers['Authorization'] = `Bearer ${platform.config.apiKey}`;
        }
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(4000) });
        if (res.ok) {
          const body = (await res.json()) as { data?: Array<{ id?: string }> };
          if (Array.isArray(body.data)) {
            const fetched = body.data
              .map((m) => m.id)
              .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
            if (fetched.length > 0) {
              cachedModels = Array.from(new Set(fetched));
              lastFetchTime = now;
            }
          }
        }
      } catch {
        // Fall back gracefully if endpoint is unreachable
      }
    }

    const fallbackList = [
      'auto-code',
      'auto-complex',
      'auto',
      'auto-fast',
      'auto-flash',
      'auto-vision',
      'deepseek-chat',
      'deepseek-reasoner',
      'deepseek-v4-pro',
      'deepseek-v4.1-flash',
      'deepseek-v4-flash',
      'deepseek-v3.2',
      'kimi-k2.6',
      'kimi-k2.7-code',
      'kimi-k3',
      'qwen3.8-max',
      'qwen3.8-flash',
      'qwen3.8-27b',
      'qwen3.7-max',
      'qwen3-coder-plus',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'claude-3-7-sonnet',
      'claude-3-5-sonnet',
      'gpt-4o',
      'gpt-4o-mini',
      'o3-mini',
      'o1',
      'llama-3.3-70b-versatile',
      'glm-5.3',
      'minimax-m3',
      'scholar-s2',
      'atria-dawn',
      'agents-a1',
    ];

    let opencode = null;
    let opencodeFreeModelIds: string[] = [];
    try {
      opencode = await getOpenCodeStatus();
      if (opencode.available) {
        opencodeFreeModelIds = opencode.freeModels.map((m) => m.id);
      }
    } catch {}

    const models = Array.from(new Set([...cachedModels, ...opencodeFreeModelIds, ...fallbackList]));

    return c.json({
      defaultModel: platform.config.model,
      models,
      reasoningEfforts: ['default', 'none', 'low', 'medium', 'high', 'xhigh', 'max'],
      opencode,
    });
  });

  app.get('/opencode/status', async (c) => {
    return c.json(await getOpenCodeStatus(true));
  });

  app.post('/opencode/run', async (c) => {
    const data = z
      .object({
        message: z.string().min(1).max(50000),
        model: z.string().optional(),
        variant: z.string().optional(),
        workdir: z.string().optional(),
        timeoutMs: z.number().optional(),
      })
      .safeParse(await c.req.json());
    if (!data.success) {
      return c.json({ error: 'Invalid OpenCode run request.' }, 400);
    }
    const result = await runOpenCode(data.data);
    return c.json(result);
  });

  app.get('/workspace/directory', (c) => {
    const settings = platform.store.settings();
    const dir = settings.codingDirectory || process.cwd();
    const exists = existsSync(dir);
    const isGit = exists && existsSync(join(dir, '.git'));
    let permissions = { bash: 'auto', edits: 'auto' };
    try {
      if (settings.codingPermissions) {
        permissions = JSON.parse(settings.codingPermissions);
      }
    } catch {}
    return c.json({
      directory: dir,
      exists,
      isGit,
      permissions,
      codingEnabled: settings.codingEnabled !== false,
    });
  });

  app.post('/workspace/directory', async (c) => {
    const data = z
      .object({
        directory: z.string().min(1).max(1000),
        permissions: z
          .object({
            bash: z.enum(['auto', 'ask', 'deny']).optional(),
            edits: z.enum(['auto', 'ask', 'deny']).optional(),
          })
          .optional(),
      })
      .safeParse(await c.req.json());
    if (!data.success) {
      return c.json({ error: 'Valid directory path is required.' }, 400);
    }
    if (!existsSync(data.data.directory)) {
      return c.json({ error: `Directory does not exist on disk: ${data.data.directory}` }, 404);
    }
    const patch: any = { codingDirectory: data.data.directory };
    if (data.data.permissions) {
      patch.codingPermissions = JSON.stringify(data.data.permissions);
    }
    const updated = platform.store.updateSettings(patch);
    let perms = { bash: 'auto', edits: 'auto' };
    try {
      if (updated.codingPermissions) perms = JSON.parse(updated.codingPermissions);
    } catch {}
    return c.json({
      directory: updated.codingDirectory,
      permissions: perms,
    });
  });

  app.get('/workspace/browse', (c) => {
    const requested = c.req.query('path')?.trim() || homedir();
    let dir: string;
    try {
      dir = resolve(requested);
    } catch {
      return c.json({ error: 'Invalid path.' }, 400);
    }
    if (!existsSync(dir)) {
      return c.json({ error: `Directory does not exist: ${dir}` }, 404);
    }
    let entries: Array<{ name: string; path: string }> = [];
    try {
      const names = readdirSync(dir);
      for (const name of names) {
        if (entries.length >= 200) break;
        if (name.startsWith('.')) continue;
        const full = join(dir, name);
        try {
          if (statSync(full).isDirectory()) entries.push({ name, path: full });
        } catch {}
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return c.json({ error: `Cannot read directory: ${dir}` }, 403);
    }
    return c.json({ path: dir, parent: dirname(dir), home: homedir(), entries });
  });

  app.get('/conversations/:threadId/session-memories', (c) => {
    const threadId = c.req.param('threadId');
    return c.json(platform.workspace.sessionMemories(threadId));
  });

  app.post('/conversations/:threadId/session-memories', async (c) => {
    const threadId = c.req.param('threadId');
    const data = z
      .object({
        text: z.string().trim().min(1).max(2000),
        category: z.string().max(50).optional(),
      })
      .safeParse(await c.req.json());
    if (!data.success) {
      return c.json({ error: 'Memory text is required (1-2000 chars).' }, 400);
    }
    const saved = platform.workspace.saveSessionMemory(
      threadId,
      data.data.text,
      undefined,
      data.data.category || 'note',
    );
    return c.json(saved, 201);
  });

  app.delete('/conversations/:threadId/session-memories/:id', (c) => {
    const id = c.req.param('id');
    const deleted = platform.workspace.deleteSessionMemory(id);
    return c.json({ deleted });
  });

  app.delete('/conversations/:threadId/session-memories', (c) => {
    const threadId = c.req.param('threadId');
    const count = platform.workspace.clearSessionMemories(threadId);
    return c.json({ cleared: count });
  });

  app.get('/dots/all', (c) => {
    return c.json(platform.workspace.dots());
  });
  app.post('/spaces', async (c) => {
    const data = z
      .object({
        name: z.string().trim().min(1).max(60),
        description: z.string().max(500).default(''),
      })
      .strict()
      .safeParse(await c.req.json());
    if (!data.success)
      return c.json(
        { error: 'Enter a Space name (up to 60 characters).' },
        400,
      );
    return c.json(
      platform.workspace.createSpace(data.data.name, data.data.description),
      201,
    );
  });
  app.post('/dots', async (c) => {
    const data = dotSchema
      .extend({ spaceId: z.string() })
      .safeParse(await c.req.json());
    if (!data.success)
      return c.json(
        {
          error:
            'Provide a name, role instructions, and explicit tool permissions.',
        },
        400,
      );
    try {
      validateLearningSettings(
        data.data.learningContainerId ?? null,
        data.data.skillDeliveryEnabled ?? false,
      );
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Invalid Learning settings.',
        },
        400,
      );
    }
    return c.json(
      platform.workspace.createDot(
        data.data.spaceId,
        data.data.name,
        data.data.instructions,
        data.data.researchAllowed,
        data.data.memoryAllowed,
        data.data.spaceIds,
        data.data.learningContainerId,
        data.data.skillDeliveryEnabled,
        data.data.model ?? null,
        data.data.reasoningEffort ?? null,
      ),
      201,
    );
  });
  app.put('/dots/:id', async (c) => {
    const data = dotSchema.safeParse(await c.req.json());
    if (!data.success)
      return c.json({ error: 'Invalid specialist settings.' }, 400);
    const current = platform.workspace.dot(c.req.param('id'));
    if (!current) return c.json({ error: 'Dot not found.' }, 404);
    try {
      validateLearningSettings(
        data.data.learningContainerId === undefined
          ? (current.learningContainerId ?? null)
          : data.data.learningContainerId,
        data.data.skillDeliveryEnabled ?? current.skillDeliveryEnabled ?? false,
      );
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Invalid Learning settings.',
        },
        400,
      );
    }
    return c.json(platform.workspace.updateDot(c.req.param('id'), data.data));
  });
  app.post('/conversations', async (c) => {
    const data = z
      .object({
        dotId: z.string(),
        title: z.string().trim().min(1).max(120).default('A new thought'),
      })
      .strict()
      .safeParse(await c.req.json());
    if (!data.success)
      return c.json({ error: 'Select a Dot and a conversation title.' }, 400);
    if (platform.setup().missing.length)
      return c.json(
        { error: `Setup required: ${platform.setup().missing.join(', ')}.` },
        503,
      );
    return c.json(
      await platform.createConversation(data.data.dotId, data.data.title),
      201,
    );
  });
  app.delete('/conversations/:id', (c) => {
    const id = c.req.param('id');
    try {
      platform.workspace.deleteThread(id);
      return c.json({ success: true, id });
    } catch (e: any) {
      return c.json(
        { error: e?.message || 'Could not delete conversation.' },
        500,
      );
    }
  });
  app.patch('/conversations/:id', async (c) => {
    const id = c.req.param('id');
    const data = z
      .object({ title: z.string().trim().min(1).max(120) })
      .safeParse(await c.req.json());
    if (!data.success)
      return c.json({ error: 'A conversation title (1-120 chars) is required.' }, 400);
    try {
      platform.workspace.updateThread(id, { title: data.data.title });
      return c.json({ success: true, id, title: data.data.title });
    } catch (e: any) {
      return c.json(
        { error: e?.message || 'Could not rename conversation.' },
        500,
      );
    }
  });
  app.delete('/conversations', (c) => {
    const dotId = c.req.query('dotId');
    const threads = platform.workspace.conversations();
    const toDelete = dotId ? threads.filter((t) => t.dotId === dotId) : threads;
    for (const thread of toDelete) {
      platform.workspace.deleteThread(thread.id);
    }
    return c.json({ success: true, count: toDelete.length });
  });
  app.post('/conversations/:id/compact', (c) => {
    const id = c.req.param('id');
    try {
      const result = platform.workspace.compactThreadMessages(id);
      return c.json({ success: true, ...result });
    } catch (e: any) {
      return c.json({ error: e?.message || 'Could not compact conversation context.' }, 500);
    }
  });
  app.post('/conversations/:id/clear', (c) => {
    const id = c.req.param('id');
    try {
      platform.workspace.clearThreadMessages(id);
      return c.json({ success: true, id });
    } catch (e: any) {
      return c.json({ error: e?.message || 'Could not clear messages.' }, 500);
    }
  });
  app.get('/conversations/:id/capture', (c) =>
    c.json(platform.workspace.capture(c.req.param('id'))),
  );
  app.get('/conversations/:id/memories', (c) => {
    const threadId = c.req.param('id');
    const category = c.req.query('category');
    return c.json(
      platform.workspace.sessionMemories(threadId, category || undefined),
    );
  });
  app.post('/conversations/:id/memories', async (c) => {
    const threadId = c.req.param('id');
    const data = z
      .object({
        id: z.string().optional(),
        text: z.string().min(1).max(2000),
        category: z.string().min(1).max(50).optional(),
      })
      .strict()
      .safeParse(await c.req.json());
    if (!data.success) {
      return c.json({ error: 'Text is required for session memory.' }, 400);
    }
    const mem = platform.workspace.saveSessionMemory(
      threadId,
      data.data.text,
      data.data.id,
      data.data.category || 'note',
    );
    return c.json(mem, 201);
  });
  app.delete('/conversations/:id/memories/:memId', (c) => {
    const memId = c.req.param('memId');
    const deleted = platform.workspace.deleteSessionMemory(memId);
    return c.json({ success: deleted });
  });
  app.delete('/conversations/:id/memories', (c) => {
    const threadId = c.req.param('id');
    const count = platform.workspace.clearSessionMemories(threadId);
    return c.json({ success: true, count });
  });
  app.post('/voice/calls', async (c) => {
    const data = z
      .object({ threadId: z.string(), sdp: z.string().max(100000) })
      .strict()
      .safeParse(await c.req.json());
    if (!data.success)
      return c.json(
        { error: 'A conversation and audio SDP offer are required.' },
        400,
      );
    return c.json(
      await voice.begin(data.data.threadId, data.data.sdp, c.req.raw.signal),
      201,
    );
  });
  app.post('/voice/transcribe', async (c) => {
    const data = z
      .object({
        audio: z.string().min(1),
        mimeType: z.string().default('audio/webm'),
        model: z.string().default('gemini-2.5-flash'),
      })
      .strict()
      .safeParse(await c.req.json());
    if (!data.success) {
      return c.json({ error: 'Audio data is required for transcription.' }, 400);
    }
    const { audio, mimeType, model } = data.data;

    // Check if TokenMaxxing was requested
    if (model === 'tokenmaxxing-auto') {
      const tmKey = platform.config.apiKey;
      const tmUrl = `${platform.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      try {
        const tmRes = await fetch(tmUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tmKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'qwen3.8-omni-flash',
            messages: [
              {
                role: 'user',
                content:
                  'Transcribe the audio speech accurately. Return ONLY the transcribed text.',
              },
            ],
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (tmRes.ok) {
          const tmJson = (await tmRes.json()) as any;
          const text = tmJson.choices?.[0]?.message?.content?.trim();
          if (text && !text.toLowerCase().includes('image you uploaded')) {
            return c.json({ text });
          }
        }
      } catch {
        // Fall back to Gemini
      }
    }

    const settings = platform.store.settings();
    let geminiKey = platform.config.voiceKey;
    try {
      const keys = JSON.parse(settings.voiceApiKeys || '[]');
      const match = keys.find(
        (k: any) => k.provider === 'gemini' || k.provider === 'any',
      );
      if (match?.key) geminiKey = match.key;
    } catch {}

    if (!geminiKey) {
      return c.json(
        { error: 'Gemini API key is required. Add one in Settings or .env.' },
        400,
      );
    }

    const geminiModel =
      model === 'gemini-3.5-transcribe'
        ? 'gemini-3.5-transcribe'
        : model === 'gemini-2.5-flash-lite'
          ? 'gemini-2.5-flash-lite'
          : 'gemini-2.5-flash';

    const cleanMime = mimeType.split(';')[0] || 'audio/webm';
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;

    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: cleanMime,
                  data: audio,
                },
              },
              {
                text: 'Transcribe this user speech audio verbatim into plain text. Output ONLY the transcribed speech, nothing else. Do not format with markdown quotes or add conversational filler. If the audio is silent or unintelligible, output nothing.',
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return c.json(
        {
          error: `Transcription provider returned ${geminiRes.status}: ${errText}`,
        },
        500,
      );
    }

    const body = (await geminiRes.json()) as any;
    let transcribedText =
      body.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    if (
      transcribedText.toLowerCase().startsWith('transcribing audio') ||
      transcribedText.toLowerCase().includes('the audio is silent')
    ) {
      transcribedText = '';
    }

    return c.json({ text: transcribedText });
  });
  app.get('/voice/calls/:id', (c) =>
    c.json(platform.workspace.call(c.req.param('id'))),
  );
  app.post('/voice/calls/:id/active', (c) =>
    c.json(voice.activate(c.req.param('id'))),
  );
  app.post('/voice/calls/:id/compute', async (c) => {
    const data = z
      .object({
        toolCallId: z.string().min(1).max(200),
        request: z.string().trim().min(1).max(4000),
        transcript: z.string().max(12000).default(''),
      })
      .strict()
      .safeParse(await c.req.json());
    if (!data.success)
      return c.json(
        { error: 'A bounded compute request and tool call ID are required.' },
        400,
      );
    return c.json({
      text: await voice.compute(
        c.req.param('id'),
        data.data.toolCallId,
        `${data.data.request}\n\nUntrusted current-call transcript for context:\n${data.data.transcript}`,
      ),
    });
  });
  app.post('/voice/calls/:id/end', async (c) => {
    const data = z
      .object({
        transcript: z.string().max(20000),
        anchorMessageId: z.string().max(200).optional(),
      })
      .strict()
      .safeParse(await c.req.json());
    if (!data.success)
      return c.json(
        { error: 'Transcript exceeds the 20,000 character limit.' },
        400,
      );
    platform.workspace.anchorCall(c.req.param('id'), data.data.anchorMessageId);
    return c.json(await voice.end(c.req.param('id'), data.data.transcript));
  });
  app.all('/copilotkit/*', (c) => platform.handle(c.req.raw));
  app.onError((error, c) => {
    const text = error.message;
    const known =
      /^(Setup|Voice setup|Dot |Space |Specialist |Conversation |Call |This call|End the current|Voice provider|An audio|Intelligence could not)/.test(
        text,
      );
    return c.json(
      {
        error: known
          ? text
          : 'The service request failed. Check the server configuration and try again.',
      },
      503,
    );
  });
  return app;
}
