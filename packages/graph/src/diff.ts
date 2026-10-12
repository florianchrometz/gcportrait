// SPDX-License-Identifier: MIT
/**
 * The timeline diff (skill cai-ingestion §5): what changed between the previously
 * displayed snapshot and the displayed one. Pure, and independent of the order of either snapshot's assets.
 */
import type { Asset, Diff } from '@gcportrait/model';
import { compareStrings } from './order.js';
import { compareTimestamps } from './timestamps.js';

/** Each name's latest `updateTime`: a name repeated inside one snapshot counts once. */
function updateTimes(assets: readonly Asset[]): Map<string, string> {
  const times = new Map<string, string>();
  for (const asset of assets) {
    const known = times.get(asset.name);
    if (known === undefined || (known !== asset.updateTime && compareTimestamps(asset.updateTime, known) > 0))
      times.set(asset.name, asset.updateTime);
  }
  return times;
}

/**
 * Compares two snapshots by asset name: `added` are in `after` but not in `before`, `removed` in `before` but
 * not in `after`, and `changed` in both with a different `updateTime` (compared as instants, so a different
 * spelling of the same instant is no change). Each list is sorted by name. A name repeated inside one
 * snapshot counts once, with its latest `updateTime`. The same text is the same instant, so only the times that
 * differ as text are parsed (a timeline step on demo L compares 6,000 names).
 */
export function diffSnapshots(
  before: { readonly assets: readonly Asset[] },
  after: { readonly assets: readonly Asset[] },
): Diff {
  const old = updateTimes(before.assets);
  const now = updateTimes(after.assets);
  const added: string[] = [];
  const changed: string[] = [];
  for (const [name, updateTime] of now) {
    const previous = old.get(name);
    if (previous === undefined) added.push(name);
    else if (previous !== updateTime && compareTimestamps(previous, updateTime) !== 0) changed.push(name);
  }
  const removed = [...old.keys()].filter((name) => !now.has(name));
  return {
    added: added.sort(compareStrings),
    removed: removed.sort(compareStrings),
    changed: changed.sort(compareStrings),
  };
}
