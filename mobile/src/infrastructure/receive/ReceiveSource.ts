/**
 * ReceiveSource port — abstracts WHERE incoming agent messages come from, so the chat
 * store doesn't care. Two implementations, selected once by config.relayBase:
 *
 *  - TelegramPollSource (no relay): long-polls Telegram getUpdates directly while a chat
 *    is open (today's behavior, foreground-only).
 *  - RelayPullSource (relay set): NEVER touches Telegram getUpdates (the relay is the sole
 *    consumer). Pulls buffered updates from the relay; realtime arrives via Expo push, and
 *    a light pull loop covers the foreground while a chat is open.
 *
 * Both feed updates through useChatStore.ingestUpdates (single dedupe/offset authority).
 * Sending stays direct to the gateway in both modes (it doesn't consume the update queue).
 *
 * Imports the chat store lazily inside methods to avoid a load-time circular dependency
 * (chat.ts imports `receiveSource`).
 */
import { config } from "@/infrastructure/config";
import { botApi } from "@/infrastructure/api/telegramBotApi";
import { relayClient } from "@/infrastructure/api/relayClient";
import { secureStore, SecureKeys } from "@/infrastructure/storage/secureStore";
import { useChatStore } from "@/application/stores/chat";
import { useBuddiesStore } from "@/application/stores/buddies";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface ReceiveSource {
  start(buddyId: string): Promise<void>;
  stop(buddyId: string): void;
  catchUp(buddyId: string): Promise<void>;
}

type Ctrl = { stopped: boolean; abort?: AbortController };

class TelegramPollSource implements ReceiveSource {
  private loops = new Map<string, Ctrl>();

  async start(buddyId: string): Promise<void> {
    if (this.loops.has(buddyId)) return;
    const token = await secureStore.get(SecureKeys.botToken(buddyId));
    if (!token) return;
    const ctrl: Ctrl = { stopped: false };
    this.loops.set(buddyId, ctrl);
    let backoff = 1000;

    void (async () => {
      while (!ctrl.stopped) {
        try {
          const abort = new AbortController();
          ctrl.abort = abort;
          const offset = useChatStore.getState().currentOffset(buddyId);
          const updates = await botApi.getUpdates(token, offset, 25, abort.signal);
          backoff = 1000;
          if (updates.length) useChatStore.getState().ingestUpdates(buddyId, updates);
        } catch {
          if (ctrl.stopped) break;
          await sleep(backoff);
          backoff = Math.min(backoff * 2, 8000);
        }
      }
    })();
  }

  stop(buddyId: string): void {
    const ctrl = this.loops.get(buddyId);
    if (ctrl) {
      ctrl.stopped = true;
      ctrl.abort?.abort();
      this.loops.delete(buddyId);
    }
  }

  async catchUp(): Promise<void> {
    // Direct poll already covers the open chat; nothing extra to do.
  }
}

class RelayPullSource implements ReceiveSource {
  private loops = new Map<string, Ctrl>();

  private botIdFor(buddyId: string): number | null {
    return useBuddiesStore.getState().buddies.find((b) => b.id === buddyId)?.botId ?? null;
  }

  async catchUp(buddyId: string): Promise<void> {
    const botId = this.botIdFor(buddyId);
    if (botId == null) return;
    const since = useChatStore.getState().currentOffset(buddyId);
    const updates = await relayClient.pull(botId, since);
    if (updates.length) useChatStore.getState().ingestUpdates(buddyId, updates);
  }

  async start(buddyId: string): Promise<void> {
    if (this.loops.has(buddyId)) return;
    const botId = this.botIdFor(buddyId);
    if (botId == null) return;
    const ctrl: Ctrl = { stopped: false };
    this.loops.set(buddyId, ctrl);
    // Light foreground pull loop (relay returns immediately; push handles background).
    void (async () => {
      while (!ctrl.stopped) {
        try {
          await this.catchUp(buddyId);
        } catch {
          // ignore; retried next tick
        }
        await sleep(3000);
      }
    })();
  }

  stop(buddyId: string): void {
    const ctrl = this.loops.get(buddyId);
    if (ctrl) {
      ctrl.stopped = true;
      this.loops.delete(buddyId);
    }
  }
}

export const receiveSource: ReceiveSource = config.relayBase
  ? new RelayPullSource()
  : new TelegramPollSource();
