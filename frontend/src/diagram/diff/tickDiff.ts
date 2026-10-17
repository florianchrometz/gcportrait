// SPDX-License-Identifier: MIT
/**
 * The timeline diff of a drawn day (skill cai-ingestion §5, gcp-diagram-style §6; docs/timeline.md), worked
 * out in the data worker with the drawn day's Scene. Pure: Graphs, snapshots, the view and the Scene in; a Scene
 * with ghosts and a `TickDiff` out.
 *
 * - **The diff** is `diffSnapshots` of `@gcportrait/graph` between the day on screen before (the "previously
 *   displayed tick") and the drawn day: by asset name, independent of either snapshot's order.
 * - **Ghosts** (removed, "drawn as a ghost card at its last position for one tick"): the view is built on the
 *   earlier day too, at the detail level the drawn Scene uses and with the same flips, and every node it drew there
 *   that the drawn Scene does not draw goes back into the drawn Scene in its old container, with what it held then
 *   that is gone now, when it was removed (absent from the drawn day's snapshot), or when it changed and the drawn
 *   day's view leaves it out where it stood (a project marked for deletion is changed, and the view no longer draws
 *   it or anything in it: "not drawn now"). A zone that is no asset (a region or zone, a bundle), drawn open there,
 *   goes back the same way when it held something removed, holding what was removed in it, with the reason
 *   `removed`: when everything a project held in one region is removed, the region zone is gone too, and comes back
 *   in the project around their ghosts. A changed asset the drawn day's Graph holds in another container (it
 *   moved: drawn there, inside a chip there, or outside the view now) or inside a chip of the drawn Scene is no
 *   ghost: it is drawn once, where the drawn day has it, and the chip that holds it counts it (below). The layout
 *   then places a ghost among its siblings by the same order it placed it the day before (zones before cards, then
 *   by label), so it lands where it was and nothing overlaps it. A ghost needs its container: one whose container is
 *   not drawn as an open zone now (gone, or collapsed into a chip) gets none of its own; it comes back inside its
 *   container's ghost, or a chip counts it instead (below). The ghosts keep their ids: a removed asset is in no Graph
 *   of the drawn day, and a changed one or a zone that is no asset is not drawn there, so no id is drawn twice.
 * - **What a ghost holds** is only what is gone: the assets the diff found removed (absent from the drawn day's
 *   snapshot), and the zones that are no asset (a region or zone, a bundle) around them (a closed one unless the
 *   drawn day's Graph still holds it). An asset still there on the drawn day never comes back inside a ghost,
 *   whatever that day's Scene draws of it (drawn elsewhere, held by a chip, left out by the lens or the filters): a
 *   perimeter removed between the days takes none of the projects it secured that are still there, wherever the
 *   drawn day puts them.
 * - **What the ghosts depend on** (`TickDiff.earlier`): every ghost zone and every zone around a ghost on the earlier
 *   day, up to the canvas, with its container, whether it was the view's overlay there (the drawing draws such a
 *   ghost as an overlay, diff/marks.ts) and the state it was drawn in. The disclosure buttons judge by these whether
 *   a press keeps the ghosts, since the drawn day may hold such a zone elsewhere, or not hold the perimeter whose
 *   overlay it was.
 * - **Inside chips:** what a collapsed zone holds is not drawn, so a chip counts the added, removed and changed
 *   nodes inside it that the view would draw were it open (the view built with every zone open: detail `all`, no
 *   flips, no `depth` filter; on the drawn day for added and changed nodes, on the earlier day for removed ones).
 *   The extra builds happen only when the Scene has a chip and the days differ.
 * - **The chip that holds a node** (`holdingChip`) is found through the zones of the drawn Scene, virtual ones
 *   included: a region zone or a bundle is no Graph container (the Graph holds what lies in it in the zone around
 *   it, drawn open), so the open view that draws the node is walked up by that Scene's own structure, and the first
 *   zone the drawn Scene draws holds it when that zone is such a chip; an asset zone's chip is found by the Graph's
 *   containment. The same chip decides a changed node's count and whether it is a ghost (left out where it stood), so
 *   a node is never both.
 */
import { BUNDLE_ID_PREFIX, buildSceneWithReport, diffSnapshots, isVirtualNode } from '@gcportrait/graph';
import {
  normalizeViewSpec,
  type Catalog,
  type Graph,
  type Scene,
  type SceneBuild,
  type SceneEnv,
  type SceneNode,
  type SceneReport,
  type Snapshot,
  type ViewSpec,
  type ViewSpecInput,
} from '@gcportrait/model';

import type { DiffCounts, EarlierZone, GhostReason, TickDiff } from './types';

/** One day as the data worker holds it: its snapshot and Graph, and its tick (absent: the snapshot's own day). */
export interface DiffDayData {
  readonly snapshot: Snapshot;
  readonly graph: Graph;
  readonly tick?: string;
}

export interface TickDiffInput {
  /** The day on screen before (the one compared with). */
  readonly before: DiffDayData;
  /** The drawn day. */
  readonly after: DiffDayData;
  /** The view (its Scene's part: selection and highlight do not matter). */
  readonly spec: ViewSpec;
  /** The drawn day's Scene and report, as the scene builder made them for `spec`. */
  readonly scene: Scene;
  readonly report: SceneReport;
  readonly catalog: Catalog;
  /** The environments each day's Scene is built with (its read time, the root label, the `auto` budget). */
  readonly envBefore: SceneEnv;
  readonly envAfter: SceneEnv;
  /**
   * Builds a view on one day's Graph (the data worker's memo, pipeline/sceneMemo.ts; the earlier day's views
   * were built the step before); default: the scene builder itself, with `catalog`.
   */
  readonly build?: (graph: Graph, spec: ViewSpec, env: SceneEnv) => SceneBuild;
}

export interface TickDiffResult {
  /** The drawn Scene with the ghosts in their old containers (the same object when there are none). */
  readonly scene: Scene;
  readonly diff: TickDiff;
}

/** Every node of a Scene by id, with its parent (null at the top level). */
interface SceneIndex {
  readonly nodes: ReadonlyMap<string, SceneNode>;
  readonly parent: ReadonlyMap<string, string | null>;
}

function indexScene(scene: Scene): SceneIndex {
  const nodes = new Map<string, SceneNode>();
  const parent = new Map<string, string | null>();
  const visit = (list: readonly SceneNode[], up: string | null): void => {
    for (const node of list) {
      nodes.set(node.id, node);
      parent.set(node.id, up);
      if (node.type === 'zone') visit(node.children, node.id);
    }
  };
  visit(scene.children, null);
  return { nodes, parent };
}

function isChip(node: SceneNode | undefined): boolean {
  return node?.type === 'zone' && node.collapsed !== undefined;
}

/** Whether a Scene draws a chip (a collapsed zone): only then does a diff build the open views (see above). */
export function hasChip(scene: Scene): boolean {
  const walk = (nodes: readonly SceneNode[]): boolean =>
    nodes.some((node) => node.type === 'zone' && (node.collapsed !== undefined || walk(node.children)));
  return walk(scene.children);
}

function isOpenZone(node: SceneNode | undefined): boolean {
  return node?.type === 'zone' && node.collapsed === undefined;
}

/** Whether a Scene node is an asset: not one of the builder's virtual regions and zones, nor a bundle. */
function isAsset(id: string): boolean {
  return !isVirtualNode(id) && !id.startsWith(BUNDLE_ID_PREFIX);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The view with every zone open: detail `all`, no flips, no `depth` filter (what a chip would show opened). */
export function openView(spec: ViewSpec): ViewSpec {
  const filters: ViewSpecInput['filters'] = { ...spec.filters };
  delete filters.depth;
  return normalizeViewSpec({ ...spec, detail: 'all', flips: [], filters });
}

/** How many containment steps a walk up the Graph takes at most (deeper than any real chain; cycle-safe). */
const MAX_CHAIN = 64;

/** An index of no Scene: the earlier day's open view when nothing was removed or changed. */
const NO_SCENE: SceneIndex = { nodes: new Map(), parent: new Map() };

/**
 * The views with every zone open (`openView`) on the drawn day (`now`) and on the earlier one (`then`), as the chips'
 * counts and the holding chips read them. Only a drawn Scene with a chip builds them, the earlier day's only when
 * something was removed or changed (the file comment).
 */
interface OpenViews {
  readonly now: SceneIndex;
  readonly then: SceneIndex;
}

function openViews(
  input: TickDiffInput,
  now: SceneIndex,
  diff: { readonly removed: readonly string[]; readonly changed: readonly string[] },
): OpenViews | null {
  if (![...now.nodes.values()].some(isChip)) return null;
  const open = openView(input.spec);
  return {
    now: indexScene(buildOn(input, input.after.graph, open, input.envAfter).scene),
    then:
      diff.removed.length === 0 && diff.changed.length === 0
        ? NO_SCENE
        : indexScene(buildOn(input, input.before.graph, open, input.envBefore).scene),
  };
}

/**
 * The chip of the drawn Scene that holds node `id`, or null. A region zone or a bundle is no Graph container, so
 * when the open view `open` draws the node, it is walked up first, by that Scene's own structure, to the first zone
 * the drawn Scene draws: when that zone is a chip that is no asset, it holds the node. Otherwise the Graph's
 * containment is walked up to the first node the drawn Scene draws, which holds it when it is a chip.
 */
function holdingChip(graph: Graph, now: SceneIndex, open: SceneIndex, id: string): string | null {
  if (open.nodes.has(id)) {
    for (let up = open.parent.get(id) ?? null; up !== null; up = open.parent.get(up) ?? null) {
      const node = now.nodes.get(up);
      if (node === undefined) continue;
      if (!isAsset(up) && isChip(node)) return up;
      break;
    }
  }
  let current = graph.containment.parent[id];
  for (let step = 0; current !== undefined && step < MAX_CHAIN; step += 1) {
    const node = now.nodes.get(current);
    if (node !== undefined) return isChip(node) ? current : null;
    current = graph.containment.parent[current];
  }
  return null;
}

/** The view `spec` on one day's Graph, through the input's builder (the memo) or the scene builder itself. */
function buildOn(input: TickDiffInput, graph: Graph, spec: ViewSpec, env: SceneEnv): SceneBuild {
  return input.build === undefined
    ? buildSceneWithReport(graph, spec, input.catalog, env)
    : input.build(graph, spec, env);
}

type MutableCounts = { added: number; removed: number; changed: number };

/**
 * The chip of the drawn Scene that holds a node of the diff, or null (always when the drawn Scene has no chip): an
 * added node by the drawn day's Graph and open view, a removed one by the earlier day's, a changed one by the drawn
 * day's Graph and the drawn day's open view where that draws it, else the earlier day's.
 */
function chipOf(
  input: TickDiffInput,
  now: SceneIndex,
  open: OpenViews | null,
  id: string,
  kind: keyof MutableCounts,
): string | null {
  if (open === null) return null;
  if (kind === 'added') return holdingChip(input.after.graph, now, open.now, id);
  if (kind === 'removed') return holdingChip(input.before.graph, now, open.then, id);
  return holdingChip(input.after.graph, now, open.now.nodes.has(id) ? open.now : open.then, id);
}

/** The chips with changes inside them that the view would draw (see the file comment). */
function insideChips(
  input: TickDiffInput,
  now: SceneIndex,
  open: OpenViews | null,
  diff: {
    readonly added: readonly string[];
    readonly removed: readonly string[];
    readonly changed: readonly string[];
  },
): Record<string, DiffCounts> {
  if (open === null) return {};
  const counts = new Map<string, MutableCounts>();
  const count = (id: string, kind: keyof MutableCounts): void => {
    if (now.nodes.has(id)) return;
    const chip = chipOf(input, now, open, id, kind);
    if (chip === null) return;
    let entry = counts.get(chip);
    if (entry === undefined) {
      entry = { added: 0, removed: 0, changed: 0 };
      counts.set(chip, entry);
    }
    entry[kind] += 1;
  };
  for (const id of diff.added) if (open.now.nodes.has(id)) count(id, 'added');
  for (const id of diff.changed) {
    if (open.now.nodes.has(id) || open.then.nodes.has(id)) count(id, 'changed');
  }
  for (const id of diff.removed) if (open.then.nodes.has(id)) count(id, 'removed');
  const out: Record<string, DiffCounts> = {};
  for (const id of [...counts.keys()].sort(compare)) {
    const entry = counts.get(id);
    if (entry !== undefined) out[id] = { ...entry };
  }
  return out;
}

interface Ghosts {
  /** The ghost roots by the container they go into (null: the top level), each in id order. */
  readonly roots: ReadonlyMap<string | null, SceneNode[]>;
  readonly reasons: ReadonlyMap<string, GhostReason>;
  /** The zones the ghosts depend on, as the earlier day drew them (`TickDiff.earlier`). */
  readonly zones: ReadonlyMap<string, EarlierZone>;
}

/** The ghosts: the nodes the view drew on the earlier day that it no longer draws (see the file comment). */
function ghostsOf(
  input: TickDiffInput,
  now: SceneIndex,
  open: OpenViews | null,
  removed: ReadonlySet<string>,
  changed: ReadonlySet<string>,
): Ghosts {
  const roots = new Map<string | null, SceneNode[]>();
  const reasons = new Map<string, GhostReason>();
  const zones = new Map<string, EarlierZone>();
  if (removed.size === 0 && changed.size === 0) return { roots, reasons, zones };
  // The earlier day at the level the drawn Scene uses (an `auto` view could pick another one there), same flips.
  const earlierView = normalizeViewSpec({ ...input.spec, detail: input.report.detail.used });
  const earlier = buildOn(input, input.before.graph, earlierView, input.envBefore);
  // Rooted elsewhere (a drill-in root that is gone today): the earlier containers are not today's.
  if (earlier.report.root.used !== input.report.root.used) return { roots, reasons, zones };
  const then = indexScene(earlier.scene);
  const overlays = new Set(earlier.report.overlays.map((overlay) => overlay.zone));
  const gone = (id: string): boolean => !now.nodes.has(id);
  // Whether the drawn day's view leaves out a changed asset where it stood: the drawn day's Graph holds it in the
  // container it lay in the day before (it did not move), and no chip of the drawn Scene holds it (a chip that holds
  // it counts it, so it is never both).
  const leftOut = (id: string): boolean =>
    input.after.graph.containment.parent[id] === input.before.graph.containment.parent[id] &&
    chipOf(input, now, open, id, 'changed') === null;
  // A zone of the earlier Scene, with what the scene builder decided its state from there.
  const keep = (node: SceneNode): void => {
    if (node.type !== 'zone') return;
    zones.set(node.id, {
      kind: node.kind,
      parent: then.parent.get(node.id) ?? null,
      overlay: overlays.has(node.id),
      collapsed: node.collapsed !== undefined,
      empty: node.collapsed === undefined && node.children.length === 0,
    });
  };
  // A ghost with what comes back inside it.
  const ghost = (node: SceneNode, reason: GhostReason): SceneNode => {
    reasons.set(node.id, reason);
    if (node.type === 'card') return node;
    keep(node);
    return { ...node, children: node.children.flatMap((child) => inside(child, reason)) };
  };
  // An open zone that is no asset, with the reason `reason`, holding what comes back of its children (null when
  // nothing does).
  const reopened = (zone: SceneNode, reason: GhostReason): SceneNode | null => {
    if (zone.type !== 'zone') return null;
    const children = zone.children.flatMap((child) => inside(child, reason));
    if (children.length === 0) return null;
    reasons.set(zone.id, reason);
    keep(zone);
    return { ...zone, children };
  };
  // What a child of a ghost on the earlier day comes back as inside it (nothing, or itself): a removed asset as a
  // removed ghost; an asset still there on the drawn day never, wherever that day draws it, or whether it does; a
  // zone that is no asset with the reason of the ghost around it, when it holds something that comes back (an open
  // one) or the drawn day's Graph holds no such zone any more (a chip, whose contents the Scene leaves out).
  const inside = (child: SceneNode, around: GhostReason): SceneNode[] => {
    if (!gone(child.id)) return [];
    if (removed.has(child.id)) return [ghost(child, 'removed')];
    if (child.type !== 'zone' || isAsset(child.id)) return [];
    if (child.collapsed !== undefined) {
      return Object.hasOwn(input.after.graph.nodes, child.id) ? [] : [ghost(child, around)];
    }
    const zone = reopened(child, around);
    return zone === null ? [] : [zone];
  };
  // What a node of the earlier day that the drawn Scene does not draw comes back as on its own (null: nothing): a
  // removed asset; a changed one the drawn day's view leaves out where it stood; an open zone that is no asset (a
  // region or zone, a bundle) holding something removed, which takes the reason of what it holds (`removed`: only
  // what was removed comes back inside a ghost). A chip that is no asset does not, whatever it held.
  const rootOf = (id: string, node: SceneNode): SceneNode | null => {
    if (removed.has(id)) return ghost(node, 'removed');
    if (changed.has(id)) return leftOut(id) ? ghost(node, 'hidden') : null;
    if (isAsset(id) || node.type !== 'zone' || node.collapsed !== undefined) return null;
    return reopened(node, 'removed');
  };
  for (const [id, node] of then.nodes) {
    if (!gone(id)) continue;
    const up = then.parent.get(id) ?? null;
    // Its container must be drawn open today (or be the canvas); inside a vanished one it is part of that ghost.
    if (up !== null && !isOpenZone(now.nodes.get(up))) continue;
    const root = rootOf(id, node);
    if (root === null) continue;
    const list = roots.get(up);
    if (list === undefined) roots.set(up, [root]);
    else list.push(root);
    // The zones around it there, up to the canvas (or to one kept for another ghost, which holds the rest).
    for (let around = up; around !== null && !zones.has(around); around = then.parent.get(around) ?? null) {
      const zone = then.nodes.get(around);
      if (zone !== undefined) keep(zone);
    }
  }
  for (const list of roots.values()) list.sort((a, b) => compare(a.id, b.id));
  return { roots, reasons, zones };
}

/** A map's entries as a record, in id order. */
function sortedRecord<T>(map: ReadonlyMap<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const id of [...map.keys()].sort(compare)) {
    const value = map.get(id);
    if (value !== undefined) out[id] = value;
  }
  return out;
}

/** The Scene with the ghost roots added to their containers' children (or the top level), and its rect count. */
function withGhosts(
  scene: Scene,
  roots: ReadonlyMap<string | null, readonly SceneNode[]>,
  count: number,
): Scene {
  if (count === 0) return scene;
  const insert = (list: readonly SceneNode[]): SceneNode[] =>
    list.map((node) => {
      if (node.type !== 'zone') return node;
      const extra = roots.get(node.id) ?? [];
      return { ...node, children: [...insert(node.children), ...extra] };
    });
  return {
    ...scene,
    children: [...insert(scene.children), ...(roots.get(null) ?? [])],
    metadata: { ...scene.metadata, rectCount: scene.metadata.rectCount + count },
  };
}

/** The diff of the drawn day against the earlier one, and the drawn Scene with its ghosts. */
export function tickDiff(input: TickDiffInput): TickDiffResult {
  const diff = diffSnapshots(input.before.snapshot, input.after.snapshot);
  const now = indexScene(input.scene);
  const open = openViews(input, now, diff);
  const { roots, reasons, zones } = ghostsOf(input, now, open, new Set(diff.removed), new Set(diff.changed));
  return {
    scene: withGhosts(input.scene, roots, reasons.size),
    diff: {
      since: {
        ...(input.before.tick === undefined ? {} : { tick: input.before.tick }),
        readTime: input.before.snapshot.readTime,
      },
      added: diff.added,
      removed: diff.removed,
      changed: diff.changed,
      ghosts: sortedRecord(reasons),
      earlier: sortedRecord(zones),
      inside: insideChips(input, now, open, diff),
    },
  };
}
