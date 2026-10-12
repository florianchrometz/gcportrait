// SPDX-License-Identifier: MIT
/**
 * What the data worker tells the page about a snapshot's timeline (with each Scene: `SceneSource.timeline`), and
 * the scope name both sides build cache keys with.
 */
import type { SnapshotScope } from '@gcportrait/model';

import { COLLECTION_OF } from '../scope/scopeName';

export type TimelineInfo =
  /**
   * A stored history (a demo organisation, or an imported bundle that carries one): every day is replayed in the
   * data worker, so every tick is available without reading Google Cloud. `days` are the history's 35 days, oldest
   * first; `today` is the last, the snapshot's own.
   */
  | {
      readonly kind: 'history';
      readonly today: string;
      readonly days: readonly string[];
      /**
       * The snapshot's scope, as Cloud Asset Inventory names it, and its read time (the stored exports and
       * pulls of the same scope are the timeline's extra ticks, timeline/extraTicks.ts); absent: none are shown.
       */
      readonly scopePath?: string;
      readonly readTime?: string;
    }
  /**
   * A snapshot of a scope without a history (a live pull, an export): its own day is the snapshot; every other
   * tick of the last 35 days is read from Cloud Asset Inventory at that day's 00:00 UTC and cached in this browser.
   */
  | {
      readonly kind: 'live';
      readonly scope: SnapshotScope;
      /** `organizations/123`: the scope as Cloud Asset Inventory names it (and the cache key's first part). */
      readonly scopePath: string;
      /** The snapshot's own read time. */
      readonly readTime: string;
    };

/** `organizations/123`, `folders/456`, `projects/my-project`: a snapshot scope as Cloud Asset Inventory names it. */
export function scopePathOf(scope: Pick<SnapshotScope, 'kind' | 'id'>): string {
  return `${COLLECTION_OF[scope.kind]}/${scope.id}`;
}
