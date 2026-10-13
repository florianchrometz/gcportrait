// SPDX-License-Identifier: MIT
/**
 * The numbers of progressive disclosure (skill gcp-diagram-layout §4 and §6) and
 * the scene builder's few fixed keys.
 */

/** A view whose fully opened scene has at most this many rects is never collapsed by `auto`. */
export const NEVER_COLLAPSE_RECTS = 100;

/** A zone (or the canvas) with more visible children than this bundles them into `group` zones. */
export const BUNDLE_THRESHOLD = 120;

/**
 * The size a bundle aims for; the members are spread evenly, so every bundle holds 20–24 of them (121
 * siblings make six bundles of 20 or 21).
 */
export const BUNDLE_SIZE = 24;

/** Viewport area per rect in the `auto` budget, and the budget's bounds (skill gcp-diagram-layout §6). */
export const VIEWPORT_AREA_PER_RECT = 14_000;
export const MIN_VIEWPORT_BUDGET = 24;
export const MAX_VIEWPORT_BUDGET = 250;

/** The smallest supported viewport (desktop only, at least 1280×800: agents.md, Product rules). */
export const MIN_VIEWPORT = { width: 1280, height: 800 } as const;

/**
 * The rect budget of `auto` for a viewport: `width × height / 14000`, rounded down and clamped to 24–250. The
 * caller passes it as `SceneEnv.viewportBudget`.
 */
export function viewportBudget(width: number, height: number): number {
  const raw = Math.floor((Math.max(0, width) * Math.max(0, height)) / VIEWPORT_AREA_PER_RECT);
  if (Number.isNaN(raw)) return MIN_VIEWPORT_BUDGET;
  return Math.min(MAX_VIEWPORT_BUDGET, Math.max(MIN_VIEWPORT_BUDGET, raw));
}

/** The budget used when the caller passes none: the one of the smallest supported viewport (73). */
export const DEFAULT_VIEWPORT_BUDGET = viewportBudget(MIN_VIEWPORT.width, MIN_VIEWPORT.height);

/**
 * The icon key of a card whose type and service the catalog does not know (agents.md, Product rules): the
 * generic cloud mark, the end of the icon fallback chain. `packages/icons` resolves it like any other key.
 */
export const GENERIC_ICON = 'cloud_generic';

/** The canvas title when neither a drill-in root, nor an organisation node, nor the caller names one. */
export const DEFAULT_ROOT_LABEL = 'All resources';

/** The prefix of a bundle zone's id; the rest is the id of its first member. */
export const BUNDLE_ID_PREFIX = 'group:';
