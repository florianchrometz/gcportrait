// SPDX-License-Identifier: MIT
/**
 * Step (e) of the scene builder: progressive disclosure (skill gcp-diagram-layout §6). A detail level decides
 * which zones start collapsed:
 *
 * | Level | Collapsed |
 * |---|---|
 * | `folders` | everything but folders and bundles: projects (and whatever the canvas holds below them) are chips |
 * | `projects` | VPCs, subnets and product containers |
 * | `networks` | product containers |
 * | `all` | nothing |
 *
 * The table as data is {@link ZONE_OPENS_AT} (the shallowest level each zone kind is open at), exported so the
 * app's disclosure controls read the same rule instead of restating it. The `depth` filter collapses every asset
 * zone deeper than the limit below the root (bundles, region zones and overlays are not levels). A flip XORs a
 * zone's default, so a click on a chip opens it and a click on an open zone closes it, whatever made it collapse.
 * `auto` picks the deepest level whose rect count (without flips) fits the caller's budget, but never opens
 * deeper than the lens's `defaultDetail`, its ceiling (a lens that opens at `networks` is not drawn at
 * `all` by `auto`; an explicit level still wins); a view of at most 100 rects is never collapsed, whatever the
 * ceiling, {@link autoDetailLevel}; flips are applied after the choice, so opening a chip never changes the
 * level. A zone with nothing inside never becomes a chip.
 */
import type { ConcreteDetailLevel, DetailLevel, ZoneKind } from '@gcportrait/model';
import { NEVER_COLLAPSE_RECTS } from './constants.js';
import { flipIdOf } from './flip.js';
import type { SceneTree } from './tree.js';

/** Detail levels from the shallowest to the deepest. */
export const DETAIL_LEVELS: readonly ConcreteDetailLevel[] = ['folders', 'projects', 'networks', 'all'];

const rank = (level: ConcreteDetailLevel): number => DETAIL_LEVELS.indexOf(level);

/**
 * The shallowest level at which a zone of each kind is open by default (the table above): folders and bundles at
 * every level, projects and virtual region zones from `projects`, VPCs and subnets from `networks`, product
 * containers only at `all`. An overlay zone (a perimeter drawn around its projects) is open at every level.
 */
export const ZONE_OPENS_AT: Readonly<Record<ZoneKind, ConcreteDetailLevel>> = Object.freeze({
  folder: 'folders',
  group: 'folders',
  project: 'projects',
  region: 'projects',
  vpc: 'networks',
  subnet: 'networks',
  'product-container': 'all',
});

/** The shallowest level at which a zone is open by default (before flips and the `depth` filter). */
export function zoneOpensAt(kind: ZoneKind, overlay: boolean): ConcreteDetailLevel {
  return overlay ? 'folders' : ZONE_OPENS_AT[kind];
}

/**
 * The deepest level `auto` may open a lens at: the lens's `defaultDetail` (catalog lens files), or `all` for a
 * lens that opens at `auto` itself.
 */
export function autoCeiling(defaultDetail: DetailLevel): ConcreteDetailLevel {
  return defaultDetail === 'auto' ? 'all' : defaultDetail;
}

/**
 * The level `auto` picks, from the rect counts of each level (without flips): `all` for a view of at most {@link
 * NEVER_COLLAPSE_RECTS} rects, whatever `ceiling` says (a small view opens whole); otherwise the deepest
 * level whose count fits `budget` (`folders` when none fits), but never deeper than `ceiling`. Rect counts never
 * fall from one level to the next, so the ceiling, when it is the shallower, fits too.
 */
export function autoDetailLevel(
  rectCounts: Readonly<Record<ConcreteDetailLevel, number>>,
  budget: number,
  ceiling: ConcreteDetailLevel = 'all',
): ConcreteDetailLevel {
  if (rectCounts.all <= NEVER_COLLAPSE_RECTS) return 'all';
  const fits = [...DETAIL_LEVELS].reverse().find((level) => rectCounts[level] <= budget) ?? 'folders';
  return rank(fits) <= rank(ceiling) ? fits : ceiling;
}

export interface Disclosure {
  readonly requested: DetailLevel;
  readonly used: ConcreteDetailLevel;
  readonly budget: number;
  /** The deepest level `auto` may open at (the lens's `defaultDetail`). */
  readonly ceiling: ConcreteDetailLevel;
  /** Zones drawn as chips (the outermost ones; nothing below a chip is in the scene). */
  readonly collapsed: ReadonlySet<string>;
  readonly rectCounts: Readonly<Record<ConcreteDetailLevel, number>>;
  /** Flips that match no zone of the tree. */
  readonly unknownFlips: readonly string[];
}

/** Decides which zones are chips; `ceiling` bounds the level `auto` picks. */
export function disclose(
  tree: SceneTree,
  requested: DetailLevel,
  depthLimit: number | undefined,
  flips: readonly string[],
  budget: number,
  ceiling: ConcreteDetailLevel = 'all',
): Disclosure {
  const byFlip = new Map<string, string>();
  for (const entry of tree.entries.values())
    if (entry.type === 'zone') byFlip.set(flipIdOf(entry.id), entry.id);
  const flipped = new Set(flips.flatMap((flip) => byFlip.get(flip) ?? []));
  const unknownFlips = flips.filter((flip) => !byFlip.has(flip));

  const collapsedAt = (level: ConcreteDetailLevel, withFlips: boolean): Set<string> => {
    const collapsed = new Set<string>();
    // `depth`: how many asset zones enclose the ids (0 at the top level).
    const visit = (ids: readonly string[], depth: number): void => {
      for (const id of ids) {
        const entry = tree.entries.get(id);
        const children = tree.children.get(id) ?? [];
        if (entry?.type !== 'zone' || children.length === 0) continue;
        const own = entry.counted ? depth + 1 : depth;
        const deep = depthLimit !== undefined && entry.counted && own > depthLimit;
        const byDefault = rank(level) < rank(entry.opensAt) || deep;
        if (byDefault !== (withFlips && flipped.has(id))) collapsed.add(id);
        else visit(children, own);
      }
    };
    visit(tree.top, 0);
    return collapsed;
  };
  const rectsAt = (level: ConcreteDetailLevel): number => {
    const collapsed = collapsedAt(level, false);
    let count = 0;
    const visit = (ids: readonly string[]): void => {
      for (const id of ids) {
        count += 1;
        if (!collapsed.has(id)) visit(tree.children.get(id) ?? []);
      }
    };
    visit(tree.top);
    return count;
  };
  const rectCounts = {
    folders: rectsAt('folders'),
    projects: rectsAt('projects'),
    networks: rectsAt('networks'),
    all: rectsAt('all'),
  };
  const used = requested === 'auto' ? autoDetailLevel(rectCounts, budget, ceiling) : requested;
  return {
    requested,
    used,
    budget,
    ceiling,
    collapsed: collapsedAt(used, true),
    rectCounts,
    unknownFlips,
  };
}
