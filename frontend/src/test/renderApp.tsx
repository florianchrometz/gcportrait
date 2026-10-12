// SPDX-License-Identifier: MIT
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';

import type { PublicConfig } from '../api/config';
import { App } from '../App';
import type { DiagramWorkersFactory } from '../diagram/pipeline/workers';
import type { SnapshotLibrary } from '../snapshots/library';
import type { DatabaseConnection } from '../storage/connection';
import { DEFAULT_SOURCE_URL } from '../source';
import { createMemoryPreferenceStore, type PreferenceStore } from '../storage/preferences';
import { SavedViewStoreContext, type SavedViewStore } from '../views/savedViewStore';
import { currentLocation, hashOf, LocationProbe } from './location';

export { currentLocation } from './location';

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
  /** The page's IndexedDB connection (the tick cache on the Snapshots page); by default the browser's. */
  readonly database?: DatabaseConnection;
  /** The saved views; by default the app's own store over the page's database. */
  readonly savedViews?: SavedViewStore;
};

export interface AppRender extends RenderResult {
  /** The router's path, query string and hash. */
  readonly location: () => string;
  /** The router's hash, decoded for reading (`%2F` → `/`). */
  readonly hash: () => string;
}

/** The whole app at `path`, in a memory router, as main.tsx would mount it in a browser. */
export function renderApp(path: string, options: RenderAppOptions = {}): AppRender {
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
        database={options.database}
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
  return { ...result, location, hash: () => hashOf(location()) };
}
