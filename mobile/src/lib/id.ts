let counter = 0;

/** Short unique id for client-side message/trace ids (not a security token). */
export function uid(prefix = "id"): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}
