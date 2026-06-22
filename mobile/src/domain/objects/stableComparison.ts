/**
 * Deep, key-order-independent structural comparison.
 *
 * `stableValue` recursively normalises a value (undefined → null, object keys
 * sorted) so that two structurally-equal values serialise to the same JSON
 * regardless of key insertion order. `deepStableEqual` compares two values that
 * way — used for message de-duplication and "did this field actually change?"
 * checks.
 */
export function stableValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stableValue);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

export function deepStableEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(stableValue(a)) === JSON.stringify(stableValue(b));
}
