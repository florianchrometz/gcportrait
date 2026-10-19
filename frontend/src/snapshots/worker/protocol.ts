// SPDX-License-Identifier: Apache-2.0
/**
 * The snapshot worker's protocol (ingest off the UI thread). The page hands over files to import; the
 * worker reads, checks and encodes them and answers with records ready to store (`PreparedSnapshot`: Blobs and
 * listing metadata, never parsed assets), which the page writes to IndexedDB (../repository.ts); before an export
 * it reads a stored record in full (`check`). Each job reports its stages as it goes; the page may `cancel` an
 * import, which then stops reading and prepares nothing (the page has stopped waiting for it). A demo organisation is
 * prepared the same way, as a `PreparedSnapshot` with the same progress, but by a demo worker started for the job,
 * as the demo generator runs in the diagram's workers only (diagram/pipeline/demoRole.ts; AGENTS.md, Architecture
 * and code).
 */
import type { SnapshotMeta } from '../../storage/db';

/** What a `check` (and so export) says about a record it cannot read in full; its problems give the reason. */
export const DAMAGED_RECORD =
  'The stored snapshot is damaged, so it cannot be exported. Delete it, then import or generate it again.';

export type SnapshotRequest =
  | {
      readonly type: 'import';
      readonly job: number;
      readonly files: readonly File[];
      /** Milliseconds since the epoch: the imported snapshot's id is made from it. */
      readonly now: number;
      /**
       * The ids already stored in this browser: no imported snapshot gets one (every import is stored under a new
       * id), and a bundle whose own id is among them is noted as a copy of a stored snapshot.
       */
      readonly taken: readonly string[];
      /**
       * The read time the person typed for an export that came without its operation.json (RFC 3339, UTC):
       * the snapshot's read time unless the sidecar names one (`readTimeSource: user`). Bundles keep their own.
       */
      readonly readTime?: string;
    }
  | {
      /** A stored record's plain documents, read in full before export; answered with no snapshots. */
      readonly type: 'check';
      readonly job: number;
      readonly snapshot: Blob;
      readonly history?: Blob;
    }
  | {
      /**
       * Stops job `job` (an import the person cancelled, or left the page during): it reads no further and is
       * answered with an error (`CANCELLED_JOB`), which the page no longer waits for. A job that has ended is not
       * affected.
       */
      readonly type: 'cancel';
      readonly job: number;
    };

/** What a cancelled job answers. */
export const CANCELLED_JOB = 'The import was cancelled.';

/**
 * Where a job is: `generate` (a demo's history), `read` (files or the demo's assets; `done`/`total` in bytes when
 * reading files, `assets` read so far), `check` (a bundle's snapshot and history), `encode` (compressing for
 * storage). The page adds `store` (writing to IndexedDB).
 */
export type JobStage = 'generate' | 'read' | 'check' | 'encode' | 'store';

export interface JobProgress {
  readonly stage: JobStage;
  readonly done?: number;
  readonly total?: number;
  readonly assets?: number;
}

/** A snapshot ready to store: the record of storage/db.ts but for the time it is saved. */
export interface PreparedSnapshot {
  /** Its ref: `demo:<size>`, or the snapshot's ULID. */
  readonly id: string;
  readonly meta: Omit<SnapshotMeta, 'savedAt'>;
  readonly blob: Blob;
  readonly history?: Blob;
}

export type SnapshotResponse =
  | { readonly type: 'progress'; readonly job: number; readonly progress: JobProgress }
  | {
      readonly type: 'done';
      readonly job: number;
      readonly snapshots: readonly PreparedSnapshot[];
      /** What was read but not kept (malformed lines, an estimated read time), for the person. */
      readonly warnings: readonly string[];
    }
  | {
      readonly type: 'error';
      readonly job: number;
      readonly message: string;
      /** The first problems found (a file's malformed lines), for the person. */
      readonly problems: readonly string[];
    };
