import { TelegramClient, Api } from "telegram";
import bigInt from "big-integer";
import { StringSession } from "telegram/sessions/index.js";
import { config } from "../config.js";

export function idToNum(x: unknown): number {
  if (x == null) return 0;
  const anyX = x as { toJSNumber?: () => number };
  if (typeof anyX.toJSNumber === "function") return anyX.toJSNumber();
  return Number(x as number);
}

export function newClient(session = ""): TelegramClient {
  const client = new TelegramClient(new StringSession(session), config.apiId, config.apiHash, {
    connectionRetries: 5,
    autoReconnect: true,
  });
  try {
    client.setLogLevel("error" as never);
  } catch {
    /* older builds: ignore */
  }
  return client;
}

export function rpcError(e: unknown): string {
  const anyE = e as { errorMessage?: string; message?: string };
  return anyE?.errorMessage ?? anyE?.message ?? String(e);
}

function inputPeerFromStored(peer?: { peer_id: number; access_hash: string | null }): InstanceType<typeof Api.InputPeerUser> | undefined {
  if (!peer?.access_hash) return undefined;
  return new Api.InputPeerUser({
    userId: bigInt(peer.peer_id),
    accessHash: bigInt(peer.access_hash),
  });
}

export async function retrySendTarget<T>(
  peer: { device_id: string; peer_id: number; username: string | null; access_hash: string | null } | undefined,
  send: (target: any) => Promise<T>,
  refreshPeer: (username: string) => Promise<void>,
): Promise<T> {
  const byStoredInput = inputPeerFromStored(peer);
  if (byStoredInput) {
    try {
      return await send(byStoredInput);
    } catch {
      // The stored access hash may be stale; fall through to username refresh when possible.
    }
  }
  if (peer?.username) {
    await refreshPeer(peer.username);
    return send(peer.username);
  }
  throw new Error("cannot resolve telegram peer");
}
