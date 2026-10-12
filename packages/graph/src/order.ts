// SPDX-License-Identifier: MIT
/**
 * Deterministic ordering. Every list the builder emits is sorted with these helpers, so the output never
 * depends on the order of the input, on the runtime's locale, or on Map/Set iteration order.
 */

/** Locale-independent string order (UTF-16 code units, which is code-point order for resource names). */
export function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** The distinct values, sorted with {@link compareStrings}. */
export function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareStrings);
}

/** Compares tuples of strings element by element. */
export function compareTuples(a: readonly string[], b: readonly string[]): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const order = compareStrings(a[i] ?? '', b[i] ?? '');
    if (order !== 0) return order;
  }
  return a.length - b.length;
}

/** A map's entries as a plain record with sorted keys (own properties only, `__proto__` included safely). */
export function sortedRecord<V>(map: ReadonlyMap<string, V>): Record<string, V> {
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => compareStrings(a, b)));
}
