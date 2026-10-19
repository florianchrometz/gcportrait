// SPDX-License-Identifier: Apache-2.0
/**
 * The whole app for the view controls' tests: the real data and layout handlers in-process, a
 * memory saved-view store (or the test's own), and the router's location, so a test can drive a control and read
 * the URL hash it wrote. A thin layer over `renderApp` (src/test/renderApp.tsx).
 */
import { screen, waitFor, within, type BoundFunctions, type queries } from '@testing-library/react';
import { expect } from 'vitest';

import { createInProcessWorkers } from '../../diagram/pipeline/inProcess';
import { DRAW_TIMEOUT } from '../../test/diagram';
import { renderApp, type AppRender } from '../../test/renderApp';
import { createSavedViewStore, type SavedViewStore } from '../savedViewStore';

export { drawn } from '../../test/diagram';

export interface ControlsApp extends AppRender {
  readonly savedViews: SavedViewStore;
}

export function renderControls(
  path: string,
  options: {
    readonly savedViews?: SavedViewStore;
    /** `false`: no workers, so nothing is drawn. */
    readonly workers?: boolean;
  } = {},
): ControlsApp {
  const savedViews = options.savedViews ?? createSavedViewStore(Promise.resolve(null));
  const app = renderApp(path, {
    ...(options.workers === false ? {} : { diagramWorkers: () => createInProcessWorkers() }),
    savedViews,
  });
  return { ...app, savedViews };
}

/** The top bar: the page's first `banner` (the first header in document order). */
export function topBar(): HTMLElement {
  const header = screen.getAllByRole('banner')[0];
  if (header === undefined) throw new Error('no top bar');
  return header;
}

/** Queries inside the top bar. */
export function inTopBar(): BoundFunctions<typeof queries> {
  return within(topBar());
}

/** A snapshot id no library holds: the diagram page says it could not be drawn. */
export const UNKNOWN_SNAPSHOT = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

/** The diagram page on `UNKNOWN_SNAPSHOT`, once it says the snapshot could not be drawn. */
export async function openUndrawable(): Promise<ControlsApp> {
  const app = renderControls(`/diagram#snapshot=${UNKNOWN_SNAPSHOT}`);
  await waitFor(
    () => {
      expect(app.container.querySelector('[role="alert"]')?.textContent).toMatch(/could not be drawn/);
    },
    { timeout: DRAW_TIMEOUT },
  );
  return app;
}
