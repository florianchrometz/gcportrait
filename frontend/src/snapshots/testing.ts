// SPDX-License-Identifier: MIT
/**
 * A snapshot library for the page tests: records in memory, every call logged, and the jobs answered by the
 * test (`answer`) so it can look at the page while one runs; an import's answer is stored once its `confirm`, if
 * it has one, says yes. Nothing is generated, compressed or parsed (jsdom's Blob cannot stream); the worker, the
 * codec and IndexedDB are tested on their own (library.test.ts).
 */
import type { DemoSize, SnapshotRef } from '@gcportrait/model';

import type { SnapshotMeta, StoredSnapshot } from '../storage/db';
import type { Imported, SnapshotLibrary, StorageUse } from './library';
import type { ListedSnapshot } from './repository';
import type { OnProgress } from './worker/client';

export function storedRecord(id: string, meta: Partial<SnapshotMeta> = {}): StoredSnapshot {
  return {
    id,
    meta: {
      scope: { kind: 'organization', id: '30000000001', displayName: 'example.com' },
      readTime: '2026-10-08T00:00:00Z',
      source: 'demo',
      assetCount: 952,
      bytes: 123_400,
      savedAt: '2026-10-10T12:00:00Z',
      schemaVersion: 1,
      ...meta,
    },
    blob: new Blob(['{}']),
  };
}

interface Job<T> {
  readonly onProgress: OnProgress | undefined;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}

export interface FakeLibrary extends SnapshotLibrary {
  readonly calls: string[];
  readonly records: Map<string, ListedSnapshot>;
  /** The demo or import job waiting for an answer (the latest one). */
  readonly pending: () => Job<unknown> | null;
  /** Answers the pending job. */
  readonly answer: (outcome: { readonly ok: unknown } | { readonly error: Error }) => Promise<void>;
}

export function fakeLibrary(
  options: {
    readonly persistent?: boolean;
    readonly records?: readonly StoredSnapshot[];
    readonly use?: StorageUse;
    /** What `exportFile` fails with, after reporting its check (it succeeds otherwise). */
    readonly exportError?: Error;
  } = {},
): FakeLibrary {
  const persistent = options.persistent ?? true;
  const records = new Map<string, ListedSnapshot>(
    (options.records ?? []).map((record) => [record.id, { record, persisted: persistent }]),
  );
  const listeners = new Set<() => void>();
  const calls: string[] = [];
  let pending: Job<unknown> | null = null;
  const changed = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const wait = <T>(onProgress: OnProgress | undefined): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      pending = { onProgress, resolve: resolve as (value: unknown) => void, reject };
    });

  return {
    calls,
    records,
    pending: () => pending,
    async answer(outcome) {
      const job = pending;
      pending = null;
      if ('ok' in outcome) job?.resolve(outcome.ok);
      else job?.reject(outcome.error);
      await Promise.resolve();
    },
    canWork: true,
    persistent: () => Promise.resolve(persistent),
    list: () =>
      Promise.resolve(
        [...records.values()].sort((a, b) => b.record.meta.savedAt.localeCompare(a.record.meta.savedAt)),
      ),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async tryDemo(size: DemoSize, onProgress?: OnProgress) {
      calls.push(`tryDemo ${size}`);
      const result = await wait<{ ref: SnapshotRef; persisted: boolean }>(onProgress);
      records.set(result.ref, { record: storedRecord(result.ref), persisted: result.persisted });
      changed();
      return result;
    },
    async importFiles(files, onProgress, importOptions) {
      // A read time typed for an export is logged after the names.
      const at = importOptions?.readTime === undefined ? '' : ` at ${importOptions.readTime}`;
      calls.push(`importFiles ${files.map((file) => file.name).join(',')}${at}`);
      const result = await wait<Imported>(onProgress);
      // The test's answer is what the worker prepared: asked about before any of it is stored, as the library does.
      const candidates = result.refs.map((ref) => ({
        ref,
        assets: result.records.find((record) => record.id === ref)?.meta.assetCount ?? 0,
      }));
      if (importOptions?.confirm !== undefined && !(await importOptions.confirm(candidates)))
        return { refs: [], records: [], warnings: [], declined: true };
      for (const record of result.records) records.set(record.id, { record, persisted: true });
      changed();
      return result;
    },
    storePrepared(prepared) {
      calls.push(`storePrepared ${prepared.meta.source}`);
      records.set(prepared.id, {
        record: { ...prepared, meta: { ...prepared.meta, savedAt: '2026-10-10T12:00:00Z' } },
        persisted: true,
      });
      changed();
      return Promise.resolve(prepared.id);
    },
    exportFile(id, onProgress) {
      calls.push(`exportFile ${id}`);
      onProgress?.({ stage: 'check' });
      if (options.exportError !== undefined) return Promise.reject(options.exportError);
      return Promise.resolve({ blob: new Blob(['{}']), fileName: `${id}.gcportrait.json` });
    },
    remove(id) {
      calls.push(`remove ${id}`);
      records.delete(id);
      changed();
      return Promise.resolve();
    },
    clear() {
      calls.push('clear');
      records.clear();
      changed();
      return Promise.resolve();
    },
    estimate: () => Promise.resolve(options.use ?? null),
    dispose: () => undefined,
  };
}
