// SPDX-License-Identifier: MIT
/**
 * Steps (c) and (d) of the scene builder: the lens and the cross-cutting filters (docs/lenses-and-filters.md)
 * turn the focus's part of the universe into the set of visible nodes and the edges drawn between them.
 * Everything here works on whatever the root and the focus left, so the filters apply the same under drill-in
 * and under every focus (filters compose with focus views and drill-in: ADR 0035 §3).
 *
 * 1. Candidates: nodes the lens rules pass (`lens.ts`) whose location, project and folder pass `regions`,
 *    `projects` and `folders`; the focus's anchors always. Folders above a kept node stay as structure when
 *    only the project or folder lists dropped them, so a filtered view keeps its hierarchy.
 * 2. Virtual region zones (`showRegions`) that hold a candidate.
 * 3. Drawn edges: edges of a kind the lens draws between visible nodes; an `attaches` edge to a node's own
 *    container is drawn as nesting, not as an arrow (skill gcp-asset-catalog §4). Under a project focus,
 *    edges from the project to anything outside it are drawn to external stubs (targets the lens rules pass).
 * 4. `hideDisconnected`: cards without a drawn edge go, then containers left with neither a visible child nor
 *    a drawn edge. `hideEmptyProjects`, `hideEmptyFolders`: projects and folders without a visible child go,
 *    recursively; region zones always go when empty. Repeated until nothing changes, so "empty" and
 *    "disconnected" mean empty and disconnected in this view, and applying the filters again changes nothing.
 */
import type { GraphNode, RelationEdge } from '@gcportrait/model';
import { FOLDER_TYPE, ORGANIZATION_TYPE, PROJECT_TYPE, isVirtualNode } from '../structure.js';
import type { FocusSelection } from './focus.js';
import type { LensRules } from './lens.js';
import type { RootSelection } from './root.js';
import { isAncestor, type ViewGraph } from './view-graph.js';

export interface ViewContext {
  readonly vg: ViewGraph;
  readonly root: RootSelection;
  readonly focus: FocusSelection;
  readonly rules: LensRules;
  readonly filters: FilterSettings;
}

/** The filters of a ViewSpec in the form the scene builder uses. */
export interface FilterSettings {
  readonly hideEmptyProjects: boolean;
  readonly hideEmptyFolders: boolean;
  readonly hideDisconnected: boolean;
  /** Lower-cased locations to keep. */
  readonly regions: ReadonlySet<string> | undefined;
  /** Project ids or numbers to keep. */
  readonly projects: ReadonlySet<string> | undefined;
  /** Folder node ids whose subtrees to keep. */
  readonly folders: ReadonlySet<string> | undefined;
}

export interface Visible {
  /** Nodes shown (inside chips included); external stubs are separate. */
  readonly nodes: ReadonlySet<string>;
  /** External stubs of a project focus. */
  readonly stubs: ReadonlySet<string>;
  /** Drawn relations, node to node, in graph order. */
  readonly edges: readonly RelationEdge[];
}

const HIERARCHY = new Set([ORGANIZATION_TYPE, FOLDER_TYPE, PROJECT_TYPE]);
const ZONE = /^([a-z]+-[a-z]+[0-9]+)-[a-z0-9]+$/;

function locationPasses(node: GraphNode, regions: ReadonlySet<string>): boolean {
  if (HIERARCHY.has(node.assetType)) return true;
  const location = node.location?.toLowerCase();
  // No location: nothing to filter on. A global container (a VPC) is structure, not a regional resource.
  if (location === undefined || (location === 'global' && node.role === 'container')) return true;
  if (regions.has(location)) return true;
  const region = ZONE.exec(location)?.[1];
  return region !== undefined && regions.has(region);
}

function projectPasses(node: GraphNode, projects: ReadonlySet<string>): boolean {
  if (node.assetType === FOLDER_TYPE || node.assetType === ORGANIZATION_TYPE) return false;
  return (
    (node.projectId !== undefined && projects.has(node.projectId)) ||
    (node.projectNumber !== undefined && projects.has(node.projectNumber))
  );
}

function folderPasses(vg: ViewGraph, id: string, folders: ReadonlySet<string>): boolean {
  if (folders.has(id)) return true;
  for (let current = vg.parent.get(id); current !== undefined; current = vg.parent.get(current)) {
    if (folders.has(current)) return true;
  }
  return false;
}

/** Whether a node passes the location, project and folder filters. */
export function scopePasses(ctx: ViewContext, id: string, node: GraphNode): boolean {
  const { regions, projects, folders } = ctx.filters;
  return (
    (regions === undefined || locationPasses(node, regions)) &&
    (projects === undefined || projectPasses(node, projects)) &&
    (folders === undefined || folderPasses(ctx.vg, id, folders))
  );
}

/** Whether a node lies in the part of the view the root and the focus kept. */
export function inView(ctx: ViewContext, id: string): boolean {
  return ctx.root.universe.has(id) && (ctx.focus.members?.has(id) ?? true);
}

/** Step 1 and 2: the candidates, the structure that holds them, and the region zones they sit in. */
export function candidates(ctx: ViewContext): Set<string> {
  const { vg, rules, focus } = ctx;
  const visible = new Set<string>();
  for (const [id, node] of vg.nodes) {
    if (focus.anchors.has(id) || (inView(ctx, id) && rules.passes(node) && scopePasses(ctx, id, node))) {
      visible.add(id);
    }
  }
  const lifted = new Set<string>();
  for (const id of [...visible]) {
    for (let current = vg.parent.get(id); current !== undefined; current = vg.parent.get(current)) {
      if (lifted.has(current) || !inView(ctx, current)) break;
      lifted.add(current);
      // Region zones always; folders when the lens rules pass them (the project and folder lists dropped them).
      const node = vg.nodes.get(current);
      if (isVirtualNode(current) || (node?.assetType === FOLDER_TYPE && rules.passes(node))) {
        visible.add(current);
      }
    }
  }
  return visible;
}

/**
 * Edges of a kind the view draws that nesting does not already show: an `attaches` edge to one of the node's
 * own containers, and a perimeter's `secures` edge to a project drawn inside its overlay zone.
 */
export function drawableEdges(ctx: ViewContext): RelationEdge[] {
  const { vg, rules, focus } = ctx;
  return vg.graph.edges.filter(
    (edge) =>
      rules.edgeKinds.has(edge.kind) &&
      !(edge.kind === 'attaches' && isAncestor(vg, edge.to, edge.from)) &&
      focus.sceneParent.get(edge.to) !== edge.from,
  );
}

/** The nearest visible container of a node (or its focus override); undefined at the top level. */
export function sceneParentOf(
  ctx: ViewContext,
  visible: ReadonlySet<string>,
  id: string,
): string | undefined {
  const override = ctx.focus.sceneParent.get(id);
  if (override !== undefined && visible.has(override)) return override;
  for (let current = ctx.vg.parent.get(id); current !== undefined; current = ctx.vg.parent.get(current)) {
    if (visible.has(current)) return current;
  }
  return undefined;
}

function stubsOf(
  ctx: ViewContext,
  visible: ReadonlySet<string>,
  drawable: readonly RelationEdge[],
): Set<string> {
  const inside = ctx.focus.inside;
  const stubs = new Set<string>();
  if (inside === undefined) return stubs;
  for (const edge of drawable) {
    if (!visible.has(edge.from) || inside.has(edge.to)) continue;
    const target = ctx.vg.nodes.get(edge.to);
    if (target !== undefined && ctx.rules.passes(target)) stubs.add(edge.to);
  }
  return stubs;
}

/**
 * Removes zones that end up empty. `removable` decides which empty zones may go; `degree` (when given) keeps
 * a zone that still has a drawn edge. Removing a node never changes another node's container, because only
 * childless nodes go.
 */
function pruneEmpty(
  ctx: ViewContext,
  visible: Set<string>,
  removable: (id: string) => boolean,
  degree?: ReadonlyMap<string, number>,
): boolean {
  const childCount = new Map<string, number>();
  const parents = new Map<string, string>();
  for (const id of visible) {
    const container = sceneParentOf(ctx, visible, id);
    if (container === undefined) continue;
    parents.set(id, container);
    childCount.set(container, (childCount.get(container) ?? 0) + 1);
  }
  const goes = (id: string): boolean =>
    !ctx.focus.anchors.has(id) &&
    ctx.vg.nodes.get(id)?.role === 'container' &&
    (childCount.get(id) ?? 0) === 0 &&
    (degree?.get(id) ?? 0) === 0 &&
    removable(id);
  const queue = [...visible].filter(goes);
  let removed = false;
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    visible.delete(id);
    removed = true;
    const container = parents.get(id);
    if (container === undefined) continue;
    childCount.set(container, (childCount.get(container) ?? 1) - 1);
    if (goes(container)) queue.push(container);
  }
  return removed;
}

/** Steps 3 and 4: drawn edges, stubs, and the hide filters, repeated until nothing changes. */
export function settle(ctx: ViewContext, initial: ReadonlySet<string>): Visible {
  const { vg, filters, focus } = ctx;
  const drawable = drawableEdges(ctx);
  const visible = new Set(initial);
  const typeOf = (id: string): string | undefined => vg.nodes.get(id)?.assetType;
  for (;;) {
    const stubs = stubsOf(ctx, visible, drawable);
    const edges = drawable.filter(
      (edge) => visible.has(edge.from) && (visible.has(edge.to) || stubs.has(edge.to)),
    );
    let changed = false;
    if (filters.hideDisconnected) {
      const degree = new Map<string, number>();
      for (const edge of edges) {
        degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
        degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
      }
      for (const id of [...visible]) {
        const card = vg.nodes.get(id)?.role !== 'container';
        if (card && !focus.anchors.has(id) && (degree.get(id) ?? 0) === 0) {
          visible.delete(id);
          changed = true;
        }
      }
      changed = pruneEmpty(ctx, visible, () => true, degree) || changed;
    }
    changed =
      pruneEmpty(
        ctx,
        visible,
        (id) =>
          isVirtualNode(id) ||
          (filters.hideEmptyProjects && typeOf(id) === PROJECT_TYPE) ||
          (filters.hideEmptyFolders && typeOf(id) === FOLDER_TYPE),
      ) || changed;
    if (!changed) return { nodes: visible, stubs, edges };
  }
}
