// SPDX-License-Identifier: MIT
/** Lens ids and detail levels: the vocabulary shared by views, catalog lenses and the URL hash. */
import * as z from 'zod';
import { DETAIL_LEVEL_IDS, LENS_IDS } from './vocabulary.js';

/**
 * The lenses (docs/lenses-and-filters.md). Each is a catalog-driven list of types plus relation kinds to draw
 * (`packages/catalog/lenses/<id>.yaml`).
 */
export const LensIdSchema = z.enum(LENS_IDS);
export type LensId = z.infer<typeof LensIdSchema>;

/**
 * Progressive-disclosure levels (skill gcp-diagram-layout §6): `folders` shows folders with project chips,
 * `projects` opens projects with networks as chips, `networks` opens VPCs and subnets with product containers
 * as chips, `all` opens everything, and `auto` picks the deepest level that fits the viewport budget.
 */
export const DetailLevelSchema = z.enum(DETAIL_LEVEL_IDS);
export type DetailLevel = z.infer<typeof DetailLevelSchema>;
