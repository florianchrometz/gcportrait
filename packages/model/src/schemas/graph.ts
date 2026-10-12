// SPDX-License-Identifier: MIT
/**
 * Graph: the output of `packages/graph`'s builder (Snapshot + catalog → Graph; docs/packages.md).
 * Plain records and arrays only, so it crosses worker boundaries and JSON unchanged; the graph package may
 * build Maps at runtime. Parsing checks the structural invariants (ids resolve, containment is a consistent
 * forest, edges and dangling references are where they belong), so builder tests can use the schema as their
 * oracle.
 */
import { z } from 'zod';
import {
  AssetTypeSchema,
  DomainSchema,
  IpSchema,
  NonEmptyStringSchema,
  NumericIdSchema,
  ProjectRefSchema,
  ResourceNameSchema,
} from './primitives.js';
import { RelationKindSchema } from './relation.js';

/**
 * How a type is drawn (skill gcp-asset-catalog §3): `container` is a zone other assets nest in, `core` a card
 * with edges, `leaf` a card without cross-references, `hidden` an imported asset not drawn by default.
 */
export const NodeRoleSchema = z.enum(['container', 'core', 'leaf', 'hidden']);
export type NodeRole = z.infer<typeof NodeRoleSchema>;

/** A node id is the asset's full resource name. */
export const NodeIdSchema = ResourceNameSchema;

export const GraphNodeSchema = z
  .strictObject({
    /** The asset name. */
    id: NodeIdSchema,
    assetType: AssetTypeSchema,
    label: NonEmptyStringSchema,
    subtitle: NonEmptyStringSchema.exactOptional(),
    role: NodeRoleSchema,
    /** Catalog product name; the service host for types the catalog does not know. */
    product: NonEmptyStringSchema,
    projectId: ProjectRefSchema.exactOptional(),
    projectNumber: NumericIdSchema.exactOptional(),
    location: NonEmptyStringSchema.exactOptional(),
    /** Addresses and ranges extracted by the catalog's `ips` paths. */
    ips: z.array(IpSchema),
    /** Host names extracted by the catalog's `domains` paths. */
    domains: z.array(DomainSchema),
    /** Starts hidden: the role is `hidden`, or the type's `hiddenWhen` predicate matched. */
    hidden: z.boolean(),
    /**
     * The type's `hiddenWhen` predicate matched (whatever the role). A view's `includeTypes` reveals a hidden
     * type's nodes but not these, which only a lens with `showHidden` draws.
     */
    hiddenWhenMatched: z.literal(true).exactOptional(),
    /**
     * Resource Manager project nodes only: the project is a Shared VPC host (its Compute settings,
     * `compute.googleapis.com/Project`, say `xpnProjectStatus: HOST`).
     */
    sharedVpcHost: z.literal(true).exactOptional(),
  })
  .refine((node) => node.role !== 'hidden' || node.hidden, {
    path: ['hidden'],
    message: 'a node with role hidden must be hidden',
  })
  .refine((node) => node.hiddenWhenMatched !== true || node.hidden, {
    path: ['hiddenWhenMatched'],
    message: 'a node whose hiddenWhen matched must be hidden',
  });
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const ContainmentSchema = z.strictObject({
  /** child id → parent id. Roots (the organisation, or top-level nodes of a narrower scope) have no entry. */
  parent: z.record(NodeIdSchema, NodeIdSchema),
  /** parent id → child ids; the inverse of `parent`. */
  children: z.record(NodeIdSchema, z.array(NodeIdSchema)),
});
export type Containment = z.infer<typeof ContainmentSchema>;

/**
 * The value a relation rule read from the asset, before normalisation, kept for a reference that resolved
 * nowhere.
 */
export const DanglingTargetSchema = z.strictObject({ raw: z.string() });
export type DanglingTarget = z.infer<typeof DanglingTargetSchema>;

export const RelationEdgeSchema = z.strictObject({
  from: NodeIdSchema,
  /** A node id; for a dangling reference, the normalised name that matched no asset. */
  to: NonEmptyStringSchema,
  kind: RelationKindSchema,
  /** Yields to a stronger edge from the same asset (a NIC's network next to its subnet). */
  weak: z.boolean().exactOptional(),
  /**
   * Present when the reference spelled its project the other way (a number where the asset's name has the
   * id, or the reverse) and matched only after the project segment was swapped through the project index:
   * the form the matched name uses.
   */
  matchedProject: z.enum(['id', 'number']).exactOptional(),
  /** Present exactly when `to` matches no node. */
  dangling: DanglingTargetSchema.exactOptional(),
});
export type RelationEdge = z.infer<typeof RelationEdgeSchema>;

const NodeIdListSchema = z.array(NodeIdSchema);

export const GraphIndexesSchema = z.strictObject({
  byType: z.record(AssetTypeSchema, NodeIdListSchema),
  /** Keyed by project id, or by project number when the id could not be resolved. */
  byProject: z.record(ProjectRefSchema, NodeIdListSchema),
  byIp: z.record(IpSchema, NodeIdListSchema),
  byDomain: z.record(DomainSchema, NodeIdListSchema),
  /** Other names an asset is referenced by: service-account email, project id or number, … → node id. */
  aliases: z.record(NonEmptyStringSchema, NodeIdSchema),
});
export type GraphIndexes = z.infer<typeof GraphIndexesSchema>;

type Issue = { path: PropertyKey[]; message: string };

/** Every structural problem of a graph whose fields are individually valid. */
function graphIssues(graph: {
  nodes: Record<string, GraphNode>;
  containment: Containment;
  edges: RelationEdge[];
  dangling: RelationEdge[];
  indexes: GraphIndexes;
}): Issue[] {
  const issues: Issue[] = [];
  const known = (id: string): boolean => Object.hasOwn(graph.nodes, id);
  const requireNode = (id: string, path: PropertyKey[]): void => {
    if (!known(id)) issues.push({ path, message: `unknown node ${id}` });
  };

  for (const [key, node] of Object.entries(graph.nodes)) {
    if (node.id !== key) issues.push({ path: ['nodes', key, 'id'], message: 'must equal the node key' });
  }

  const { parent, children } = graph.containment;
  for (const [child, parentId] of Object.entries(parent)) {
    requireNode(child, ['containment', 'parent', child]);
    requireNode(parentId, ['containment', 'parent', child]);
    if (!(children[parentId] ?? []).includes(child)) {
      issues.push({ path: ['containment', 'parent', child], message: 'missing from the parent’s children' });
    }
  }
  for (const [parentId, list] of Object.entries(children)) {
    list.forEach((child, index) => {
      if (parent[child] !== parentId) {
        issues.push({ path: ['containment', 'children', parentId, index], message: 'parent does not match' });
      }
    });
  }
  const visited = new Set<string>();
  for (const start of Object.keys(parent)) {
    const chain = new Set<string>();
    let current: string | undefined = start;
    while (current !== undefined && !visited.has(current)) {
      if (chain.has(current)) {
        issues.push({ path: ['containment', 'parent', current], message: 'containment cycle' });
        break;
      }
      chain.add(current);
      current = parent[current];
    }
    chain.forEach((id) => visited.add(id));
  }

  graph.edges.forEach((edge, index) => {
    requireNode(edge.from, ['edges', index, 'from']);
    if (edge.dangling !== undefined || !known(edge.to)) {
      issues.push({
        path: ['edges', index],
        message: 'must be resolved: to names a node and dangling is absent',
      });
    }
  });
  graph.dangling.forEach((edge, index) => {
    requireNode(edge.from, ['dangling', index, 'from']);
    if (edge.dangling === undefined || known(edge.to)) {
      issues.push({
        path: ['dangling', index],
        message: 'must be unresolved: to names no node and dangling is set',
      });
    }
  });

  const { aliases, ...lists } = graph.indexes;
  for (const [indexName, index] of Object.entries(lists)) {
    for (const [key, ids] of Object.entries(index)) {
      ids.forEach((id) => {
        requireNode(id, ['indexes', indexName, key]);
      });
    }
  }
  for (const [alias, id] of Object.entries(aliases)) requireNode(id, ['indexes', 'aliases', alias]);
  return issues;
}

export const GraphSchema = z
  .strictObject({
    /** Keyed by node id. */
    nodes: z.record(NodeIdSchema, GraphNodeSchema),
    containment: ContainmentSchema,
    /** Resolved relations: both ends are nodes. */
    edges: z.array(RelationEdgeSchema),
    /** References whose target matched no asset: counted and shown in the drawer, never drawn. */
    dangling: z.array(RelationEdgeSchema),
    indexes: GraphIndexesSchema,
  })
  .superRefine((graph, ctx) => {
    for (const issue of graphIssues(graph)) ctx.addIssue({ code: 'custom', ...issue });
  });
export type Graph = z.infer<typeof GraphSchema>;
