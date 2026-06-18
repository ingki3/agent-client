/**
 * AES-256-GCM encryption for bot tokens at rest, and secret hashing for deviceSecret.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

/** Encrypt → "ivHex:tagHex:cipherHex". */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.masterKey, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decrypt(blob: string): string {
  const [ivHex, tagHex, dataHex] = blob.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", config.masterKey, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}

export function newSecret(): string {
  return randomBytes(24).toString("base64url");
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function secretMatches(secret: string, hash: string): boolean {
  const a = Buffer.from(hashSecret(secret));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}
