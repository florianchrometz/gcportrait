// SPDX-License-Identifier: MIT
/** A normalised Cloud Asset Inventory asset (skill cai-ingestion §2). */
import * as z from 'zod';
import {
  ANCESTOR_PATTERN,
  AssetTypeSchema,
  NonEmptyStringSchema,
  ResourceNameSchema,
  TimestampSchema,
} from './primitives.js';

/** One entry of `ancestors`: `projects/<number>`, `folders/<number>` or `organizations/<number>`. */
export const AncestorSchema = z
  .string()
  .regex(ANCESTOR_PATTERN, 'must be projects/…, folders/… or organizations/…');

/**
 * One asset as Cloud Asset Inventory returns it with content type RESOURCE, flattened: `resource.parent`,
 * `resource.location` and `resource.data` move to the top level. Names are kept verbatim. Unknown keys are
 * stripped, so a newer export format still parses.
 */
export const AssetSchema = z.object({
  /** Full resource name, e.g. `//compute.googleapis.com/projects/p/zones/z/instances/i`. */
  name: ResourceNameSchema,
  /** Asset type, e.g. `compute.googleapis.com/Instance`. */
  assetType: AssetTypeSchema,
  /** `resource.parent`: the immediate parent's full resource name. */
  parent: ResourceNameSchema.exactOptional(),
  /** `ancestors`, closest first: `['projects/123', 'folders/456', 'organizations/789']`. */
  ancestors: z.array(AncestorSchema),
  /**
   * `resource.location`: `global`, a region or a zone, verbatim (some products use upper case). Absent when
   * CAI reports none or an empty string.
   */
  location: NonEmptyStringSchema.exactOptional(),
  /** When CAI last saw the asset change (RFC 3339). */
  updateTime: TimestampSchema,
  /** `resource.data`, untouched. Never assume a field inside it is present. */
  data: z.unknown(),
});

export type Asset = z.infer<typeof AssetSchema>;
