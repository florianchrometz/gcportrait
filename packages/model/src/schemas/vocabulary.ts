// SPDX-License-Identifier: Apache-2.0
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
import { RFC3339_PATTERN, ULID_PATTERN } from './patterns.js';

export const RENDER_DEFAULT_SCALE = 2;
export const RENDER_MAX_SCALE = 3;
export const RENDER_MAX_SIDE = 16_384;
export const RENDER_MAX_PIXELS = 2 ** 27;
export const RENDER_PNG_MARGIN = 24;
export const RENDER_PNG_LIMITS = Object.freeze({ side: RENDER_MAX_SIDE, area: RENDER_MAX_PIXELS });
export const RENDER_DEFAULT_VIEWPORT = Object.freeze({ width: 1280, height: 800 });
export const RENDER_THEMES = ['light', 'dark'] as const;

export const FONT_FACE_KEYS = Object.freeze(['sans-400', 'sans-500', 'sans-700', 'mono-400'] as const);

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

/** The three kinds of Cloud Asset Inventory scope. */
export const SCOPE_KINDS = ['organization', 'folder', 'project'] as const;

/** A Cloud Asset Inventory scope kind. */
export type ScopeKind = (typeof SCOPE_KINDS)[number];

/** The Cloud Asset Inventory resource collection of each scope kind. */
export const SCOPE_COLLECTIONS = Object.freeze({
  organization: 'organizations',
  folder: 'folders',
  project: 'projects',
} as const);

export type ScopeCollection = (typeof SCOPE_COLLECTIONS)[ScopeKind];

/**
 * A scope's resource path as Cloud Asset Inventory names it: `organizations/<id>`, `folders/<id>`, or `projects/<id>`.
 */
export function scopePathOf(scope: { readonly kind: ScopeKind; readonly id: string }): string {
  return `${SCOPE_COLLECTIONS[scope.kind]}/${scope.id}`;
}

export const RESOURCE_MANAGER_ORGANIZATION = 'cloudresourcemanager.googleapis.com/Organization';
export const RESOURCE_MANAGER_FOLDER = 'cloudresourcemanager.googleapis.com/Folder';
export const RESOURCE_MANAGER_PROJECT = 'cloudresourcemanager.googleapis.com/Project';

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

/** Daily ticks on the timeline: today and the 34 days before it (CAI reads at most 35 days back). */
export const TIMELINE_DAYS = 35;

export const DAY_MS = 86_400_000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The UTC calendar day (`YYYY-MM-DD`) of an instant in milliseconds since the epoch. */
export function utcDayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Whether `value` is a real calendar day written `YYYY-MM-DD` (what a ViewSpec's `tick` holds). */
export function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY_PATTERN.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && utcDayOf(ms) === value;
}

/** The start of a day, 00:00 UTC, in milliseconds since the epoch. */
export function dayStart(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

/** The read time of a day's tick: `YYYY-MM-DDT00:00:00Z`. */
export function dayReadTime(day: string): string {
  return `${day}T00:00:00Z`;
}

/** The day `days` days after `day` (before it when negative). */
export function addDays(day: string, days: number): string {
  return utcDayOf(dayStart(day) + days * DAY_MS);
}

/** Whether `value` is a valid RFC 3339 timestamp representing a real calendar instant. */
export function isRfc3339Timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !RFC3339_PATTERN.test(value)) return false;
  if (!isDay(value.slice(0, 10))) return false;
  return Number.isFinite(Date.parse(value));
}

/** The UTC day a read time (RFC 3339) falls on; null when it is not a valid RFC 3339 time. */
export function dayOfReadTime(readTime: string): string | null {
  if (!isRfc3339Timestamp(readTime)) return null;
  return utcDayOf(Date.parse(readTime));
}

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

export function isScopeKind(value: unknown): value is ScopeKind {
  return member(SCOPE_KINDS, value);
}

export function isDemoSize(value: unknown): value is DemoSize {
  return member(DEMO_SIZES, value);
}

/** The demo size of a snapshot ref (`demo:M` → `'M'`), or null when `ref` is not a demo ref. */
export function demoSizeOfRef(ref: unknown): DemoSize | null {
  if (typeof ref !== 'string' || !ref.startsWith(DEMO_REF_PREFIX)) return null;
  const size = ref.slice(DEMO_REF_PREFIX.length);
  return isDemoSize(size) ? size : null;
}

/** The snapshot ref of a demo organisation (`demo:<size>`). */
export function demoRefOfSize(size: DemoSize): SnapshotRef {
  return `${DEMO_REF_PREFIX}${size}`;
}

/** A snapshot ref: `''` (none chosen), a stored snapshot's ULID, or `demo:<size>`. */
export function isSnapshotRef(value: unknown): value is SnapshotRef {
  if (typeof value !== 'string') return false;
  if (value === '' || ULID_PATTERN.test(value)) return true;
  return demoSizeOfRef(value) !== null;
}
