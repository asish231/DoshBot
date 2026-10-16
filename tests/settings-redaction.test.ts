import { describe, expect, it } from 'vitest';
import {
  SAVED_SENTINEL,
  redactSettings,
  resolveSettingsPatch,
} from '../src/server/settings-redaction.js';
import type { Settings } from '../src/shared/types.js';

const base: Settings = {
  name: 'Dot',
  paused: false,
  researchAllowed: true,
  memoryAllowed: true,
};

describe('settings redaction', () => {
  it('masks the Telegram token and reports its presence', () => {
    const out = redactSettings({
      ...base,
      telegramBotToken: '123:secret-token',
    });
    expect(out.telegramBotToken).toBeNull();
    expect(out.secrets?.telegramBotToken).toBe(true);
  });

  it('masks the custom provider key and reports its presence', () => {
    const out = redactSettings({
      ...base,
      customApiKey: 'ollama-secret',
    });
    expect(out.customApiKey).toBeNull();
    expect(out.secrets?.customApiKey).toBe(true);
  });

  it('masks voice API keys but keeps labels and providers', () => {
    const out = redactSettings({
      ...base,
      voiceApiKeys: JSON.stringify([
        {
          id: 'k1',
          label: 'Gemini',
          key: 'AIza-super-secret',
          provider: 'gemini',
        },
      ]),
    });
    const keys = JSON.parse(out.voiceApiKeys || '[]') as {
      key?: string;
      label?: string;
    }[];
    expect(keys).toHaveLength(1);
    expect(keys[0]!.key).toBe(SAVED_SENTINEL);
    expect(keys[0]!.label).toBe('Gemini');
    expect(out.secrets?.voiceApiKeys).toBe(1);
  });

  it('masks connector tokens but keeps names and urls', () => {
    const out = redactSettings({
      ...base,
      connectors: JSON.stringify([
        {
          id: 'c1',
          name: 'Local FS',
          type: 'remote_sse',
          url: 'http://example.invalid/mcp',
          token: 'tok-secret',
          enabled: true,
        },
      ]),
    });
    const connectors = JSON.parse(out.connectors || '[]') as {
      token?: string;
      url?: string;
    }[];
    expect(connectors[0]!.token).toBe(SAVED_SENTINEL);
    expect(connectors[0]!.url).toBe('http://example.invalid/mcp');
    expect(out.secrets?.connectors).toBe(1);
  });

  it('round-trips a sentinel PATCH back to the stored credentials', () => {
    const previous: Settings = {
      ...base,
      telegramBotToken: '123:real-token',
      voiceApiKeys: JSON.stringify([
        { id: 'k1', label: 'A', key: 'stored-key', provider: 'gemini' },
      ]),
    };
    const patch = resolveSettingsPatch(
      {
        telegramBotToken: SAVED_SENTINEL,
        voiceApiKeys: JSON.stringify([
          { id: 'k1', label: 'A', key: SAVED_SENTINEL, provider: 'gemini' },
        ]),
      },
      previous,
    );
    expect(patch.telegramBotToken).toBe('123:real-token');
    const keys = JSON.parse(String(patch.voiceApiKeys)) as { key?: string }[];
    expect(keys[0]!.key).toBe('stored-key');
  });

  it('drops secrets metadata from patches so it is never persisted', () => {
    const patch = resolveSettingsPatch(
      {
        secrets: { telegramBotToken: true, voiceApiKeys: 0, connectors: 0 },
      } as never,
      base,
    );
    expect('secrets' in patch).toBe(false);
  });

  it('lets real new credentials through untouched', () => {
    const patch = resolveSettingsPatch(
      { telegramBotToken: '999:new-token' },
      base,
    );
    expect(patch.telegramBotToken).toBe('999:new-token');
  });
});
