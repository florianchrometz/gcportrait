// SPDX-License-Identifier: Apache-2.0
/** The snapshot worker as a real Web Worker: the app's one worker script in its snapshots role (role.ts). */
import { WORKER_ROLES } from '../../diagram/pipeline/roles';
import { startRole } from '../../diagram/pipeline/workers';
import { createSnapshotClient, type SnapshotWorkerFactory } from './client';

export const createBrowserSnapshotWorker: SnapshotWorkerFactory = () =>
  startRole(WORKER_ROLES.snapshots, createSnapshotClient, 'snapshot');
