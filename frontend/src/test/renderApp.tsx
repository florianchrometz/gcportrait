// SPDX-License-Identifier: MIT
import { cleanup, render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach } from 'vitest';

import type { PublicConfig } from '../api/config';
import { App } from '../App';
import type { DiagramWorkersFactory } from '../diagram/pipeline/workers';
import type { SnapshotLibrary } from '../snapshots/library';
import { createDatabaseConnection, type DatabaseConnection } from '../storage/connection';
import { openDatabase, type GcportraitDB } from '../storage/db';
import { DEFAULT_SOURCE_URL } from '../source';
import { createMemoryPreferenceStore, type PreferenceStore } from '../storage/preferences';
import { SavedViewStoreContext, type SavedViewStore } from '../views/savedViewStore';
import { DRAW_TIMEOUT } from './diagram';
import { TEST_OPEN_TIMEOUT_MS } from './indexedDb';
import { currentLocation, hashOf, LocationProbe } from './location';

export { currentLocation } from './location';

const ownedConnections = new Set<() => void>();

afterEach(() => {
  try {
    cleanup();
  } finally {
    for (const close of ownedConnections) close();
  }
});

export type RenderAppOptions = {
  readonly demo?: boolean;
  /** The build-time source URL (VITE_SOURCE_URL); the default one unless a test sets its own. */
  readonly sourceUrl?: string;
  /** The static demo's built-in configuration (api/staticConfig.ts); none unless a test sets one (with `demo: false`). */
  readonly staticConfig?: PublicConfig;
  readonly preferences?: PreferenceStore;
  /** The diagram's workers (e.g. `createInProcessWorkers`); none by default, so no diagram is drawn. */
  readonly diagramWorkers?: DiagramWorkersFactory;
  /** The snapshot library; by default one that keeps nothing and cannot generate. */
  readonly snapshots?: SnapshotLibrary;
  /** The page's IndexedDB connection; by default test-owned, with TEST_OPEN_TIMEOUT_MS and automatic cleanup. */
  readonly database?: DatabaseConnection;
  /** The saved views; by default the app's own store over the page's database. */
  readonly savedViews?: SavedViewStore;
};

/**
 * The per-test timeout of the suites whose tests render the whole app (`renderApp`) and work through it: such a
 * test is CPU work in jsdom (every render of the shell and the page, twice under StrictMode (setup.ts), Testing
 * Library's role queries over the document, an axe audit of it), a few hundred milliseconds of it on a quiet
 * machine and about a second for a file's first test, which runs the modules and axe for the first time. A
 * machine whose every core runs another test process stretches that work several times over, past Vitest's 5 s
 * default; the assertions are the same whatever the timeout.
 */
export const WHOLE_APP_TIMEOUT = { timeout: 20_000 } as const;

/**
 * The per-test timeout of the whole-app tests that draw a demo organisation (in-process workers) before they work
 * through the app: the draw alone may take DRAW_TIMEOUT on a loaded machine (a file's first draw the longest, as it
 * also generates the organisation and loads the pipeline's modules), and the work after it is a whole-app test's.
 */
export const DRAWING_APP_TIMEOUT = { timeout: DRAW_TIMEOUT + WHOLE_APP_TIMEOUT.timeout } as const;

export interface AppRender extends RenderResult {
  /** The router's path, query string and hash. */
  readonly location: () => string;
  /** The router's hash, decoded for reading (`%2F` → `/`). */
  readonly hash: () => string;
}

/**
 * The whole app at `path`, in a memory router, as main.tsx would mount it in a browser: under StrictMode, as every
 * render of the unit tests is (setup.ts).
 */
export function renderApp(path: string, options: RenderAppOptions = {}): AppRender {
  const opened = new Map<GcportraitDB, () => void>();
  const close = (): void => {
    for (const [db, onClose] of opened) {
      db.close();
      onClose();
    }
    opened.clear();
    ownedConnections.delete(close);
  };
  const database =
    options.database ??
    createDatabaseConnection(async (onClose) => {
      if (!ownedConnections.has(close)) return null;
      const db = await openDatabase(TEST_OPEN_TIMEOUT_MS, onClose);
      if (db !== null) {
        if (!ownedConnections.has(close)) {
          db.close();
          return null;
        }
        opened.set(db, onClose);
      }
      return db;
    });
  if (options.database === undefined) ownedConnections.add(close);
  const app: ReactElement = (
    <MemoryRouter initialEntries={[path]}>
      <App
        mode={{
          demo: options.demo ?? true,
          sourceUrl: options.sourceUrl ?? DEFAULT_SOURCE_URL,
          ...(options.staticConfig === undefined ? {} : { staticConfig: options.staticConfig }),
        }}
        preferences={options.preferences ?? createMemoryPreferenceStore()}
        diagramWorkers={options.diagramWorkers}
        snapshots={options.snapshots}
        database={database}
      />
      <LocationProbe />
    </MemoryRouter>
  );
  const result = render(
    options.savedViews === undefined ? (
      app
    ) : (
      <SavedViewStoreContext value={options.savedViews}>{app}</SavedViewStoreContext>
    ),
  );
  const location = (): string => currentLocation(result.container);
  return {
    ...result,
    unmount() {
      try {
        result.unmount();
      } finally {
        close();
      }
    },
    location,
    hash: () => hashOf(location()),
  };
}
