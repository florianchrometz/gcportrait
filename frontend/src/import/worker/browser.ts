// SPDX-License-Identifier: Apache-2.0
/** The import worker as a real Web Worker: the app's one worker script in its imports role (role.ts). */
import { WORKER_ROLES } from '../../diagram/pipeline/roles';
import { startRole } from '../../diagram/pipeline/workers';
import { createImportClient, type ImportWorkerFactory } from './client';

export const createBrowserImportWorker: ImportWorkerFactory = () =>
  startRole(WORKER_ROLES.imports, createImportClient, 'import');
