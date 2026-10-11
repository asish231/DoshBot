import type { Platform } from './platform.js';

export interface TelegramChannelConfig {
  getToken: () => string | null | undefined;
  getAllowedUsers: () => string | null | undefined;
  isPaused: () => boolean;
}

export class TelegramChannel {
  private abortController: AbortController | null = null;
  private running = false;
  private offset = 0;
  /** chatId -> threadId cache over the durable workspace binding. */
  private threadMap = new Map<number, string>();

  constructor(
    private platform: Pick<
      Platform,
      'workspace' | 'turn' | 'createConversation' | 'store'
    >,
    private config: TelegramChannelConfig,
    private transport: typeof fetch = fetch,
  ) {}

  /** Durable chat -> thread binding so restarts continue existing conversations. */
  private threadFor(chatId: number): string | undefined {
    const cached = this.threadMap.get(chatId);
    if (cached) return cached;
    const stored = this.platform.workspace.telegramThread(chatId);
    if (stored) {
      this.threadMap.set(chatId, stored);
      return stored;
    }
    return undefined;
  }
  private rememberThread(chatId: number, threadId: string) {
    this.threadMap.set(chatId, threadId);
    this.platform.workspace.bindTelegramThread(chatId, threadId);
  }

  start() {
    if (this.running) return;
    const token = this.config.getToken();
    if (!token) return;
    this.running = true;
    this.abortController = new AbortController();
    void this.pollLoop(this.abortController.signal);
  }

  stop() {
    this.running = false;
    this.abortController?.abort();
    this.abortController = null;
  }

  private async pollLoop(signal: AbortSignal) {
    while (this.running && !signal.aborted) {
      const token = this.config.getToken();
      if (!token) {
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      if (this.config.isPaused()) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      try {
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${this.offset}&timeout=20`;
        const res = await this.transport(url, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        });

        if (!res.ok) {
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }

        const data = (await res.json()) as {
          ok: boolean;
          result?: Array<{
            update_id: number;
            message?: {
              message_id: number;
              from?: { id: number; first_name?: string; username?: string };
              chat: { id: number; type: string };
              text?: string;
              voice?: { file_id: string; duration: number };
            };
          }>;
        };

        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            this.offset = Math.max(this.offset, update.update_id + 1);
            if (update.message) {
              void this.handleMessage(token, update.message);
            }
          }
        }
      } catch {
        if (signal.aborted) break;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  /** Processes one Telegram message; public so tests can drive it directly. */
  async handleMessage(
    token: string,
    message: {
      message_id: number;
      from?: { id: number; first_name?: string; username?: string };
      chat: { id: number; type: string };
      text?: string;
      voice?: { file_id: string; duration: number };
    },
  ) {
    const chatId = message.chat.id;
    const userId = message.from?.id;

    // Check whitelist if configured
    const allowedRaw = this.config.getAllowedUsers();
    if (allowedRaw && allowedRaw.trim() && userId) {
      const allowedList = allowedRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (allowedList.length > 0 && !allowedList.includes(String(userId))) {
        await this.sendMessage(
          token,
          chatId,
          '⛔ Access restricted. Your Telegram User ID is not authorized for this Dot.',
        );
        return;
      }
    }

    // Handle /start
    if (message.text?.trim() === '/start') {
      const name = message.from?.first_name || 'there';
      await this.sendMessage(
        token,
        chatId,
        `👋 Hello ${name}! I am your personal OpenDots assistant.\n\nSend me any question, task, or voice message and I will assist you!`,
      );
      return;
    }

    let userPrompt = message.text?.trim();

    if (message.voice) {
      userPrompt = `[Voice message received from Telegram: ${message.voice.duration} seconds. Transcribe or respond to the user's spoken audio request.]`;
    }

    if (!userPrompt) return;

    // Show typing status indicator on Telegram
    void this.sendChatAction(token, chatId, 'typing');

    // Get or create conversation thread for this Telegram chat
    let threadId = this.threadFor(chatId);
    if (!threadId) {
      const dots = this.platform.workspace.dots();
      const dotId = dots[0]?.id;
      if (!dotId) {
        await this.sendMessage(
          token,
          chatId,
          'Error: No Dot found in workspace.',
        );
        return;
      }

      const conversation = await this.platform.createConversation(
        dotId,
        `Telegram: ${message.from?.first_name || message.chat.id}`,
      );
      threadId = conversation.id;
      this.rememberThread(chatId, threadId);
    }

    try {
      const reply = await this.platform.turn(
        threadId,
        userPrompt,
        AbortSignal.timeout(90_000),
      );

      if (reply && reply.trim()) {
        await this.sendMessage(token, chatId, reply.trim());
      }
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : 'Error executing turn';
      await this.sendMessage(
        token,
        chatId,
        `⚠️ Sorry, I encountered an issue: ${errorMsg}`,
      );
    }
  }

  private async sendMessage(token: string, chatId: number, text: string) {
    try {
      await this.transport(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
        }),
      });
    } catch {
      // ignore transport errors
    }
  }

  private async sendChatAction(token: string, chatId: number, action: string) {
    try {
      await this.transport(
        `https://api.telegram.org/bot${token}/sendChatAction`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, action }),
        },
      );
    } catch {
      // ignore
    }
  }
}
