// SPDX-License-Identifier: MIT
/**
 * The snapshots role of the app's worker script (diagram/pipeline/diagram.worker.ts, started with the name
 * `WORKER_ROLES.snapshots`): file import and the check before an export (handler.ts). It shares the script with
 * the diagram's data and layout roles so the build bundles the modules they have in common (the model, zod,
 * ingest) once, in shared chunks, instead of a second time in a worker of its own. The demo generator is not
 * among them: only the data and demo roles load it.
 */
import { createSnapshotHandler } from './handler';
import type { SnapshotResponse } from './protocol';

export function startRole(post: (message: SnapshotResponse) => void): (message: unknown) => void {
  return createSnapshotHandler(post);
}
