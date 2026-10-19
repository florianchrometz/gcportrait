// SPDX-License-Identifier: Apache-2.0
/**
 * Lens rules (docs/lenses-and-filters.md, skill gcp-asset-catalog §7): which nodes are candidates and which
 * edge kinds are drawn. The catalog's lens decides through its type patterns and relation kinds; the view's
 * `includeTypes`, `excludeTypes` and `showIdentities` refine it. Everything here looks at a node's type and
 * visibility only; where a node is (root, focus, region, project, folder) is the filters' business.
 */
import { matchesTypePattern } from '@gcportrait/catalog';
import type { Catalog, GraphNode, Lens, RelationKind, ViewSpec } from '@gcportrait/model';
import { SERVICE_ACCOUNT_TYPE, isVirtualNode } from '../structure.js';

export interface LensRules {
  readonly lens: Lens;
  /** Edge kinds the view draws (never `contains`: containment is nesting). */
  readonly edgeKinds: ReadonlySet<RelationKind>;
  /** Whether the node's type and visibility let it into the view. Virtual containers never pass. */
  readonly passes: (node: GraphNode) => boolean;
  /** Whether the node would pass but is hidden by default: it is counted in its zone's "N hidden" badge. */
  readonly heldBack: (node: GraphNode) => boolean;
}

function matchesAny(patterns: readonly string[] | undefined, assetType: string): boolean {
  return patterns?.some((pattern) => matchesTypePattern(pattern, assetType)) === true;
}

/**
 * The rules of a view. Precedence, strongest first: `excludeTypes` hides; `showIdentities` shows (true) or
 * hides (false) service-account cards whatever the lens says; a type the lens or `includeTypes` names is a
 * candidate; a hidden-by-default node is shown only when the lens says `showHidden` or `includeTypes` names
 * its type, except that `includeTypes` never reveals a node of a hidden type whose `hiddenWhen` matched
 * (the predicate marks the noise of a type the user switched on, such as destroyed secret versions;
 * only a lens with `showHidden` draws those). For a type visible by role, `includeTypes` still reveals its
 * `hiddenWhen` matches.
 */
export function lensRules(catalog: Catalog, spec: ViewSpec): LensRules {
  const lens = catalog.lenses[spec.lens];
  const { includeTypes, excludeTypes, showIdentities } = spec.filters;
  const edgeKinds = new Set<RelationKind>(lens.relationKinds.filter((kind) => kind !== 'contains'));
  if (showIdentities === true) edgeKinds.add('runsAs');
  if (showIdentities === false) edgeKinds.delete('runsAs');

  /** 'in', 'out', or 'hidden' (would be in, but is hidden by default). */
  const decide = (node: GraphNode): 'in' | 'out' | 'hidden' => {
    if (isVirtualNode(node.id) || matchesAny(excludeTypes, node.assetType)) return 'out';
    if (node.assetType === SERVICE_ACCOUNT_TYPE && showIdentities !== undefined) {
      return showIdentities ? 'in' : 'out';
    }
    const included = matchesAny(includeTypes, node.assetType);
    if (!included && !matchesAny(lens.types, node.assetType)) return 'out';
    if (!node.hidden || lens.showHidden) return 'in';
    const revealed = included && !(node.role === 'hidden' && node.hiddenWhenMatched === true);
    return revealed ? 'in' : 'hidden';
  };
  return {
    lens,
    edgeKinds,
    passes: (node) => decide(node) === 'in',
    heldBack: (node) => decide(node) === 'hidden',
  };
}
