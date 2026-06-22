/**
 * Deep, key-order-independent structural comparison via stable JSON.
 *
 * `stableValue` normalises a value (undefined → null, object keys sorted) so
 * structurally-equal values serialise identically regardless of key order;
 * `sameJson` compares two values that way (used for snapshot change detection).
 */
export function stableValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableValue);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(stableValue(a)) === JSON.stringify(stableValue(b));
}
