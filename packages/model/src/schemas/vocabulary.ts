// SPDX-License-Identifier: MIT
/**
 * The closed vocabularies of the model as plain tuples, and a type guard for each, in a module that imports no
 * zod: the lens ids, the detail levels, the relation kinds, the focus kinds, the demo sizes and the snapshot ref,
 * and the size above which the app asks before it draws a snapshot.
 * The schemas are built from these tuples (`z.enum(LENS_IDS)` in lens.ts, and so on), so there is one list of
 * each; code that only needs to list or test a value (the app's UI thread, which ships no zod) imports
 * these instead of a schema's `options` or `safeParse`. vocabulary.test.ts checks every guard against its schema.
 */
import type { DemoSize, FocusKind, SnapshotRef } from './view-spec.js';
import type { DetailLevel, LensId } from './lens.js';
import type { RelationKind } from './relation.js';
import { ULID_PATTERN } from './patterns.js';

export const RENDER_DEFAULT_SCALE = 2;
export const RENDER_MAX_SCALE = 3;
export const RENDER_MAX_SIDE = 16_384;
export const RENDER_MAX_PIXELS = 2 ** 27;
export const RENDER_PNG_MARGIN = 24;
export const RENDER_PNG_LIMITS = Object.freeze({ side: RENDER_MAX_SIDE, area: RENDER_MAX_PIXELS });
export const RENDER_DEFAULT_VIEWPORT = Object.freeze({ width: 1280, height: 800 });
export const RENDER_THEMES = ['light', 'dark'] as const;

/** The lenses, in menu order (`packages/catalog/lenses/<id>.yaml`). */
export const LENS_IDS = [
  'overview',
  'networking',
  'load-balancing',
  'compute',
  'serverless',
  'kubernetes',
  'data',
  'security',
  'identity',
  'operations',
  'everything',
] as const;

/** `auto` and the four progressive-disclosure levels from coarse to fine (skill gcp-diagram-layout §6). */
export const DETAIL_LEVEL_IDS = ['auto', 'folders', 'projects', 'networks', 'all'] as const;

/** The relation kinds, in the order of the relation-kind table (skill gcp-asset-catalog §4). */
export const RELATION_KIND_IDS = [
  'contains',
  'attaches',
  'routes',
  'uses',
  'peers',
  'connects',
  'memberOf',
  'runsAs',
  'encryptedBy',
  'secures',
  'triggers',
  'replicates',
  'shares',
] as const;

/** The focus views (docs/lenses-and-filters.md). */
export const FOCUS_KIND_IDS = [
  'project',
  'shared-vpc',
  'standalone-projects',
  'perimeter',
  'application',
] as const;

/** The synthetic demo organisations, smallest first. */
export const DEMO_SIZES = ['S', 'M', 'L', 'XL'] as const;

/** The prefix of a demo organisation's snapshot ref (`demo:M`). */
export const DEMO_REF_PREFIX = 'demo:';

/**
 * The most assets the app draws without asking first: drawing a larger snapshot at once is slow and heavy on
 * memory (the diagram still works), so the app asks for a confirmation before it draws one (docs/modes.md). The
 * app, its guide and the tests read this one value.
 */
export const LARGE_SNAPSHOT_ASSETS = 10_000;

function member<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

export function isLensId(value: unknown): value is LensId {
  return member(LENS_IDS, value);
}

export function isDetailLevel(value: unknown): value is DetailLevel {
  return member(DETAIL_LEVEL_IDS, value);
}

export function isRelationKind(value: unknown): value is RelationKind {
  return member(RELATION_KIND_IDS, value);
}

export function isFocusKind(value: unknown): value is FocusKind {
  return member(FOCUS_KIND_IDS, value);
}

export function isDemoSize(value: unknown): value is DemoSize {
  return member(DEMO_SIZES, value);
}

/** A snapshot ref: `''` (none chosen), a stored snapshot's ULID, or `demo:<size>`. */
export function isSnapshotRef(value: unknown): value is SnapshotRef {
  if (typeof value !== 'string') return false;
  if (value === '' || ULID_PATTERN.test(value)) return true;
  return value.startsWith(DEMO_REF_PREFIX) && isDemoSize(value.slice(DEMO_REF_PREFIX.length));
}
