// SPDX-License-Identifier: Apache-2.0
/**
 * The details of one node for the drawer, worked out where the Graph, the snapshot's
 * assets and the catalog are: the data worker (diagram/pipeline/dataHandler.ts answers `details` requests with
 * {@link nodeDetails}). Pure: the same Graph, assets and catalog give the same details.
 *
 * Everything comes from data that already exists: the Graph's node (label, product, project, location, the
 * catalog's addresses and domains), its containment, its relation edges and dangling references, the asset's
 * `resource.data`, the catalog's zone kinds (which container is a VPC network) and its console templates
 * through the engine's `consoleLinkFor`, the one place a console URL is built. Nothing here keeps a list of
 * asset types of its own.
 */
import { consoleLinkFor, type RuleContext } from '@gcportrait/catalog';
import { isVirtualNode, projectNodeId } from '@gcportrait/graph';
import {
  RELATION_KIND_IDS,
  type Asset,
  type Catalog,
  type Graph,
  type ProjectIndex,
  type RelationEdge,
  type RelationKind,
} from '@gcportrait/model';

import { cardTypeName } from '../diagram/names';
import { isRecord } from '../guards';
import type {
  DanglingEntry,
  LabelEntry,
  NodeDetails,
  NodeRef,
  RelationDirection,
  RelationEntry,
  RelationGroup,
} from './types';

/** How many children of a container the `contains` group lists (the rest are counted). */
export const CHILDREN_CAP = 100;

/** What the details are worked out from: the Graph, the snapshot's assets by name and its project index. */
export interface DetailsSource {
  readonly graph: Graph;
  readonly assets: ReadonlyMap<string, Asset>;
  readonly ctx: RuleContext;
}

const DIRECTION_RANK: Readonly<Record<RelationDirection, number>> = { out: 0, both: 1, in: 2 };

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A reference to another node of the Graph, or a bare id when the Graph does not hold it. */
export function nodeRef(graph: Graph, id: string): NodeRef {
  const node = Object.hasOwn(graph.nodes, id) ? graph.nodes[id] : undefined;
  if (node === undefined) return { id, label: id.slice(id.lastIndexOf('/') + 1) || id, typeName: '' };
  return { id, label: node.label, typeName: cardTypeName(node.product, node.assetType) };
}

/**
 * The relations of a node, grouped by kind in the model's order: its children (`contains`, capped), then every
 * relation edge it is an end of. In each group the outgoing relations come first, then `peers`, then the
 * incoming ones, each by label and id. A target that sits directly in a VPC network (a subnet) names that
 * network as `via`.
 */
export function groupRelations(
  graph: Graph,
  id: string,
  catalog: Pick<Catalog, 'types'>,
  cap: number = CHILDREN_CAP,
): RelationGroup[] {
  const groups = new Map<RelationKind, RelationEntry[]>();
  const add = (kind: RelationKind, entry: RelationEntry): void => {
    const list = groups.get(kind);
    if (list === undefined) groups.set(kind, [entry]);
    else list.push(entry);
  };
  const viaOf = (target: string): NodeRef | undefined => {
    const up = graph.containment.parent[target];
    if (up === undefined || up === id) return undefined;
    const container = graph.nodes[up];
    const type = container === undefined ? undefined : catalog.types[container.assetType];
    return type?.zoneKind === 'vpc' ? nodeRef(graph, up) : undefined;
  };
  const entry = (direction: RelationDirection, other: string, edge?: RelationEdge): RelationEntry => {
    const via = viaOf(other);
    return {
      direction,
      target: nodeRef(graph, other),
      ...(via === undefined ? {} : { via }),
      ...(edge?.weak === true ? { weak: true as const } : {}),
    };
  };

  const children = graph.containment.children[id] ?? [];
  for (const child of children) add('contains', entry('out', child));
  for (const edge of graph.edges) {
    if (edge.from !== id && edge.to !== id) continue;
    const out = edge.from === id;
    const direction: RelationDirection = edge.kind === 'peers' ? 'both' : out ? 'out' : 'in';
    add(edge.kind, entry(direction, out ? edge.to : edge.from, edge));
  }

  const ordered: RelationGroup[] = [];
  for (const kind of RELATION_KIND_IDS) {
    const list = groups.get(kind);
    if (list === undefined) continue;
    list.sort(
      (a, b) =>
        DIRECTION_RANK[a.direction] - DIRECTION_RANK[b.direction] ||
        compare(a.target.label.toLowerCase(), b.target.label.toLowerCase()) ||
        compare(a.target.id, b.target.id),
    );
    const kept = kind === 'contains' ? list.slice(0, cap) : list;
    ordered.push({ kind, entries: kept, more: list.length - kept.length });
  }
  return ordered;
}

function knownProject(ref: string, projects: ProjectIndex): boolean {
  return Object.hasOwn(projects.numberById, ref) || Object.hasOwn(projects.idByNumber, ref);
}

/** Why a dangling reference names nothing, for the drawer's short explanation. */
export function danglingEntry(edge: RelationEdge, projects: ProjectIndex): DanglingEntry {
  const raw = edge.dangling?.raw ?? edge.to;
  const base = { kind: edge.kind, to: edge.to, raw };
  if (edge.to.startsWith('//')) {
    const project = /\/projects\/([^/]+)/.exec(edge.to)?.[1];
    if (project !== undefined && !knownProject(project, projects)) {
      return { ...base, reason: 'outside-project', project };
    }
    return { ...base, reason: 'missing' };
  }
  if (edge.to.includes('@')) return { ...base, reason: 'identity' };
  return { ...base, reason: 'unreadable' };
}

/** The resource's labels: `data.labels` and GKE's `data.resourceLabels`, string values only, by key. */
export function labelsOf(data: unknown): LabelEntry[] {
  if (!isRecord(data)) return [];
  const labels = new Map<string, string>();
  for (const field of ['labels', 'resourceLabels']) {
    const value = data[field];
    if (!isRecord(value)) continue;
    for (const [key, text] of Object.entries(value)) {
      if (typeof text === 'string' && !labels.has(key)) labels.set(key, text);
    }
  }
  return [...labels].map(([key, value]) => ({ key, value })).sort((a, b) => compare(a.key, b.key));
}

/** The resource's plain tag lists: Compute's network tags (`data.tags.items`) or a `data.tags` list. */
export function tagsOf(data: unknown): string[] {
  if (!isRecord(data)) return [];
  const tags = data['tags'];
  const list = isRecord(tags) ? tags['items'] : tags;
  if (!Array.isArray(list)) return [];
  const strings = list.filter((item): item is string => typeof item === 'string' && item !== '');
  return [...new Set(strings)].sort(compare);
}

/**
 * The drawer's details of node `id`, or null when the Graph holds no such node (a bundle the scene builder
 * draws around many projects is a zone of the Scene, not a node of the Graph). `types` is the catalog's type
 * table (a test may strip a console template from it).
 */
export function nodeDetails(
  source: DetailsSource,
  id: string,
  types: Pick<Catalog, 'types'>,
): NodeDetails | null {
  const { graph } = source;
  const node = Object.hasOwn(graph.nodes, id) ? graph.nodes[id] : undefined;
  if (node === undefined) return null;
  const asset = source.assets.get(id);
  const parentId = graph.containment.parent[id];
  const projectNode = node.projectNumber === undefined ? undefined : projectNodeId(node.projectNumber);
  const project =
    node.projectId === undefined && node.projectNumber === undefined
      ? undefined
      : {
          ...(node.projectId === undefined ? {} : { id: node.projectId }),
          ...(node.projectNumber === undefined ? {} : { number: node.projectNumber }),
          ...(projectNode !== undefined && Object.hasOwn(graph.nodes, projectNode)
            ? { node: projectNode }
            : {}),
        };
  const link = asset === undefined ? undefined : consoleLinkFor(asset, types, source.ctx);
  const data = asset?.data;
  return {
    id,
    label: node.label,
    ...(node.subtitle === undefined ? {} : { subtitle: node.subtitle }),
    assetType: node.assetType,
    typeName: cardTypeName(node.product, node.assetType),
    product: node.product,
    role: node.role,
    drillable: node.role === 'container' && !isVirtualNode(id),
    hidden: node.hidden,
    ...(parentId === undefined ? {} : { parent: nodeRef(graph, parentId) }),
    ...(project === undefined ? {} : { project }),
    ...(node.location === undefined ? {} : { location: node.location }),
    ips: [...node.ips],
    domains: [...node.domains],
    labels: labelsOf(data),
    tags: tagsOf(data),
    relations: groupRelations(graph, id, types),
    dangling: graph.dangling
      .filter((edge) => edge.from === id)
      .map((edge) => danglingEntry(edge, source.ctx.projects)),
    ...(link === undefined ? {} : { console: link }),
    ...(asset === undefined ? {} : { updateTime: asset.updateTime }),
    resource: asset === undefined ? null : { data: asset.data },
  };
}
