// SPDX-License-Identifier: MIT
/**
 * The search documents of a Graph (a Fuse.js index over the Graph's node index): one per node, except
 * the organisation, which is the canvas and never a node of the drawing. Each carries the fields the index
 * searches (rank.ts: label, display name, last name segment, full name, IPs, domains, project id, type name,
 * asset type, product, and the names of the project and folders above it) and what a result shows (kind, type
 * name, project, icon key, hidden by default). Pure; built in the data worker, where the Graph is.
 */
import { matchesTypePattern, serviceOf } from '@gcportrait/catalog';
import { FOLDER_TYPE, ORGANIZATION_TYPE, PROJECT_TYPE } from '@gcportrait/graph';
import { DEFAULT_VIEW_SPEC, type Asset, type Catalog, type Graph, type GraphNode } from '@gcportrait/model';

import { cardTypeName } from '../diagram/names';
import type { SearchKind } from './protocol';

export interface SearchDoc {
  readonly id: string;
  readonly label: string;
  /** The asset's own `displayName`, when it has one; `''` otherwise. */
  readonly displayName: string;
  /** The last segment of the resource name ("bastion"). */
  readonly name: string;
  readonly assetType: string;
  readonly product: string;
  readonly typeName: string;
  /** The project id; `''` for folders and assets outside any project. */
  readonly projectId: string;
  readonly ips: readonly string[];
  readonly domains: readonly string[];
  /** The labels of the project and the folders above the node, closest first. */
  readonly ancestors: readonly string[];
  readonly kind: SearchKind;
  /** A container in the Graph (folders, projects, networks, clusters, …): boosted in the ranking. */
  readonly container: boolean;
  /** A record rather than architecture (role `leaf`): after `core` nodes on a tie. */
  readonly leaf: boolean;
  /** The default view's lens draws its type (and it is not hidden): first on a tie. */
  readonly prominent: boolean;
  readonly hidden: boolean;
  /** The icon key the canvas would draw it with (the catalog type's, else its product's). */
  readonly icon: string | undefined;
}

/** The kind a node is listed under. */
export function searchKindOf(node: GraphNode, catalog: Pick<Catalog, 'types'>): SearchKind {
  if (node.assetType === FOLDER_TYPE) return 'folder';
  if (node.assetType === PROJECT_TYPE) return 'project';
  const zoneKind = catalog.types[node.assetType]?.zoneKind;
  if (zoneKind === 'vpc' || zoneKind === 'subnet') return 'network';
  return node.role === 'container' ? 'container' : 'resource';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function displayNameOf(asset: Asset | undefined): string {
  const data: unknown = asset?.data;
  if (!isRecord(data)) return '';
  const value = data['displayName'];
  return typeof value === 'string' ? value : '';
}

/** The labels of the hierarchy nodes (project, folders) above a node, closest first. */
function ancestorLabels(graph: Graph, id: string): string[] {
  const labels: string[] = [];
  const seen = new Set<string>([id]);
  let parent = graph.containment.parent[id];
  while (parent !== undefined && !seen.has(parent)) {
    seen.add(parent);
    const node = graph.nodes[parent];
    if (node !== undefined && (node.assetType === PROJECT_TYPE || node.assetType === FOLDER_TYPE)) {
      labels.push(node.label);
    }
    parent = graph.containment.parent[parent];
  }
  return labels;
}

/**
 * The search documents of a Graph, in node-id order. `assets` gives the display names (the Graph keeps the
 * label, not the asset's data); `catalog` the type's zone kind and icon, as the scene builder draws it: the
 * type's icon, else its service's product icon (the icons package's fallback chain does the rest); and whether
 * the default view's lens draws the type, the ranking's tie-break.
 */
export function searchDocuments(
  graph: Graph,
  assets: readonly Asset[],
  catalog: Pick<Catalog, 'types' | 'products' | 'lenses'>,
): SearchDoc[] {
  const byName = new Map(assets.map((asset) => [asset.name, asset]));
  const defaultLens = catalog.lenses[DEFAULT_VIEW_SPEC.lens].types;
  const productIcons = new Map(catalog.products.map((product) => [product.service, product.icon]));
  const docs: SearchDoc[] = [];
  for (const id of Object.keys(graph.nodes).sort()) {
    const node = graph.nodes[id];
    if (node === undefined || node.assetType === ORGANIZATION_TYPE) continue;
    const kind = searchKindOf(node, catalog);
    docs.push({
      id,
      label: node.label,
      displayName: displayNameOf(byName.get(id)),
      name: id.slice(id.lastIndexOf('/') + 1),
      assetType: node.assetType,
      product: node.product,
      typeName: cardTypeName(node.product, node.assetType),
      projectId: kind === 'folder' ? '' : (node.projectId ?? ''),
      ips: node.ips,
      domains: node.domains,
      ancestors: ancestorLabels(graph, id),
      kind,
      container: node.role === 'container',
      leaf: node.role === 'leaf',
      prominent: !node.hidden && defaultLens.some((pattern) => matchesTypePattern(pattern, node.assetType)),
      hidden: node.hidden,
      icon: catalog.types[node.assetType]?.icon ?? productIcons.get(serviceOf(node.assetType)),
    });
  }
  return docs;
}
