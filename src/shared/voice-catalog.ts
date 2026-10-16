/**
 * One source of truth for voice options and Dot behavior on calls. The
 * in-call voice picker, the Settings dialog, and every voice provider's
 * system prompt read from here, so all providers stay aware of the same
 * capabilities automatically — nothing is duplicated per provider.
 */

/** Voice names accepted by each realtime provider. */
export const VOICE_CATALOG: Record<string, string[]> = {
  gemini: ['Aoede', 'Puck', 'Charon', 'Kore', 'Fenrir'],
  openai: [
    'marin',
    'alloy',
    'echo',
    'shimmer',
    'ash',
    'ballad',
    'coral',
    'sage',
    'verse',
  ],
};

export function voicesForProvider(provider?: string | null): string[] {
  const key = (provider || 'openai').toLowerCase();
  return VOICE_CATALOG[key] ?? VOICE_CATALOG.openai!;
}

/**
 * Resolve the effective realtime voice provider.
 *
 * Older workspaces (and minimal `.env` files) often set only VOICE_MODEL —
 * e.g. `gemini-3.8-live` — leaving the provider empty while the client and
 * server default to OpenAI. That mismatch sends a Gemini model name and key
 * to the OpenAI Realtime endpoint (or vice versa) and every call fails.
 * An explicitly configured provider always wins; otherwise the model name
 * decides, falling back to OpenAI only when nothing hints at Gemini.
 */
export function resolveVoiceProvider(
  provider?: string | null,
  model?: string | null,
): string {
  const explicit = (provider || '').trim().toLowerCase();
  if (explicit === 'gemini' || explicit === 'openai') return explicit;
  const name = (model || '').toLowerCase();
  if (name.includes('gemini')) return 'gemini';
  if (
    name.includes('gpt-4o') ||
    name.includes('realtime') ||
    name.includes('marin')
  )
    return 'openai';
  return explicit || 'openai';
}

/**
 * OpenAI Realtime can switch voices mid-call (session.update); Gemini Live
 * bakes the voice into the session setup, so a change applies next call.
 */
export function supportsLiveVoiceChange(provider?: string | null): boolean {
  return (provider || 'openai').toLowerCase() !== 'gemini';
}

/**
 * The capability awareness shared by every voice provider, so the Dot
 * behaves identically whether the owner is on OpenAI Realtime or Gemini
 * Live: it knows about the ask_compute chat-delivery tool (when the
 * session has one) and that the call screen obeys spoken commands.
 */
export function voiceCapabilityPrompt(options: {
  hasComputeTool: boolean;
}): string {
  const toolHint = options.hasComputeTool
    ? 'Use the ask_compute tool for research, code, and anything the owner wants shown in the chat — its result lands in this conversation, so say "it\'s in the chat" instead of reading long content aloud. Never claim work happened without a tool result.'
    : '';
  return `Keep spoken responses short, natural, and conversational. ${toolHint} The owner's call screen reacts to their spoken commands automatically: "minimize the screen" or "minimize yourself" shrinks the call to a small floating pill, "expand"/"full screen" restores the big view, and "move left/right" slides the pill — the interface does these the moment they speak, so confirm briefly ("done, minimized") instead of saying you cannot. You cannot send messages to other people, make purchases, or control anything else on their machine.`;
}
