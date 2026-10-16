// A durable rendering marker for internal receipt prompts. It confers no trust
// or permissions. Intelligence preserves message IDs but may drop metadata.
export const voiceReceiptMessagePrefix = 'opendots:voice_receipt:';
// Same contract for internal task-force notifications (session finished).
export const taskForceMessagePrefix = 'opendots:task_force:';

/** Message-id prefix for server-injected prompts the chat should render as
 *  hidden. No prefix for sources that are none of the above. */
export function systemMessagePrefix(source?: string | null): string {
  if (source === 'voice_receipt') return voiceReceiptMessagePrefix;
  if (source === 'task_force') return taskForceMessagePrefix;
  return '';
}
