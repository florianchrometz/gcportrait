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
 *   that the drawn Scene does not draw goes back into the drawn Scene in its old container, holding what of it is
 *   gone now (below), when it was removed (absent from the drawn day's snapshot), or when it is still there and the
 *   drawn day's view leaves it out where it stood: changed (a project marked for deletion is changed, and the view
 *   no longer draws it: "not drawn now"), or an asset zone unchanged itself holding something
 *   that comes back (a project whose VM was removed, which `hideEmptyProjects` no longer draws, is not drawn now,
 *   around the VM's ghost, so the removal shows where it happened). A zone that is no asset (a region or zone, a
 *   bundle) goes back the same way when it held something that comes back, `removed` when something removed does,
 *   else not drawn now: when everything a project held in one region is removed, the region zone is gone too, and
 *   comes back in the project around their ghosts; when the one job a region held succeeded (a finished job is not
 *   drawn), the region zone comes back not drawn now around the job's. A zone the earlier day drew as a chip comes
 *   back as that chip, by what it held in the earlier day's view with every zone open (below), counting only what of
 *   that comes back (a bundle whose members are bundled anew counts its removed member, not those the new bundles
 *   draw). A node still there that the drawn day's Graph holds in another container (it moved: drawn there, inside
 *   a chip there, or outside the view now) or inside a chip of the drawn Scene is no ghost: it is drawn once, where
 *   the drawn day has it, and the chip that holds it counts what changed of it (below). The layout then places a
 *   ghost among its siblings by the same order it placed it the day before (zones before cards, then by label), so
 *   it lands where it was and nothing overlaps it. A ghost needs its container: one whose container is not drawn as
 *   an open zone now (gone, or collapsed into a chip) gets none of its own; it comes back inside its container's
 *   ghost, or a chip counts it instead (below). The ghosts keep their ids: a removed asset is in no Graph of the
 *   drawn day, and one still there or a zone that is no asset is not drawn there, so no id is drawn twice.
 * - **What the earlier day drew only inside a chip** is judged on that day's view with every zone open (below): a
 *   node of it that the earlier day's Scene does not draw comes back by the same rule in the zone it lies in there,
 *   when the drawn Scene draws that zone open, each zone of its ghost open or closed as the drawn day's view draws
 *   a zone there (its level, the `depth` filter and the flips; one holding no ghost is never a chip, and a chip
 *   counts what comes back of what it held): a VM removed from a subnet of a bundle closed by hand, the subnet drawn
 *   now in a new bundle (a bundle's members are bundled anew), comes back in the subnet; a network removed from a
 *   project that moved out of a folder drawn as a chip comes back in the project, where it is drawn now. Not in a
 *   zone the earlier day drew as a chip itself that the drawn day draws only as it holds nothing now (a zone with
 *   nothing inside is never a chip): what it held showed as that chip, at the same level and flips.
 * - **What a ghost holds** is only what is gone, or still there and left out where it stood. The ghost of an asset
 *   (removed, or changed) holds what of its children would come back in a container drawn open (above): an asset
 *   removed, or still there that the drawn day leaves out where it stood, changed (a Batch job that succeeded in a
 *   project marked for deletion: a finished job is not drawn) or a zone unchanged itself holding something that
 *   comes back, each with its own reason; and the zones that are no asset (a region or zone, a bundle) around
 *   them (a closed one unless the drawn day's Graph still holds it), which take its reason. An asset still there
 *   that the drawn day draws (a project being deleted is hidden, and what it holds is drawn in its folder) or that a
 *   chip of it holds never comes back inside it: a perimeter removed between the days takes none of the projects
 *   it secured that the drawn day still draws, or holds in a chip, and one it leaves out where it stood (emptied by
 *   removals, under `hideEmptyProjects`) comes back in it not drawn now, around what was removed in it. A zone gone
 *   for what it held (a zone that is no asset, or an asset zone unchanged itself) holds what of its children would
 *   come back in a container drawn open (above), each with its own reason.
 * - **What the ghosts depend on** (`TickDiff.earlier`): every ghost zone and every zone around a ghost on the earlier
 *   day, up to the canvas, with its container, whether it was the view's overlay there (the drawing draws such a
 *   ghost as an overlay, diff/marks.ts) and the state it was drawn in; for a ghost of what the earlier day drew only
 *   inside a chip, its zones in the state they come back in and the zones around it as the drawn day draws them,
 *   which set how deep its zones lie. The disclosure buttons judge by these whether a press keeps the ghosts, since
 *   the drawn day may hold such a zone elsewhere, or not hold the perimeter whose overlay it was.
 * - **Inside chips:** what a collapsed zone holds is not drawn, so a chip counts the added, removed and changed
 *   nodes inside it that the view would draw were it open (the view built with every zone open: detail `all`, no
 *   flips, no `depth` filter; on the drawn day for added and changed nodes, on the earlier day for removed ones).
 *   The extra builds happen only when the Scene has a chip and the days differ; the earlier day's open view alone
 *   also when the earlier day's Scene has a chip and something was removed or changed, since what that day drew
 *   only inside a chip, and the ghost of a chip, are judged by it.
 * - **The chip that holds a node** (`holdingChip`) is found through the zones of the drawn Scene, virtual ones
 *   included: a region zone or a bundle is no Graph container (the Graph holds what lies in it in the zone around
 *   it, drawn open), so the open view that draws the node is walked up by that Scene's own structure, and the first
 *   zone the drawn Scene draws holds it when that zone is such a chip; an asset zone's chip is found by the Graph's
 *   containment. The same chip decides a changed node's count and whether it is a ghost (left out where it stood), so
 *   a node is never both.
 */
import {
  BUNDLE_ID_PREFIX,
  buildSceneWithReport,
  CHIP_COUNT_OF_KIND,
  diffSnapshots,
  flipIdOf,
  isVirtualNode,
} from '@gcportrait/graph';
import {
  normalizeViewSpec,
  type Catalog,
  type ChipCounts,
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

import { collapsedByDefault } from '../disclosure/flips';
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
 * counts, the holding chips and the ghosts of chips read them (the file comment). A drawn Scene with a chip builds
 * both at once, the earlier day's only when something was removed or changed; one without builds the earlier day's
 * only when a ghost of a chip needs it, and no other.
 */
interface OpenViews {
  /** The drawn day's, or null when the drawn Scene has no chip: then no chip holds a node, and none counts. */
  readonly now: SceneIndex | null;
  /** The earlier day's, built on first use. */
  readonly then: () => SceneIndex;
}

function openViews(
  input: TickDiffInput,
  now: SceneIndex,
  diff: { readonly removed: readonly string[]; readonly changed: readonly string[] },
): OpenViews {
  const open = openView(input.spec);
  let earlier: SceneIndex | undefined =
    diff.removed.length === 0 && diff.changed.length === 0 ? NO_SCENE : undefined;
  const then = (): SceneIndex => {
    earlier ??= indexScene(buildOn(input, input.before.graph, open, input.envBefore).scene);
    return earlier;
  };
  if (![...now.nodes.values()].some(isChip)) return { now: null, then };
  const drawn = indexScene(buildOn(input, input.after.graph, open, input.envAfter).scene);
  then();
  return { now: drawn, then };
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
 * The chip of the drawn Scene that holds a node, or null (always when the drawn Scene has no chip): an added node by
 * the drawn day's Graph and open view, a removed one by the earlier day's, a changed one (or one there on both days
 * unchanged) by the drawn day's Graph and the drawn day's open view where that draws it, else the earlier day's.
 */
function chipOf(
  input: TickDiffInput,
  now: SceneIndex,
  open: OpenViews,
  id: string,
  kind: keyof MutableCounts,
): string | null {
  if (open.now === null) return null;
  if (kind === 'added') return holdingChip(input.after.graph, now, open.now, id);
  if (kind === 'removed') return holdingChip(input.before.graph, now, open.then(), id);
  return holdingChip(input.after.graph, now, open.now.nodes.has(id) ? open.now : open.then(), id);
}

/** The chips with changes inside them that the view would draw (see the file comment). */
function insideChips(
  input: TickDiffInput,
  now: SceneIndex,
  open: OpenViews,
  diff: {
    readonly added: readonly string[];
    readonly removed: readonly string[];
    readonly changed: readonly string[];
  },
): Record<string, DiffCounts> {
  const drawn = open.now;
  if (drawn === null) return {};
  const then = open.then();
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
  for (const id of diff.added) if (drawn.nodes.has(id)) count(id, 'added');
  for (const id of diff.changed) {
    if (drawn.nodes.has(id) || then.nodes.has(id)) count(id, 'changed');
  }
  for (const id of diff.removed) if (then.nodes.has(id)) count(id, 'removed');
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

/** A node of the earlier day as it comes back as a ghost, with the ghosts inside it. */
interface Back {
  /** The node as the earlier day drew it. */
  readonly source: SceneNode;
  /** The ghost: the node, holding the ghosts inside it (`inner`) in the place of its children. */
  readonly node: SceneNode;
  readonly reason: GhostReason;
  readonly inner: readonly Back[];
  /** Whether something removed comes back in it, itself included. */
  readonly removed: boolean;
}

/** What comes back of a list of nodes, each by `rule` (in their order, those that do not left out). */
function backs(nodes: readonly SceneNode[], rule: (node: SceneNode) => Back | null): Back[] {
  return nodes.flatMap((node) => {
    const back = rule(node);
    return back === null ? [] : [back];
  });
}

/** What a chip holding the ghosts `ghosts` counts, as the scene builder counts what a chip holds. */
function countsOf(ghosts: readonly Back[]): ChipCounts {
  const counts: ChipCounts = {};
  const visit = (list: readonly Back[]): void => {
    for (const ghost of list) {
      const kind = ghost.node.type === 'card' ? 'resources' : CHIP_COUNT_OF_KIND[ghost.node.kind];
      if (kind !== undefined) counts[kind] = (counts[kind] ?? 0) + 1;
      visit(ghost.inner);
    }
  };
  visit(ghosts);
  return counts;
}

/** The ghosts: the nodes the view drew on the earlier day that it no longer draws (see the file comment). */
function ghostsOf(
  input: TickDiffInput,
  now: SceneIndex,
  open: OpenViews,
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
  // Whether the drawn day's view leaves out an asset still there where it stood: the drawn day's Graph holds it in
  // the container it lay in the day before (it did not move), and no chip of the drawn Scene holds it (a chip that
  // holds it counts what changed of it, so it is never both).
  const leftOut = (id: string): boolean =>
    input.after.graph.containment.parent[id] === input.before.graph.containment.parent[id] &&
    chipOf(input, now, open, id, 'changed') === null;
  // A ghost of `source` with the reason `reason`, holding the ghosts `inner` (a chip holds none: its contents are
  // not drawn); `removedInside` says that a chip held something removed.
  const back = (
    source: SceneNode,
    reason: GhostReason,
    inner: readonly Back[],
    removedInside = false,
  ): Back => ({
    source,
    node: source.type === 'card' ? source : { ...source, children: inner.map((ghost) => ghost.node) },
    reason,
    inner,
    removed: removed.has(source.id) || removedInside || inner.some((ghost) => ghost.removed),
  });
  // What a child of an asset's ghost on the earlier day comes back as inside it (null: nothing): an asset as it would
  // in a container drawn open (`rootOf`: removed, or still there and left out where it stood, changed or a zone
  // holding something that comes back); a zone that is no asset with the reason of the ghost around it, when it holds
  // something that comes back (an open one) or the drawn day's Graph holds no such zone any more (a chip, whose
  // contents the Scene leaves out). An asset still there that the drawn day draws, or that a chip of it holds, never
  // does (`rootOf` and `leftOut`).
  const within = (child: SceneNode, around: GhostReason): Back | null => {
    if (!gone(child.id)) return null;
    if (child.type !== 'zone' || isAsset(child.id)) return rootOf(child);
    if (child.collapsed !== undefined) {
      return Object.hasOwn(input.after.graph.nodes, child.id) ? null : back(child, around, []);
    }
    const inner = backs(child.children, (node) => within(node, around));
    return inner.length === 0 ? null : back(child, around, inner);
  };
  // The ghost of an asset (removed, or changed and left out where it stood), holding what of its children comes
  // back inside it.
  const assetGhost = (node: SceneNode, reason: GhostReason): Back =>
    back(node, reason, node.type === 'zone' ? backs(node.children, (child) => within(child, reason)) : []);
  // What a node of the earlier day that the drawn Scene does not draw comes back as (null: nothing), in a container
  // the drawn Scene draws open, or inside the ghost of an asset or of a zone gone for what it held: a removed
  // asset; an asset still there that the drawn day's view leaves out where it stood, changed (a project marked for
  // deletion: not drawn now), or a zone unchanged itself holding something that comes back (a project emptied by
  // removals under `hideEmptyProjects`: not drawn now); a zone that is no asset (a region or zone, a bundle)
  // holding something that comes back, `removed` when something removed does, else not drawn now.
  const rootOf = (node: SceneNode): Back | null => {
    const { id } = node;
    if (!gone(id)) return null;
    if (removed.has(id)) return assetGhost(node, 'removed');
    if (!isAsset(id)) return goneFor(node, (removedInside) => (removedInside ? 'removed' : 'hidden'));
    if (changed.has(id)) return leftOut(id) ? assetGhost(node, 'hidden') : null;
    return node.type === 'zone' && leftOut(id) ? goneFor(node, () => 'hidden') : null;
  };
  // What comes back of what a chip held, which its Scene leaves out: the ghosts in that zone of the earlier day's
  // view with every zone open (none when that view draws no such zone open).
  const held = (id: string): readonly Back[] => {
    const zone = open.then().nodes.get(id);
    return zone?.type === 'zone' && zone.collapsed === undefined ? backs(zone.children, rootOf) : [];
  };
  // The ghost of a zone gone for what it held, with the reason `reasonOf` gives by whether something removed comes
  // back in it, or null when nothing does: an open one holds what comes back of its children; a chip comes back as
  // the chip it was, counting what comes back of what it held (`held`), since its contents are not drawn.
  const goneFor = (node: SceneNode, reasonOf: (removedInside: boolean) => GhostReason): Back | null => {
    if (node.type !== 'zone') return null;
    const inner = node.collapsed === undefined ? backs(node.children, rootOf) : held(node.id);
    if (inner.length === 0) return null;
    const removedInside = inner.some((ghost) => ghost.removed);
    if (node.collapsed === undefined) return back(node, reasonOf(removedInside), inner);
    const chip = back(node, reasonOf(removedInside), [], removedInside);
    return { ...chip, node: { ...node, collapsed: countsOf(inner) } };
  };
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
  // Each ghost's reason, and each ghost zone as the earlier day drew it.
  const record = (ghost: Back): void => {
    reasons.set(ghost.node.id, ghost.reason);
    keep(ghost.source);
    for (const inner of ghost.inner) record(inner);
  };
  for (const [id, node] of then.nodes) {
    if (!gone(id)) continue;
    const up = then.parent.get(id) ?? null;
    // Its container must be drawn open today (or be the canvas); inside a vanished one it is part of that ghost.
    if (up !== null && !isOpenZone(now.nodes.get(up))) continue;
    const root = rootOf(node);
    if (root === null) continue;
    record(root);
    const list = roots.get(up);
    if (list === undefined) roots.set(up, [root.node]);
    else list.push(root.node);
    // The zones around it there, up to the canvas (or to one kept for another ghost, which holds the rest).
    for (let around = up; around !== null && !zones.has(around); around = then.parent.get(around) ?? null) {
      const zone = then.nodes.get(around);
      if (zone !== undefined) keep(zone);
    }
  }
  if (hasChip(earlier.scene)) folded(input, now, open.then(), then, rootOf, { roots, reasons, zones });
  for (const list of roots.values()) list.sort((a, b) => compare(a.id, b.id));
  return { roots, reasons, zones };
}

/** The ghosts as `ghostsOf` gathers them. */
interface GhostLists {
  readonly roots: Map<string | null, SceneNode[]>;
  readonly reasons: Map<string, GhostReason>;
  readonly zones: Map<string, EarlierZone>;
}

/**
 * The ghosts of what the earlier day's Scene (`then`) drew only inside a chip (see the file comment): judged on the
 * earlier day's open view (`openThen`), a node of it that is not drawn now comes back by `rootOf` in the zone it
 * lies in there, when the drawn Scene draws that zone open, each zone of the ghost open or closed as the drawn
 * day's view draws a zone there; not when the earlier day drew that zone itself as a chip and the drawn day draws
 * it with nothing inside. The ghosts go into `lists`, with the zones around them as the drawn day draws them.
 */
function folded(
  input: TickDiffInput,
  now: SceneIndex,
  openThen: SceneIndex,
  then: SceneIndex,
  rootOf: (node: SceneNode) => Back | null,
  lists: GhostLists,
): void {
  const { roots, reasons, zones } = lists;
  const level = input.report.detail.used;
  const depthLimit = input.spec.filters.depth;
  const flips = new Set(input.spec.flips);
  const overlays = new Set(input.report.overlays.map((overlay) => overlay.zone));
  // How many asset zones of the drawn Scene enclose zone `id` there, itself included (the `depth` filter's measure).
  const depthNow = (id: string): number => {
    let depth = 0;
    for (let at: string | null = id; at !== null; at = now.parent.get(at) ?? null) {
      if (isAsset(at) && !overlays.has(at)) depth += 1;
    }
    return depth;
  };
  // The ghost with each zone in it closed as the drawn day's view closes a zone `above` asset zones deep (its level,
  // the `depth` filter and the flips; a zone holding no ghost is never a chip): a chip counts what comes back of what
  // it held, as the ghost of a chip does.
  const settle = (ghost: Back, above: number): Back => {
    const { source } = ghost;
    if (source.type !== 'zone') return ghost;
    const counted = isAsset(source.id);
    const depth = above + (counted ? 1 : 0);
    const facts = { kind: source.kind, overlay: false, counted, depth, collapsed: false, empty: false };
    const closed =
      ghost.inner.length > 0 &&
      collapsedByDefault(facts, level, depthLimit) !== flips.has(flipIdOf(source.id));
    if (closed) {
      return { ...ghost, node: { ...source, collapsed: countsOf(ghost.inner), children: [] }, inner: [] };
    }
    const inner = ghost.inner.map((child) => settle(child, depth));
    return { ...ghost, node: { ...source, children: inner.map((child) => child.node) }, inner };
  };
  // Each ghost's reason, and each ghost zone as it is drawn, in the zone `parent`.
  const record = (ghost: Back, parent: string): void => {
    const { node } = ghost;
    reasons.set(node.id, ghost.reason);
    if (node.type !== 'zone') return;
    const open = node.collapsed === undefined;
    zones.set(node.id, {
      kind: node.kind,
      parent,
      overlay: false,
      collapsed: !open,
      empty: open && node.children.length === 0,
    });
    for (const inner of ghost.inner) record(inner, node.id);
  };
  for (const [id, node] of openThen.nodes) {
    if (then.nodes.has(id) || now.nodes.has(id)) continue;
    const up = openThen.parent.get(id) ?? null;
    const container = up === null ? undefined : now.nodes.get(up);
    if (up === null || container?.type !== 'zone' || container.collapsed !== undefined) continue;
    // The earlier day drew the zone as a chip, and the drawn day draws it open only as it holds nothing now.
    if (isChip(then.nodes.get(up)) && container.children.length === 0) continue;
    const found = rootOf(node);
    if (found === null) continue;
    const ghost = settle(found, depthNow(up));
    record(ghost, up);
    const list = roots.get(up);
    if (list === undefined) roots.set(up, [ghost.node]);
    else list.push(ghost.node);
    // The zones around it on the drawn day, up to the canvas (or to one kept for another ghost).
    for (
      let around: string | null = up;
      around !== null && !zones.has(around);
      around = now.parent.get(around) ?? null
    ) {
      const zone = now.nodes.get(around);
      if (zone?.type !== 'zone') break;
      zones.set(around, {
        kind: zone.kind,
        parent: now.parent.get(around) ?? null,
        overlay: overlays.has(around),
        collapsed: false,
        empty: zone.children.length === 0,
      });
    }
  }
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
