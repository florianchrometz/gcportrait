// SPDX-License-Identifier: MIT
/** The import worker as a real Web Worker: the app's one worker script in its imports role (role.ts). */
import DiagramWorker from '../../diagram/pipeline/diagram.worker?worker';
import { WORKER_ROLES } from '../../diagram/pipeline/roles';
import { createImportClient, type ImportWorkerFactory } from './client';

export const createBrowserImportWorker: ImportWorkerFactory = () => {
  const worker = new DiagramWorker({ name: WORKER_ROLES.imports });
  const client = createImportClient((request, transfer) => {
    worker.postMessage(request, transfer);
  });
  worker.addEventListener('message', (event: MessageEvent) => {
    client.receive(event.data);
  });
  worker.addEventListener('error', (event: ErrorEvent) => {
    client.fail(event.message || 'The import worker failed.');
  });
  return {
    client,
    dispose() {
      client.dispose();
      worker.terminate();
    },
  };
};
