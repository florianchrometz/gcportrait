// SPDX-License-Identifier: Apache-2.0
/**
 * The import worker's protocol (ingest off the UI thread): the page reads a stream from the backend
 * (a live pull's frames, or an export's lines) and hands its bytes over chunk by chunk; the worker reads them with
 * `@gcportrait/ingest` as they arrive, counts pages and assets for the progress bar, and at the end answers with
 * the snapshot ready to store (`PreparedSnapshot`: Blobs and listing metadata, never parsed assets), which the
 * page writes to IndexedDB through the snapshot library. One job per stream; several may run at once.
 */
import type { SnapshotScope, SnapshotSource } from '@gcportrait/model';

import type { PreparedSnapshot } from '../../snapshots/worker/protocol';

export interface StreamSettings {
  /** The scope read; null for an export without a sidecar, whose assets' ancestors name it. */
  readonly scope: SnapshotScope | null;
  readonly source: SnapshotSource;
  /** A read time from an export's operation (the sidecar); a pull's comes from its `done` frame. */
  readonly readTime?: string;
  readonly readTimeOrigin?: 'export-sidecar' | 'user';
  /** A pull: refuse a stream that ended without its `done` frame (cut short), rather than store part of it. */
  readonly requireComplete: boolean;
}

export type ImportRequest =
  | { readonly type: 'start'; readonly job: number; readonly settings: StreamSettings }
  | { readonly type: 'chunk'; readonly job: number; readonly data: Uint8Array }
  | { readonly type: 'end'; readonly job: number }
  | { readonly type: 'cancel'; readonly job: number };

/** What the worker has read so far. */
export interface StreamCounts {
  /** `page` frames read (pulls). */
  readonly pages: number;
  /** Assets read (distinct names). */
  readonly assets: number;
}

/** Why a job failed. `upstream` carries an `error` frame's fields, Google's message verbatim. */
export interface StreamFailure {
  readonly kind: 'upstream' | 'cut-short' | 'empty' | 'invalid' | 'cancelled' | 'internal';
  readonly message: string;
  readonly status?: number;
  readonly code?: string;
  readonly reason?: string;
  readonly problems?: readonly string[];
}

export type ImportResponse =
  | { readonly type: 'progress'; readonly job: number; readonly counts: StreamCounts }
  /** Reading is done; the snapshot is being compressed for storage. */
  | { readonly type: 'encoding'; readonly job: number }
  | {
      readonly type: 'done';
      readonly job: number;
      readonly snapshot: PreparedSnapshot;
      /** What was read but not kept (malformed lines, duplicates, an estimated read time), for the person. */
      readonly warnings: readonly string[];
    }
  | { readonly type: 'error'; readonly job: number; readonly failure: StreamFailure };
