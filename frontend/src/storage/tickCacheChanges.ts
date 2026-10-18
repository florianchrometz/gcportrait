// SPDX-License-Identifier: Apache-2.0
/**
 * The tick cache's change signal between the tabs of this browser (storage/tickCache.ts): a `BroadcastChannel` named
 * after the database (`gcportrait.tickCache`), so that the timeline of every tab on the same scope marks a day read
 * once any tab stored it, and not read once one deleted it, without waiting for the view to rest near it
 * (timeline/controller.ts). A message names one cache entry by its key (its scope, read time and content type, the
 * key itself holding the type filter too) and says whether it was stored or deleted; it never carries a snapshot, a
 * count of assets, a size or a token (AGENTS.md, Security and privacy, principle 1). A tab that hears of a stored day
 * reads the entry from its own IndexedDB, so the timeline's rules decide whether it counts (another scope's never).
 *
 * One per page (`tickCacheChanges`): the tick cache posts through it and the timeline controller listens through it,
 * so a tab never hears its own changes (a channel is not handed what it posts itself), and its own reads mark the
 * bar as they end. The channel is open only while something in the page listens; a change posted while nothing does
 * goes out on a channel opened for that message alone. A browser without `BroadcastChannel` (or one that refuses to
 * open it) posts nothing and hears nothing, and nothing else changes: a read still asks the cache for its day first.
 * Zod-free, like everything the page's main thread loads (AGENTS.md, Architecture and code): a message from another
 * tab, which may run another version of the app, is checked field by field.
 */
import { DB_NAME, type StoredTick } from './db';

/** The channel's name: the database's, so it speaks of that database alone. */
export const TICK_CACHE_CHANNEL = `${DB_NAME}.tickCache`;

/** What happened to a cache entry: stored (new, or replacing one under the same key) or deleted. */
export type TickCacheChangeKind = 'put' | 'delete';

/** One change of the tick cache as it crosses between tabs: the entry's key, and what happened to it. */
export interface TickCacheChange {
  readonly change: TickCacheChangeKind;
  /** The entry's cache key (timeline/cacheKey.ts). */
  readonly key: string;
  /** Its scope, `organizations/123`. */
  readonly scope: string;
  /** Its read time, `YYYY-MM-DDT00:00:00Z`. */
  readonly readTime: string;
  /** `RESOURCE`. */
  readonly contentType: string;
}

/** The fields of a cache entry a change names it by. */
export type TickCacheEntryKey = Pick<StoredTick, 'key' | 'scope' | 'readTime' | 'contentType'>;

/** The message for a change of `entry`: its key fields, copied one by one, so nothing else of it crosses. */
export function tickCacheChange(change: TickCacheChangeKind, entry: TickCacheEntryKey): TickCacheChange {
  return {
    change,
    key: entry.key,
    scope: entry.scope,
    readTime: entry.readTime,
    contentType: entry.contentType,
  };
}

/** `data` as a change of the tick cache when it is one, its key fields only; null for anything else. */
export function readTickCacheChange(data: unknown): TickCacheChange | null {
  if (typeof data !== 'object' || data === null) return null;
  const { change, key, scope, readTime, contentType } = data as Record<string, unknown>;
  if (change !== 'put' && change !== 'delete') return null;
  if (
    typeof key !== 'string' ||
    typeof scope !== 'string' ||
    typeof readTime !== 'string' ||
    typeof contentType !== 'string'
  )
    return null;
  return { change, key, scope, readTime, contentType };
}

export interface TickCacheChanges {
  /** Tells the other tabs of a change; never throws (a change that cannot be told is not told). */
  post(change: TickCacheChange): void;
  /** Hands every change another tab tells of to `listener`, until the function it returns is called. */
  subscribe(listener: (change: TickCacheChange) => void): () => void;
}

/** A channel between the tabs, as the changes use it. */
export interface TabChannel {
  post(message: TickCacheChange): void;
  close(): void;
}

/** Opens channel `name`, handing what other tabs post on it to `receive`; null where the browser has none. */
export type TabChannelOpener = (name: string, receive: (data: unknown) => void) => TabChannel | null;

/** The browser's `BroadcastChannel`, when it has one and lets the page open it. */
export function openBroadcastChannel(name: string, receive: (data: unknown) => void): TabChannel | null {
  if (typeof BroadcastChannel !== 'function') return null;
  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(name);
  } catch {
    return null;
  }
  channel.onmessage = (event: MessageEvent<unknown>) => {
    receive(event.data);
  };
  return {
    post(message) {
      channel.postMessage(message);
    },
    close() {
      channel.onmessage = null;
      channel.close();
    },
  };
}

export interface TickCacheChangesOptions {
  /** The channel's name (default {@link TICK_CACHE_CHANNEL}). */
  readonly name?: string;
  /** How a channel is opened (default {@link openBroadcastChannel}). */
  readonly open?: TabChannelOpener;
}

export function createTickCacheChanges(options: TickCacheChangesOptions = {}): TickCacheChanges {
  const name = options.name ?? TICK_CACHE_CHANNEL;
  const open = options.open ?? openBroadcastChannel;
  const listeners = new Set<(change: TickCacheChange) => void>();
  /** Open while something listens. */
  let channel: TabChannel | null = null;

  const receive = (data: unknown): void => {
    const change = readTickCacheChange(data);
    if (change === null) return;
    for (const listener of [...listeners]) listener(change);
  };

  const opened = (handler: (data: unknown) => void): TabChannel | null => {
    try {
      return open(name, handler);
    } catch {
      return null;
    }
  };

  return {
    post(change) {
      const message = tickCacheChange(change.change, change);
      // Through the open channel when this page listens (so it does not hear itself), else one for this message.
      const through = channel ?? opened(() => undefined);
      if (through === null) return;
      try {
        through.post(message);
      } catch {
        // Not told: the other tabs still find the day in the cache when they ask it.
      } finally {
        if (through !== channel) through.close();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      channel ??= opened(receive);
      return () => {
        if (!listeners.delete(listener) || listeners.size > 0 || channel === null) return;
        channel.close();
        channel = null;
      };
    },
  };
}

let page: TickCacheChanges | null = null;

/** The page's one change signal: the tick cache posts through it, the timeline controller listens through it. */
export function tickCacheChanges(): TickCacheChanges {
  page ??= createTickCacheChanges();
  return page;
}
