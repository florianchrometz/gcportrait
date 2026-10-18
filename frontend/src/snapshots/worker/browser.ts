// SPDX-License-Identifier: Apache-2.0
/** The snapshot worker as a real Web Worker: the app's one worker script in its snapshots role (role.ts). */
import DiagramWorker from '../../diagram/pipeline/diagram.worker?worker';
import { WORKER_ROLES } from '../../diagram/pipeline/roles';
import { createSnapshotClient, type SnapshotWorkerFactory } from './client';

export const createBrowserSnapshotWorker: SnapshotWorkerFactory = () => {
  const worker = new DiagramWorker({ name: WORKER_ROLES.snapshots });
  const client = createSnapshotClient((request) => {
    worker.postMessage(request);
  });
  worker.addEventListener('message', (event: MessageEvent) => {
    client.receive(event.data);
  });
  worker.addEventListener('error', (event: ErrorEvent) => {
    client.fail(event.message || 'The snapshot worker failed.');
  });
  return {
    client,
    dispose() {
      client.dispose();
      worker.terminate();
    },
  };
};
