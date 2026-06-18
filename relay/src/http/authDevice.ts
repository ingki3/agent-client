import { secretMatches } from "../crypto.js";
import { store } from "../store.js";

export function authDevice(req: { headers: Record<string, unknown> }, deviceId: string): boolean {
  const dev = store.getDevice(deviceId);
  if (!dev) return false;
  const header = String(req.headers["authorization"] ?? "");
  const secret = header.startsWith("Bearer ") ? header.slice(7) : "";
  return secretMatches(secret, dev.device_secret_hash);
}
