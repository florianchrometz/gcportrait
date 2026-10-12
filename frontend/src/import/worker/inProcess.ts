// SPDX-License-Identifier: MIT
/**
 * The import worker in-process: the same handler and client, connected through microtasks instead of
 * `postMessage`. For tests (jsdom has no Web Workers); the app never imports it.
 */
import { createImportClient, type ImportClient, type ImportWorkerFactory } from './client';
import { createImportHandler, type HandlerEnvironment } from './handler';

export function inProcessImportWorker(environment: HandlerEnvironment = {}): ImportWorkerFactory {
  return () => {
    let client: ImportClient | null = null;
    const handle = createImportHandler((response) => {
      queueMicrotask(() => client?.receive(response));
    }, environment);
    client = createImportClient((request) => {
      // A copy, as postMessage would make one (or move the buffer): the page may not touch it again.
      const message = request.type === 'chunk' ? { ...request, data: request.data.slice() } : request;
      queueMicrotask(() => {
        handle(message);
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
}
