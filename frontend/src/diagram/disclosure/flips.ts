// SPDX-License-Identifier: MIT
/**
 * Progressive disclosure on the page (skill gcp-diagram-layout §6): what "Expand all",
 * "Collapse all", the "N of M shown" indicator and the two notices need, worked out from the view (the URL
 * hash's ViewSpec) and the Scene on screen with its report. Pure: no store, no DOM.
 *
 * A detail level decides which zones start collapsed, and a flip (`flipIdOf(zone id)` in `ViewSpec.flips`) XORs
 * that default for one zone (the scene builder's step (e), `@gcportrait/graph`). Both actions are worked out on
 * the drawing on screen and the view it draws, and each is offered only when it would change that drawing:
 * "Expand all" opens the shallowest collapsed tier (the next detail level at which a chip on screen opens) and
 * reopens zones closed by hand, never closing anything; "Collapse all" closes every zone opened by hand and,
 * when the level in use is deeper than the one `auto` picks, returns to `auto`, never opening anything (a zone
 * closed by hand stays closed). Flips that name no zone of the view (another root's or focus's) are left alone.
 */
import { BUNDLE_ID_PREFIX, DETAIL_LEVELS, flipIdOf, isVirtualNode, zoneOpensAt } from '@gcportrait/graph';
import {
  VIEW_SPEC_MAX_FLIPS,
  type ConcreteDetailLevel,
  type Scene,
  type SceneNode,
  type SceneReport,
  type ViewSpec,
  type ViewSpecInput,
  type ZoneKind,
} from '@gcportrait/model';

import { autoLevel } from '../autoDetail';
import type { TickDiff } from '../diff/types';

/** What the disclosure logic reads of the Scene on screen (the data worker's `SceneAnswer` fits). */
export interface ShownScene {
  readonly scene: Scene;
  readonly report: SceneReport;
  /** A timeline day's diff, whose ghosts the Scene holds besides the view. */
  readonly diff?: Pick<TickDiff, 'ghosts'>;
}

const rank = (level: ConcreteDetailLevel): number => DETAIL_LEVELS.indexOf(level);

/** One zone of the Scene on screen, as the disclosure logic sees it. */
export interface ZoneState {
  readonly id: string;
  readonly kind: ZoneKind;
  readonly label: string;
  /** Drawn as a chip. */
  readonly collapsed: boolean;
  /** Open with nothing inside: never a chip, whatever the level. */
  readonly empty: boolean;
  readonly overlay: boolean;
  /** How many asset zones enclose it, itself included when it is one (the `depth` filter's measure). */
  readonly depth: number;
  /** Whether it counts for the `depth` filter: not an overlay, a virtual region or a bundle. */
  readonly counted: boolean;
}

/**
 * Every zone of a Scene, keyed by its flip token, with its depth for the `depth` filter; a timeline day's ghosts
 * are not zones of the view.
 */
export function zonesByFlip(shown: ShownScene): ReadonlyMap<string, ZoneState> {
  const overlays = new Set(shown.report.overlays.map((overlay) => overlay.zone));
  const ghosts = shown.diff?.ghosts ?? {};
  const zones = new Map<string, ZoneState>();
  const visit = (nodes: readonly SceneNode[], depth: number): void => {
    for (const node of nodes) {
      if (node.type !== 'zone' || Object.hasOwn(ghosts, node.id)) continue;
      const overlay = overlays.has(node.id);
      const counted = !overlay && !isVirtualNode(node.id) && !node.id.startsWith(BUNDLE_ID_PREFIX);
      const own = counted ? depth + 1 : depth;
      zones.set(flipIdOf(node.id), {
        id: node.id,
        kind: node.kind,
        label: node.label,
        collapsed: node.collapsed !== undefined,
        empty: node.collapsed === undefined && node.children.length === 0,
        overlay,
        depth: own,
        counted,
      });
      visit(node.children, own);
    }
  };
  visit(shown.scene.children, 0);
  return zones;
}

/** Whether the `depth` filter closes a zone, whatever the level. */
function closedByDepth(zone: ZoneState, depthLimit: number | undefined): boolean {
  return depthLimit !== undefined && zone.counted && zone.depth > depthLimit;
}

/**
 * Whether a zone starts collapsed at a level (before flips): by the scene builder's level table
 * (`zoneOpensAt`, `@gcportrait/graph` step (e)) or the `depth` filter.
 */
export function collapsedByDefault(
  zone: ZoneState,
  level: ConcreteDetailLevel,
  depthLimit: number | undefined,
): boolean {
  return rank(level) < rank(zoneOpensAt(zone.kind, zone.overlay)) || closedByDepth(zone, depthLimit);
}

/**
 * The shallowest level deeper than the one in use at which a chip on screen opens: of the chips its level
 * closes (not a flip, not the `depth` filter), the shallowest level that opens one; null when none would open
 * (every chip is closed by hand or by the `depth` filter).
 */
export function nextOpeningLevel(spec: ViewSpec, shown: ShownScene): ConcreteDetailLevel | null {
  const used = shown.report.detail.used;
  const flips = new Set(spec.flips);
  let next: ConcreteDetailLevel | null = null;
  for (const [token, zone] of zonesByFlip(shown)) {
    if (!zone.collapsed || flips.has(token) || closedByDepth(zone, spec.filters.depth)) continue;
    const opens = zoneOpensAt(zone.kind, zone.overlay);
    if (rank(opens) > rank(used) && (next === null || rank(opens) < rank(next))) next = opens;
  }
  return next;
}

/**
 * "Expand all": the view with the shallowest collapsed tier open, or null when it would open nothing on screen.
 *
 * The detail level becomes the next one at which a chip on screen opens ({@link nextOpeningLevel}). Of the
 * flips, a flip whose zone is a chip on screen (it keeps a zone closed that its level opens) goes, and so does a
 * flip that opens a zone the new level opens anyway; a flip that opens a zone the new level still closes stays,
 * so nothing open closes. Flips that name no zone on screen (inside a chip, or another view's) stay. With no
 * deeper level to open, only the closing flips go; chips the `depth` filter makes stay (the filter is the
 * person's own choice).
 */
export function expandAllView(spec: ViewSpec, shown: ShownScene): ViewSpecInput | null {
  const next = nextOpeningLevel(spec, shown);
  const level = next ?? shown.report.detail.used;
  const zones = zonesByFlip(shown);
  const flips = spec.flips.filter((token) => {
    const zone = zones.get(token);
    if (zone === undefined) return true;
    if (zone.collapsed) return false;
    return collapsedByDefault(zone, level, spec.filters.depth);
  });
  if (next === null && flips.length === spec.flips.length) return null;
  return { ...spec, detail: next ?? spec.detail, flips };
}

/**
 * "Collapse all": the view with every zone opened by hand closed and, when the level in use is deeper than the
 * one `auto` picks for this view at `budget` (the canvas's; the drawing's own by default), back at `auto`; null
 * when no zone on screen would close. It never opens anything: a level the person chose that is not deeper than
 * `auto`'s stays, and a flip that keeps a zone on screen closed stays while the level still opens that zone (one
 * the level closes anyway goes, since it would open it). Every other flip of the view goes, those of zones hidden
 * inside a chip included; flips that name no zone of the view (the report's `unknownFlips`: another root's or
 * focus's) stay, as they change nothing here.
 */
export function collapseAllView(
  spec: ViewSpec,
  shown: ShownScene,
  budget: number = shown.report.detail.budget,
): ViewSpecInput | null {
  const { detail } = shown.report;
  const automatic = autoLevel(detail, budget);
  const toAuto = spec.detail !== 'auto' && rank(automatic) < rank(detail.used);
  const level = toAuto ? automatic : detail.used;
  const depth = spec.filters.depth;
  const zones = zonesByFlip(shown);
  const elsewhere = new Set(shown.report.unknownFlips);
  const flips = spec.flips.filter((token) => {
    if (elsewhere.has(token)) return true;
    const zone = zones.get(token);
    return zone !== undefined && zone.collapsed && !collapsedByDefault(zone, level, depth);
  });
  // An open zone on screen closes when the new level closes it: its own flip, if any, opened it and is gone.
  const closes = [...zones.values()].some(
    (zone) => !zone.collapsed && !zone.empty && collapsedByDefault(zone, level, depth),
  );
  if (!closes) return null;
  return { ...spec, detail: toAuto ? 'auto' : spec.detail, flips };
}

/**
 * "N of M shown": the rects drawn (zones, chips and cards, a chip once) and the rects the view holds at `all`
 * (the report's count without flips; never less than N, since a flip can open a zone the `depth` filter
 * closes).
 */
export function rectsShown(shown: ShownScene): { readonly shown: number; readonly total: number } {
  // A timeline day's ghosts are in its Scene, but they are not part of the view.
  const ghosts = shown.diff === undefined ? 0 : Object.keys(shown.diff.ghosts).length;
  const drawn = shown.scene.metadata.rectCount - ghosts;
  return { shown: drawn, total: Math.max(drawn, shown.report.detail.rectCounts.all) };
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/**
 * The flips the 48-flip cap dropped between two views, oldest first, or none: exactly the change
 * `normalizeViewSpec` makes when a flip is added to a full list (it keeps the newest 48), so a person
 * collapsing a zone, "Collapse all", a view with fewer flips or with other flips altogether never counts.
 */
export function flipsDroppedByCap(previous: readonly string[], next: readonly string[]): string[] {
  if (next.length !== VIEW_SPEC_MAX_FLIPS) return [];
  const before = new Set(previous);
  const after = new Set(next);
  const added = next.filter((token) => !before.has(token));
  const removed = previous.filter((token) => !after.has(token));
  // Something new came in and some, not all, of the old went: a view with other flips altogether is no drop.
  if (added.length === 0 || removed.length === 0 || removed.length === previous.length) return [];
  if (!sameList(removed, previous.slice(0, removed.length))) return [];
  if (!sameList(next, [...previous.slice(removed.length), ...added])) return [];
  return removed;
}

/** A change of the level `auto` picked for the same view: the canvas was resized across a threshold. */
export interface AutoLevelShift {
  readonly from: ConcreteDetailLevel;
  readonly to: ConcreteDetailLevel;
  /** The diagram area got larger (a deeper level) or smaller. */
  readonly larger: boolean;
}

/** What the pipeline draws, as far as this module needs it (the store's `PipelineResult` fits). */
export interface DrawnView {
  /** The view's scene key: the same key, the same view. */
  readonly key: string;
  readonly answer: ShownScene;
}

/**
 * The `auto` level change between two results the pipeline drew for the same view, or null: the view (its
 * scene key) did not change, so only the canvas size did (the pipeline asks again for an `auto` view only
 * then).
 */
export function autoLevelShift(previous: DrawnView | null, next: DrawnView | null): AutoLevelShift | null {
  if (previous === null || next === null || previous === next || previous.key !== next.key) return null;
  const before = previous.answer.report.detail;
  const after = next.answer.report.detail;
  if (after.requested !== 'auto' || before.used === after.used) return null;
  return { from: before.used, to: after.used, larger: rank(after.used) > rank(before.used) };
}

/** The detail levels' names as the page writes them. */
export const LEVEL_NAMES: Readonly<Record<ConcreteDetailLevel, string>> = {
  folders: 'Folders',
  projects: 'Projects',
  networks: 'Networks',
  all: 'All',
};
