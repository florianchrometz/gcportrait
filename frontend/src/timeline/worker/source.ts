// SPDX-License-Identifier: Apache-2.0
/**
 * The data worker's side of the timeline (skill cai-ingestion §5): what a snapshot's timeline is, and the snapshot of
 * one of its days. The data handler (diagram/pipeline/dataHandler.ts) asks it for the view's `tick`; the tick's
 * Graph, Scene and Layout then go through the normal pipeline.
 *
 * - A snapshot with a stored history (the demo organisations, generated here; an imported bundle that carries one,
 *   read from IndexedDB) has a `history` timeline: every one of its 35 days is replayed on demand (replay.ts, loaded
 *   on first use); the last day is the snapshot itself.
 * - Any other snapshot has a `live` timeline: its own day is the snapshot; another day is drawn once the page has
 *   read it from Cloud Asset Inventory into the tick cache (storage/tickCache.ts), under its cache key; until then
 *   the snapshot itself is drawn and the page shows the day as loading.
 * - On either, an extra tick (`2026-10-05T14:30:00Z`, an export or a manual pull of the same scope stored in
 *   IndexedDB; timeline/extraTicks.ts) draws that stored snapshot, the copy the timeline bar lists (`pickExtra`).
 *
 * The history of each loaded snapshot is looked up once (kept with the snapshot, so a snapshot loaded again, after
 * a delete, looks again).
 */
import type { DemoHistory } from '@gcportrait/demo-data';
import {
  DEMO_REF_PREFIX,
  isDemoSize,
  migrateSnapshot,
  type DemoSize,
  type Snapshot,
  type SnapshotRef,
} from '@gcportrait/model';

import { decodeJson } from '../../snapshots/codec';
import type { StoredTick } from '../../storage/db';
import { TICK_CONTENT_TYPE, tickCacheKey } from '../cacheKey';
import { isExtraTickId, type TimelineOwner } from '../extraTicks';
import { dayOfReadTime, dayReadTime } from '../ticks';
import { scopePathOf, type TimelineInfo } from '../types';

export interface TickSourceEnvironment {
  /** A demo organisation's history (default: diagram/pipeline/demo.ts, which generates it once and keeps it). */
  readonly demoHistory?: (size: DemoSize) => Promise<DemoHistory>;
  /** A stored snapshot's history (snapshots/load.ts), or null when it has none; default: none. */
  readonly storedHistory?: (ref: SnapshotRef) => Promise<DemoHistory | null>;
  /** A live scope's cached tick by its cache key (timeline/worker/store.ts); default: none is cached. */
  readonly readTick?: (key: string) => Promise<StoredTick | undefined>;
  /** The stored snapshot an extra tick of `owner`'s timeline shows (snapshots/load.ts); default: none. */
  readonly storedExtra?: (owner: TimelineOwner, id: string) => Promise<StoredExtra | null>;
}

/** The stored snapshot an extra tick shows. */
export interface StoredExtra {
  /** Changes when the tick shows another copy, or the copy is stored again. */
  readonly version: string;
  readonly load: () => Promise<Snapshot>;
}

/** A day the data worker can draw instead of the snapshot itself. */
export interface ResolvedTick {
  readonly day: string;
  /** Changes when the day's data does (a live tick read again), so a kept Graph of it is not reused then. */
  readonly version: string;
  readonly load: () => Promise<Snapshot>;
}

export interface TickSource {
  /** The snapshot's timeline. */
  info(ref: SnapshotRef, base: Snapshot): Promise<TimelineInfo>;
  /**
   * Day `day` of the snapshot (or its extra tick `day`), or null when the snapshot itself is drawn: its own
   * day, a day its timeline does not have, a live day that is not cached yet, or an extra tick not stored here.
   */
  resolve(ref: SnapshotRef, base: Snapshot, day: string): Promise<ResolvedTick | null>;
}

async function generatedHistory(size: DemoSize): Promise<DemoHistory> {
  const demo = await import('../../diagram/pipeline/demo');
  return demo.demoHistory(size);
}

function demoSizeOf(ref: SnapshotRef): DemoSize | null {
  const size = ref.startsWith(DEMO_REF_PREFIX) ? ref.slice(DEMO_REF_PREFIX.length) : undefined;
  return isDemoSize(size) ? size : null;
}

/** A cached live tick's snapshot; a record that cannot be read is said in a sentence (the canvas shows it). */
async function cachedSnapshot(record: StoredTick): Promise<Snapshot> {
  try {
    return migrateSnapshot(await decodeJson(record.blob));
  } catch {
    throw new Error(
      `The copy of ${record.day} kept in this browser cannot be read. Delete this site's data in the browser, ` +
        'then read the day again.',
    );
  }
}

export function createTickSource(environment: TickSourceEnvironment = {}): TickSource {
  const demoHistory = environment.demoHistory ?? generatedHistory;
  const histories = new WeakMap<Snapshot, Promise<DemoHistory | null>>();

  const historyOf = (ref: SnapshotRef, base: Snapshot): Promise<DemoHistory | null> => {
    const known = histories.get(base);
    if (known !== undefined) return known;
    const size = demoSizeOf(ref);
    const looked: Promise<DemoHistory | null> =
      size !== null
        ? demoHistory(size)
        : (environment.storedHistory?.(ref) ?? Promise.resolve(null)).catch(() => null);
    histories.set(base, looked);
    // A failure is not kept: the next request looks again.
    looked.catch(() => {
      histories.delete(base);
    });
    return looked;
  };

  const info = async (ref: SnapshotRef, base: Snapshot): Promise<TimelineInfo> => {
    const history = await historyOf(ref, base);
    if (history !== null)
      return {
        kind: 'history',
        today: history.today,
        days: history.ticks.map((tick) => tick.tick),
        scopePath: scopePathOf(base.scope),
        readTime: base.readTime,
      };
    return { kind: 'live', scope: base.scope, scopePath: scopePathOf(base.scope), readTime: base.readTime };
  };

  return {
    info,
    async resolve(ref, base, day) {
      if (isExtraTickId(day)) {
        const owner = { ref, scopePath: scopePathOf(base.scope), readTime: base.readTime };
        const extra = (await environment.storedExtra?.(owner, day)) ?? null;
        return extra === null ? null : { day, version: extra.version, load: extra.load };
      }
      const history = await historyOf(ref, base);
      if (history !== null) {
        if (day === history.today || !history.ticks.some((tick) => tick.tick === day)) return null;
        return {
          day,
          version: 'history',
          load: async () => (await import('./replay')).historySnapshot(history, day, base),
        };
      }
      if (day === dayOfReadTime(base.readTime) || environment.readTick === undefined) return null;
      const key = tickCacheKey({
        scope: scopePathOf(base.scope),
        readTime: dayReadTime(day),
        contentType: TICK_CONTENT_TYPE,
      });
      const record = await environment.readTick(key);
      if (record === undefined) return null;
      return {
        day,
        version: `${record.fetchedAt} ${record.actualReadTime}`,
        load: () => cachedSnapshot(record),
      };
    },
  };
}
