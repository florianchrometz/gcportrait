// SPDX-License-Identifier: Apache-2.0
/**
 * The `snapshots` store of IndexedDB (storage/db.ts), on the page: list, read, save, delete. When IndexedDB is
 * unavailable (the page's connection, storage/connection.ts, has none: a private window, a blocked or broken
 * database) or a write
 * fails (the quota), a demo organisation is kept in memory instead, and says so (`persisted: false`): it still
 * opens, because the diagram generates it (load.ts), and it is gone after a reload. An import is not kept in
 * memory (`put(record, { inMemory: false })`): the diagram's data worker reads imported snapshots only from
 * IndexedDB, so a copy in memory could be listed but never opened.
 */
import { databaseOf, type DatabaseSource } from '../storage/connection';
import type { StoredSnapshot } from '../storage/db';

export interface ListedSnapshot {
  readonly record: StoredSnapshot;
  /** Whether it is in IndexedDB (false: in memory, until the page is reloaded or closed). */
  readonly persisted: boolean;
}

export interface SnapshotRepository {
  /** Whether IndexedDB is available. */
  readonly persistent: () => Promise<boolean>;
  /** Every record, the most recently saved first. */
  list(): Promise<ListedSnapshot[]>;
  get(id: string): Promise<StoredSnapshot | undefined>;
  /** The id of every record, in IndexedDB or in memory. */
  ids(): Promise<string[]>;
  /**
   * Saves a record (replacing one with the same id); resolves to whether it reached IndexedDB. When it did not, it
   * is kept in memory unless `inMemory` is false.
   */
  put(record: StoredSnapshot, options?: { readonly inMemory?: boolean }): Promise<boolean>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

export function createSnapshotRepository(source: DatabaseSource): SnapshotRepository {
  const database = databaseOf(source);
  const memory = new Map<string, StoredSnapshot>();

  return {
    persistent: async () => (await database()) !== null,
    async list() {
      const db = await database();
      let stored: StoredSnapshot[] = [];
      if (db !== null) {
        try {
          stored = await db.getAll('snapshots');
        } catch {
          stored = [];
        }
      }
      const listed: ListedSnapshot[] = [
        ...stored.filter((record) => !memory.has(record.id)).map((record) => ({ record, persisted: true })),
        ...[...memory.values()].map((record) => ({ record, persisted: false })),
      ];
      return listed.sort(
        (a, b) =>
          b.record.meta.savedAt.localeCompare(a.record.meta.savedAt) ||
          a.record.id.localeCompare(b.record.id),
      );
    },
    async get(id) {
      const kept = memory.get(id);
      if (kept !== undefined) return kept;
      const db = await database();
      if (db === null) return undefined;
      try {
        return await db.get('snapshots', id);
      } catch {
        return undefined;
      }
    },
    async ids() {
      const db = await database();
      let stored: string[] = [];
      if (db !== null) {
        try {
          stored = await db.getAllKeys('snapshots');
        } catch {
          stored = [];
        }
      }
      return [...new Set([...stored, ...memory.keys()])];
    },
    async put(record, options) {
      const db = await database();
      if (db !== null) {
        try {
          await db.put('snapshots', record);
          memory.delete(record.id);
          return true;
        } catch {
          // The quota, or a database another tab closed: keep it in memory, if the caller wants that.
        }
      }
      if (options?.inMemory !== false) memory.set(record.id, record);
      return false;
    },
    async delete(id) {
      memory.delete(id);
      const db = await database();
      if (db !== null) await db.delete('snapshots', id);
    },
    async clear() {
      memory.clear();
      const db = await database();
      if (db !== null) await db.clear('snapshots');
    },
  };
}
