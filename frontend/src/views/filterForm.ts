// SPDX-License-Identifier: Apache-2.0
/**
 * The Filters popover's form and the ViewSpec's `filters` (`@gcportrait/model`), both ways. The form is never
 * state of its own: the popover shows `formOf(view.filters)` and every edit writes `filtersOf(edited form)`
 * through the store's `setFilters`, so the URL hash stays the only truth. Pure.
 *
 * | Form field | ViewSpec | Notes |
 * |---|---|---|
 * | `hideEmptyProjects`, `hideEmptyFolders`, `hideDisconnected` | the same booleans | the `hide` key |
 * | `regions`, `projects`, `folders`, `includeTypes`, `excludeTypes` | the same lists | `[]` ⇔ absent; de-duplicated and sorted |
 * | `depth` | `depth` | `0` ⇔ absent (no limit) |
 * | `showRegions` | `showRegions` | `'default'` ⇔ absent (the user's setting), `'show'` ⇔ true, `'hide'` ⇔ false |
 * | `showIdentities` | `showIdentities` | `'default'` ⇔ absent (the lens decides), `'show'`, `'hide'` |
 */
import {
  DEFAULT_VIEW_SPEC,
  normalizeViewSpec,
  VIEW_SPEC_MAX_DEPTH,
  type ViewFilters,
} from '@gcportrait/model';

/** A tri-state switch: absent (`default`), on (`show`) or off (`hide`). */
export type TriState = 'default' | 'show' | 'hide';

export interface FilterForm {
  readonly hideEmptyProjects: boolean;
  readonly hideEmptyFolders: boolean;
  readonly hideDisconnected: boolean;
  readonly regions: readonly string[];
  readonly projects: readonly string[];
  readonly folders: readonly string[];
  readonly includeTypes: readonly string[];
  readonly excludeTypes: readonly string[];
  /** The depth limit; 0 for none. */
  readonly depth: number;
  readonly showRegions: TriState;
  readonly showIdentities: TriState;
}

/** The list filters, in the popover's order. */
export const FILTER_LISTS = ['regions', 'projects', 'folders', 'includeTypes', 'excludeTypes'] as const;
export type FilterList = (typeof FILTER_LISTS)[number];

/** The hide switches, in the popover's order. */
export const HIDE_SWITCHES = ['hideEmptyProjects', 'hideEmptyFolders', 'hideDisconnected'] as const;
export type HideSwitch = (typeof HIDE_SWITCHES)[number];

/** The filters of a view with nothing filtered (the default view's). */
export const NO_FILTERS: ViewFilters = DEFAULT_VIEW_SPEC.filters;

/** The deepest limit the depth slider offers by default (a deeper one from a hash widens it). */
export const DEPTH_SLIDER_MAX = 12;

/**
 * The depth slider reads left to right as shallow to deep: positions 1 to `max` are depth limits, and the
 * position after them, at the right end, is "No limit" (the form's depth 0, no `depth` in the hash). `max` is the
 * deepest limit offered (`DEPTH_SLIDER_MAX`, or a deeper one the hash holds).
 */
export function depthSliderMax(depth: number): number {
  return Math.max(DEPTH_SLIDER_MAX, depth);
}

/** The slider position of a form depth (0: no limit, the right end). */
export function depthSliderValue(depth: number): number {
  return depth === 0 ? depthSliderMax(depth) + 1 : depth;
}

/** The form depth of a slider position on a slider whose deepest limit is `max` (past it: no limit, 0). */
export function depthFromSlider(position: number, max: number): number {
  return position > max ? 0 : position;
}

function triStateOf(value: boolean | undefined): TriState {
  if (value === undefined) return 'default';
  return value ? 'show' : 'hide';
}

export function formOf(filters: ViewFilters): FilterForm {
  return {
    hideEmptyProjects: filters.hideEmptyProjects,
    hideEmptyFolders: filters.hideEmptyFolders,
    hideDisconnected: filters.hideDisconnected,
    regions: filters.regions ?? [],
    projects: filters.projects ?? [],
    folders: filters.folders ?? [],
    includeTypes: filters.includeTypes ?? [],
    excludeTypes: filters.excludeTypes ?? [],
    depth: filters.depth ?? 0,
    showRegions: triStateOf(filters.showRegions),
    showIdentities: triStateOf(filters.showIdentities),
  };
}

/**
 * The ViewSpec filters of a form, in the canonical form the hash codec writes (`normalizeViewSpec`): empty
 * lists, no depth limit and `default` switches are left out, lists are de-duplicated and sorted, and a depth
 * outside 1–64 is clamped into it.
 */
export function filtersOf(form: FilterForm): ViewFilters {
  const filters: { -readonly [K in keyof ViewFilters]: ViewFilters[K] } = {
    hideEmptyProjects: form.hideEmptyProjects,
    hideEmptyFolders: form.hideEmptyFolders,
    hideDisconnected: form.hideDisconnected,
  };
  for (const list of FILTER_LISTS) {
    if (form[list].length > 0) filters[list] = [...form[list]];
  }
  if (form.depth > 0) filters.depth = Math.min(VIEW_SPEC_MAX_DEPTH, Math.max(1, Math.round(form.depth)));
  if (form.showRegions !== 'default') filters.showRegions = form.showRegions === 'show';
  if (form.showIdentities !== 'default') filters.showIdentities = form.showIdentities === 'show';
  return normalizeViewSpec({ filters }).filters;
}

/** The filters with one form field changed. */
export function withFormField<K extends keyof FilterForm>(
  filters: ViewFilters,
  field: K,
  value: FilterForm[K],
): ViewFilters {
  return filtersOf({ ...formOf(filters), [field]: value });
}

/** The filters with `value` added to, or removed from, one list. */
export function withListItem(
  filters: ViewFilters,
  list: FilterList,
  value: string,
  present: boolean,
): ViewFilters {
  const current = formOf(filters)[list];
  const next = present ? [...current, value] : current.filter((item) => item !== value);
  return withFormField(filters, list, next);
}

/**
 * How many filters are active, for the badge: each hide switch that is on, each non-empty list, a depth limit,
 * and each tri-state switch that is not `default`.
 */
export function activeFilterCount(filters: ViewFilters): number {
  const form = formOf(filters);
  return (
    HIDE_SWITCHES.filter((name) => form[name]).length +
    FILTER_LISTS.filter((name) => form[name].length > 0).length +
    (form.depth > 0 ? 1 : 0) +
    (form.showRegions === 'default' ? 0 : 1) +
    (form.showIdentities === 'default' ? 0 : 1)
  );
}
