import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { workspaceRoutes } from '../src/server/workspace-routes.js';
import { VoiceService } from '../src/server/voice.js';

describe('Voice Transcribe Endpoint', () => {
  it('validates input and returns 400 if audio is missing', async () => {
    const mockPlatform: any = {
      config: { baseUrl: 'http://localhost', apiKey: 'test', voiceKey: 'test' },
      workspace: { spaces: () => [], dots: () => [], conversations: () => [], calls: () => [] },
      store: { settings: () => ({}) },
      setup: () => ({ missing: [] }),
    };
    const mockVoice: any = {};
    const app = workspaceRoutes(mockPlatform, mockVoice);

    const res = await app.request('/voice/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBeDefined();
  });
});
