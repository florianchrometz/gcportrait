// SPDX-License-Identifier: MIT
/**
 * Relation kinds and their metadata (skill gcp-asset-catalog §4). The renderer and the legend read styles and
 * default visibility from {@link RELATION_KINDS}; nothing else keeps a second copy of this table.
 */
import { z } from 'zod';
import { LensIdSchema } from './lens.js';
import { NonEmptyStringSchema } from './primitives.js';
import { RELATION_KIND_IDS } from './vocabulary.js';

export const RelationKindSchema = z.enum(RELATION_KIND_IDS);
export type RelationKind = z.infer<typeof RelationKindSchema>;

/**
 * Default drawing styles, one per entry of the relation-kind table's "Default style" column: `nesting` (never
 * an arrow), `nesting-or-thin-arrow` (nesting when the target is unambiguous, else a thin solid arrow),
 * `solid-arrow`, `dashed-double-headed`, `solid-round-caps`, `thin-dotted`, `dashed-overlay-zone` (an overlay
 * zone around the targets instead of a line), `solid-hollow-head` and `dashed-arrow`. The stroke, dash and
 * head values behind each id are theme data (skill gcp-diagram-style §5), not part of the model.
 */
export const EdgeStyleIdSchema = z.enum([
  'nesting',
  'nesting-or-thin-arrow',
  'solid-arrow',
  'dashed-double-headed',
  'solid-round-caps',
  'thin-dotted',
  'dashed-overlay-zone',
  'solid-hollow-head',
  'dashed-arrow',
]);
export type EdgeStyleId = z.infer<typeof EdgeStyleIdSchema>;

export const RelationKindInfoSchema = z.strictObject({
  /** What the relation means, with examples. */
  meaning: NonEmptyStringSchema,
  /** Which end is which, e.g. `parent → child`; `both` for symmetric kinds. */
  direction: NonEmptyStringSchema,
  defaultStyle: EdgeStyleIdSchema,
  /** Whether views draw the kind when the lens does not say otherwise. `contains` is drawn as nesting. */
  drawnByDefault: z.boolean(),
  /** For kinds that are not drawn by default: the lenses that draw them. */
  lensOnly: z.array(LensIdSchema).min(1).exactOptional(),
});
export type RelationKindInfo = z.infer<typeof RelationKindInfoSchema>;

/** The relation-kind table as data (in relation-kinds.ts, which imports no zod, so the app's UI thread can read it). */
export { RELATION_KINDS } from './relation-kinds.js';
