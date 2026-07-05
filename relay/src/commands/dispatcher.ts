/**
 * Phone-command dispatcher — the async bridge between a synchronous MCP tool
 * call and the pocketed phone that executes it.
 *
 * dispatchCommand: generate a correlationId, persist a pending audit row, wake
 * the phone via FCM, and return a promise that settles when the phone POSTs its
 * result to /command/result (resolveCommand) or a timeout fires. The phone may
 * be asleep or offline, so every dispatch is bounded and always settles.
 */
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { fcm } from "../fcm/fcmSender.js";
import { log } from "../log.js";
import { store } from "../store.js";

export interface CommandResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface Pending {
  resolve: (r: CommandResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, Pending>();

export async function dispatchCommand(
  deviceId: string,
  peerId: number,
  tool: string,
  args: Record<string, unknown>,
): Promise<CommandResult> {
  const device = store.getDevice(deviceId);
  if (!device) return { ok: false, error: "device_not_found" };
  if (!device.fcm_token) return { ok: false, error: "device_no_fcm_token" };
  if (!fcm.enabled) return { ok: false, error: "fcm_not_configured" };

  const correlationId = randomUUID();
  const argsJson = JSON.stringify(args ?? {});
  store.insertToolCall({ correlationId, deviceId, peerId, tool, argsJson });

  const promise = new Promise<CommandResult>((resolve) => {
    const timer = setTimeout(() => {
      if (pending.delete(correlationId)) {
        store.finishToolCall(correlationId, "timeout", null);
        log.warn(`command timeout tool=${tool} corr=${correlationId}`);
        resolve({ ok: false, error: "phone_unreachable" });
      }
    }, config.commandTimeoutMs);
    pending.set(correlationId, { resolve, timer });
  });

  try {
    await fcm.sendCommand(device.fcm_token, { correlationId, tool, args: argsJson });
  } catch (e) {
    const p = pending.get(correlationId);
    if (p) {
      clearTimeout(p.timer);
      pending.delete(correlationId);
    }
    store.finishToolCall(correlationId, "error", null);
    return { ok: false, error: `fcm_send_failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  return promise;
}

/** Called by POST /command/result when the phone reports back. Idempotent. */
export function resolveCommand(correlationId: string, result: CommandResult): boolean {
  const p = pending.get(correlationId);
  if (!p) return false; // unknown or already settled (late/duplicate) — drop
  clearTimeout(p.timer);
  pending.delete(correlationId);
  store.finishToolCall(correlationId, result.ok ? "done" : "error", JSON.stringify(result));
  p.resolve(result);
  return true;
}

export function pendingCommandCount(): number {
  return pending.size;
}
