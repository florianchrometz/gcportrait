// SPDX-License-Identifier: MIT
/**
 * What the top bar's view controls offer to choose from: the loaded snapshot's facts, its
 * projects, Shared VPC hosts, perimeters, applications, folders and locations, the containers above a drill-in
 * root (the breadcrumb's trail), and the asset types a filter can include or exclude. Worked out in the data
 * worker from the Graph and the compiled catalog (neither ever reaches the UI thread) and sent once per
 * snapshot (`choices` in diagram/pipeline/protocol.ts). Pure: the same snapshot, graph and catalog always give
 * the same, sorted answer.
 *
 * Every candidate follows the scene builder's own semantics (`@gcportrait/graph`, views): a Shared VPC host is a
 * project other projects `shares` into, a perimeter any node whose `secures` edges reach projects, an
 * application a container that is no part of the resource hierarchy or the network layers (the focus accepts any
 * container; the picker leaves out what is no application). Nothing here is a second map of asset types: the
 * hierarchy's types come from the graph package, zone kinds and products from the catalog.
 */
import { FOLDER_TYPE, ORGANIZATION_TYPE, PROJECT_TYPE, isVirtualNode } from '@gcportrait/graph';
import type {
  Catalog,
  Graph,
  GraphNode,
  ScopeKind,
  Snapshot,
  SnapshotRef,
  SnapshotSourceKind,
} from '@gcportrait/model';

import { cardTypeName } from '../diagram/names';

/** The loaded snapshot, for the Snapshot menu. */
export interface SnapshotFacts {
  readonly ref: SnapshotRef;
  /** The scope's display name, else its id. */
  readonly scope: string;
  readonly scopeKind: ScopeKind;
  readonly readTime: string;
  /** The read time is the latest asset update time, an estimate (skill cai-ingestion §1). */
  readonly readTimeEstimated: boolean;
  readonly source: SnapshotSourceKind;
  readonly assets: number;
}

/** A project, as the project focus and the projects filter name it. */
export interface ProjectChoice {
  /** The project's node id. */
  readonly node: string;
  /** The project id (the number when the snapshot does not know the id): what the hash holds. */
  readonly id: string;
  readonly number: string | null;
  /** Its display name. */
  readonly name: string;
  /** The folders above it, outermost first ("Workloads › Retail"); '' at the top. */
  readonly path: string;
}

/** A Shared VPC host project and how many service projects attach to it. */
export interface HostChoice extends ProjectChoice {
  readonly services: number;
}

/** A node a focus anchors on (a perimeter, an application): its id is what the hash holds. */
export interface NodeChoice {
  readonly node: string;
  readonly label: string;
  /** A second line: its type and project, or what it secures. */
  readonly detail: string;
}

/** A folder, as the folders filter names it (by number). */
export interface FolderChoice {
  readonly node: string;
  readonly number: string;
  readonly label: string;
  /** The folders above it, outermost first; '' at the top. */
  readonly path: string;
}

/** A container one can drill into, with its parent: the breadcrumb walks these up from the root. */
export interface ContainerInfo {
  readonly label: string;
  readonly parent: string | null;
  /** Its type's name ("Folder", "Compute Engine network"). */
  readonly typeName: string;
}

/** An asset type or a `<service>/*` pattern a filter can include or exclude. */
export interface TypeChoice {
  /** The asset type or pattern, as the hash holds it. */
  readonly type: string;
  readonly product: string;
  /** Its name ("Cloud Run service", "every Cloud Run type"). */
  readonly name: string;
  /** Assets of the type (or matching the pattern) in this snapshot. */
  readonly count: number;
}

export interface ViewChoices {
  readonly snapshot: SnapshotFacts;
  /** The organisation's node, when the snapshot holds one: the breadcrumb's first crumb. */
  readonly organization: string | null;
  readonly projects: readonly ProjectChoice[];
  readonly hosts: readonly HostChoice[];
  readonly perimeters: readonly NodeChoice[];
  readonly applications: readonly NodeChoice[];
  readonly folders: readonly FolderChoice[];
  /** Locations in the snapshot, lower-case, zones as their region; `global` included. */
  readonly regions: readonly string[];
  readonly containers: Readonly<Record<string, ContainerInfo>>;
  readonly types: readonly TypeChoice[];
}

/** What of the catalog the choices read: its type table (zone kinds, products) and product list. */
export type ChoicesCatalog = Pick<Catalog, 'types' | 'products'>;

const HIERARCHY = new Set([ORGANIZATION_TYPE, FOLDER_TYPE, PROJECT_TYPE]);
/** A zone's location: `europe-west3-a` is in `europe-west3` (the regions filter's own rule). */
const ZONE = /^([a-z]+-[a-z]+[0-9]+)-[a-z0-9]+$/;

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function lastSegment(id: string): string {
  return id.slice(id.lastIndexOf('/') + 1);
}

function typeNameOf(node: GraphNode): string {
  if (node.assetType === FOLDER_TYPE) return 'Folder';
  if (node.assetType === PROJECT_TYPE) return 'Project';
  if (node.assetType === ORGANIZATION_TYPE) return 'Organisation';
  return cardTypeName(node.product, node.assetType);
}

/** The region a location belongs to (lower-case), or the location itself. */
export function regionOf(location: string): string {
  const lower = location.toLowerCase();
  return ZONE.exec(lower)?.[1] ?? lower;
}

export function viewChoices(
  ref: SnapshotRef,
  snapshot: Snapshot,
  graph: Graph,
  catalog: ChoicesCatalog,
): ViewChoices {
  const nodes = graph.nodes;
  const parentOf = graph.containment.parent;
  const label = (id: string): string => nodes[id]?.label ?? lastSegment(id);

  /** The folders above a node, outermost first. */
  const folderPath = (id: string): string => {
    const names: string[] = [];
    for (let current = parentOf[id]; current !== undefined; current = parentOf[current]) {
      if (nodes[current]?.assetType === FOLDER_TYPE) names.unshift(label(current));
    }
    return names.join(' › ');
  };

  const ids = Object.keys(nodes).sort(compare);
  const projectNodes = ids.filter((id) => nodes[id]?.assetType === PROJECT_TYPE);
  const project = (id: string): ProjectChoice => {
    const node = nodes[id];
    const number = node?.projectNumber ?? null;
    return {
      node: id,
      id: node?.projectId ?? number ?? lastSegment(id),
      number,
      name: label(id),
      path: folderPath(id),
    };
  };
  const byName = (a: { readonly name: string; readonly id: string }, b: typeof a): number =>
    compare(a.name.toLowerCase(), b.name.toLowerCase()) || compare(a.id, b.id);
  const projects = projectNodes.map(project).sort(byName);

  const services = new Map<string, Set<string>>();
  const secured = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (edge.kind === 'shares') {
      const set = services.get(edge.to) ?? new Set<string>();
      set.add(edge.from);
      services.set(edge.to, set);
    } else if (edge.kind === 'secures' && nodes[edge.to]?.assetType === PROJECT_TYPE) {
      const set = secured.get(edge.from) ?? new Set<string>();
      set.add(edge.to);
      secured.set(edge.from, set);
    }
  }
  const hosts = [...services]
    .filter(([host]) => nodes[host]?.assetType === PROJECT_TYPE)
    .map(([host, set]) => ({ ...project(host), services: set.size }))
    .sort(byName);

  const perimeters = [...secured]
    .map(([id, set]) => {
      const count = set.size;
      return {
        node: id,
        label: label(id),
        detail: `${nodes[id] === undefined ? 'Perimeter' : typeNameOf(nodes[id])} · secures ${String(count)} project${count === 1 ? '' : 's'}`,
      };
    })
    .sort((a, b) => compare(a.label.toLowerCase(), b.label.toLowerCase()) || compare(a.node, b.node));

  // Applications: containers outside the hierarchy and the network layers (what the scene draws as product
  // containers), grouped by their type's name ("App Hub application", "BigQuery dataset", ...), then by label,
  // so the picker reads like a list of kinds; its search finds one by name, type or project.
  const isApplication = (id: string): boolean => {
    const node = nodes[id];
    if (node?.role !== 'container' || HIERARCHY.has(node.assetType) || isVirtualNode(id)) return false;
    const zoneKind = catalog.types[node.assetType]?.zoneKind;
    return zoneKind === undefined || zoneKind === 'product';
  };
  const applications = ids
    .filter(isApplication)
    .map((id) => {
      const node = nodes[id];
      return {
        choice: {
          node: id,
          label: label(id),
          detail: [node === undefined ? '' : typeNameOf(node), node?.projectId ?? node?.projectNumber ?? '']
            .filter((part) => part !== '')
            .join(' · '),
        },
        type: node === undefined ? '' : typeNameOf(node).toLowerCase(),
      };
    })
    .sort(
      (a, b) =>
        compare(a.type, b.type) ||
        compare(a.choice.label.toLowerCase(), b.choice.label.toLowerCase()) ||
        compare(a.choice.node, b.choice.node),
    )
    .map((entry) => entry.choice);

  const folders = ids
    .filter((id) => nodes[id]?.assetType === FOLDER_TYPE)
    .map((id) => ({ node: id, number: lastSegment(id), label: label(id), path: folderPath(id) }))
    .sort(
      (a, b) =>
        compare(`${a.path} › ${a.label}`.toLowerCase(), `${b.path} › ${b.label}`.toLowerCase()) ||
        compare(a.node, b.node),
    );

  const regions = new Set<string>();
  for (const id of ids) {
    const location = nodes[id]?.location;
    if (location !== undefined && location !== '') regions.add(regionOf(location));
  }

  const containers: Record<string, ContainerInfo> = {};
  for (const id of ids) {
    const node = nodes[id];
    if (node === undefined) continue;
    if (node.role !== 'container' && (graph.containment.children[id]?.length ?? 0) === 0) continue;
    containers[id] = { label: label(id), parent: parentOf[id] ?? null, typeName: typeNameOf(node) };
  }

  const organization = ids.find((id) => nodes[id]?.assetType === ORGANIZATION_TYPE) ?? null;

  return {
    snapshot: {
      ref,
      scope: snapshot.scope.displayName ?? snapshot.scope.id,
      scopeKind: snapshot.scope.kind,
      readTime: snapshot.readTime,
      readTimeEstimated: snapshot.readTimeSource === 'estimated-max-update-time',
      source: snapshot.source.kind,
      assets: snapshot.assets.length,
    },
    organization,
    projects,
    hosts,
    perimeters,
    applications,
    folders,
    regions: [...regions].sort(compare),
    containers,
    types: typeChoices(graph, catalog),
  };
}

/**
 * The types a filter can name: every catalog type, every type of the snapshot the catalog does not map (they
 * still render: AGENTS.md, Product rules), and a `<service>/*` pattern per service; those present in the snapshot
 * first.
 */
export function typeChoices(graph: Graph, catalog: ChoicesCatalog): TypeChoice[] {
  const count = (type: string): number => graph.indexes.byType[type]?.length ?? 0;
  const choices = new Map<string, TypeChoice>();
  for (const entry of Object.values(catalog.types)) {
    choices.set(entry.assetType, {
      type: entry.assetType,
      product: entry.product,
      name: cardTypeName(entry.product, entry.assetType),
      count: count(entry.assetType),
    });
  }
  for (const type of Object.keys(graph.indexes.byType)) {
    if (choices.has(type) || type.startsWith('gcportrait.')) continue;
    const first = graph.indexes.byType[type]?.[0];
    const product =
      (first === undefined ? undefined : graph.nodes[first]?.product) ?? type.split('/')[0] ?? type;
    choices.set(type, { type, product, name: cardTypeName(product, type), count: count(type) });
  }
  const services = new Map<string, { products: Set<string>; count: number }>();
  for (const choice of choices.values()) {
    const service = choice.type.slice(0, choice.type.indexOf('/'));
    const entry = services.get(service) ?? { products: new Set<string>(), count: 0 };
    entry.count += choice.count;
    services.set(service, entry);
  }
  for (const product of catalog.products) services.get(product.service)?.products.add(product.product);
  for (const [service, entry] of services) {
    // Products that differ only by an API version ("… v1", "… v2") read as one.
    const names = new Set([...entry.products].map((name) => name.replace(/ v[0-9]+[a-z0-9]*$/, '')));
    const product = [...names].sort(compare).join(' / ') || service;
    const type = `${service}/*`;
    choices.set(type, { type, product, name: `every ${service} type`, count: entry.count });
  }
  return [...choices.values()].sort((a, b) => b.count - a.count || compare(a.type, b.type));
}
