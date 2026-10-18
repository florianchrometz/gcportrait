// SPDX-License-Identifier: MIT
import * as z from 'zod';
import { RelationKindSchema } from './relation.js';
import { ZoneKindSchema } from './scene.js';

export const PointSchema = z.strictObject({ x: z.number(), y: z.number() }).readonly();
export type Point = z.infer<typeof PointSchema>;

export const RectSchema = PointSchema.unwrap().extend({ width: z.number(), height: z.number() }).readonly();
export type Rect = z.infer<typeof RectSchema>;

/** A length per side of a rect. */
export const InsetsSchema = z
  .strictObject({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() })
  .readonly();
export type Insets = z.infer<typeof InsetsSchema>;

/**
 * How a Scene node is drawn:
 * - `zone`: an open zone with a header band and children inside its padding;
 * - `chip`: a collapsed zone, a fixed-size chip in the zone's tint;
 * - `empty`: a zone with no children in the Scene, drawn card-sized with its icon (skill §2 rule 4);
 * - `card`: a resource card.
 * Chips, empty zones and cards are solid: nothing is drawn inside them and no edge crosses them.
 */
export const RectRoleSchema = z.enum(['zone', 'chip', 'empty', 'card']);
export type RectRole = z.infer<typeof RectRoleSchema>;

export const LayoutRectSchema = RectSchema.unwrap()
  .extend({
    /** The parent zone's id; `null` for the top level (the canvas). */
    parent: z.string().nullable(),
    role: RectRoleSchema,
    /** The zone kind (zones, chips and empty zones) or `card`. */
    kind: z.union([ZoneKindSchema, z.literal('card')]),
    /** Depth from the canvas: the canvas is 0, so top-level zones and cards are 1. */
    depth: z.number(),
    /** Height of the header band at the top of an open zone; 0 for chips, empty zones and cards. */
    headerHeight: z.number(),
    /** The open zone's inner padding ring (including any uniform `ring` reservation); 0 otherwise. */
    padding: z.number(),
    /**
     * Extra padding on single sides of an open zone (the router's lane space, `GutterWidening.ringSides`), on top
     * of `padding`; absent when there is none. The children lie inside `padding` + `paddingExtra` on each side;
     * the header is unaffected (a folder's title still starts `padding` from the left).
     */
    paddingExtra: InsetsSchema.exactOptional(),
    chipCountLine: z.string().exactOptional(),
    /** True for a chip (a collapsed zone). */
    collapsed: z.boolean(),
  })
  .readonly();
export type LayoutRect = z.infer<typeof LayoutRectSchema>;

/** A side of a rect. */
export const SideSchema = z.enum(['top', 'right', 'bottom', 'left']);
export type Side = z.infer<typeof SideSchema>;

/** Where an edge meets one of its rects: a point on that rect's border and the side it lies on. */
export const EdgePortSchema = PointSchema.unwrap().extend({ side: SideSchema }).readonly();
export type EdgePort = z.infer<typeof EdgePortSchema>;

/**
 * Which ends of an edge carry an arrowhead, from the relation kind's default style (`RELATION_KINDS` in
 * `@gcportrait/model`): `both` for a double-headed (symmetric) kind such as `peers`, `none` for a kind drawn
 * with round caps (`connects`), `end` otherwise.
 */
export const EdgeHeadsSchema = z.enum(['end', 'both', 'none']);
export type EdgeHeads = z.infer<typeof EdgeHeadsSchema>;

/**
 * A hub's bundle (skill gcp-diagram-layout §5, ports): the edges of one kind that meet one rect at the same end
 * (all as targets, or all as sources) and from the same side, sharing that end's port and their lanes towards it.
 */
export const EdgeBundleSchema = z
  .strictObject({
    /**
     * Unique per bundle: `<rect id> <-<kind>- * (<side>)` for a shared target, `<rect id> -<kind>-> * (<side>)` for
     * a shared source (`<side>, inside` for a port on the inside of a zone that contains the other ends; a `#2`, …
     * suffix in the rare case of two bundles of one kind on one side).
     */
    id: z.string(),
    /** The end the members share. */
    end: z.enum(['source', 'target']),
    /** How many edges the bundle holds. */
    size: z.number(),
  })
  .readonly();
export type EdgeBundle = z.infer<typeof EdgeBundleSchema>;

/**
 * A routed edge (stage 5): an orthogonal polyline through the gutters. `points` run from the source end to
 * the target end; an end with an arrowhead stops at the head's tip, `Routing.arrowInset` (2 px) inside the
 * rect's border, an end without one at its port. Every segment is horizontal or vertical; the renderer rounds
 * each elbow with `elbowRadius`, at most half the shorter of its two segments and, next to an arrowhead, at
 * most what the end segment leaves beside the head (the end segment can be as short as the gutter allows,
 * e.g. 10 px in a 16 px padding ring, shorter than a 9 px head plus the radius): the head sits on a straight
 * stretch.
 */
export const EdgePathSchema = z
  .strictObject({
    from: z.string(),
    to: z.string(),
    kind: RelationKindSchema,
    /** How many Scene relations the edge stands for (merged duplicates, re-targeted ends); at least 1. */
    count: z.number(),
    /** Whether the Scene marked an end re-targeted to a chip or the layout merged several Scene edges into it. */
    merged: z.boolean(),
    heads: EdgeHeadsSchema,
    /** The port on the border of `from`'s rect. */
    source: EdgePortSchema,
    /** The port on the border of `to`'s rect. */
    target: EdgePortSchema,
    points: z.array(PointSchema).readonly(),
    /** Radius of the rounded elbows; 0 when the path is straight. */
    elbowRadius: z.number(),
    /** True when no gutter path existed and the coarse-grid fallback routed the edge (should never happen). */
    fallback: z.boolean(),
    /**
     * The hub bundle the edge belongs to; absent for an edge of its own. Its members share the port at the
     * bundle's end (`end`), and lanes towards it: where their points coincide they are one trunk, so the renderer
     * draws a member's dashes from that shared end (the dash patterns then coincide along the trunk) and its
     * shared arrowhead once.
     */
    bundle: EdgeBundleSchema.exactOptional(),
  })
  .readonly();
export type EdgePath = z.infer<typeof EdgePathSchema>;
