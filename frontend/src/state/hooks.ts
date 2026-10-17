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
import { AppStoreContext } from './context';
import { createPipelineController } from './pipeline';
import type { AppState, SelectionSlice, UiSlice } from './slices';
import type { AppStore, ViewActions } from './store';
import { selectSceneKey } from './viewKey';

export { selectSceneKey } from './viewKey';

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

/**
 * Whether the top bar's fold `id` ('view', 'more') is open as a sheet, and a setter: one sheet at a time. A popup
 * inside the sheet (`usePopover`) leaves it open; opening or closing a sheet closes any popup, and opening one closes
 * the details drawer, the selection kept (store.ts, `apart`).
 */
export function useSheet(id: string): readonly [boolean, (open: boolean) => void] {
  const store = useAppStore();
  const open = useAppState((state) => state.ui.sheet === id);
  const setOpen = useCallback(
    (next: boolean): void => {
      store.updateUi((ui) => {
        if (next) return ui.sheet === id && ui.popover === null ? ui : { ...ui, sheet: id, popover: null };
        return ui.sheet === id ? { ...ui, sheet: null, popover: null } : ui;
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

/**
 * Runs the diagram pipeline for the diagram page: measures the canvas element (synchronously before the first
 * request, then with a ResizeObserver), asks for the view's Scene and Layout whenever its scene key changes and,
 * for detail `auto`, when a resize would pick another level (state/pipeline.ts), and empties the pipeline slice,
 * the measured canvas included, when the page goes away. While `held` (the large-snapshot guard is asking
 * whether to draw the view's snapshot, snapshots/LargeSnapshotGuard.tsx) it asks for nothing, so no worker
 * starts on the snapshot.
 */
export function useDiagramPipeline(canvasRef: { readonly current: HTMLElement | null }, held = false): void {
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
    if (held) return undefined;
    controller.run(key);
    return () => {
      controller.cancel();
    };
  }, [controller, key, held]);

  useEffect(
    () => () => {
      controller.reset();
    },
    [controller],
  );
}
