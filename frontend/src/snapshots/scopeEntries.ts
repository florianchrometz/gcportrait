// SPDX-License-Identifier: Apache-2.0
/**
 * What the Snapshots page shows of each scope's timeline (docs/timeline.md): everything this browser keeps of
 * one scope, in time order. Its snapshots with a history (a demo organisation, a bundle that carries one), whose
 * days are replayed; its exports and manual pulls, which are the extra ticks of the scope's timeline
 * (timeline/extraTicks.ts); and the days its timeline read from Cloud Asset Inventory into the tick cache
 * (storage/tickCache.ts), each with its size, so the person sees what takes the space and can free it. Pure: the
 * page passes the library's listing and the cache's records.
 */
import type { StoredSnapshot, StoredTick } from '../storage/db';
import { extraTickId } from '../timeline/extraTicks';
import { scopePathOf } from '../timeline/types';
import { parseScopeName } from '../scope/scopeName';
import { scopeKindAndId, scopeName } from './labels';
import type { ListedSnapshot } from './repository';

/** One row of a scope's timeline. */
export type ScopeEntry =
  /** A snapshot that is a timeline of its own (a stored history), or any snapshot that is no extra tick. */
  | { readonly kind: 'snapshot'; readonly at: number; readonly listed: ListedSnapshot }
  /**
   * An export or a manual pull: an extra tick of the scope's timeline. `shared` counts the other stored snapshots of
   * the scope read in the same second (one tick on the timeline, which shows the copy stored last).
   */
  | { readonly kind: 'extra'; readonly at: number; readonly listed: ListedSnapshot; readonly shared: number }
  /** A day read from Cloud Asset Inventory and cached. */
  | { readonly kind: 'day'; readonly at: number; readonly tick: StoredTick };

export interface ScopeTimeline {
  /** `organizations/123`: the scope as Cloud Asset Inventory names it. */
  readonly scopePath: string;
  /** "example.com", or "Organisation 123" when no stored snapshot names it. */
  readonly name: string;
  /** "Organisation 30000000001". */
  readonly kindAndId: string;
  readonly entries: readonly ScopeEntry[];
  /** The cached days alone (what "Delete the cached days" deletes). */
  readonly days: readonly StoredTick[];
  /** What the scope's records take in this browser: snapshots, extra ticks and cached days. */
  readonly bytes: { readonly snapshots: number; readonly extras: number; readonly days: number };
}

/** A record that is an extra tick of its scope's timeline: an export or a manual pull. */
export function isExtraRecord(record: StoredSnapshot): boolean {
  return record.meta.source === 'export' || record.meta.source === 'api';
}

/** The instant a cached day shows: its day's start, or the time a latest day was read at "now". */
function dayAt(tick: StoredTick): number {
  const at = Date.parse(tick.now ? tick.actualReadTime : tick.readTime);
  return Number.isFinite(at) ? at : Date.parse(`${tick.day}T00:00:00Z`);
}

function readAt(record: StoredSnapshot): number {
  const at = Date.parse(record.meta.readTime);
  return Number.isFinite(at) ? at : 0;
}

/** The scope a cache key names when no snapshot of it is stored ("organizations/123" → "Organisation 123"). */
function scopeOfPath(scopePath: string): { readonly name: string; readonly kindAndId: string } {
  const parsed = parseScopeName(scopePath);
  if (parsed === null) return { name: scopePath, kindAndId: scopePath };
  const label = scopeKindAndId({ kind: parsed.kind, id: parsed.id });
  return { name: label, kindAndId: label };
}

/**
 * Order inside a scope: by instant, then days, snapshots and extra ticks (as the timeline bar puts a day before an
 * extra tick read at its 00:00), then by id.
 */
function compareEntries(a: ScopeEntry, b: ScopeEntry): number {
  const rank = { day: 0, snapshot: 1, extra: 2 } as const;
  const key = (entry: ScopeEntry): string => (entry.kind === 'day' ? entry.tick.key : entry.listed.record.id);
  return a.at - b.at || rank[a.kind] - rank[b.kind] || key(a).localeCompare(key(b));
}

/**
 * Every scope that this browser keeps something of, by name (then by scope path), each with its entries in time
 * order and what they take.
 */
export function scopeTimelines(
  snapshots: readonly ListedSnapshot[],
  ticks: readonly StoredTick[],
): readonly ScopeTimeline[] {
  const scopes = new Map<
    string,
    { name: string | null; kindAndId: string | null; entries: ScopeEntry[]; days: StoredTick[] }
  >();
  const scopeOf = (scopePath: string) => {
    let scope = scopes.get(scopePath);
    if (scope === undefined) {
      scope = { name: null, kindAndId: null, entries: [], days: [] };
      scopes.set(scopePath, scope);
    }
    return scope;
  };
  const extraIds = new Map<string, number>();
  for (const { record } of snapshots) {
    if (!isExtraRecord(record)) continue;
    const id = `${scopePathOf(record.meta.scope)} ${extraTickId(record.meta.readTime) ?? record.meta.readTime}`;
    extraIds.set(id, (extraIds.get(id) ?? 0) + 1);
  }
  for (const listed of snapshots) {
    const { record } = listed;
    const scopePath = scopePathOf(record.meta.scope);
    const scope = scopeOf(scopePath);
    // A stored snapshot names its scope; one with a display name names it best.
    if (scope.name === null || record.meta.scope.displayName !== undefined) {
      scope.name = scopeName(record.meta.scope);
      scope.kindAndId = scopeKindAndId(record.meta.scope);
    }
    const at = readAt(record);
    if (isExtraRecord(record)) {
      const id = `${scopePath} ${extraTickId(record.meta.readTime) ?? record.meta.readTime}`;
      scope.entries.push({ kind: 'extra', at, listed, shared: (extraIds.get(id) ?? 1) - 1 });
    } else scope.entries.push({ kind: 'snapshot', at, listed });
  }
  for (const tick of ticks) {
    const scope = scopeOf(tick.scope);
    scope.entries.push({ kind: 'day', at: dayAt(tick), tick });
    scope.days.push(tick);
  }
  const timelines = [...scopes].map(([scopePath, scope]): ScopeTimeline => {
    const fallback = scopeOfPath(scopePath);
    const entries = scope.entries.sort(compareEntries);
    const sum = (kind: ScopeEntry['kind']): number =>
      entries.reduce(
        (total, entry) =>
          entry.kind !== kind
            ? total
            : total + (entry.kind === 'day' ? entry.tick.bytes : entry.listed.record.meta.bytes),
        0,
      );
    return {
      scopePath,
      name: scope.name ?? fallback.name,
      kindAndId: scope.kindAndId ?? fallback.kindAndId,
      entries,
      days: [...scope.days].sort((a, b) => a.day.localeCompare(b.day)),
      bytes: { snapshots: sum('snapshot'), extras: sum('extra'), days: sum('day') },
    };
  });
  return timelines.sort((a, b) => a.name.localeCompare(b.name) || a.scopePath.localeCompare(b.scopePath));
}
