// SPDX-License-Identifier: MIT
/**
 * The imports role of the app's worker script (diagram/pipeline/diagram.worker.ts, started with the name
 * `WORKER_ROLES.imports`): live pulls and export reads streamed from the backend (handler.ts). It shares the script
 * with the other roles so the build bundles ingest, the model and zod once, in shared chunks.
 */
import { createImportHandler } from './handler';
import type { ImportResponse } from './protocol';

export function startRole(post: (message: ImportResponse) => void): (message: unknown) => void {
  return createImportHandler(post);
}
