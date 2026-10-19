// SPDX-License-Identifier: Apache-2.0
/**
 * Deterministic ordering. Every list the builder emits is sorted with these helpers, so the output never
 * depends on the order of the input, on the runtime's locale, or on Map/Set iteration order.
 */
import { compareText, sortedRecord } from '@gcportrait/model';

/** Locale-independent string order (UTF-16 code units, which is code-point order for resource names). */
export const compareStrings = compareText;

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

export { sortedRecord };
