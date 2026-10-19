// SPDX-License-Identifier: Apache-2.0
/**
 * Progressive disclosure on the page (skill gcp-diagram-layout §6): what "Expand all",
 * "Collapse all", the "N of M shown" indicator and the two notices need, worked out from the view (the URL
 * hash's ViewSpec) and the Scene on screen with its report. Pure: no store, no DOM.
 *
 * A detail level decides which zones start collapsed, and a flip (`flipIdOf(zone id)` in `ViewSpec.flips`) XORs
 * that default for one zone (the scene builder's step (e), `@gcportrait/graph`). Both actions are worked out on
 * the drawing on screen and the view it draws, and each is offered only when the view it writes draws another
 * Scene or, on a timeline day, other ghosts: "Expand all" opens the shallowest collapsed tier (the next detail
 * level at which a chip on screen opens) and reopens zones closed by hand, never closing anything; "Collapse all"
 * closes every zone opened by hand and, when the level in use is deeper than the one `auto` picks, returns to
 * `auto`, never opening anything (a zone closed by hand stays closed). Flips that name no zone of the view (another
 * root's or focus's) are left alone. A
 * zone drawn empty (nothing inside under the view's lens and filters) is never a chip and the builder ignores its
 * flip, so a change to that flip alone changes nothing on screen and leaves both buttons inert. Such a flip is the
 * person's choice for when the zone holds something again (after a lens switch, say): both buttons leave it as it
 * is, unless the level they write gives the zone that state by default, when it goes as any zone's flip would.
 * On a timeline day a ghost zone's flip is treated as a flip of the view's zones is, by the state the earlier day
 * drew the zone in and what it was there (the diff's `earlier`), so neither button opens or closes a ghost against
 * its rule either.
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
import type { EarlierZone, TickDiff } from '../diff/types';

/** What the disclosure logic reads of the Scene on screen (the data worker's `SceneAnswer` fits). */
export interface ShownScene {
  readonly scene: Scene;
  readonly report: SceneReport;
  /**
   * A timeline day's diff, whose ghosts the Scene holds besides the view. The diff builds the earlier day at the
   * level in use with the view's flips (diff/tickDiff.ts), so a press that leaves every zone of the view as it is
   * can still change the ghosts (back at `auto`, an open ghost project becomes a ghost chip): the zones the ghosts
   * depend on, as that day drew them (`earlier`), are part of the drawing the buttons compare with.
   */
  readonly diff?: Pick<TickDiff, 'ghosts' | 'earlier'>;
}

const rank = (level: ConcreteDetailLevel): number => DETAIL_LEVELS.indexOf(level);

/** A zone as a drawing shows it, with what the scene builder decided its state from. */
export interface ZoneFacts {
  readonly kind: ZoneKind;
  /** Drawn as a chip. */
  readonly collapsed: boolean;
  /**
   * Open with nothing inside for the scene builder that drew it (to the drawn day's, a timeline day's ghosts are
   * nothing): never a chip, whatever the level, and that builder ignores its flip.
   */
  readonly empty: boolean;
  readonly overlay: boolean;
  /** How many asset zones enclose it, itself included when it is one (the `depth` filter's measure). */
  readonly depth: number;
  /** Whether it counts for the `depth` filter: not an overlay, a virtual region or a bundle. */
  readonly counted: boolean;
}

/** One zone of the Scene on screen, as the disclosure logic sees it. */
export interface ZoneState extends ZoneFacts {
  readonly id: string;
  readonly label: string;
}

/** The zones of a Scene on screen, each keyed by flip token. */
interface Drawing {
  /** The view's zones (a timeline day's ghosts are none of them). */
  readonly zones: ReadonlyMap<string, ZoneState>;
  /**
   * On a timeline day, the zones its ghosts depend on as the earlier day drew them (the diff's `earlier`): every
   * ghost zone, and every zone around a ghost there (around a ghost of what that day drew only inside a chip, the
   * zones the drawn day draws, through which its zones' depth is counted).
   */
  readonly earlier: ReadonlyMap<string, ZoneFacts>;
}

/** Whether a zone counts for the `depth` filter, as the scene builder counts it. */
function countsForDepth(id: string, overlay: boolean): boolean {
  return !overlay && !isVirtualNode(id) && !id.startsWith(BUNDLE_ID_PREFIX);
}

function drawingOf(shown: ShownScene): Drawing {
  const overlays = new Set(shown.report.overlays.map((overlay) => overlay.zone));
  const ghosts = shown.diff?.ghosts ?? {};
  const isGhost = (node: SceneNode): boolean => Object.hasOwn(ghosts, node.id);
  const zones = new Map<string, ZoneState>();
  const visit = (nodes: readonly SceneNode[], depth: number): void => {
    for (const node of nodes) {
      // A ghost, and all it holds, is the earlier day's.
      if (node.type !== 'zone' || isGhost(node)) continue;
      const overlay = overlays.has(node.id);
      const counted = countsForDepth(node.id, overlay);
      const own = counted ? depth + 1 : depth;
      zones.set(flipIdOf(node.id), {
        id: node.id,
        kind: node.kind,
        label: node.label,
        collapsed: node.collapsed !== undefined,
        // A ghost is no asset of the drawn day: the builder saw the zone without it.
        empty: node.collapsed === undefined && node.children.every(isGhost),
        overlay,
        depth: own,
        counted,
      });
      visit(node.children, own);
    }
  };
  visit(shown.scene.children, 0);
  return { zones, earlier: earlierZones(shown.diff?.earlier ?? {}) };
}

/**
 * The zones a timeline day's ghosts depend on, keyed by flip token, each with its depth on the earlier day: the
 * zones around each one are listed too, up to the canvas.
 */
function earlierZones(earlier: Readonly<Record<string, EarlierZone>>): ReadonlyMap<string, ZoneFacts> {
  const depths = new Map<string, number>();
  const depthOf = (id: string): number => {
    const zone = Object.hasOwn(earlier, id) ? earlier[id] : undefined;
    if (zone === undefined) return 0;
    let depth = depths.get(id);
    if (depth === undefined) {
      depth = (zone.parent === null ? 0 : depthOf(zone.parent)) + (countsForDepth(id, zone.overlay) ? 1 : 0);
      depths.set(id, depth);
    }
    return depth;
  };
  const zones = new Map<string, ZoneFacts>();
  for (const [id, zone] of Object.entries(earlier)) {
    zones.set(flipIdOf(id), {
      kind: zone.kind,
      collapsed: zone.collapsed,
      empty: zone.empty,
      overlay: zone.overlay,
      depth: depthOf(id),
      counted: countsForDepth(id, zone.overlay),
    });
  }
  return zones;
}

/**
 * Every zone of a Scene, keyed by its flip token, with its depth for the `depth` filter; a timeline day's ghosts
 * are not zones of the view.
 */
export function zonesByFlip(shown: ShownScene): ReadonlyMap<string, ZoneState> {
  return drawingOf(shown).zones;
}

/** Whether the `depth` filter closes a zone, whatever the level. */
function closedByDepth(zone: ZoneFacts, depthLimit: number | undefined): boolean {
  return depthLimit !== undefined && zone.counted && zone.depth > depthLimit;
}

/**
 * Whether a zone starts collapsed at a level (before flips): by the scene builder's level table
 * (`zoneOpensAt`, `@gcportrait/graph` step (e)) or the `depth` filter.
 */
export function collapsedByDefault(
  zone: ZoneFacts,
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

/** A press of "Expand all" or "Collapse all": the view it writes and whether that view draws what is on screen. */
interface Press {
  readonly view: ViewSpecInput;
  readonly unchanged: boolean;
}

/**
 * Whether the view on screen at `level` with `flips` (in place of its own level and flips) draws what is on screen:
 * every zone on screen keeps its state, a chip staying a chip and an open zone open, so what the chips hold stays
 * hidden and the scene builder decides every zone as it did. A zone drawn empty keeps its state whatever its flip
 * says, as the builder ignores a flip on a zone with nothing inside. On a timeline day the ghosts count too: each
 * zone they depend on keeps the state the earlier day drew it in, on that day, which the diff builds at the level
 * and flips written and which decides each zone by what it was there (where it lay, whether it was the overlay).
 */
function drawsAsShown(
  drawing: Drawing,
  level: ConcreteDetailLevel,
  flips: readonly string[],
  depthLimit: number | undefined,
): boolean {
  const flipped = new Set(flips);
  const keeps = ([token, zone]: readonly [string, ZoneFacts]): boolean => {
    if (zone.empty) return true;
    const collapsed = collapsedByDefault(zone, level, depthLimit) !== flipped.has(token);
    return collapsed === zone.collapsed;
  };
  return [...drawing.zones].every(keeps) && [...drawing.earlier].every(keeps);
}

/**
 * The zone a flip names in the drawing on screen: a zone of the view or, on a timeline day, one its ghosts depend
 * on (as the earlier day drew it), which a press treats alike; undefined when it names neither.
 */
function zoneOfFlip(drawing: Drawing, token: string): ZoneFacts | undefined {
  return drawing.zones.get(token) ?? drawing.earlier.get(token);
}

/**
 * Whether a press keeps the flip of a zone drawn empty, the person's choice for when the zone holds something: it
 * does unless the level written gives the zone, by default, the state the flip gives it at the level in use.
 */
function keepsEmptyFlip(
  zone: ZoneFacts,
  used: ConcreteDetailLevel,
  level: ConcreteDetailLevel,
  depthLimit: number | undefined,
): boolean {
  return collapsedByDefault(zone, level, depthLimit) === collapsedByDefault(zone, used, depthLimit);
}

function expandAll(spec: ViewSpec, shown: ShownScene): Press {
  const { used } = shown.report.detail;
  const next = nextOpeningLevel(spec, shown);
  const level = next ?? used;
  const depth = spec.filters.depth;
  const drawing = drawingOf(shown);
  const flips = spec.flips.filter((token) => {
    const zone = zoneOfFlip(drawing, token);
    if (zone === undefined) return true;
    if (zone.empty) return keepsEmptyFlip(zone, used, level, depth);
    if (zone.collapsed) return false;
    return collapsedByDefault(zone, level, depth);
  });
  return {
    view: { ...spec, detail: next ?? spec.detail, flips },
    unchanged: drawsAsShown(drawing, level, flips, depth),
  };
}

/**
 * The view "Expand all" writes for the drawing on screen, whether or not it changes that drawing
 * ({@link expandAllView} is null when it does not).
 *
 * The detail level becomes the next one at which a chip on screen opens ({@link nextOpeningLevel}). Of the
 * flips, a flip whose zone is a chip on screen (it keeps a zone closed that its level opens) goes, and so does a
 * flip that opens a zone the new level opens anyway; a flip that opens a zone the new level still closes stays,
 * so nothing open closes. Flips that name no zone on screen (inside a chip, or another view's) stay. With no
 * deeper level to open, only the closing flips go; chips the `depth` filter makes stay (the filter is the
 * person's own choice). The flip of a zone drawn empty stays, unless it opens a zone the new level opens anyway.
 * On a timeline day the flip of a ghost zone, or of a zone around a ghost, goes or stays by the same rules, by the
 * state the earlier day drew the zone in.
 */
export function expandAllTarget(spec: ViewSpec, shown: ShownScene): ViewSpecInput {
  return expandAll(spec, shown).view;
}

/**
 * "Expand all": the view with the shallowest collapsed tier open ({@link expandAllTarget}), or null when that
 * view draws what is on screen (no chip on screen would open or reopen, and a timeline day's ghosts would stay).
 */
export function expandAllView(spec: ViewSpec, shown: ShownScene): ViewSpecInput | null {
  const press = expandAll(spec, shown);
  return press.unchanged ? null : press.view;
}

function collapseAll(spec: ViewSpec, shown: ShownScene, budget: number): Press {
  const { detail } = shown.report;
  const automatic = autoLevel(detail, budget);
  const toAuto = spec.detail !== 'auto' && rank(automatic) < rank(detail.used);
  const level = toAuto ? automatic : detail.used;
  const depth = spec.filters.depth;
  const drawing = drawingOf(shown);
  const elsewhere = new Set(shown.report.unknownFlips);
  const flips = spec.flips.filter((token) => {
    // A ghost zone's flip is among the unknown ones: the drawn day's view holds no such zone.
    const zone = zoneOfFlip(drawing, token);
    if (zone === undefined) return elsewhere.has(token);
    if (zone.empty) return keepsEmptyFlip(zone, detail.used, level, depth);
    return zone.collapsed && !collapsedByDefault(zone, level, depth);
  });
  return {
    view: { ...spec, detail: toAuto ? 'auto' : spec.detail, flips },
    unchanged: drawsAsShown(drawing, level, flips, depth),
  };
}

/**
 * The view "Collapse all" writes for the drawing on screen at `budget` (the canvas's; the drawing's own by
 * default), whether or not it changes that drawing ({@link collapseAllView} is null when it does not).
 *
 * Every zone opened by hand closes and, when the level in use is deeper than the one `auto` picks for this view
 * at `budget`, the level goes back to `auto`. It never opens anything: a level the person chose that is not deeper
 * than `auto`'s stays, and a flip that keeps a zone on screen closed stays while the level still opens that zone
 * (one the level closes anyway goes, since it would open it), and so does the flip of a zone drawn empty, unless
 * it closes a zone the new level closes anyway. Every other flip of the view goes, those of zones hidden inside a
 * chip included; flips that name no zone of the view (the report's `unknownFlips`: another root's or focus's)
 * stay, as they change nothing here. On a timeline day the flip of a ghost zone, or of a zone around a ghost, goes
 * or stays by the same rules, by the state the earlier day drew the zone in: a flip that closed a ghost goes where
 * the new level closes it anyway, so the ghost chip stays closed.
 */
export function collapseAllTarget(
  spec: ViewSpec,
  shown: ShownScene,
  budget: number = shown.report.detail.budget,
): ViewSpecInput {
  return collapseAll(spec, shown, budget).view;
}

/**
 * "Collapse all": the view with every zone opened by hand closed and back at `auto` when the level in use is
 * deeper ({@link collapseAllTarget}), or null when that view draws what is on screen (no open zone on screen would
 * close, and a timeline day's ghosts would stay).
 */
export function collapseAllView(
  spec: ViewSpec,
  shown: ShownScene,
  budget: number = shown.report.detail.budget,
): ViewSpecInput | null {
  const press = collapseAll(spec, shown, budget);
  return press.unchanged ? null : press.view;
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
