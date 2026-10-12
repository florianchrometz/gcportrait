// SPDX-License-Identifier: MIT
/**
 * The app store in React. Components read slices through `useAppState(selector)` (`useSyncExternalStore`, so
 * a component re-renders only when what it selected changed; a selector must return something already in the
 * state or a primitive, never a new object) and change the view only through `useDiagramActions()`.
 *
 * The diagram page's hooks: `useScene()`, `useLayout()` and `useSelection()` read what is drawn and what is
 * selected; `useDiagramActions()` is the one way to change the view (lens, focus, detail, filters, drill-in,
 * flips, selection, highlight) or to ask the renderer for a camera glide (`jumpTo`). Feature code never calls the
 * router, the workers or the renderer itself.
 */
import type { Layout } from '@gcportrait/layout';
import type { ViewSpec } from '@gcportrait/model';
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';

import { measureDiagramArea } from '../diagram/autoDetail';
import type { SceneAnswer } from '../diagram/pipeline/protocol';
import { useDiagramSession } from '../diagram/session';
import { tickToDraw } from '../timeline/model';
import { AppStoreContext } from './context';
import { createPipelineController, sceneKey } from './pipeline';
import type { AppState, SelectionSlice, UiSlice } from './slices';
import type { AppStore, ViewActions } from './store';

export function useAppStore(): AppStore {
  const store = useContext(AppStoreContext);
  if (store === null) throw new Error('The app store is missing: render inside <AppStateProvider>.');
  return store;
}

export function useAppState<T>(selector: (state: AppState) => T): T {
  const store = useAppStore();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

/** The view in the URL hash (the default view away from /diagram). */
export function useView(): ViewSpec {
  return useAppState((state) => state.view.spec);
}

/** The Scene on screen with its report, source, lens title, icons and console links; null when none. */
export function useScene(): SceneAnswer | null {
  return useAppState((state) => state.pipeline.result?.answer ?? null);
}

/** The Layout on screen; null when none. */
export function useLayout(): Layout | null {
  return useAppState((state) => state.pipeline.result?.layout ?? null);
}

/** Selected and highlighted ids (from the hash) and the hovered one (from the canvas). */
export function useSelection(): SelectionSlice {
  return useAppState((state) => state.selection);
}

export function useUi(): UiSlice {
  return useAppState((state) => state.ui);
}

/** What changes the view (and asks for camera jumps); the same object for the life of the app. */
export function useDiagramActions(): ViewActions {
  return useAppStore().actions;
}

/**
 * Whether the top-bar popup `id` is open, and a setter: the store keeps one popup open at a time (`ui.popover`),
 * so opening one closes any other.
 */
export function usePopover(id: string): readonly [boolean, (open: boolean) => void] {
  const store = useAppStore();
  const open = useAppState((state) => state.ui.popover === id);
  const setOpen = useCallback(
    (next: boolean): void => {
      store.updateUi((ui) => {
        if (next) return ui.popover === id ? ui : { ...ui, popover: id };
        return ui.popover === id ? { ...ui, popover: null } : ui;
      });
    },
    [store, id],
  );
  return [open, setOpen] as const;
}

/** The scope the diagram on screen shows ("example.com"), for the breadcrumb; null when nothing is drawn. */
export function selectScope(state: AppState): string | null {
  if (!state.view.onDiagram || state.view.spec.snapshot === '') return null;
  return state.pipeline.result?.answer.source.scope ?? null;
}

/**
 * The timeline day the diagram on screen draws: its tick, `null` for the snapshot's own day, `undefined` while
 * nothing of the view's snapshot is drawn. Every follow-up request to the data worker (details, choices, search,
 * locate, reveal) names it, and the page keys what it keeps of their answers by it.
 */
export function selectDrawnDay(state: AppState): string | null | undefined {
  const source = state.pipeline.result?.answer.source;
  if (source === undefined || source.ref !== state.view.spec.snapshot) return undefined;
  return source.tick ?? null;
}

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

/**
 * Runs the diagram pipeline for the diagram page: measures the canvas element (synchronously before the first
 * request, then with a ResizeObserver), asks for the view's Scene and Layout whenever its scene key changes and,
 * for detail `auto`, when a resize would pick another level (state/pipeline.ts), and empties the pipeline slice
 * when the page goes away.
 */
export function useDiagramPipeline(canvasRef: { readonly current: HTMLElement | null }): void {
  const store = useAppStore();
  const { workers } = useDiagramSession();
  const key = useAppState(selectSceneKey);
  const controller = useMemo(() => createPipelineController(store, workers), [store, workers]);

  useLayoutEffect(() => {
    const element = canvasRef.current;
    if (element === null) return undefined;
    controller.measure(measureDiagramArea(element));
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      controller.measure(measureDiagramArea(element));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [controller, canvasRef]);

  useEffect(() => {
    controller.run(key);
    return () => {
      controller.cancel();
    };
  }, [controller, key]);

  useEffect(
    () => () => {
      controller.reset();
    },
    [controller],
  );
}
