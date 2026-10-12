// SPDX-License-Identifier: MIT
/**
 * ViewSpec: everything that defines a view. It serialises into the URL hash
 * (`codec/view-hash.ts`); `snapshot` and `tick` make timeline positions shareable.
 */
import { z } from 'zod';
import { DetailLevelSchema, LensIdSchema } from './lens.js';
import {
  AssetTypePatternSchema,
  LocationSchema,
  NumericIdSchema,
  ProjectRefSchema,
  TextSchema,
  UlidSchema,
} from './primitives.js';
import { TickSchema } from './timeline.js';
import {
  FLIP_ID_PATTERN,
  FOCUS_PARAM_NAME_PATTERN,
  VIEW_SPEC_MAX_DEPTH,
  VIEW_SPEC_MAX_FLIPS,
} from '../codec/normalize.js';
import { DEMO_REF_PREFIX, DEMO_SIZES, FOCUS_KIND_IDS } from './vocabulary.js';

/**
 * The view constants, `DEFAULT_VIEW_SPEC` and `normalizeViewSpec` live in codec/normalize.ts, which imports no zod
 * (ADR 0029: the URL-hash codec runs on the app's UI thread); they are re-exported here for the package's own
 * modules and tests.
 */
export {
  DEFAULT_VIEW_SPEC,
  FLIP_ID_PATTERN,
  FOCUS_PARAM_NAME_PATTERN,
  VIEW_SPEC_MAX_DEPTH,
  VIEW_SPEC_MAX_FLIPS,
  normalizeViewSpec,
} from '../codec/normalize.js';

/** The synthetic demo organisations (ADR 0014). */
export const DemoSizeSchema = z.enum(DEMO_SIZES);
export type DemoSize = z.infer<typeof DemoSizeSchema>;

/**
 * Which snapshot a view shows: a stored snapshot's ULID, `demo:<size>` for a demo organisation, or the empty
 * string for "no snapshot chosen" (the app then shows the connect page or the most recent snapshot).
 */
export const SnapshotRefSchema = z.union([
  z.literal(''),
  UlidSchema,
  z.templateLiteral([DEMO_REF_PREFIX, DemoSizeSchema]),
]);
export type SnapshotRef = z.infer<typeof SnapshotRefSchema>;

/**
 * Focus views (docs/lenses-and-filters.md): one project, a Shared VPC host and its service projects,
 * standalone projects, a VPC-SC perimeter, an App Hub application.
 */
export const FocusKindSchema = z.enum(FOCUS_KIND_IDS);
export type FocusKind = z.infer<typeof FocusKindSchema>;

/** A focus parameter name; it appears in the URL hash as `focus.<name>`. */
export const FocusParamNameSchema = z
  .string()
  .regex(FOCUS_PARAM_NAME_PATTERN, 'must start with a letter and use only letters, digits, _ and -');

export const FocusSchema = z.strictObject({
  kind: FocusKindSchema,
  /** Kind-specific parameters, e.g. `{ project: 'demo-app' }` or `{ host: 'demo-net-host' }`. */
  params: z.record(FocusParamNameSchema, TextSchema),
});
export type Focus = z.infer<typeof FocusSchema>;

/** A per-container expand/collapse override: an opaque, URL-safe token derived from the container id. */
export const FlipIdSchema = z.string().regex(FLIP_ID_PATTERN, 'must be 1–32 URL-safe characters');

/** Containment depth limit, counted from the view root. */
export const DepthSchema = z.int().min(1).max(VIEW_SPEC_MAX_DEPTH);

export const ViewFiltersSchema = z.strictObject({
  hideEmptyProjects: z.boolean(),
  hideEmptyFolders: z.boolean(),
  hideDisconnected: z.boolean(),
  /** Locations to keep (`global`, regions, zones, multi-regions). Absent: no location filter. */
  regions: z.array(LocationSchema).exactOptional(),
  /** Project ids (or numbers) to keep. */
  projects: z.array(ProjectRefSchema).exactOptional(),
  /** Folder numbers to keep. */
  folders: z.array(NumericIdSchema).exactOptional(),
  /** Asset types or `<service>/*` globs to show in addition to the lens. */
  includeTypes: z.array(AssetTypePatternSchema).exactOptional(),
  /** Asset types or globs to hide. */
  excludeTypes: z.array(AssetTypePatternSchema).exactOptional(),
  depth: DepthSchema.exactOptional(),
  /** Virtual region/zone containers. Absent: follow the user's setting (off by default). */
  showRegions: z.boolean().exactOptional(),
  /** Identity cards (service accounts). Absent: the lens decides. */
  showIdentities: z.boolean().exactOptional(),
});
export type ViewFilters = z.infer<typeof ViewFiltersSchema>;

export const ViewSpecSchema = z.strictObject({
  snapshot: SnapshotRefSchema,
  /** Timeline day; absent means the snapshot's own read time. */
  tick: TickSchema.exactOptional(),
  lens: LensIdSchema,
  focus: FocusSchema.exactOptional(),
  /** Drill-in: the id of the container the view is rooted at. */
  root: TextSchema.exactOptional(),
  filters: ViewFiltersSchema,
  detail: DetailLevelSchema,
  /** Per-container overrides that XOR the detail level's default, oldest first. */
  flips: z.array(FlipIdSchema).max(VIEW_SPEC_MAX_FLIPS),
  /** The selected node id (opens the drawer). */
  selection: TextSchema.exactOptional(),
  /** A node id or search term whose matches are highlighted. */
  highlight: TextSchema.exactOptional(),
});
export type ViewSpec = z.infer<typeof ViewSpecSchema>;

/** What {@link normalizeViewSpec} accepts: any subset of a ViewSpec, filters included. */
export type ViewSpecInput = Partial<Omit<ViewSpec, 'filters'>> & { filters?: Partial<ViewFilters> };

/**
 * A ViewSpec-shaped object whose values have not been validated. The codec builds one from the hash;
 * {@link normalizeViewSpec} validates every field of it.
 */
export type LooseViewSpec = { [K in keyof ViewSpec]?: unknown };
