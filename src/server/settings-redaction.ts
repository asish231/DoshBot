import type { Settings } from '../shared/types.js';

/** Replaces redacted credential values in API responses. */
export const SAVED_SENTINEL = '__saved__';

interface VoiceKeyEntry {
  id?: string;
  label?: string;
  key?: string;
  provider?: string;
}
interface ConnectorEntry {
  id?: string;
  token?: string;
  [key: string]: unknown;
}

function safeParse(value: string | null | undefined): unknown[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as unknown[]) : null;
  } catch {
    return null;
  }
}

/** Settings shape safe to send to the browser: credential values masked, presence kept. */
export function redactSettings(settings: Settings): Settings {
  const out: Settings = {
    ...settings,
    telegramBotToken: null,
    customApiKey: null,
    whatsappAccessToken: null,
    whatsappVerifyToken: null,
    twilioAuthToken: null,
  };
  out.secrets = {
    telegramBotToken: Boolean(settings.telegramBotToken),
    customApiKey: Boolean(settings.customApiKey),
    voiceApiKeys: 0,
    connectors: 0,
  };
  const voiceKeys = safeParse(settings.voiceApiKeys);
  if (voiceKeys) {
    out.secrets.voiceApiKeys = voiceKeys.filter(
      (e) => (e as VoiceKeyEntry)?.key,
    ).length;
    out.voiceApiKeys = JSON.stringify(
      voiceKeys.map((e) => {
        const entry = (e ?? {}) as VoiceKeyEntry;
        return { ...entry, key: entry.key ? SAVED_SENTINEL : undefined };
      }),
    );
  }
  const connectors = safeParse(settings.connectors);
  if (connectors) {
    out.secrets.connectors = connectors.filter(
      (e) => (e as ConnectorEntry)?.token,
    ).length;
    out.connectors = JSON.stringify(
      connectors.map((e) => {
        const entry = (e ?? {}) as ConnectorEntry;
        return entry.token ? { ...entry, token: SAVED_SENTINEL } : entry;
      }),
    );
  }
  return out;
}

/** Restores stored credential values when a PATCH round-trips the redaction sentinel. */
export function resolveSettingsPatch(
  patch: Partial<Settings>,
  previous: Settings,
): Partial<Settings> {
  const out = { ...patch };
  delete out.secrets;
  if (out.telegramBotToken === SAVED_SENTINEL)
    out.telegramBotToken = previous.telegramBotToken ?? null;
  if (out.customApiKey === SAVED_SENTINEL)
    out.customApiKey = previous.customApiKey ?? null;
  if (typeof out.voiceApiKeys === 'string') {
    const incoming = safeParse(out.voiceApiKeys);
    if (incoming) {
      const stored = new Map(
        (safeParse(previous.voiceApiKeys) ?? []).map((e) => {
          const entry = (e ?? {}) as VoiceKeyEntry;
          return [entry.id ?? `${entry.label}:${entry.provider}`, entry.key];
        }),
      );
      out.voiceApiKeys = JSON.stringify(
        incoming.map((e) => {
          const entry = (e ?? {}) as VoiceKeyEntry;
          if (entry.key !== SAVED_SENTINEL) return entry;
          const storedKey =
            stored.get(entry.id ?? `${entry.label}:${entry.provider}`) ?? null;
          return { ...entry, key: storedKey };
        }),
      );
    }
  }
  if (typeof out.connectors === 'string') {
    const incoming = safeParse(out.connectors);
    if (incoming) {
      const stored = new Map(
        (safeParse(previous.connectors) ?? []).map((e) => {
          const entry = (e ?? {}) as ConnectorEntry;
          return [entry.id, entry.token];
        }),
      );
      out.connectors = JSON.stringify(
        incoming.map((e) => {
          const entry = (e ?? {}) as ConnectorEntry;
          if (entry.token !== SAVED_SENTINEL) return entry;
          return { ...entry, token: stored.get(entry.id) ?? null };
        }),
      );
    }
  }
  return out;
}
