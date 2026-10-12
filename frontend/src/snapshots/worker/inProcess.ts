// SPDX-License-Identifier: MIT
/**
 * The snapshot worker in-process: the same handler and client, connected through microtasks instead of
 * `postMessage`. For tests (jsdom has no Web Workers); the app never imports it.
 */
import { createSnapshotClient, type SnapshotClient, type SnapshotWorkerFactory } from './client';
import { createSnapshotHandler } from './handler';

export const createInProcessSnapshotWorker: SnapshotWorkerFactory = () => {
  let client: SnapshotClient | null = null;
  const handle = createSnapshotHandler((response) => {
    queueMicrotask(() => client?.receive(response));
  });
  client = createSnapshotClient((request) => {
    queueMicrotask(() => {
      handle(request);
    });
  });
  const started = client;
  return {
    client: started,
    dispose() {
      started.dispose();
    },
  };
};
