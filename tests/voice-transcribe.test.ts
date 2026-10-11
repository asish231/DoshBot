import { describe, expect, it } from 'vitest';
import { workspaceRoutes } from '../src/server/workspace-routes.js';
import type { Platform } from '../src/server/platform.js';
import type { VoiceService } from '../src/server/voice.js';

describe('Voice Transcribe Endpoint', () => {
  it('validates input and returns 400 if audio is missing', async () => {
    const mockPlatform = {
      config: { baseUrl: 'http://localhost', apiKey: 'test', voiceKey: 'test' },
      workspace: {
        spaces: () => [],
        dots: () => [],
        conversations: () => [],
        calls: () => [],
      },
      store: { settings: () => ({}) },
      setup: () => ({ missing: [] }),
    } as unknown as Platform;
    const mockVoice = {} as unknown as VoiceService;
    const app = workspaceRoutes(mockPlatform, mockVoice);

    const res = await app.request('/voice/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBeDefined();
  });
});
