/**
 * ReceiveSource port — abstracts WHERE incoming agent messages come from, so the chat
 * store doesn't care. Two implementations, selected once by config.relayBase:
 *
 *  - RelayPullSource (relay set): pulls buffered updates from the relay (the relay's
 *    user-account session is the sole consumer). Realtime arrives via Expo push, and a
 *    light pull loop covers the foreground while a chat is open.
 *  - NullReceiveSource (no relay): live receive needs the relay (MTProto), so without one
 *    there's nothing to receive — mock buddies reply locally. A no-op.
 *
 * RelayPullSource feeds updates through a ChatBridge (currentOffset / ingestUpdates) — the
 * single dedupe/offset authority. The bridge is injected by chat.ts via setChatBridge()
 * rather than imported, so this module does NOT import the chat store — that one-directional
 * dependency (chat → ReceiveSource only) breaks the require cycle.
 */
import type { TgUpdate } from "@/infrastructure/api/telegramBotApi";
import { config } from "@/infrastructure/config";
import { relayClient } from "@/infrastructure/api/relayClient";
import { useBuddiesStore } from "@/application/stores/buddies";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Minimal view of the chat store that ReceiveSource needs, injected by chat.ts. */
export type ChatBridge = {
  currentOffset: (buddyId: string) => number;
  ingestUpdates: (buddyId: string, updates: TgUpdate[]) => void;
};

let chat: ChatBridge = {
  currentOffset: () => 0,
  ingestUpdates: () => undefined,
};

export function setChatBridge(bridge: ChatBridge): void {
  chat = bridge;
}

export interface ReceiveSource {
  start(buddyId: string): Promise<void>;
  stop(buddyId: string): void;
  catchUp(buddyId: string): Promise<void>;
}

type Ctrl = { stopped: boolean; abort?: AbortController };

/** No relay configured → no live receive (live messaging requires the relay). No-op. */
class NullReceiveSource implements ReceiveSource {
  async start(): Promise<void> {}
  stop(): void {}
  async catchUp(): Promise<void> {}
}

class RelayPullSource implements ReceiveSource {
  private loops = new Map<string, Ctrl>();

  private botIdFor(buddyId: string): number | null {
    return useBuddiesStore.getState().buddies.find((b) => b.id === buddyId)?.botId ?? null;
  }

  async catchUp(buddyId: string): Promise<void> {
    const botId = this.botIdFor(buddyId);
    if (botId == null) return;
    const since = Math.max(0, chat.currentOffset(buddyId) - 2500);
    const updates = await relayClient.pull(botId, since);
    if (updates.length) chat.ingestUpdates(buddyId, updates);
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

const relaySource = new RelayPullSource();
const nullSource = new NullReceiveSource();

function currentSource(): ReceiveSource {
  return config.relayBase ? relaySource : nullSource;
}

export const receiveSource: ReceiveSource = {
  start: (buddyId) => currentSource().start(buddyId),
  stop: (buddyId) => currentSource().stop(buddyId),
  catchUp: (buddyId) => currentSource().catchUp(buddyId),
};
