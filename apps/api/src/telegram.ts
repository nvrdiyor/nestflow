/**
 * Minimal Telegram Bot API client for the sign-in bot. Updates arrive by long
 * polling (getUpdates), so no public webhook route or certificate is needed —
 * the API process itself is the only consumer. The token never appears in
 * logs: errors carry only the Telegram method name and description.
 */

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: TgUser;
    text?: string;
  };
}

/** What the server needs from a bot — a real client in production, a fake in tests. */
export interface TgSender {
  sendMessage(chatId: number | string, text: string): Promise<void>;
}

const API = 'https://api.telegram.org';

export class TelegramBot implements TgSender {
  private stopped = false;
  /** The in-flight long poll, so stop() can end it immediately. */
  private pollAbort: AbortController | null = null;

  constructor(private readonly token: string) {}

  private async call<T>(
    method: string,
    body: Record<string, unknown> = {},
    timeoutMs = 15_000,
    abort = new AbortController(),
  ): Promise<T> {
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const res = await fetch(`${API}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
      if (!json.ok) throw new Error(`Telegram ${method}: ${json.description ?? res.status}`);
      return json.result as T;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Telegram ')) throw err;
      throw new Error(`Telegram ${method}: ${err instanceof Error ? err.name : 'request failed'}`);
    } finally {
      clearTimeout(timer);
    }
  }

  getMe(): Promise<TgUser> {
    return this.call<TgUser>('getMe');
  }

  async sendMessage(chatId: number | string, text: string): Promise<void> {
    await this.call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
  }

  /**
   * Long-polls for updates until stop(). A webhook would make getUpdates fail,
   * so it is removed first. Failures back off (up to a minute) and never throw.
   */
  async startPolling(onUpdate: (u: TgUpdate) => Promise<void>, log: (msg: string) => void): Promise<void> {
    await this.call('deleteWebhook', { drop_pending_updates: false }).catch((e: Error) => log(e.message));
    let offset = 0;
    let backoff = 1000;
    while (!this.stopped) {
      try {
        this.pollAbort = new AbortController();
        const updates = await this.call<TgUpdate[]>(
          'getUpdates',
          { offset, timeout: 50, allowed_updates: ['message'] },
          65_000,
          this.pollAbort,
        );
        backoff = 1000;
        for (const u of updates) {
          offset = u.update_id + 1;
          try {
            await onUpdate(u);
          } catch (err) {
            log(`telegram update ${u.update_id} failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } catch (err) {
        if (this.stopped) break;
        log(err instanceof Error ? err.message : String(err));
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(60_000, backoff * 2);
      }
    }
  }

  stop(): void {
    this.stopped = true;
    this.pollAbort?.abort();
  }
}
