// SPDX-License-Identifier: Apache-2.0
/** One graph node per asset: what the catalog says about it, or a generic card for a type it does not map. */
import {
  assetProject,
  extractDomains,
  extractIps,
  hiddenWhenMatches,
  isHiddenByDefault,
  renderLabel,
  renderSubtitle,
  serviceOf,
  type RuleContext,
} from '@gcportrait/catalog';
import type { Asset, CatalogType, GraphNode, NodeRole } from '@gcportrait/model';

/**
 * The node of an asset. For a type the catalog maps, role, label, subtitle, product, addresses, host names
 * and default visibility come from its entry. For a type it does not map (it still renders: AGENTS.md,
 * Product rules) the node is a
 * generic card: label from `data.displayName`, else the last segment of `data.name`, else of the asset name;
 * product = the service host; no addresses; visible; and the provisional role `leaf` that
 * {@link unmappedRole} settles once the edges are known. `hiddenWhenMatched` marks a node its type's
 * `hiddenWhen` hides (views keep those held back under `includeTypes` when the type itself is hidden).
 */
export function assetNode(asset: Asset, type: CatalogType | undefined, ctx: RuleContext): GraphNode {
  const project = assetProject(asset, ctx.projects);
  const subtitle = renderSubtitle(asset, type, ctx);
  return {
    id: asset.name,
    assetType: asset.assetType,
    label: renderLabel(asset, type, ctx),
    ...(subtitle === undefined ? {} : { subtitle }),
    role: type?.role ?? 'leaf',
    product: type?.product ?? serviceOf(asset.assetType),
    ...(project.id === undefined ? {} : { projectId: project.id }),
    ...(project.number === undefined ? {} : { projectNumber: project.number }),
    ...(asset.location === undefined ? {} : { location: asset.location }),
    ips: extractIps(asset, type),
    domains: extractDomains(asset, type),
    hidden: isHiddenByDefault(asset, type),
    ...(hiddenWhenMatches(asset, type) ? { hiddenWhenMatched: true as const } : {}),
  };
}

/**
 * The role of a node whose type the catalog does not map. Such a node has no relation rules, so it has no
 * outgoing edges; it is `core` when another asset's rule points at it (it takes part in the picture's edges),
 * and `leaf` otherwise. It is never a `container`: only the catalog can declare what nests inside a type.
 */
export function unmappedRole(hasIncomingEdge: boolean): NodeRole {
  return hasIncomingEdge ? 'core' : 'leaf';
}
