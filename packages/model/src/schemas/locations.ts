// SPDX-License-Identifier: MIT
/**
 * The shape of Google Cloud's location names, and the one rule that turns a zone into its region (AGENTS.md,
 * Data and graph semantics: one source of truth per concept). The catalog's templates and `siblingName`
 * placeholders, the graph's virtual region and zone containers and its regions filter, and the app's filter
 * choices all read a location through these functions, so a resource lies in the same region for the filter
 * as in the drawing. The module imports nothing (no zod), so the app's UI thread may use it too.
 *
 * - A region is `<geography>-<area><n>`: `europe-west3`, `us-central1`, `northamerica-northeast1`.
 * - A zone is its region, a hyphen and a suffix of lower-case letters and digits: `europe-west3-b`, or an AI
 *   zone's longer suffix, `us-central1-ai1a`.
 * - Anything else is a location of its own: `global`, a multi-region (`us`, `eu`) or a multi-region
 *   configuration (`nam4`, `eur3`).
 *
 * Names match as Cloud Asset Inventory writes them, in lower case; a caller that compares locations across
 * cases lower-cases them first.
 */

const REGION = /^[a-z]+-[a-z]+[0-9]+$/;
const ZONE = /^([a-z]+-[a-z]+[0-9]+)-[a-z0-9]+$/;

/** Whether a location is a region (`europe-west3`), not a zone, a multi-region or `global`. */
export function isRegion(location: string): boolean {
  return REGION.test(location);
}

/** Whether a location is a zone (`europe-west3-b`, `us-central1-ai1a`). */
export function isZone(location: string): boolean {
  return ZONE.test(location);
}

/** The region a zone lies in (`us-central1-ai1a` → `us-central1`); undefined for a location that is no zone. */
export function zoneRegion(location: string): string | undefined {
  return ZONE.exec(location)?.[1];
}

/** A zone's region (`europe-west3-b` → `europe-west3`); any other location unchanged. */
export function regionOfZone(location: string): string {
  return zoneRegion(location) ?? location;
}
