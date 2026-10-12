// SPDX-License-Identifier: MIT
/**
 * What the graph builder (`@gcportrait/graph`; containment: skill gcp-diagram-layout §2) reports next to the
 * Graph it builds: the Shared VPC pairs behind its derived `shares` edges, the "shared with N projects" count
 * of each host subnet or network, the containment cycles it refused (rule 5), dangling references per node,
 * the asset types the catalog does not map yet, and a few counters. The UI reads it for zone badges, the
 * drawer and the cycle error of skill gcp-diagram-layout §2 rule 5. Plain records only, so it crosses worker
 * boundaries and JSON unchanged.
 */
import { z } from 'zod';
import { GraphSchema, NodeIdSchema, type Graph } from './graph.js';
import { AssetTypeSchema, CountSchema } from './primitives.js';

const PositiveCountSchema = z.int().min(1);

/**
 * One cross-project `attaches` edge behind a Shared VPC pair: into a subnetwork of another project, or into a
 * network of a project that is a Shared VPC host (producer networks peered into a project that is not a host
 * are no Shared VPC).
 */
export const SharedVpcAttachmentSchema = z.strictObject({
  /** The attaching resource, in the service project. */
  from: NodeIdSchema,
  /** What it attaches to, in the host project: a subnet, a network, a connector, … */
  to: NodeIdSchema,
});
export type SharedVpcAttachment = z.infer<typeof SharedVpcAttachmentSchema>;

/**
 * A Shared VPC pair (skill gcp-diagram-layout §2, rule 2): resources of the service project attach to the
 * host project's network. Both ends are Resource Manager project nodes; the graph holds the matching `shares`
 * edge service → host.
 */
export const SharedVpcPairSchema = z.strictObject({
  service: NodeIdSchema,
  host: NodeIdSchema,
  /** The cross-project `attaches` edges that make the pair, at least one. */
  attachments: z.array(SharedVpcAttachmentSchema).min(1),
});
export type SharedVpcPair = z.infer<typeof SharedVpcPairSchema>;

/**
 * A containment cycle the builder refused (skill gcp-diagram-layout §2, rule 5): the nodes whose nesting
 * preferences close a loop, starting at the smallest id. The builder nested them without the cycle; the UI
 * shows the ids.
 */
export const ContainmentCycleSchema = z.strictObject({ ids: z.array(NodeIdSchema).min(1) });
export type ContainmentCycle = z.infer<typeof ContainmentCycleSchema>;

/** Counters of what the builder did. */
export const GraphBuildCountsSchema = z.strictObject({
  /** Assets read, after dropping repeated names. */
  assets: CountSchema,
  /** Copies of a repeated asset name dropped; the latest `updateTime` is kept (a snapshot should have none). */
  duplicateAssets: CountSchema,
  /** Virtual region and zone containers added (`showRegions`). */
  virtualNodes: CountSchema,
  /** Weak relations dropped for a stronger one of the same kind from the same asset inside their target. */
  weakYielded: CountSchema,
  /** Reciprocal `peers` relations folded into one edge. */
  peersMerged: CountSchema,
  /** Reciprocal `connects` relations folded into one edge (a tunnel and its router naming each other). */
  connectsMerged: CountSchema.exactOptional(),
  /**
   * Edges whose reference matched a node only after its project segment was swapped between id and number
   * (`RelationEdge.matchedProject`). `contains` names and `nestsIn` targets resolve the same way.
   */
  projectSwaps: CountSchema.exactOptional(),
  /** Nodes nested in a container their own type's `nestsIn` rule names. */
  nestedByReference: CountSchema.exactOptional(),
  /** Alias keys claimed by more than one node (the first claim, in name order, wins). */
  aliasConflicts: CountSchema,
  /**
   * Nodes kept out of a container in another project (skill gcp-diagram-layout §2, rule 2), such as Shared
   * VPC resources that stay in their service project.
   */
  crossProjectRefused: CountSchema,
});
export type GraphBuildCounts = z.infer<typeof GraphBuildCountsSchema>;

export const GraphReportSchema = z.strictObject({
  /** One entry per (service project, host project) pair, sorted by service, then host. */
  sharedVpc: z.array(SharedVpcPairSchema),
  /** Attachment target in a host project → how many other projects attach to it ("shared with N"). */
  sharedWith: z.record(NodeIdSchema, PositiveCountSchema),
  /** Containment cycles refused. */
  cycles: z.array(ContainmentCycleSchema),
  /** Node id → number of its dangling references (`Graph.dangling` entries from it). */
  danglingByNode: z.record(NodeIdSchema, PositiveCountSchema),
  /** Asset types the catalog does not map → number of assets, drawn as generic cards (agents.md rule 5). */
  unmappedTypes: z.record(AssetTypeSchema, PositiveCountSchema),
  counts: GraphBuildCountsSchema,
});
export type GraphReport = z.infer<typeof GraphReportSchema>;

type Issue = { path: PropertyKey[]; message: string };

/** Every place where a report disagrees with the graph it describes. */
function graphBuildIssues(graph: Graph, report: GraphReport): Issue[] {
  const issues: Issue[] = [];
  const requireNode = (id: string, path: PropertyKey[]): void => {
    if (!Object.hasOwn(graph.nodes, id))
      issues.push({ path: ['report', ...path], message: `unknown node ${id}` });
  };
  const edgeKey = (from: string, kind: string, to: string): string => `${from}\u0000${kind}\u0000${to}`;
  const edges = new Set(graph.edges.map((edge) => edgeKey(edge.from, edge.kind, edge.to)));

  const pairs = new Set<string>();
  const sharedWith = new Map<string, Set<string>>();
  report.sharedVpc.forEach((pair, index) => {
    requireNode(pair.service, ['sharedVpc', index, 'service']);
    requireNode(pair.host, ['sharedVpc', index, 'host']);
    const key = edgeKey(pair.service, 'shares', pair.host);
    if (pairs.has(key)) issues.push({ path: ['report', 'sharedVpc', index], message: 'listed twice' });
    pairs.add(key);
    if (!edges.has(key)) {
      issues.push({ path: ['report', 'sharedVpc', index], message: 'has no shares edge in the graph' });
    }
    pair.attachments.forEach((attachment, a) => {
      if (!edges.has(edgeKey(attachment.from, 'attaches', attachment.to))) {
        issues.push({
          path: ['report', 'sharedVpc', index, 'attachments', a],
          message: 'has no attaches edge in the graph',
        });
      }
      const projects = sharedWith.get(attachment.to) ?? new Set<string>();
      projects.add(pair.service);
      sharedWith.set(attachment.to, projects);
    });
  });
  graph.edges.forEach((edge, index) => {
    if (edge.kind === 'shares' && !pairs.has(edgeKey(edge.from, 'shares', edge.to))) {
      issues.push({ path: ['graph', 'edges', index], message: 'shares edge without a Shared VPC pair' });
    }
  });

  for (const [target, count] of Object.entries(report.sharedWith)) {
    requireNode(target, ['sharedWith', target]);
    if (sharedWith.get(target)?.size !== count) {
      issues.push({ path: ['report', 'sharedWith', target], message: 'must count the attaching projects' });
    }
  }
  for (const target of sharedWith.keys()) {
    if (!Object.hasOwn(report.sharedWith, target)) {
      issues.push({ path: ['report', 'sharedWith'], message: `missing ${target}` });
    }
  }

  report.cycles.forEach((cycle, index) => {
    cycle.ids.forEach((id, i) => {
      requireNode(id, ['cycles', index, 'ids', i]);
    });
  });

  const dangling = new Map<string, number>();
  for (const edge of graph.dangling) dangling.set(edge.from, (dangling.get(edge.from) ?? 0) + 1);
  for (const [id, count] of Object.entries(report.danglingByNode)) {
    if (dangling.get(id) !== count) {
      issues.push({
        path: ['report', 'danglingByNode', id],
        message: 'must count the node’s dangling references',
      });
    }
  }
  for (const id of dangling.keys()) {
    if (!Object.hasOwn(report.danglingByNode, id)) {
      issues.push({ path: ['report', 'danglingByNode'], message: `missing ${id}` });
    }
  }
  return issues;
}

/**
 * The builder's full output: the Graph and its report, which must agree. Every Shared VPC pair has its
 * `shares` edge and every `shares` edge its pair, attachments are `attaches` edges, `sharedWith` counts the
 * service projects of the pairs per target, and `danglingByNode` counts `Graph.dangling`.
 */
export const GraphBuildSchema = z
  .strictObject({ graph: GraphSchema, report: GraphReportSchema })
  .superRefine((build, ctx) => {
    for (const issue of graphBuildIssues(build.graph, build.report))
      ctx.addIssue({ code: 'custom', ...issue });
  });
export type GraphBuild = z.infer<typeof GraphBuildSchema>;
