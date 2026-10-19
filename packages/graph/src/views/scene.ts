// SPDX-License-Identifier: Apache-2.0
/**
 * The scene builder (docs/packages.md, docs/lenses-and-filters.md): Graph + ViewSpec → Scene. Pure and
 * deterministic: the same graph, view and catalog always give a deep-equal scene, whatever the order of the
 * graph's records. The steps compose in this order, and each works on what the previous left:
 *
 *  (a) root: a drill-in re-roots the view at a container; the organisation (or the root) is the canvas;
 *  (b) focus: one project, a Shared VPC, standalone projects, a perimeter or an application;
 *  (c) lens: the catalog lens's types and relation kinds, `includeTypes`, `excludeTypes`, `showIdentities`;
 *  (d) filters: regions, projects, folders, then hide-disconnected and hide-empty until nothing changes;
 *      virtual region zones with `showRegions`;
 *  (e) detail: level (or `auto` against the budget), `depth`, flips → chips; edges re-targeted to chips;
 *      large flat sets bundled;
 *  (f) selection and highlight passed through, with where the scene shows them.
 *
 * Problems with the view (an unknown root, a focus parameter that names nothing) never throw: the view falls
 * back and the report says why.
 *
 * Steps (a)–(d), the scene tree and its badges do not depend on the view's detail level, flips, `depth` filter,
 * selection or highlight: {@link prepareView} does them once, and {@link buildPreparedScene} finishes any view
 * that differs from the prepared one only in those (a timeline step's open view, a chip expanded).
 */
import type {
  Catalog,
  CatalogZoneKind,
  Graph,
  Scene,
  SceneBuild,
  SceneEnv,
  SceneNode,
  ScenePointer,
  SceneReport,
  ViewFilters,
  ViewSpec,
  ZoneKind,
} from '@gcportrait/model';
import { RelationKindSchema, ZoneKindSchema } from '@gcportrait/model';
import { compareStrings } from '../order.js';
import { deriveSharedVpc } from '../shared-vpc.js';
import { DEFAULT_VIEWPORT_BUDGET } from './constants.js';
import { autoCeiling, disclose } from './detail.js';
import { emitEdges, emitNodes } from './emit.js';
import {
  candidates,
  inView,
  sceneParentOf,
  scopePasses,
  settle,
  type FilterSettings,
  type ViewContext,
  type Visible,
} from './filters.js';
import { selectFocus } from './focus.js';
import { lensRules } from './lens.js';
import { selectRoot } from './root.js';
import { sceneTree, type SceneTree } from './tree.js';
import { viewGraph, type ViewGraph } from './view-graph.js';

function filterSettings(filters: ViewFilters): FilterSettings {
  const set = (
    values: readonly string[] | undefined,
    map: (value: string) => string,
  ): Set<string> | undefined => (values === undefined ? undefined : new Set(values.map(map)));
  return {
    hideEmptyProjects: filters.hideEmptyProjects,
    hideEmptyFolders: filters.hideEmptyFolders,
    hideDisconnected: filters.hideDisconnected,
    regions: set(filters.regions, (region) => region.toLowerCase()),
    projects: set(filters.projects, (project) => project),
    folders: set(filters.folders, (folder) => `//cloudresourcemanager.googleapis.com/folders/${folder}`),
  };
}

/**
 * Host-side subnet or network → how many other projects attach to it (the "shared with N" badge), by the
 * builder's own Shared VPC rule (`deriveSharedVpc`) over the graph's `attaches` edges.
 */
function sharedWithCounts(vg: ViewGraph, catalog: Catalog): ReadonlyMap<string, number> {
  const attaches = vg.graph.edges.flatMap((edge) =>
    edge.kind === 'attaches'
      ? [{ from: edge.from, to: edge.to, kind: edge.kind, weak: edge.weak === true }]
      : [],
  );
  const zoneKindOf = (id: string): CatalogZoneKind | undefined => {
    const assetType = vg.nodes.get(id)?.assetType;
    return assetType !== undefined && Object.hasOwn(catalog.types, assetType)
      ? catalog.types[assetType]?.zoneKind
      : undefined;
  };
  return deriveSharedVpc(attaches, vg.nodes, zoneKindOf).sharedWith;
}

/** Hidden-by-default nodes the lens would show, counted at their nearest visible zone. */
function heldBack(ctx: ViewContext, visible: Visible): { byZone: Map<string, number>; total: number } {
  const byZone = new Map<string, number>();
  let total = 0;
  for (const [id, node] of ctx.vg.nodes) {
    if (
      visible.nodes.has(id) ||
      !inView(ctx, id) ||
      !ctx.rules.heldBack(node) ||
      !scopePasses(ctx, id, node)
    ) {
      continue;
    }
    total += 1;
    const zone = sceneParentOf(ctx, visible.nodes, id);
    if (zone !== undefined) byZone.set(zone, (byZone.get(zone) ?? 0) + 1);
  }
  return { byZone, total };
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

interface Tally {
  zones: number;
  cards: number;
  chips: number;
  bundles: number;
  kinds: Set<ZoneKind>;
}

function tally(nodes: readonly SceneNode[], into: Tally): Tally {
  for (const node of nodes) {
    if (node.type === 'card') {
      into.cards += 1;
      continue;
    }
    into.zones += 1;
    into.kinds.add(node.kind);
    if (node.collapsed !== undefined) into.chips += 1;
    if (node.kind === 'group') into.bundles += 1;
    tally(node.children, into);
  }
  return into;
}

function pointer(
  vg: ViewGraph,
  value: string | undefined,
  shownAs: ReadonlyMap<string, string>,
): ScenePointer | undefined {
  if (value === undefined) return undefined;
  const shown = shownAs.get(value);
  return {
    value,
    ...(vg.nodes.has(value) ? { node: value } : {}),
    ...(shown === undefined ? {} : { shownAs: shown }),
  };
}

function badgesOf(
  vg: ViewGraph,
  catalog: Catalog,
  tree: SceneTree,
  held: ReadonlyMap<string, number>,
): (id: string) => string[] {
  const sharedWith = sharedWithCounts(vg, catalog);
  return (id) => {
    const badges: string[] = [];
    const entry = tree.entries.get(id);
    if (entry?.type === 'zone' && entry.external) badges.push('external');
    const shared = sharedWith.get(id);
    if (shared !== undefined) badges.push(`shared with ${plural(shared, 'project')}`);
    const hidden = held.get(id);
    if (hidden !== undefined) badges.push(`${String(hidden)} hidden`);
    const members = tree.bundles.get(id);
    if (members !== undefined) badges.push(plural(members, 'item'));
    return badges;
  };
}

/** Steps (a)–(c) and the filter settings of (d): everything the filter stage works with. */
export function viewContext(graph: Graph, spec: ViewSpec, catalog: Catalog, env: SceneEnv): ViewContext {
  const vg = viewGraph(graph, spec.filters.showRegions ?? env.showRegions ?? false);
  const root = selectRoot(vg, spec.root, env);
  return {
    vg,
    root,
    focus: selectFocus(vg, root, spec),
    rules: lensRules(catalog, spec),
    filters: filterSettings(spec.filters),
  };
}

/**
 * A view prepared up to its detail level: steps (a)–(d), the scene tree, what the lens holds back and the
 * zones' badges. It serves every view whose {@link preparedViewKey} is its `key` on the same Graph: views that
 * differ only in detail level, flips, `depth` filter, selection, highlight, snapshot ref, timeline tick, read time or
 * `auto` budget. Read-only: the Scenes built from it share some of its objects, and nothing may mutate one.
 */
export interface PreparedView {
  readonly graph: Graph;
  readonly key: string;
  readonly ctx: ViewContext;
  readonly visible: Visible;
  readonly tree: SceneTree;
  readonly held: { readonly byZone: ReadonlyMap<string, number>; readonly total: number };
  readonly badges: (id: string) => string[];
}

/**
 * What a preparation depends on, as a string: the view's lens, focus, root and filters (but `depth`), and the root
 * label and region setting of the environment. Two views with the same key on the same Graph and catalog share
 * one preparation.
 */
export function preparedViewKey(spec: ViewSpec, env: SceneEnv): string {
  const filters: Partial<ViewFilters> = { ...spec.filters };
  delete filters.depth;
  const canonicalFocus =
    spec.focus === undefined
      ? null
      : {
          kind: spec.focus.kind,
          params: Object.fromEntries(
            Object.entries(spec.focus.params as Record<string, unknown>)
              .filter(([, v]) => v !== undefined)
              .sort(([a], [b]) => compareStrings(a, b)),
          ),
        };
  return JSON.stringify([
    spec.lens,
    canonicalFocus,
    spec.root ?? null,
    Object.entries(filters as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => compareStrings(a, b)),
    env.rootLabel ?? null,
    env.showRegions ?? null,
  ]);
}

/** Prepares view `spec` on `graph` (see {@link PreparedView}). */
export function prepareView(graph: Graph, spec: ViewSpec, catalog: Catalog, env: SceneEnv): PreparedView {
  const ctx = viewContext(graph, spec, catalog, env);
  const visible = settle(ctx, candidates(ctx));
  const tree = sceneTree(ctx, catalog, visible);
  const held = heldBack(ctx, visible);
  return {
    graph,
    key: preparedViewKey(spec, env),
    ctx,
    visible,
    tree,
    held,
    badges: badgesOf(ctx.vg, catalog, tree, held.byZone),
  };
}

/** Builds the scene of a view and the report that goes with it (`SceneBuildSchema` in `@gcportrait/model`). */
export function buildSceneWithReport(
  graph: Graph,
  spec: ViewSpec,
  catalog: Catalog,
  env: SceneEnv,
): SceneBuild {
  return buildPreparedScene(prepareView(graph, spec, catalog, env), spec, env);
}

/**
 * Builds the scene and report of view `spec` from a preparation that serves it (the same {@link preparedViewKey}):
 * exactly what {@link buildSceneWithReport} builds for it. Throws when the preparation is another view's.
 */
export function buildPreparedScene(prepared: PreparedView, spec: ViewSpec, env: SceneEnv): SceneBuild {
  if (preparedViewKey(spec, env) !== prepared.key) {
    throw new Error('buildPreparedScene: the view was prepared for another lens, focus, root or filters.');
  }
  const { ctx, visible, tree, held } = prepared;
  const { vg, root, focus } = ctx;
  const disclosure = disclose(
    tree,
    spec.detail,
    spec.filters.depth,
    spec.flips,
    env.viewportBudget ?? DEFAULT_VIEWPORT_BUDGET,
    autoCeiling(ctx.rules.lens.defaultDetail),
  );
  const { children, shownAs } = emitNodes(tree, disclosure, prepared.badges);
  const edges = emitEdges(visible.edges, shownAs);
  const counted = tally(children, { zones: 0, cards: 0, chips: 0, bundles: 0, kinds: new Set() });
  const scene: Scene = {
    children,
    edges,
    metadata: {
      rootLabel: root.label,
      lens: spec.lens,
      readTime: env.readTime,
      rectCount: counted.zones + counted.cards,
      // A refused focus or root travels with the scene too, so a caller that keeps only the Scene can say so.
      ...(focus.outcome?.status === 'error' ? { focusError: focus.outcome.error } : {}),
      ...(root.outcome.error === undefined ? {} : { rootError: root.outcome.error }),
    },
  };

  const edgeKinds = new Set(edges.map((edge) => edge.kind));
  const external = [...shownAs]
    .filter(([id, shown]) => id === shown && tree.entries.get(id)?.external === true)
    .map(([id]) => id)
    .sort(compareStrings);
  const overlay = focus.overlay !== undefined && shownAs.has(focus.overlay) ? focus.overlay : undefined;
  const warnings = [...focus.warnings];
  if (root.outcome.error !== undefined) warnings.unshift(root.outcome.error.message);
  if (disclosure.unknownFlips.length > 0) {
    warnings.push(`${plural(disclosure.unknownFlips.length, 'flip')} match no zone of this view.`);
  }
  const members = focus.members;
  const selection = pointer(vg, spec.selection, shownAs);
  const highlight = pointer(vg, spec.highlight, shownAs);
  const report: SceneReport = {
    root: root.outcome,
    ...(focus.outcome === undefined ? {} : { focus: focus.outcome }),
    detail: {
      requested: disclosure.requested,
      used: disclosure.used,
      budget: disclosure.budget,
      ceiling: disclosure.ceiling,
      rectCounts: { ...disclosure.rectCounts },
    },
    legend: {
      zoneKinds: ZoneKindSchema.options.filter((kind) => counted.kinds.has(kind)),
      edgeKinds: RelationKindSchema.options.filter((kind) => edgeKinds.has(kind)),
      collapsed: counted.chips > 0,
      external: external.length > 0,
      overlay: overlay !== undefined,
    },
    overlays: overlay === undefined ? [] : [{ zone: overlay, kind: 'secures' }],
    external,
    ...(selection === undefined ? {} : { selection }),
    ...(highlight === undefined ? {} : { highlight }),
    unknownFlips: [...disclosure.unknownFlips],
    warnings,
    counts: {
      universe: root.universe.size,
      focus:
        members === undefined
          ? root.universe.size
          : [...members].filter((id) => root.universe.has(id)).length,
      visible: visible.nodes.size,
      stubs: visible.stubs.size,
      held: held.total,
      zones: counted.zones,
      cards: counted.cards,
      chips: counted.chips,
      bundles: counted.bundles,
      edges: edges.length,
      relations: edges.reduce((sum, edge) => sum + (edge.count ?? 1), 0),
      dangling: vg.graph.dangling.filter((edge) => visible.nodes.has(edge.from)).length,
    },
  };
  return { scene, report };
}

/**
 * Builds the Scene of a view (`SceneSchema` in `@gcportrait/model`): what `packages/layout` lays out. See
 * {@link buildSceneWithReport} for the report (root and focus outcome, detail level used, legend, warnings).
 */
export function buildScene(graph: Graph, spec: ViewSpec, catalog: Catalog, env: SceneEnv): Scene {
  return buildSceneWithReport(graph, spec, catalog, env).scene;
}
