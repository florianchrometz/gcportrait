// SPDX-License-Identifier: MIT
/**
 * Replaying a history (the base and the daily mutations) to the organisation at one tick. Kept apart from the
 * generator (generate.ts, builder/, topology/, history/plan.ts) and importing none of it, so a caller that only
 * replays a stored history, such as the app's snapshot worker reading an imported bundle, bundles none of the
 * generator (the app's ADR 0029).
 */
import type { Asset, Tick } from '@gcportrait/model';
import type { DemoHistory, DemoOrganization } from './types.js';

/** Assets (or anything named) in code-point order of their names, in place. */
export function sortByName<T extends { readonly name: string }>(items: T[]): T[] {
  return items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * The organisation at one tick: an index (0 = first, 34 = today) or a `YYYY-MM-DD` day of the history. Every
 * mutation is checked while it is applied: an add never duplicates an asset, a remove or change never misses one.
 */
export function snapshotAt(history: DemoHistory, tick: number | Tick): DemoOrganization {
  const index = typeof tick === 'number' ? tick : history.ticks.findIndex((t) => t.tick === tick);
  const target = history.ticks[index];
  if (target === undefined || !Number.isInteger(index)) {
    throw new RangeError(`tick ${String(tick)} is not part of the history ending ${history.today}`);
  }
  const working = new Map<string, Asset>();
  for (const asset of history.base) working.set(asset.name, asset);
  for (let i = 1; i <= index; i++) {
    for (const mutation of history.ticks[i]?.mutations ?? []) {
      if (mutation.kind === 'add') {
        if (working.has(mutation.asset.name)) throw new Error(`${mutation.asset.name} is added twice`);
        working.set(mutation.asset.name, mutation.asset);
      } else if (mutation.kind === 'remove') {
        if (!working.delete(mutation.name)) throw new Error(`${mutation.name} is removed but does not exist`);
      } else {
        if (!working.has(mutation.asset.name))
          throw new Error(`${mutation.asset.name} is changed but does not exist`);
        working.set(mutation.asset.name, mutation.asset);
      }
    }
  }
  return {
    size: history.size,
    seed: history.seed,
    tick: target.tick,
    readTime: target.readTime,
    assets: sortByName([...working.values()]),
  };
}
