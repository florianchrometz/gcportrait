// SPDX-License-Identifier: MIT
/**
 * Progressive disclosure through the app store: selectors over the store's state for the
 * "N of M shown" indicator and whether "Expand all" and "Collapse all" would change anything (the actions
 * themselves are the store's, `actions.expandAll` and `actions.collapseAll`), and the two notices (flips over
 * the 48 cap, the `auto` level changed with the canvas size), worked out from the store's changes. The buttons
 * describe the drawing on screen with the view it draws (its scene key, decoded), so they never mix one view's
 * hash with another view's drawing while a new one is prepared; the store's actions wait for the view's own
 * drawing. Every selector returns a primitive or null, as `useAppState` asks; the work behind them is cached per
 * drawing and canvas budget.
 */
import { decodeViewSpec, type ViewSpec } from '@gcportrait/model';
import { useCallback, useEffect, useState } from 'react';

import { useAppStore } from '../../state/hooks';
import { FALLBACK_VIEWPORT } from '../../state/pipeline';
import type { AppState, PipelineResult } from '../../state/slices';
import { budgetOf } from '../autoDetail';
import {
  autoLevelShift,
  collapseAllView,
  expandAllView,
  flipsDroppedByCap,
  LEVEL_NAMES,
  nextOpeningLevel,
  rectsShown,
  zonesByFlip,
  type AutoLevelShift,
  type ShownScene,
  type ZoneState,
} from './flips';

/** The Scene on screen, on the diagram route; null otherwise. */
function shownScene(state: AppState): ShownScene | null {
  if (!state.view.onDiagram) return null;
  return state.pipeline.result?.answer ?? null;
}

/** The rects drawn ("N"), or null when nothing is drawn. */
export function selectRectsShown(state: AppState): number | null {
  const shown = shownScene(state);
  return shown === null ? null : rectsShown(shown).shown;
}

/** The rects the view holds at `all` ("M"), or null when nothing is drawn. */
export function selectRectsTotal(state: AppState): number | null {
  const shown = shownScene(state);
  return shown === null ? null : rectsShown(shown).total;
}

const DRAWN_SPECS = new WeakMap<PipelineResult, ViewSpec>();

/** The view the drawing on screen draws: its scene key, decoded (the hash without selection and highlight). */
function drawnSpec(result: PipelineResult): ViewSpec {
  let spec = DRAWN_SPECS.get(result);
  if (spec === undefined) {
    spec = decodeViewSpec(result.key);
    DRAWN_SPECS.set(result, spec);
  }
  return spec;
}

interface Availability {
  readonly result: PipelineResult;
  readonly budget: number;
  readonly expand: boolean;
  readonly collapse: boolean;
}

let cached: Availability | null = null;

function availability(state: AppState): Availability | null {
  const result = state.view.onDiagram ? state.pipeline.result : null;
  if (result === null) return null;
  // `auto` as the pipeline would pick it now: at the canvas's size, which a level chosen by hand never redraws.
  const budget = budgetOf(state.pipeline.canvas ?? FALLBACK_VIEWPORT);
  if (cached?.result !== result || cached.budget !== budget) {
    const spec = drawnSpec(result);
    cached = {
      result,
      budget,
      expand: expandAllView(spec, result.answer) !== null,
      collapse: collapseAllView(spec, result.answer, budget) !== null,
    };
  }
  return cached;
}

/** Whether "Expand all" would open anything in the diagram on screen. */
export function selectCanExpandAll(state: AppState): boolean {
  return availability(state)?.expand ?? false;
}

/** Whether "Collapse all" would close anything in the diagram on screen. */
export function selectCanCollapseAll(state: AppState): boolean {
  return availability(state)?.collapse ?? false;
}

/** The level "Expand all" would open ("Projects"), or null when it would only reopen zones closed by hand. */
export function selectExpandLevelName(state: AppState): string | null {
  const result = state.view.onDiagram ? state.pipeline.result : null;
  if (result === null) return null;
  const level = nextOpeningLevel(drawnSpec(result), result.answer);
  return level === null ? null : LEVEL_NAMES[level];
}

/** The detail level in use, as the page writes it ("Folders"), or null when nothing is drawn. */
export function selectUsedLevelName(state: AppState): string | null {
  const shown = shownScene(state);
  return shown === null ? null : LEVEL_NAMES[shown.report.detail.used];
}

/** What the person is told when the cap dropped flips (labels of the zones on screen when known). */
export function droppedNotice(dropped: readonly string[], shown: ShownScene | null): string {
  const zones: ReadonlyMap<string, ZoneState> = shown === null ? new Map() : zonesByFlip(shown);
  const labels = dropped.flatMap((token) => {
    const label = zones.get(token)?.label;
    return label === undefined ? [] : [label];
  });
  const which =
    dropped.length === 1
      ? labels.length === 1
        ? `the oldest, ${labels[0] ?? ''}, is`
        : 'the oldest is'
      : `the ${String(dropped.length)} oldest are`;
  return `At most 48 zones keep an expand or collapse made by hand: ${which} back to the detail level’s default.`;
}

/** What the person is told when `auto` picked another level because the canvas changed size. */
export function shiftNotice(shift: AutoLevelShift): string {
  const area = shift.larger ? 'larger' : 'smaller';
  return `The diagram area got ${area}, so Auto detail now shows ${LEVEL_NAMES[shift.to]} (it showed ${LEVEL_NAMES[shift.from]}).`;
}

/**
 * The disclosure notice on screen and a function that dismisses it. It follows the store: when a view change
 * dropped flips over the 48 cap (`flipsDroppedByCap`, whoever made the change: a chip, search, a saved view),
 * and when the pipeline drew the same view at another `auto` level because the canvas changed size
 * (`autoLevelShift`). A newer notice replaces the one shown; it stays until dismissed.
 */
export function useDisclosureNotice(): readonly [string | null, () => void] {
  const store = useAppStore();
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    let flips = store.getState().view.spec.flips;
    let result = store.getState().pipeline.result;
    return store.subscribe(() => {
      const state = store.getState();
      const nextFlips = state.view.spec.flips;
      if (nextFlips !== flips) {
        const dropped = flipsDroppedByCap(flips, nextFlips);
        flips = nextFlips;
        // The drawing on screen is still the one the dropped zones were flipped on.
        if (dropped.length > 0) setNotice(droppedNotice(dropped, state.pipeline.result?.answer ?? null));
      }
      const nextResult = state.pipeline.result;
      if (nextResult !== result) {
        const shift = autoLevelShift(result, nextResult);
        result = nextResult;
        if (shift !== null) setNotice(shiftNotice(shift));
      }
    });
  }, [store]);
  const dismiss = useCallback((): void => {
    setNotice(null);
  }, []);
  return [notice, dismiss] as const;
}
