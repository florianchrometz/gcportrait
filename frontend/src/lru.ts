// SPDX-License-Identifier: Apache-2.0

/**
 * Keeps `key` → `value` as the newest entry of `kept`, dropping the least recently used entries beyond
 * `capacity`: re-setting a key makes it newest (a `Map` iterates in insertion order).
 */
export function keepNewest<K, V>(kept: Map<K, V>, key: K, value: V, capacity: number): void {
  kept.delete(key);
  kept.set(key, value);
  while (kept.size > capacity) {
    const oldest = kept.keys().next().value;
    if (oldest === undefined) break;
    kept.delete(oldest);
  }
}
