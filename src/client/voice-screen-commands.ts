/**
 * Spoken screen commands for the voice call view. The user's live transcript
 * arrives here as complete utterances; this matcher turns them into UI
 * actions. It errs toward precision: directional words like "right" appear
 * in ordinary agreement ("that's right"), and words like "minimize" appear
 * in code talk ("minimize the bundle size"), so bare keywords usually need
 * either a motion verb or a screen-ish object to fire.
 */
export type ScreenCommand = 'minimize' | 'expand' | 'left' | 'right';

const MINIMIZE_WORD = /\b(minimi[sz]e|hide|make it smaller|shrink)\b/i;
const EXPAND_WORD =
  /\b(expand|maximi[sz]e|make it bigger|make it larger|enlarge|restore|full ?screen|bring it back|bring .* back|open it up|open\b[^.]*\bback\b)\b/i;
const MOTION_WORD =
  /\b(move|go|slide|shift|drag|put|park|send|scoot|nudge)\b/i;
const SCREEN_OBJECT =
  /\b(screen|call|view|window|panel|this|it|voice|player|camera)\b/i;
/** The utterance is essentially just the command itself. */
const BARE_COMMAND =
  /^(?:please\s+)?(?:can you\s+|could you\s+|just\s+|go ahead and\s+)*(?:minimi[sz]e|hide|expand|maximi[sz]e|restore|make it smaller|make it bigger|enlarge|full ?screen)\b[.!?\s]*$/i;

export function matchScreenCommand(utterance: string): ScreenCommand | null {
  const text = utterance.toLowerCase().trim();
  // Long monologues are conversation, not a command.
  if (!text || text.length > 200) return null;

  // Direction first: a motion verb plus the direction, or an explicit
  // side/edge reference ("on the left", "right side").
  const hasLeft = /\bleft\b/.test(text);
  const hasRight = /\bright\b/.test(text);
  if (hasLeft || hasRight) {
    if (MOTION_WORD.test(text)) return hasLeft ? 'left' : 'right';
    if (/\b(?:left|right)\s+(?:side|edge|corner)\b/.test(text))
      return hasLeft ? 'left' : 'right';
    if (/\b(?:to|on|at)\s+the\s+(?:left|right)\b/.test(text))
      return hasLeft ? 'left' : 'right';
  }

  // Self-commands: "minimize yourself", "expand yourself". The verb must be
  // adjacent to "yourself" so phrases like "minimize your taxes yourself"
  // don't fire.
  if (
    /\b(?:minimi[sz]e|hide|shrink)\s+yourself\b/.test(text) ||
    /\bmake yourself smaller\b/.test(text)
  )
    return 'minimize';
  if (
    /\b(?:expand|maximi[sz]e|restore|enlarge|open)\s+yourself\b/.test(text) ||
    /\bmake yourself (?:bigger|larger|full ?screen)\b/.test(text)
  )
    return 'expand';

  if (BARE_COMMAND.test(text)) {
    return MINIMIZE_WORD.test(text) || /\bhide\b/.test(text)
      ? 'minimize'
      : 'expand';
  }

  // Otherwise the command needs a screen-ish object in the sentence
  // ("minimize the screen", "expand it", "hide the call view").
  if (!SCREEN_OBJECT.test(text)) return null;
  if (MINIMIZE_WORD.test(text)) return 'minimize';
  if (EXPAND_WORD.test(text)) return 'expand';
  return null;
}
