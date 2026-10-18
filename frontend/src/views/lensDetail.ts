// SPDX-License-Identifier: Apache-2.0
/**
 * What a lens switch does to the detail level (layout skill §6; the catalog lens files' `defaultDetail`).
 *
 * **The ceiling.** A lens's `defaultDetail` (from the catalog's lens files) is the deepest level `auto` opens it at
 * (the scene builder's rule, `autoDetailLevel` in `@gcportrait/graph`), so a lens opens readable on any canvas
 * instead of drawing a level the budget cannot fit. An explicit level the person chooses still wins.
 *
 * **The rule.** The detail level follows the lens while it is `auto`, or the current lens's own `defaultDetail`
 * (what a link may hold, and what choosing the lens's own level means): a lens switch then sets
 * `auto`, which opens the new lens at most at its default. Once the person has chosen another level than the
 * current lens's default, that level is theirs and stays across lens switches. The URL hash is the only state,
 * so nothing remembers *who* set the level, and a shared link behaves exactly like the view it came from. While
 * the catalog's lens list has not arrived, a switch keeps the level. Every lens switch follows this rule: the
 * Lens picker and the search reveal dialog's "Switch to the Everything lens" (search/locate.ts). Pure.
 */
import type { DetailLevel, LensId, ViewSpec, ViewSpecInput } from '@gcportrait/model';

/** Each lens's default detail level (from the catalog's lens files, through the data worker). */
export type LensDefaults = Readonly<Partial<Record<LensId, DetailLevel>>>;

/** Whether the view's detail level follows its lens: `auto`, or the level its lens opens at. */
export function detailFollowsLens(spec: ViewSpec, defaults: LensDefaults): boolean {
  if (spec.detail === 'auto') return true;
  const current = defaults[spec.lens];
  return current !== undefined && spec.detail === current;
}

/** The view with another lens, the detail level following the rule above. */
export function viewWithLens(spec: ViewSpec, lens: LensId, defaults: LensDefaults): ViewSpecInput {
  return { ...spec, lens, detail: detailFollowsLens(spec, defaults) ? 'auto' : spec.detail };
}
