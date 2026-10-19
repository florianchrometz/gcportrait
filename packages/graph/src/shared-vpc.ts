// SPDX-License-Identifier: Apache-2.0
/**
 * Shared VPC derivation (the `shares` relation; skill gcp-diagram-layout §2, rule 2). Containment already
 * keeps every resource in its own project; here a resolved `attaches` edge from one project into another
 * project's network layer becomes evidence for a pair: a derived `shares` edge from the service project's
 * node to the host project's node, and a "shared with N projects" count on the host-side subnet or network.
 *
 * Which cross-project attachments count (Shared VPC only on evidence: packages/AGENTS.md, Catalog and graph semantics):
 * one into a **subnetwork** of another project in the snapshot (a subnet can only be used across projects
 * through Shared VPC), and one into a **network** of a project that is a Shared VPC host (its Compute
 * settings say `xpnProjectStatus: HOST`, the project node's `sharedVpcHost`). A network of a project that is
 * not a host is reached by peering a producer's network into it (Cloud Build private pools, GitHub Enterprise
 * and Bitbucket Server configs, AlloyDB, Vertex AI, Apigee), which is no Shared VPC; neither is an attachment
 * to anything but a subnet or a network (a Serverless VPC Access connector in the host project, say). Which
 * types are subnets and networks is the catalog's `zoneKind` (`subnet`, `vpc`).
 */
import type { CatalogZoneKind, GraphNode, RelationEdge, SharedVpcPair } from '@gcportrait/model';
import { compareTuples } from './order.js';
import type { ResolvedRelation } from './relations.js';
import { projectNodeId } from './structure.js';

export interface SharedVpc {
  /** One `shares` edge per pair, service → host. */
  readonly shares: RelationEdge[];
  /** Sorted by service, then host; attachments sorted by from, then to. */
  readonly pairs: SharedVpcPair[];
  /** Host-side target → number of other projects attaching to it. */
  readonly sharedWith: Map<string, number>;
}

/**
 * Derives the Shared VPC pairs from the graph's resolved relations (other kinds are ignored). `zoneKindOf`
 * gives a node's catalog zone kind (`subnet` and `vpc` are the network layers).
 */
export function deriveSharedVpc(
  relations: readonly ResolvedRelation[],
  nodes: ReadonlyMap<string, GraphNode>,
  zoneKindOf: (id: string) => CatalogZoneKind | undefined,
): SharedVpc {
  const projectOf = (id: string): string | undefined => {
    const number = nodes.get(id)?.projectNumber;
    if (number === undefined) return undefined;
    const project = projectNodeId(number);
    return nodes.has(project) ? project : undefined;
  };
  const pairs = new Map<string, SharedVpcPair>();
  const users = new Map<string, Set<string>>();
  for (const relation of relations) {
    if (relation.kind !== 'attaches') continue;
    const service = projectOf(relation.from);
    const host = projectOf(relation.to);
    if (service === undefined || host === undefined || service === host) continue;
    const layer = zoneKindOf(relation.to);
    const shared = layer === 'subnet' || (layer === 'vpc' && nodes.get(host)?.sharedVpcHost === true);
    if (!shared) continue;
    const key = `${service}\u0000${host}`;
    const pair = pairs.get(key) ?? { service, host, attachments: [] };
    pair.attachments.push({ from: relation.from, to: relation.to });
    pairs.set(key, pair);
    const projects = users.get(relation.to) ?? new Set<string>();
    projects.add(service);
    users.set(relation.to, projects);
  }
  const sorted = [...pairs.values()]
    .map((pair) => ({
      ...pair,
      attachments: [...pair.attachments].sort((a, b) => compareTuples([a.from, a.to], [b.from, b.to])),
    }))
    .sort((a, b) => compareTuples([a.service, a.host], [b.service, b.host]));
  return {
    shares: sorted.map((pair) => ({ from: pair.service, to: pair.host, kind: 'shares' })),
    pairs: sorted,
    sharedWith: new Map([...users].map(([target, projects]) => [target, projects.size])),
  };
}
