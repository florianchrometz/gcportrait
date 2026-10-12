// SPDX-License-Identifier: MIT
/**
 * Detail level `auto` against the measured canvas (layout skill §6): the scene builder picks the deepest level whose
 * rect count fits the viewport's budget (`viewportBudget`: px² / 14 000, clamped 24–250), never collapses a
 * view of at most 100 rects, and never opens deeper than the lens's `defaultDetail` (the report's
 * `detail.ceiling`). When the canvas is resized, the page decides here, from the Scene report's rect
 * counts, ceiling and the scene builder's own rule (`autoDetailLevel`) and without asking the worker, whether
 * the new size would pick another level, and asks for the view again only then. A hysteresis band keeps the level from flapping while a window edge is dragged across a
 * threshold: the budget must clear the next level's rect count by `AUTO_HYSTERESIS` (10 %) to open it, and fall
 * 10 % below the current level's count to close it. Pure.
 */
import { autoDetailLevel, DETAIL_LEVELS, viewportBudget } from '@gcportrait/graph';
import type { ConcreteDetailLevel, SceneDetail } from '@gcportrait/model';

import type { Viewport } from './pipeline/protocol';

/** How far (relative) the budget must move past a level's rect count before the level changes. */
export const AUTO_HYSTERESIS = 0.1;

/**
 * The level `auto` picks for a view drawn with `detail` at a budget: the scene builder's own rule
 * (`autoDetailLevel`, `@gcportrait/graph` step (e)), with the view's rect counts and its lens's ceiling.
 */
export function autoLevel(
  detail: Pick<SceneDetail, 'rectCounts' | 'ceiling'>,
  budget: number,
): ConcreteDetailLevel {
  return autoDetailLevel(detail.rectCounts, budget, detail.ceiling);
}

const rank = (level: ConcreteDetailLevel): number => DETAIL_LEVELS.indexOf(level);

/**
 * The level a view drawn at `detail` should switch to on a canvas whose budget is now `budget`, or null when it
 * should stay: only `auto` views switch, and only once the budget has left the hysteresis band.
 */
export function autoLevelChange(
  detail: SceneDetail,
  budget: number,
  hysteresis = AUTO_HYSTERESIS,
): ConcreteDetailLevel | null {
  if (detail.requested !== 'auto') return null;
  const opened = autoLevel(detail, budget * (1 - hysteresis));
  if (rank(opened) > rank(detail.used)) return opened;
  const closed = autoLevel(detail, budget * (1 + hysteresis));
  if (rank(closed) < rank(detail.used)) return closed;
  return null;
}

/** The budget of a canvas size (the data worker computes the same from the viewport it is sent). */
export function budgetOf(viewport: Viewport): number {
  return viewportBudget(viewport.width, viewport.height);
}

/**
 * The size of the diagram area for the budget, measured on the canvas element: its height, and the width of
 * its row (the canvas and the details drawer beside it), so opening the drawer never changes the level and
 * never re-lays the diagram out under the node just selected. Null while the element has no size (not laid
 * out yet, hidden, jsdom).
 */
export function measureDiagramArea(canvas: HTMLElement): Viewport | null {
  const width = canvas.parentElement?.clientWidth ?? canvas.clientWidth;
  const height = canvas.clientHeight;
  return width > 0 && height > 0 ? { width, height } : null;
}
