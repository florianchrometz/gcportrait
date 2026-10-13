// SPDX-License-Identifier: MIT
/**
 * The scene key the pipeline draws for the store's view (`selectSceneKey`): the view's own scene key, with the
 * timeline day that can be drawn now (`tickToDraw`). The pipeline asks for it, and the actions that are worked
 * out on the drawing on screen ("Expand all", "Collapse all") compare the drawing's key with it to tell whether
 * the drawing is the view's own yet. Plain functions of the state: no store, no worker.
 */
import type { ViewSpec } from '@gcportrait/model';

import { tickToDraw } from '../timeline/model';
import { sceneKey } from './sceneKey';
import type { AppState } from './slices';

// The view with the timeline day the pipeline draws, when that is not the view's own `tick`, by view and day.
const DRAWN_VIEWS = new WeakMap<ViewSpec, Map<string, ViewSpec>>();

function drawnView(spec: ViewSpec, day: string | undefined): ViewSpec {
  const known = DRAWN_VIEWS.get(spec) ?? new Map<string, ViewSpec>();
  DRAWN_VIEWS.set(spec, known);
  const key = day ?? '';
  let view = known.get(key);
  if (view === undefined) {
    const next: ViewSpec = { ...spec };
    if (day === undefined) delete next.tick;
    else next.tick = day;
    view = next;
    known.set(key, view);
  }
  return view;
}

/**
 * The scene key of the view: what the pipeline draws. Its timeline `tick` is the day that can be drawn now
 * (`tickToDraw`): a live day not read yet keeps the diagram on screen until it is.
 */
export function selectSceneKey(state: AppState): string {
  const { spec } = state.view;
  const result = state.pipeline.result?.answer.source ?? null;
  const day = tickToDraw(spec, state.timeline, result);
  return sceneKey(day === spec.tick ? spec : drawnView(spec, day));
}
