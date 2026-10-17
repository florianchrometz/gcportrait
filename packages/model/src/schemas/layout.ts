// SPDX-License-Identifier: MIT
import * as z from 'zod';
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
    /** True for a chip (a collapsed zone). */
    collapsed: z.boolean(),
  })
  .readonly();
export type LayoutRect = z.infer<typeof LayoutRectSchema>;
