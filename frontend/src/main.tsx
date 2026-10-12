// SPDX-License-Identifier: MIT
// Self-hosted fonts (gcp-diagram-style §3): bundled by Vite, never fetched from a font CDN.
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import '@fontsource/roboto-mono/400.css';
import './styles/tokens.css';
import './styles/global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import { App } from './App';
import { createBrowserDemoJob, createBrowserWorkers, sharedWorkers } from './diagram/pipeline/workers';
import { readAppMode } from './mode';
import { routerBasename } from './routes';
import { createSnapshotLibrary } from './snapshots/library';
import { createBrowserSnapshotWorker } from './snapshots/worker/browser';
import { createDatabaseConnection } from './storage/connection';
import { createPreferenceStore } from './storage/preferences';

const container = document.getElementById('root');
if (container === null) throw new Error('index.html must contain <div id="root">.');

// One IndexedDB connection for the page: preferences, saved views and snapshots (storage/connection.ts).
const connection = createDatabaseConnection();
const preferences = createPreferenceStore(connection.database);
// The data worker draws the diagrams; "Try the demo" prepares a demo organisation in a worker of its own, started for
// the job (the job no longer holds back the data worker's Scene requests). The demo generator runs in workers
// only (ADR 0029).
const diagramWorkers = sharedWorkers(createBrowserWorkers);
const snapshots = createSnapshotLibrary({
  database: connection.database,
  worker: createBrowserSnapshotWorker,
  demo: createBrowserDemoJob,
});

createRoot(container).render(
  <StrictMode>
    {/* The static demo is served below /demo/ (ADR 0034); every instance at the root of its origin. */}
    <BrowserRouter basename={routerBasename(import.meta.env.BASE_URL)}>
      <App
        mode={readAppMode(import.meta.env)}
        database={connection}
        preferences={preferences}
        diagramWorkers={diagramWorkers}
        snapshots={snapshots}
      />
    </BrowserRouter>
  </StrictMode>,
);
