// SPDX-License-Identifier: MIT
/**
 * The snapshot library: everything the app does with snapshots, behind one object the pages use
 * (SnapshotLibraryProvider). Importing files runs in the snapshot worker (worker/, created on first use);
 * generating a demo organisation runs in a worker started for the job (`demo`: main.tsx passes
 * `createBrowserDemoJob`, diagram/pipeline/workers.ts; the demo generator runs in workers only, ADR 0029 as amended
 * on 2026-10-11). What either prepares is saved through the repository (IndexedDB; a demo organisation in memory
 * until a reload when IndexedDB refuses it, an import never); exporting writes the `.gcportrait.json` bundle
 * (bundle.ts) from a stored record's documents as they are, once the snapshot worker has read them in full (`check`),
 * so a damaged record is never written to a file. Every change is announced to `subscribe`rs (the provider re-lists).
 */
import { isSnapshotRef, type DemoSize, type SnapshotRef } from '@gcportrait/model';

import type { DatabaseSource } from '../storage/connection';
import type { StoredSnapshot } from '../storage/db';
import { bundleFileName, bundleParts } from './bundle';
import { plainBlob } from './codec';
import { scopeName, snapshotLabel } from './labels';
import { createSnapshotRepository, type ListedSnapshot } from './repository';
import {
  SnapshotJobError,
  type OnProgress,
  type SnapshotWorker,
  type SnapshotWorkerFactory,
} from './worker/client';
import { DAMAGED_RECORD, type PreparedSnapshot } from './worker/protocol';

export interface StorageUse {
  /** Bytes this site stores in the browser (all of its storage, not only snapshots). */
  readonly usage: number;
  /** Bytes the browser lets this site store. */
  readonly quota: number;
}

export interface Imported {
  readonly refs: readonly SnapshotRef[];
  readonly records: readonly StoredSnapshot[];
  readonly warnings: readonly string[];
}

export interface SnapshotLibrary {
  /** Whether snapshots are kept in IndexedDB (false: in memory, until the page is reloaded or closed). */
  persistent(): Promise<boolean>;
  /** Whether this library can import (it has a snapshot worker). */
  readonly canWork: boolean;
  list(): Promise<ListedSnapshot[]>;
  /** Calls `listener` after every change; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Generates demo organisation `size` with its history and saves it as `demo:<size>`. */
  tryDemo(
    size: DemoSize,
    onProgress?: OnProgress,
  ): Promise<{ readonly ref: SnapshotRef; readonly persisted: boolean }>;
  /**
   * Imports snapshot files (bundles, or one Cloud Asset Inventory export in one or more files), each snapshot as a
   * new record under a new id, so it never replaces a stored one and no ref ever names two snapshots (a warning
   * says when a file's snapshot is stored already). A snapshot IndexedDB refuses (the quota) is not stored, and a
   * warning says so; when none could be stored, it fails. An export's read time is `options.readTime` (typed by
   * the person) unless its operation.json names one.
   */
  importFiles(
    files: readonly File[],
    onProgress?: OnProgress,
    options?: { readonly readTime?: string },
  ): Promise<Imported>;
  /**
   * Stores a snapshot prepared elsewhere (a live pull or an export read, src/import/) as a new record, and
   * returns its ref. Fails (a `SnapshotJobError`) without browser storage, when its id is already stored (a ref
   * names one snapshot for good), or when IndexedDB refuses it (the quota).
   */
  storePrepared(prepared: PreparedSnapshot): Promise<SnapshotRef>;
  /**
   * The `.gcportrait.json` file of a stored snapshot, once the snapshot worker has read its documents in full; fails
   * (a `SnapshotJobError` with the reason) when they are damaged.
   */
  exportFile(
    id: string,
    onProgress?: OnProgress,
  ): Promise<{ readonly blob: Blob; readonly fileName: string }>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  /** `navigator.storage.estimate()`, when the browser has it. */
  estimate(): Promise<StorageUse | null>;
  dispose(): void;
}

export interface SnapshotLibraryOptions {
  /** IndexedDB: the page's connection (storage/connection.ts), or a promise of null for memory only. */
  readonly database: DatabaseSource;
  /** The snapshot worker; null: importing and exporting are not available (some tests). */
  readonly worker: SnapshotWorkerFactory | null;
  /**
   * Prepares a demo organisation with its history (main.tsx: a demo worker per job, `createBrowserDemoJob`); absent:
   * "Try the demo" is not available (some tests).
   */
  readonly demo?: DemoPreparer;
  /** The clock for `savedAt` and `exportedAt`. */
  readonly now?: () => Date;
  /** `navigator.storage` (tests replace it). */
  readonly storage?: Pick<StorageManager, 'estimate'> | undefined;
}

function isRef(id: string): id is SnapshotRef {
  return id !== '' && isSnapshotRef(id);
}

/** A stored record's id as the snapshot ref a view names, or null when it is not one. */
export function refOf(id: string): SnapshotRef | null {
  return isRef(id) ? id : null;
}

/** Prepares demo organisation `size`, reporting its progress (the data protocol's `demo` request, in a demo worker). */
export type DemoPreparer = (size: DemoSize, onProgress?: OnProgress) => Promise<PreparedSnapshot>;

export function createSnapshotLibrary(options: SnapshotLibraryOptions): SnapshotLibrary {
  const repository = createSnapshotRepository(options.database);
  const now = options.now ?? (() => new Date());
  const listeners = new Set<() => void>();
  let worker: SnapshotWorker | null = null;

  const changed = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const started = (): SnapshotWorker => {
    if (options.worker === null) throw new SnapshotJobError('Snapshots cannot be prepared here: no worker.');
    worker ??= options.worker();
    return worker;
  };

  const save = async (
    prepared: PreparedSnapshot,
    inMemory: boolean,
  ): Promise<{ record: StoredSnapshot; persisted: boolean }> => {
    const record: StoredSnapshot = { ...prepared, meta: { ...prepared.meta, savedAt: now().toISOString() } };
    return { record, persisted: await repository.put(record, { inMemory }) };
  };

  return {
    persistent: repository.persistent,
    canWork: options.worker !== null,
    list: () => repository.list(),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async tryDemo(size, onProgress) {
      if (options.demo === undefined)
        throw new SnapshotJobError('Demo organisations cannot be prepared here: no worker.');
      const prepared = await options.demo(size, onProgress);
      if (!isRef(prepared.id)) throw new SnapshotJobError('The demo organisation could not be prepared.');
      onProgress?.({ stage: 'store' });
      const { persisted } = await save(prepared, true);
      changed();
      return { ref: prepared.id, persisted };
    },
    async importFiles(files, onProgress, options) {
      if (!(await repository.persistent()))
        throw new SnapshotJobError(
          'Importing needs browser storage, which this browser does not allow here.',
        );
      const taken = await repository.ids();
      const { snapshots, warnings } = await started().client.importFiles(
        files,
        onProgress,
        taken,
        options?.readTime,
      );
      onProgress?.({ stage: 'store' });
      const records: StoredSnapshot[] = [];
      const refs: SnapshotRef[] = [];
      const refused: string[] = [];
      for (const prepared of snapshots) {
        if (!isRef(prepared.id)) continue;
        const { record, persisted } = await save(prepared, false);
        if (!persisted) {
          refused.push(snapshotLabel(prepared.meta));
          continue;
        }
        records.push(record);
        refs.push(prepared.id);
      }
      if (records.length > 0) changed();
      if (records.length === 0 && refused.length > 0)
        throw new SnapshotJobError(
          `This browser refused to store ${refused.length === 1 ? 'the snapshot' : 'the snapshots'}: the space it ` +
            'allows this site may be full. Delete snapshots you no longer need, then import again.',
          refused,
        );
      const notes = refused.map(
        (label) =>
          `${label} was not stored: this browser refused it, and the space it allows this site may be full.`,
      );
      return { refs, records, warnings: [...warnings, ...notes] };
    },
    async storePrepared(prepared) {
      if (!(await repository.persistent()))
        throw new SnapshotJobError(
          'Storing a snapshot needs browser storage, which this browser does not allow here.',
        );
      if (!isRef(prepared.id) || (await repository.ids()).includes(prepared.id))
        throw new SnapshotJobError('The snapshot could not be stored under a new name. Try again.');
      const { persisted } = await save(prepared, false);
      if (!persisted)
        throw new SnapshotJobError(
          'This browser refused to store the snapshot: the space it allows this site may be full. Delete ' +
            'snapshots you no longer need, then try again.',
        );
      changed();
      return prepared.id;
    },
    async exportFile(id, onProgress) {
      const record = await repository.get(id);
      if (record === undefined) throw new Error(`No snapshot "${id}" is stored in this browser.`);
      const checker = started();
      const plain = async (blob: Blob, what: string): Promise<Blob> => {
        try {
          return await plainBlob(blob);
        } catch {
          throw new SnapshotJobError(DAMAGED_RECORD, [`The ${what} does not decompress.`]);
        }
      };
      onProgress?.({ stage: 'read' });
      const snapshot = await plain(record.blob, 'snapshot');
      const history = record.history === undefined ? undefined : await plain(record.history, 'history');
      await checker.client.check(snapshot, history, onProgress);
      return {
        blob: new Blob(bundleParts(now().toISOString(), snapshot, history), { type: 'application/json' }),
        fileName: bundleFileName(scopeName(record.meta.scope), record.meta.readTime),
      };
    },
    async remove(id) {
      await repository.delete(id);
      changed();
    },
    async clear() {
      await repository.clear();
      changed();
    },
    async estimate() {
      const storage = 'storage' in options ? options.storage : globalThis.navigator.storage;
      if (typeof storage?.estimate !== 'function') return null;
      try {
        const { usage, quota } = await storage.estimate();
        return usage === undefined || quota === undefined ? null : { usage, quota };
      } catch {
        return null;
      }
    },
    dispose() {
      worker?.dispose();
      worker = null;
    },
  };
}
