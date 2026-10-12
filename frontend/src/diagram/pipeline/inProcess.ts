// SPDX-License-Identifier: MIT
/**
 * The diagram's workers run in-process: the same handlers and clients, connected through microtasks instead
 * of `postMessage`. For tests (jsdom has no Web Workers); the app never imports it.
 */
import { createLayoutClient, createLayoutWorkerHandler, type LayoutClient } from '@gcportrait/layout';

import { createDataClient, type DataClient } from './dataClient';
import { createDataHandler, type DataHandlerEnvironment } from './dataHandler';
import type { DiagramWorkers } from './workers';

export function createInProcessWorkers(environment: DataHandlerEnvironment = {}): DiagramWorkers {
  let data: DataClient | null = null;
  const dataHandler = createDataHandler((response) => {
    queueMicrotask(() => data?.receive(response));
  }, environment);
  data = createDataClient((request) => {
    queueMicrotask(() => {
      dataHandler(request);
    });
  });
  let layout: LayoutClient | null = null;
  const layoutHandler = createLayoutWorkerHandler(
    (response) => {
      queueMicrotask(() => layout?.receive(response));
    },
    { yieldToHost: () => Promise.resolve() },
  );
  layout = createLayoutClient((request) => {
    queueMicrotask(() => {
      layoutHandler(request);
    });
  });
  const clients = { data, layout };
  return {
    ...clients,
    dispose() {
      clients.data.dispose();
      clients.layout.dispose();
    },
  };
}
