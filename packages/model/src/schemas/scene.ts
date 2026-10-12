// SPDX-License-Identifier: MIT
/**
 * Scene: what `packages/graph` hands to `packages/layout` (docs/packages.md; skill gcp-diagram-layout). A
 * tree of zones and cards plus the edges to route. It lives here, not in the graph package, because layout
 * must not depend on graph. The organisation itself is not a zone: the canvas is the organisation, so the
 * tree starts at its children (or at the drill-in root's children).
 */
import { z } from 'zod';
import { LensIdSchema } from './lens.js';
import {
  AssetTypeSchema,
  CountSchema,
  IconKeySchema,
  NonEmptyStringSchema,
  TimestampSchema,
} from './primitives.js';
import { RelationKindSchema } from './relation.js';
import { FocusParamNameSchema } from './view-spec.js';

/**
 * Zone kinds and their tints (skill gcp-diagram-style §2 and §4): `region` is the optional virtual
 * region/zone container, `product-container` a product's own container (GKE cluster, dataset, key ring, …),
 * `group` a synthetic bundle of a large flat set.
 */
export const ZoneKindSchema = z.enum([
  'folder',
  'project',
  'vpc',
  'subnet',
  'region',
  'product-container',
  'group',
]);
export type ZoneKind = z.infer<typeof ZoneKindSchema>;

export const RootErrorCodeSchema = z.enum(['unknown-root', 'not-a-container']);
export type RootErrorCode = z.infer<typeof RootErrorCodeSchema>;

/** Why a requested drill-in root was refused; the view then falls back to the organisation. */
export const RootErrorSchema = z.strictObject({ code: RootErrorCodeSchema, message: NonEmptyStringSchema });
export type RootError = z.infer<typeof RootErrorSchema>;

export const FocusErrorCodeSchema = z.enum([
  'missing-param',
  'unknown-project',
  'not-a-host',
  'unknown-perimeter',
  'not-a-perimeter',
  'unknown-application',
  'not-an-application',
  'ambiguous',
  'outside-root',
]);
export type FocusErrorCode = z.infer<typeof FocusErrorCodeSchema>;

/** Why a focus could not be applied; the view then shows its root without the focus. */
export const FocusErrorSchema = z.strictObject({
  code: FocusErrorCodeSchema,
  /** The parameter at fault, when one is. */
  param: FocusParamNameSchema.exactOptional(),
  message: NonEmptyStringSchema,
});
export type FocusError = z.infer<typeof FocusErrorSchema>;

/** What a collapsed zone's chip counts, e.g. "2 networks · 39 resources" (skill gcp-diagram-layout §6). */
export const ChipCountKindSchema = z.enum([
  'folders',
  'projects',
  'networks',
  'subnets',
  'containers',
  'resources',
]);
export type ChipCountKind = z.infer<typeof ChipCountKindSchema>;

/** The counts on a collapsed zone's chip; a kind with nothing inside is left out. */
export const ChipCountsSchema = z.partialRecord(ChipCountKindSchema, z.int().min(1));
export type ChipCounts = z.infer<typeof ChipCountsSchema>;

/** A resource drawn as a card. `id` is the node id (asset name). */
export const SceneCardSchema = z.strictObject({
  type: z.literal('card'),
  id: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  subtitle: NonEmptyStringSchema.exactOptional(),
  /** Icon key in `packages/icons`, already resolved through the catalog's fallbacks. */
  icon: IconKeySchema,
  product: NonEmptyStringSchema,
  assetType: AssetTypeSchema,
});
export type SceneCard = z.infer<typeof SceneCardSchema>;

/** A zone: a container asset, or a synthetic `region` or `group` zone. */
export const SceneZoneSchema = z.strictObject({
  type: z.literal('zone'),
  /** The node id for asset zones; a synthetic id for `region` and `group` zones. */
  id: NonEmptyStringSchema,
  kind: ZoneKindSchema,
  label: NonEmptyStringSchema,
  subtitle: NonEmptyStringSchema.exactOptional(),
  /** Icon key of the zone's header (the container type's icon); absent: the zone kind's own mark. */
  icon: IconKeySchema.exactOptional(),
  /** Header pills, e.g. "shared with 3 projects" or "12 hidden". */
  badges: z.array(NonEmptyStringSchema),
  /** Present when the zone is drawn as a chip; its children are then left out of the scene. */
  collapsed: ChipCountsSchema.exactOptional(),
  get children(): z.ZodArray<typeof SceneNodeSchema> {
    return z.array(SceneNodeSchema);
  },
});
export type SceneZone = z.infer<typeof SceneZoneSchema>;

export const SceneNodeSchema = z.discriminatedUnion('type', [SceneZoneSchema, SceneCardSchema]);
export type SceneNode = z.infer<typeof SceneNodeSchema>;

/** An edge to route between two scene nodes. */
export const SceneEdgeSchema = z.strictObject({
  from: NonEmptyStringSchema,
  to: NonEmptyStringSchema,
  kind: RelationKindSchema,
  /** How many relations this edge stands for, when more than one. */
  count: z.int().min(2).exactOptional(),
  /** At least one end was re-targeted from inside a collapsed zone to the zone's chip. */
  merged: z.boolean().exactOptional(),
});
export type SceneEdge = z.infer<typeof SceneEdgeSchema>;

export const SceneMetadataSchema = z.strictObject({
  /** The canvas title: the organisation, folder or project name, or the drill-in root's label. */
  rootLabel: NonEmptyStringSchema,
  lens: LensIdSchema,
  /** The read time of the data on screen (RFC 3339). */
  readTime: TimestampSchema,
  /** Zones and cards in the scene; a collapsed zone counts once. */
  rectCount: CountSchema,
  /**
   * Why the requested focus was not applied (the scene then shows its root without it), so that a caller
   * that keeps only the Scene can still say so.
   */
  focusError: FocusErrorSchema.exactOptional(),
  /** Why the requested drill-in root was refused (the scene then shows the organisation). */
  rootError: RootErrorSchema.exactOptional(),
});
export type SceneMetadata = z.infer<typeof SceneMetadataSchema>;

type Issue = { path: PropertyKey[]; message: string };

function sceneIssues(scene: { children: SceneNode[]; edges: SceneEdge[]; metadata: SceneMetadata }): Issue[] {
  const issues: Issue[] = [];
  const ids = new Set<string>();
  const visit = (nodes: SceneNode[], path: PropertyKey[]): void => {
    nodes.forEach((node, index) => {
      const at = [...path, index];
      if (ids.has(node.id)) issues.push({ path: [...at, 'id'], message: `duplicate id ${node.id}` });
      ids.add(node.id);
      if (node.type === 'zone') {
        if (node.collapsed && node.children.length > 0) {
          issues.push({
            path: [...at, 'children'],
            message: 'a collapsed zone has no children in the scene',
          });
        }
        visit(node.children, [...at, 'children']);
      }
    });
  };
  visit(scene.children, ['children']);
  scene.edges.forEach((edge, index) => {
    if (!ids.has(edge.from)) issues.push({ path: ['edges', index, 'from'], message: 'unknown scene node' });
    if (!ids.has(edge.to)) issues.push({ path: ['edges', index, 'to'], message: 'unknown scene node' });
    if (edge.from === edge.to) issues.push({ path: ['edges', index], message: 'an edge joins two nodes' });
  });
  if (scene.metadata.rectCount !== ids.size) {
    issues.push({
      path: ['metadata', 'rectCount'],
      message: `must equal the number of zones and cards (${String(ids.size)})`,
    });
  }
  return issues;
}

export const SceneSchema = z
  .strictObject({
    /** Top-level zones and cards: folders and loose projects, or the drill-in root's children. */
    children: z.array(SceneNodeSchema),
    edges: z.array(SceneEdgeSchema),
    metadata: SceneMetadataSchema,
  })
  .superRefine((scene, ctx) => {
    for (const issue of sceneIssues(scene)) ctx.addIssue({ code: 'custom', ...issue });
  });
export type Scene = z.infer<typeof SceneSchema>;
