// SPDX-License-Identifier: MIT
/** The assets of a snapshot, one per name, in name order. */
import type { Asset } from '@gcportrait/model';
import { compareStrings } from './order.js';
import { compareTimestamps } from './timestamps.js';

/** The JSON text of a value; `undefined` (which has none) gives the empty string. */
function jsonText(value: unknown): string {
  return value === undefined ? '' : JSON.stringify(value);
}

/** Which of two assets of the same name to keep: the later `updateTime`, then the smaller data text. */
function preferred(a: Asset, b: Asset): Asset {
  const order = compareTimestamps(a.updateTime, b.updateTime);
  if (order !== 0) return order > 0 ? a : b;
  return compareStrings(jsonText(a.data), jsonText(b.data)) <= 0 ? a : b;
}

/**
 * One asset per name, sorted by name. A valid Snapshot has unique names; should a name repeat anyway, the
 * copy with the latest `updateTime` is kept, so the result does not depend on the input order.
 */
export function uniqueAssets(assets: readonly Asset[]): { assets: Asset[]; duplicates: number } {
  const byName = new Map<string, Asset>();
  let duplicates = 0;
  for (const asset of assets) {
    const existing = byName.get(asset.name);
    if (existing === undefined) {
      byName.set(asset.name, asset);
    } else {
      duplicates += 1;
      byName.set(asset.name, preferred(existing, asset));
    }
  }
  const unique = [...byName.values()].sort((a, b) => compareStrings(a.name, b.name));
  return { assets: unique, duplicates };
}
