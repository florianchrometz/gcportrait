// SPDX-License-Identifier: MIT
/**
 * An independent check of a built scene against the view that asked for it: the composition semantics of the
 * ViewSpec (docs/lenses-and-filters.md, skill gcp-diagram-layout §6), re-derived from the Graph, the ViewSpec
 * and the catalog lens without the scene builder's code. It returns the violations (empty when the scene is
 * right), so a table row or a property can print exactly what went wrong.
 *
 * What it checks, for every view:
 * - the scene and its report are valid and agree (`SceneBuildSchema`);
 * - root: nothing at or above the drill-in root is drawn; everything else lies below it (or is an external
 *   stub, or the focus's anchor);
 * - focus: every drawn node lies in a project the focus selected (application: in the application, or
 *   referenced by it, or a container of such a reference within its project);
 * - lens and type filters: every drawn node's type is in the lens or `includeTypes`, not in `excludeTypes`;
 *   hidden-by-default nodes only with `showHidden` or `includeTypes`, and a hidden type's `hiddenWhen`
 *   matches only with `showHidden`; identities as `showIdentities` says;
 * - location, project and folder filters on every drawn node (a zone counts as its region by `zoneRegion`,
 *   the one zone rule of @gcportrait/model);
 * - edges: only kinds the view draws; every scene edge stands for at least one graph relation between nodes
 *   the scene shows (or chips that hold them; edges from inside a bundle or a region-zone chip are not traced,
 *   as neither is a graph ancestor); an `attaches` edge never points at its node's own container;
 * - `hideEmptyProjects` / `hideEmptyFolders`: no empty project / folder zone; `hideDisconnected`: every card
 *   has an edge, and every empty zone has one too;
 * - `depth`: no open, non-empty asset zone deeper than the limit (unless a flip opened it);
 * - detail: the level used is the one asked for, or `auto`'s choice from the rect counts, never deeper than
 *   the lens's `defaultDetail` (its ceiling) unless the view has at most 100 rects, which opens whole; at
 *   that level no zone of a collapsing kind is open with children (unless flipped or an overlay);
 * - order: every list of siblings is sorted by kind rank, label and id.
 */
import { matchesTypePattern } from '@gcportrait/catalog';
import {
  SceneBuildSchema,
  zoneRegion,
  type Catalog,
  type Graph,
  type GraphNode,
  type RelationKind,
  type SceneBuild,
  type SceneNode,
  type SceneZone,
  type ViewSpec,
} from '@gcportrait/model';
import { ancestorsOf } from '../../src/testing/graph.js';
import { flipIdOf } from '../../src/views/flip.js';

const ORGANIZATION = 'cloudresourcemanager.googleapis.com/Organization';
const FOLDER = 'cloudresourcemanager.googleapis.com/Folder';
const PROJECT = 'cloudresourcemanager.googleapis.com/Project';
const SERVICE_ACCOUNT = 'iam.googleapis.com/ServiceAccount';
const RANK = ['folder', 'project', 'vpc', 'subnet', 'region', 'product-container', 'group'];

function projectNodeOf(graph: Graph, node: GraphNode): string | undefined {
  if (node.assetType === PROJECT) return node.id;
  const number = node.projectNumber;
  return number === undefined ? undefined : `//cloudresourcemanager.googleapis.com/projects/${number}`;
}

interface Drawn {
  readonly node: SceneNode;
  readonly parent: SceneZone | undefined;
  /** Asset zones enclosing it (bundles, region zones and overlays excluded). */
  readonly assetDepth: number;
  readonly stub: boolean;
}

function drawn(build: SceneBuild): Map<string, Drawn> {
  const overlays = new Set(build.report.overlays.map((overlay) => overlay.zone));
  const result = new Map<string, Drawn>();
  const externals = new Set(build.report.external);
  const visit = (
    nodes: readonly SceneNode[],
    parent: SceneZone | undefined,
    depth: number,
    stub: boolean,
  ): void => {
    for (const node of nodes) {
      const external = externals.has(node.id);
      result.set(node.id, { node, parent, assetDepth: depth, stub: stub || external });
      if (node.type === 'zone') {
        const counted = node.kind !== 'group' && node.kind !== 'region' && !overlays.has(node.id);
        visit(node.children, node, counted ? depth + 1 : depth, stub || external);
      }
    }
  };
  visit(build.scene.children, undefined, 0, false);
  return result;
}

function rankOf(node: SceneNode): number {
  return node.type === 'card' ? RANK.length : RANK.indexOf(node.kind);
}

function compareSiblings(a: SceneNode, b: SceneNode): number {
  const byRank = rankOf(a) - rankOf(b);
  if (byRank !== 0) return byRank;
  if (a.label !== b.label) return a.label < b.label ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** Every way the scene breaks the view's semantics; empty when it does not. */
export function violations(graph: Graph, spec: ViewSpec, catalog: Catalog, build: SceneBuild): string[] {
  const problems: string[] = [];
  const fail = (message: string): void => {
    if (problems.length < 25) problems.push(message);
  };
  const parsed = SceneBuildSchema.safeParse(build);
  if (!parsed.success)
    return parsed.error.issues.map((issue) => `schema: ${issue.path.join('.')} ${issue.message}`);

  const { scene, report } = build;
  const lens = catalog.lenses[spec.lens];
  const filters = spec.filters;
  const shown = drawn(build);
  const graphNode = (id: string): GraphNode | undefined => graph.nodes[id];
  const anchor = report.focus?.status === 'applied' ? report.focus.anchor : undefined;
  const anchors = new Set(
    report.focus?.status === 'applied' &&
      (report.focus.kind === 'perimeter' || report.focus.kind === 'application') &&
      anchor !== undefined
      ? [anchor]
      : [],
  );

  // Root.
  const root = report.root.used;
  if (spec.root !== undefined && root === undefined && report.root.error === undefined)
    fail('root: refused without a reason');
  const canvas = new Set(
    root !== undefined
      ? [root, ...ancestorsOf(graph, root)]
      : Object.values(graph.nodes)
          .filter(
            (node) => node.assetType === ORGANIZATION && graph.containment.parent[node.id] === undefined,
          )
          .map((node) => node.id),
  );
  const below = (id: string): boolean =>
    root === undefined ? !canvas.has(id) : ancestorsOf(graph, id).includes(root);

  // Focus.
  const focus = report.focus;
  const projects = focus?.status === 'applied' ? new Set(focus.projects) : undefined;
  const holdsRoot =
    root !== undefined &&
    projects !== undefined &&
    [...projects].some((p) => p === root || ancestorsOf(graph, root).includes(p));
  const application =
    focus?.status === 'applied' && focus.kind === 'application' && anchor !== undefined ? anchor : undefined;
  const inApplication = (id: string): boolean => {
    if (application === undefined) return true;
    if (id === application || ancestorsOf(graph, id).includes(application)) return true;
    const referenced = graph.edges.filter(
      (edge) =>
        edge.kind !== 'shares' &&
        (edge.from === application || ancestorsOf(graph, edge.from).includes(application)) &&
        (edge.to === id || ancestorsOf(graph, edge.to).includes(id)),
    );
    return referenced.length > 0;
  };

  // Lens.
  const matches = (patterns: readonly string[] | undefined, type: string): boolean =>
    patterns?.some((pattern) => matchesTypePattern(pattern, type)) === true;
  const kinds = new Set<RelationKind>(lens.relationKinds.filter((kind) => kind !== 'contains'));
  if (filters.showIdentities === true) kinds.add('runsAs');
  if (filters.showIdentities === false) kinds.delete('runsAs');

  const regions = filters.regions?.map((region) => region.toLowerCase());
  const folderIds = filters.folders?.map(
    (folder) => `//cloudresourcemanager.googleapis.com/folders/${folder}`,
  );

  for (const [id, { node, stub }] of shown) {
    if (node.type === 'zone' && (node.kind === 'region' || node.kind === 'group')) continue;
    const gnode = graphNode(id);
    if (gnode === undefined) {
      fail(`${id}: not a graph node`);
      continue;
    }
    const isAnchor = anchors.has(id);
    if (!stub && !isAnchor && !below(id)) fail(`${id}: drawn outside the drill-in root`);
    if (canvas.has(id)) fail(`${id}: the canvas is drawn`);

    // Type-level rules apply to stubs too.
    if (!isAnchor) {
      const included = matches(filters.includeTypes, gnode.assetType);
      if (matches(filters.excludeTypes, gnode.assetType))
        fail(`${id}: excluded type ${gnode.assetType} drawn`);
      if (gnode.assetType === SERVICE_ACCOUNT && filters.showIdentities === false)
        fail(`${id}: identity drawn`);
      const identityShown = gnode.assetType === SERVICE_ACCOUNT && filters.showIdentities === true;
      if (!identityShown && !included && !matches(lens.types, gnode.assetType)) {
        fail(`${id}: type ${gnode.assetType} is not in lens ${spec.lens}`);
      }
      const predicateHidden = gnode.role === 'hidden' && gnode.hiddenWhenMatched === true;
      if (!identityShown && gnode.hidden && !lens.showHidden && (!included || predicateHidden))
        fail(`${id}: hidden node drawn`);
    }
    if (stub || isAnchor) continue;

    // Focus membership.
    if (projects !== undefined && !holdsRoot) {
      const project = projectNodeOf(graph, gnode);
      if (application !== undefined) {
        if (!inApplication(id)) fail(`${id}: not part of the application`);
      } else if (project === undefined || !projects.has(project)) {
        fail(`${id}: outside the focus projects`);
      }
    }

    // Location, project and folder filters.
    const hierarchy = gnode.assetType === FOLDER || gnode.assetType === PROJECT;
    if (regions !== undefined && !hierarchy) {
      const location = gnode.location?.toLowerCase();
      const structural = location === undefined || (location === 'global' && gnode.role === 'container');
      const region = location === undefined ? undefined : zoneRegion(location);
      if (!structural && !regions.includes(location) && (region === undefined || !regions.includes(region))) {
        fail(`${id}: location ${location} not in ${regions.join(',')}`);
      }
    }
    if (filters.projects !== undefined && gnode.assetType !== FOLDER) {
      const inList = [gnode.projectId, gnode.projectNumber].some(
        (ref) => ref !== undefined && filters.projects?.includes(ref),
      );
      if (!inList) fail(`${id}: not in the projects ${filters.projects.join(',')}`);
    }
    if (folderIds !== undefined) {
      const chain = [id, ...ancestorsOf(graph, id)];
      const under = folderIds.some((folder) => chain.includes(folder));
      const above =
        gnode.assetType === FOLDER && folderIds.some((folder) => ancestorsOf(graph, folder).includes(id));
      if (!under && !above) fail(`${id}: outside the folders ${filters.folders?.join(',') ?? ''}`);
    }
  }

  // Edges.
  const chipOf = (id: string): string | undefined => {
    if (shown.has(id)) return id;
    for (const ancestor of ancestorsOf(graph, id)) {
      const entry = shown.get(ancestor);
      if (entry?.node.type === 'zone' && entry.node.collapsed !== undefined) return ancestor;
    }
    return undefined;
  };
  for (const edge of scene.edges) {
    if (!kinds.has(edge.kind))
      fail(`edge ${edge.kind} ${edge.from} → ${edge.to}: kind not drawn by the view`);
    const standsFor = graph.edges.some((relation) => {
      if (relation.kind !== edge.kind) return false;
      const from = chipOf(relation.from);
      const to = chipOf(relation.to);
      return (
        (from === edge.from && to === edge.to) ||
        (edge.kind === 'peers' && from === edge.to && to === edge.from)
      );
    });
    // An attachment to one of the node's own containers is drawn as nesting, never as an arrow.
    if (edge.kind === 'attaches') {
      for (
        let parent = shown.get(edge.from)?.parent;
        parent !== undefined;
        parent = shown.get(parent.id)?.parent
      ) {
        if (parent.id === edge.to)
          fail(`edge attaches ${edge.from} → ${edge.to}: drawn to its own container`);
      }
    }
    // Bundles and virtual region zones are not graph ancestors, so a chip of one cannot be traced here.
    const synthetic = [edge.from, edge.to].some(
      (end) => end.startsWith('group:') || end.startsWith('//gcportrait.virtual/'),
    );
    if (!standsFor && !synthetic) fail(`edge ${edge.kind} ${edge.from} → ${edge.to}: stands for no relation`);
  }

  // Hide filters.
  const degree = new Map<string, number>();
  for (const edge of scene.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  for (const [id, { node, stub }] of shown) {
    const empty = node.type === 'zone' && node.collapsed === undefined && node.children.length === 0;
    const type = graphNode(id)?.assetType;
    if (!stub && empty && filters.hideEmptyProjects && type === PROJECT && !anchors.has(id))
      fail(`${id}: empty project drawn`);
    if (empty && filters.hideEmptyFolders && type === FOLDER && !anchors.has(id))
      fail(`${id}: empty folder drawn`);
    if (
      filters.hideDisconnected &&
      !anchors.has(id) &&
      (node.type === 'card' || empty) &&
      (degree.get(id) ?? 0) === 0
    ) {
      fail(`${id}: disconnected ${node.type} drawn`);
    }
  }

  // Depth, detail level and flips.
  const flipped = new Set(spec.flips);
  const overlays = new Set(report.overlays.map((overlay) => overlay.zone));
  const opened = (zone: SceneZone): boolean => flipped.has(flipIdOf(zone.id));
  for (const entry of shown.values()) {
    const { node } = entry;
    if (node.type !== 'zone' || node.collapsed !== undefined || node.children.length === 0) continue;
    if (opened(node)) continue;
    const counted = node.kind !== 'group' && node.kind !== 'region' && !overlays.has(node.id);
    if (filters.depth !== undefined && counted && entry.assetDepth + 1 > filters.depth) {
      fail(`${node.id}: open below the depth limit ${String(filters.depth)}`);
    }
    const level = report.detail.used;
    const collapsing =
      level === 'folders'
        ? node.kind !== 'folder' && node.kind !== 'group' && !overlays.has(node.id)
        : level === 'projects'
          ? ['vpc', 'subnet', 'product-container'].includes(node.kind) && !overlays.has(node.id)
          : level === 'networks' && node.kind === 'product-container' && !overlays.has(node.id);
    if (collapsing) fail(`${node.id}: a ${node.kind} is open at detail level ${level}`);
  }
  const { requested, used, rectCounts, budget, ceiling } = report.detail;
  const levels = ['all', 'networks', 'projects', 'folders'] as const;
  const lensCeiling = lens.defaultDetail === 'auto' ? 'all' : lens.defaultDetail;
  if (ceiling !== lensCeiling) fail(`detail: ceiling ${ceiling}, the lens opens at ${lens.defaultDetail}`);
  if (requested !== 'auto' && used !== requested) fail(`detail: asked for ${requested}, used ${used}`);
  if (requested === 'auto') {
    const fits = levels.find((level) => rectCounts[level] <= budget) ?? 'folders';
    // At most 100 rects: whole, whatever the ceiling; else the shallower of the two (the later in `levels`).
    const expected =
      rectCounts.all <= 100 ? 'all' : levels.indexOf(fits) > levels.indexOf(lensCeiling) ? fits : lensCeiling;
    if (used !== expected) fail(`detail: auto used ${used}, expected ${expected}`);
  }

  // Order of siblings (bundles keep their members' order).
  const checkOrder = (nodes: readonly SceneNode[], where: string): void => {
    for (let index = 1; index < nodes.length; index += 1) {
      const previous = nodes[index - 1];
      const current = nodes[index];
      if (previous === undefined || current === undefined) continue;
      if (previous.type === 'zone' && previous.kind === 'group') continue;
      if (compareSiblings(previous, current) > 0)
        fail(`order: ${previous.id} before ${current.id} in ${where}`);
    }
    for (const node of nodes) if (node.type === 'zone') checkOrder(node.children, node.id);
  };
  checkOrder(scene.children, 'the top level');
  return problems;
}
