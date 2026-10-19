// SPDX-License-Identifier: Apache-2.0
/**
 * The graph builder (containment: skill gcp-diagram-layout §2): Snapshot + catalog → Graph. Pure and
 * deterministic: no clock, no randomness, no I/O, and the output does not depend on the order of the assets.
 *
 * Pipeline:
 *  1. one asset per name, in name order; the snapshot's project index (`buildProjectIndex`);
 *  2. one node per asset (`assetNode`): catalog label, subtitle, role, product, addresses, host names and
 *     default visibility, or a generic card for a type the catalog does not map;
 *     Shared VPC host projects are marked (`sharedVpcHost`, from their Compute settings);
 *  3. the alias index: each catalog type's `aliases` (service-account e-mails), project ids and numbers;
 *  4. relations: every rule of the asset's type through `evaluateRelations`, targets resolved against the
 *     nodes (a name also with its project segment swapped between id and number, `names.ts`) and aliases,
 *     `reverse` ones drawn from the target; unresolved ones become dangling references; the containers each
 *     type's `nestsIn` rules name (`evaluateNestsIn`);
 *  5. containment (`resolveContainment`): declared by containers or by the node's `nestsIn`, then
 *     attachments, then `parent`, then `ancestors`; never across projects; cycles refused and reported; a
 *     `nestsIn` rule's `kind` is drawn to a container the node did not nest in; copies of one edge merge;
 *  6. weak edges yield to stronger ones inside their target; reciprocal `peers` and `connects` edges merge;
 *  7. Shared VPC: cross-project `attaches` edges into a subnet, or into a Shared VPC host's network, become
 *     `shares` edges between project nodes;
 *  8. roles of unmapped types (`core` with an incoming edge, else `leaf`);
 *  9. optional virtual region/zone containers;
 * 10. containment records, indexes and the report.
 */
import {
  assetProject,
  evaluateContains,
  evaluateNestsIn,
  evaluateRelations,
  nestsByParent,
  type RuleContext,
} from '@gcportrait/catalog';
import {
  buildProjectIndex,
  type Asset,
  type Catalog,
  type CatalogType,
  type Containment,
  type Graph,
  type GraphBuild,
  type GraphNode,
  type RelationTarget,
} from '@gcportrait/model';
import { buildAliases } from './aliases.js';
import { uniqueAssets } from './assets.js';
import { resolveContainment } from './containment.js';
import { buildIndexes } from './indexes.js';
import type { AssetFacts, BuildMemo } from './memo.js';
import { nameResolver, type NameMatch } from './names.js';
import { assetNode, unmappedRole } from './nodes.js';
import { compareStrings, sortedRecord } from './order.js';
import { addRegionContainers } from './regions.js';
import {
  applyWeakPrecedence,
  compareEdges,
  mergeCopies,
  mergeReciprocal,
  resolveRelations,
  toDanglingEdge,
  toEdge,
  type DanglingRelation,
  type ResolvedRelation,
} from './relations.js';
import { deriveSharedVpc } from './shared-vpc.js';
import { PROJECT_TYPE, isSharedVpcHostSettings, projectNodeId } from './structure.js';

/** What the builder reads of a Snapshot: its assets (a Snapshot itself fits). */
export interface SnapshotAssets {
  readonly assets: readonly Asset[];
}

export interface BuildOptions {
  /**
   * Group each project's direct children in virtual region and zone containers (skill gcp-diagram-layout §2,
   * rule 3). Off by default; a view that enables it builds its own graph.
   */
  readonly showRegions?: boolean;
  /**
   * What earlier builds worked out per asset (memo.ts): an asset object built before with the same catalog
   * and project index is not evaluated again. It changes no result.
   */
  readonly memo?: BuildMemo;
}

function catalogType(catalog: Catalog, assetType: string): CatalogType | undefined {
  return Object.hasOwn(catalog.types, assetType) ? catalog.types[assetType] : undefined;
}

/** The names a full resource name continues: `//s/a/b/c` → `//s/a/b`, `//s/a`. */
function namePrefixes(name: string): string[] {
  const serviceEnd = name.indexOf('/', 2);
  const prefixes: string[] = [];
  for (let end = name.lastIndexOf('/'); end > serviceEnd; end = name.lastIndexOf('/', end - 1)) {
    prefixes.push(name.slice(0, end));
  }
  return prefixes;
}

/**
 * Tier 1 of containment: child → the containers that claim it. A container's JSONPath `contains` rules name
 * children; its `byParent` rules claim assets of the listed types whose `parent` is the container or whose
 * name continues the container's name; and a Kubernetes object (its name holds `/k8s/`) is claimed by every
 * container its name continues (namespace, cluster).
 */
function declaredContainers(
  assets: readonly Asset[],
  facts: readonly AssetFacts[],
  nodes: ReadonlyMap<string, GraphNode>,
  resolve: (target: RelationTarget) => NameMatch | undefined,
): Map<string, string[]> {
  const declared = new Map<string, string[]>();
  const claim = (child: string, container: string): void => {
    if (child === container) return;
    const list = declared.get(child);
    if (list === undefined) declared.set(child, [container]);
    else if (!list.includes(container)) list.push(container);
  };
  const byParent = new Map<string, ReadonlySet<string>>();
  assets.forEach((asset, index) => {
    const contained = facts[index]?.contains;
    if (contained === undefined) return;
    if (contained.byParent.length > 0) byParent.set(asset.name, new Set(contained.byParent));
    for (const target of contained.names) {
      const child = resolve(target)?.id;
      if (child !== undefined) claim(child, asset.name);
    }
  });
  for (const asset of assets) {
    const consider = (container: string, byName: boolean): void => {
      if (nodes.get(container)?.role !== 'container') return;
      const listed = byParent.get(container)?.has(asset.assetType) === true;
      if ((listed && nestsByParent(asset, { name: container })) || byName) claim(asset.name, container);
    };
    if (asset.parent !== undefined) consider(asset.parent, false);
    const isKubernetesObject = asset.name.includes('/k8s/');
    for (const prefix of namePrefixes(asset.name)) consider(prefix, isKubernetesObject);
  }
  return declared;
}

/**
 * What the builder works out for one asset on its own (memo.ts): its node, and what its type's relation, `nestsIn`
 * and `contains` rules produce.
 */
function assetFacts(asset: Asset, type: CatalogType | undefined, ctx: RuleContext): AssetFacts {
  return {
    node: assetNode(asset, type, ctx),
    relations: evaluateRelations(asset, type, ctx),
    nestsIn: type?.nestsIn === undefined ? undefined : evaluateNestsIn(asset, type, ctx),
    contains:
      type?.role === 'container' && type.contains.length > 0 ? evaluateContains(asset, type, ctx) : undefined,
  };
}

/** Builds the graph and the report that goes with it (`GraphBuildSchema` in `@gcportrait/model`). */
export function buildGraphWithReport(
  snapshot: SnapshotAssets,
  catalog: Catalog,
  options: BuildOptions = {},
): GraphBuild {
  // 1. Assets and the project index.
  const { assets, duplicates } = uniqueAssets(snapshot.assets);
  const ctx: RuleContext = { projects: buildProjectIndex(assets) };
  const assetByName = new Map(assets.map((asset) => [asset.name, asset]));
  const ids = assets.map((asset) => asset.name);

  // 2. Nodes (and what each asset's rules produce, steps 4 and 5), from the memo where it has them.
  const types = new Map(assets.map((asset) => [asset.name, catalogType(catalog, asset.assetType)]));
  const known = options.memo?.factsFor(catalog, ctx.projects);
  const facts = assets.map((asset) => {
    const kept = known?.get(asset);
    if (kept !== undefined) return kept;
    const made = assetFacts(asset, types.get(asset.name), ctx);
    known?.set(asset, made);
    return made;
  });
  const nodes = new Map<string, GraphNode>();
  const unmapped = new Map<string, number>();
  assets.forEach((asset, index) => {
    const node = facts[index]?.node;
    if (node !== undefined) nodes.set(asset.name, node);
    if (types.get(asset.name) === undefined)
      unmapped.set(asset.assetType, (unmapped.get(asset.assetType) ?? 0) + 1);
  });

  // Shared VPC hosts: the project nodes whose Compute settings say xpnProjectStatus HOST.
  for (const asset of assets) {
    if (!isSharedVpcHostSettings(asset)) continue;
    const number = assetProject(asset, ctx.projects).number;
    const id = number === undefined ? undefined : projectNodeId(number);
    const node = id === undefined ? undefined : nodes.get(id);
    if (id !== undefined && node?.assetType === PROJECT_TYPE) nodes.set(id, { ...node, sharedVpcHost: true });
  }

  // 3. Aliases.
  const { aliases, conflicts } = buildAliases(assets, ctx.projects, (asset) => types.get(asset.name));
  const resolveName = nameResolver((id) => nodes.has(id), ctx.projects);
  const resolve = (target: RelationTarget): NameMatch | undefined => {
    if (target.by === 'name') return resolveName(target.name);
    const id = aliases.get(target.alias);
    return id !== undefined && nodes.has(id) ? { id } : undefined;
  };

  // 4. Relations, and the containers nestsIn rules name.
  const resolved: ResolvedRelation[] = [];
  const dangling: DanglingRelation[] = [];
  assets.forEach((asset, index) => {
    const relations = resolveRelations(asset.name, facts[index]?.relations ?? [], resolveName, aliases);
    resolved.push(...relations.resolved);
    dangling.push(...relations.dangling);
  });
  const nestsIn = new Map<string, string[]>();
  const fallbacks: ResolvedRelation[] = [];
  assets.forEach((asset, index) => {
    const nestings = facts[index]?.nestsIn;
    if (nestings === undefined) return;
    const candidates: string[] = [];
    for (const nesting of nestings) {
      const match = nesting.target === undefined ? resolveName(nesting.raw) : resolve(nesting.target);
      if (match !== undefined) {
        if (match.id === asset.name) continue;
        if (!candidates.includes(match.id)) candidates.push(match.id);
        if (nesting.kind !== undefined) {
          fallbacks.push({
            from: asset.name,
            kind: nesting.kind,
            to: match.id,
            weak: false,
            matchedProject: match.matchedProject,
          });
        }
      } else if (nesting.kind !== undefined) {
        const target = nesting.target;
        dangling.push({
          from: asset.name,
          kind: nesting.kind,
          to: target === undefined ? nesting.raw : target.by === 'name' ? target.name : target.alias,
          weak: false,
          raw: nesting.raw,
        });
      }
    }
    if (candidates.length > 0) nestsIn.set(asset.name, candidates);
  });

  // 5. Containment.
  const attaches = new Map<string, string[]>();
  for (const relation of resolved) {
    if (relation.kind !== 'attaches') continue;
    const list = attaches.get(relation.from);
    if (list === undefined) attaches.set(relation.from, [relation.to]);
    else list.push(relation.to);
  }
  const containment = resolveContainment({
    ids,
    assets: assetByName,
    nodes,
    declared: declaredContainers(assets, facts, nodes, resolve),
    nestsIn,
    attaches,
    projects: ctx.projects,
  });
  const parent = containment.parent;
  const isInside = (inner: string, outer: string): boolean => {
    for (let current = parent.get(inner), step = 0; current !== undefined && step <= nodes.size; step += 1) {
      if (current === outer) return true;
      current = parent.get(current);
    }
    return false;
  };
  // A nestsIn rule's kind is drawn to every container the node does not nest in.
  for (const fallback of fallbacks) if (parent.get(fallback.from) !== fallback.to) resolved.push(fallback);

  // 6. One edge per (from, kind, to); weak precedence; reciprocal peers and connects.
  const weak = applyWeakPrecedence(mergeCopies(resolved), isInside);
  const peers = mergeReciprocal(weak.kept);

  // 7. Shared VPC.
  const sharedVpc = deriveSharedVpc(peers.edges, nodes, (id) => types.get(id)?.zoneKind);

  // 8. Roles of unmapped types.
  const targets = new Set(peers.edges.map((relation) => relation.to));
  for (const [id, type] of types) {
    const node = nodes.get(id);
    if (type === undefined && node !== undefined)
      nodes.set(id, { ...node, role: unmappedRole(targets.has(id)) });
  }

  // 9. Virtual region and zone containers.
  const virtualNodes = options.showRegions === true ? addRegionContainers(ids, nodes, parent) : 0;

  // 10. Output.
  const children = new Map<string, string[]>();
  for (const [child, container] of parent) {
    const list = children.get(container);
    if (list === undefined) children.set(container, [child]);
    else list.push(child);
  }
  for (const list of children.values()) list.sort(compareStrings);
  const containmentRecord: Containment = { parent: sortedRecord(parent), children: sortedRecord(children) };

  const edges = [...peers.edges.map(toEdge), ...sharedVpc.shares].sort(compareEdges);
  // A reference both a relation and a nestsIn rule of the asset read dangles once (the first raw value).
  const danglingByKey = new Map<string, DanglingRelation>();
  for (const relation of dangling) {
    const key = `${relation.from}\u0000${relation.kind}\u0000${relation.to}`;
    const existing = danglingByKey.get(key);
    danglingByKey.set(
      key,
      existing === undefined ? relation : { ...existing, weak: existing.weak && relation.weak },
    );
  }
  const danglingEdges = [...danglingByKey.values()].map(toDanglingEdge).sort(compareEdges);
  const danglingByNode = new Map<string, number>();
  for (const edge of danglingEdges) danglingByNode.set(edge.from, (danglingByNode.get(edge.from) ?? 0) + 1);

  const graph: Graph = {
    nodes: sortedRecord(nodes),
    containment: containmentRecord,
    edges,
    dangling: danglingEdges,
    indexes: buildIndexes(nodes.values(), aliases),
  };
  return {
    graph,
    report: {
      sharedVpc: sharedVpc.pairs,
      sharedWith: sortedRecord(sharedVpc.sharedWith),
      cycles: containment.cycles.map((cycle) => ({ ids: cycle })),
      danglingByNode: sortedRecord(danglingByNode),
      unmappedTypes: sortedRecord(unmapped),
      counts: {
        assets: assets.length,
        duplicateAssets: duplicates,
        virtualNodes,
        weakYielded: weak.yielded,
        peersMerged: peers.merged.peers,
        connectsMerged: peers.merged.connects,
        aliasConflicts: conflicts,
        crossProjectRefused: containment.crossProjectRefused,
        projectSwaps: edges.filter((edge) => edge.matchedProject !== undefined).length,
        nestedByReference: containment.nestedByReference,
      },
    },
  };
}

/**
 * Builds the Graph of a snapshot (`GraphSchema` in `@gcportrait/model`): a node for every asset, the
 * containment forest, relation edges, dangling references and the indexes. See {@link buildGraphWithReport}
 * for the Shared VPC pairs, refused cycles and counters that go with it.
 */
export function buildGraph(snapshot: SnapshotAssets, catalog: Catalog, options: BuildOptions = {}): Graph {
  return buildGraphWithReport(snapshot, catalog, options).graph;
}
