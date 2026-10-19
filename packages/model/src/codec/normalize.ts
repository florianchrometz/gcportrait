// SPDX-License-Identifier: Apache-2.0
/**
 * `normalizeViewSpec` and the view constants, without zod (AGENTS.md, Architecture and code). The URL-hash
 * codec (view-hash.ts) runs on the app's UI thread for every hash it reads and writes, so its parse path is
 * plain code: each field is checked by a small predicate that accepts exactly what the field's schema in
 * schemas/view-spec.ts accepts (the same patterns from schemas/patterns.ts and tuples from
 * schemas/vocabulary.ts). The schemas stay the definition and validate where it matters (worker messages,
 * tests); normalize.test.ts proves each predicate against its schema, and the property tests prove the whole
 * normaliser against a zod-based reference and `ViewSpecSchema`.
 */
import type { Focus, LooseViewSpec, ViewFilters, ViewSpec, ViewSpecInput } from '../schemas/view-spec.js';
import {
  ASSET_TYPE_PATTERN_OR_GLOB,
  LOCATION_PATTERN,
  NUMERIC_ID_PATTERN,
  PROJECT_REF_PATTERN,
  WELL_FORMED_TEXT_PATTERN,
} from '../schemas/patterns.js';
import { isDay, isDetailLevel, isFocusKind, isLensId, isSnapshotRef } from '../schemas/vocabulary.js';

/** The flips list keeps at most this many entries, newest last (skill gcp-diagram-layout §6). */
export const VIEW_SPEC_MAX_FLIPS = 48;

/** Deepest containment depth a view may limit to. Real hierarchies stay far below it. */
export const VIEW_SPEC_MAX_DEPTH = 64;

/** A focus parameter name; it appears in the URL hash as `focus.<name>`. */
export const FOCUS_PARAM_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** A per-container expand/collapse override: an opaque, URL-safe token derived from the container id. */
export const FLIP_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

const DEFAULT_FILTERS: ViewFilters = {
  hideEmptyProjects: false,
  hideEmptyFolders: false,
  hideDisconnected: false,
};
const NO_FLIPS: string[] = [];

/** The view an empty URL hash stands for. Deeply frozen: derive a new spec with {@link normalizeViewSpec}. */
export const DEFAULT_VIEW_SPEC: ViewSpec = {
  snapshot: '',
  lens: 'overview',
  filters: DEFAULT_FILTERS,
  detail: 'auto',
  flips: NO_FLIPS,
};
Object.freeze(DEFAULT_FILTERS);
Object.freeze(NO_FLIPS);
Object.freeze(DEFAULT_VIEW_SPEC);

/** A string that matches `pattern` (the `z.string().regex(pattern)` of a schema). */
function matching(pattern: RegExp): (value: unknown) => value is string {
  return (value): value is string => typeof value === 'string' && pattern.test(value);
}

/** `TextSchema`: non-empty, well-formed text. */
export const isText = matching(WELL_FORMED_TEXT_PATTERN);
/** `LocationSchema`. */
export const isLocation = matching(LOCATION_PATTERN);
/** `ProjectRefSchema`. */
export const isProjectRef = matching(PROJECT_REF_PATTERN);
/** `NumericIdSchema`. */
export const isNumericId = matching(NUMERIC_ID_PATTERN);
/** `AssetTypePatternSchema`. */
export const isAssetTypePattern = matching(ASSET_TYPE_PATTERN_OR_GLOB);
/** `FocusParamNameSchema`. */
export const isFocusParamName = matching(FOCUS_PARAM_NAME_PATTERN);
/** `FlipIdSchema`. */
export const isFlipId = matching(FLIP_ID_PATTERN);

/** `DepthSchema`: an integer from 1 to {@link VIEW_SPEC_MAX_DEPTH}. */
export function isDepth(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= VIEW_SPEC_MAX_DEPTH;
}

/** An extra tick's time of day: `THH:MM:SSZ`, to the second, in UTC. */
const UTC_SECOND = /^T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$/;

/**
 * `TickSchema`: a day tick, a calendar date `YYYY-MM-DD` that exists (`2026-02-29` does not), or an extra tick, a
 * read time to the second in UTC, `YYYY-MM-DDTHH:MM:SSZ`.
 */
export function isTick(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 10) return isDay(value);
  return value.length === 20 && isDay(value.slice(0, 10)) && UTC_SECOND.test(value.slice(10));
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/**
 * The own key/value pairs of a plain object (its prototype `Object.prototype` or null); nothing for anything
 * else (arrays, class instances, primitives).
 */
function plainRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) return {};
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return {};
  const record: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (key !== '__proto__') record[key] = (value as Record<string, unknown>)[key];
  }
  return record;
}

function valid<T>(test: (value: unknown) => value is T, value: unknown): T | undefined {
  return test(value) ? value : undefined;
}

/** The valid items of a list, in input order. Anything that is not an array has none. */
function validItems<T>(test: (value: unknown) => value is T, value: unknown): T[] {
  const items: readonly unknown[] = Array.isArray(value) ? value : [];
  return items.filter(test);
}

/** A set-like filter list in canonical form: valid items, unique, sorted; absent when empty. */
function canonicalSet(test: (value: unknown) => value is string, value: unknown): string[] | undefined {
  const items = [...new Set(validItems(test, value))].sort();
  return items.length > 0 ? items : undefined;
}

/**
 * Flips in canonical form: valid, each id once (its newest occurrence), the newest {@link
 * VIEW_SPEC_MAX_FLIPS}.
 */
function canonicalFlips(value: unknown): string[] {
  const newestFirst = [...new Set(validItems(isFlipId, value).reverse())];
  return newestFirst.slice(0, VIEW_SPEC_MAX_FLIPS).reverse();
}

function canonicalFocus(value: unknown): Focus | undefined {
  const focus = plainRecord(value);
  const kind = valid(isFocusKind, focus['kind']);
  if (kind === undefined) return undefined;
  const params = Object.entries(plainRecord(focus['params']))
    .filter((entry): entry is [string, string] => isFocusParamName(entry[0]) && isText(entry[1]))
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return { kind, params: Object.fromEntries(params) };
}

function canonicalFilters(value: unknown): ViewFilters {
  const input = plainRecord(value);
  const result: ViewFilters = {
    hideEmptyProjects: valid(isBoolean, input['hideEmptyProjects']) ?? false,
    hideEmptyFolders: valid(isBoolean, input['hideEmptyFolders']) ?? false,
    hideDisconnected: valid(isBoolean, input['hideDisconnected']) ?? false,
  };
  const regions = canonicalSet(isLocation, input['regions']);
  if (regions) result.regions = regions;
  const projects = canonicalSet(isProjectRef, input['projects']);
  if (projects) result.projects = projects;
  const folders = canonicalSet(isNumericId, input['folders']);
  if (folders) result.folders = folders;
  const includeTypes = canonicalSet(isAssetTypePattern, input['includeTypes']);
  if (includeTypes) result.includeTypes = includeTypes;
  const excludeTypes = canonicalSet(isAssetTypePattern, input['excludeTypes']);
  if (excludeTypes) result.excludeTypes = excludeTypes;
  const depth = valid(isDepth, input['depth']);
  if (depth !== undefined) result.depth = depth;
  const showRegions = valid(isBoolean, input['showRegions']);
  if (showRegions !== undefined) result.showRegions = showRegions;
  const showIdentities = valid(isBoolean, input['showIdentities']);
  if (showIdentities !== undefined) result.showIdentities = showIdentities;
  return result;
}

/**
 * Turns any subset of a ViewSpec into a complete, valid ViewSpec in canonical form. Field by field: a missing
 * or invalid value takes its default (optional fields are dropped); filter lists keep their valid items,
 * de-duplicated and sorted, and an empty list is dropped; flips keep each id's newest occurrence and the
 * newest {@link VIEW_SPEC_MAX_FLIPS}; focus parameters with an invalid name or value are dropped. Never
 * throws for plain data of any shape (it is not given getters or proxies).
 * `decodeViewSpec(encodeViewSpec(spec))` deep-equals `normalizeViewSpec(spec)`.
 */
export function normalizeViewSpec(input: ViewSpecInput | LooseViewSpec): ViewSpec {
  const loose = plainRecord(input);
  const spec: ViewSpec = {
    snapshot: valid(isSnapshotRef, loose['snapshot']) ?? DEFAULT_VIEW_SPEC.snapshot,
    lens: valid(isLensId, loose['lens']) ?? DEFAULT_VIEW_SPEC.lens,
    filters: canonicalFilters(loose['filters']),
    detail: valid(isDetailLevel, loose['detail']) ?? DEFAULT_VIEW_SPEC.detail,
    flips: canonicalFlips(loose['flips']),
  };
  const tick = valid(isTick, loose['tick']);
  if (tick !== undefined) spec.tick = tick;
  const focus = canonicalFocus(loose['focus']);
  if (focus) spec.focus = focus;
  const root = valid(isText, loose['root']);
  if (root !== undefined) spec.root = root;
  const selection = valid(isText, loose['selection']);
  if (selection !== undefined) spec.selection = selection;
  const highlight = valid(isText, loose['highlight']);
  if (highlight !== undefined) spec.highlight = highlight;
  return spec;
}
