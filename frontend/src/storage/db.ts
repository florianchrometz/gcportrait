// SPDX-License-Identifier: Apache-2.0
import type { SnapshotReadTimeSource } from '@gcportrait/model';
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb';

/**
 * The browser database (IndexedDB through `idb`). Snapshots, saved views, preferences and the timeline
 * tick cache live here and nowhere else: asset data never leaves the browser (AGENTS.md, Security
 * and privacy, principle 1). `preferences` (storage/preferences.ts), `savedViews` (views/savedViewStore.ts),
 * `snapshots` (src/snapshots/) and `tickCache` (storage/tickCache.ts, the timeline's fetched ticks)
 * are in use. The page reads all of them through one connection (storage/connection.ts); the data worker
 * opens its own.
 *
 * The schema is versioned. Each entry of MIGRATIONS upgrades from version i to i + 1 and runs inside the
 * version-change transaction; DB_VERSION is the number of migrations. Never edit a shipped migration:
 * append a new one.
 */

export const DB_NAME = 'gcportrait';

/** Kind of scope a snapshot covers (`@gcportrait/model`'s `SnapshotSchema`). */
export type ScopeKind = 'organization' | 'folder' | 'project';

/** Listing metadata kept next to a stored snapshot so the snapshot list never has to parse blobs. */
export type SnapshotMeta = {
  readonly scope: { readonly kind: ScopeKind; readonly id: string; readonly displayName?: string };
  /** RFC 3339 Cloud Asset Inventory read time. */
  readonly readTime: string;
  readonly source: 'api' | 'export' | 'demo';
  readonly assetCount: number;
  /** What the record takes in this browser: the size of `blob` plus `history`. */
  readonly bytes: number;
  /** RFC 3339 time the snapshot was saved in this browser. */
  readonly savedAt: string;
  /** Snapshot format version, for migrations in @gcportrait/model. */
  readonly schemaVersion: number;
  /** The snapshot's `source.detail` (file names, the demo size); never a token. */
  readonly detail?: string;
  /** The read time is the latest asset `updateTime`, an estimate the UI labels (skill cai-ingestion §1). */
  readonly estimatedReadTime?: boolean;
  /**
   * Where the read time came from (the snapshot's `readTimeSource`: an export's operation.json, typed in by the
   * person, Google's answer to a pull, or the estimate); absent for a demo or when the snapshot names none.
   */
  readonly readTimeSource?: SnapshotReadTimeSource;
  /** How many daily ticks `history` holds. */
  readonly historyTicks?: number;
};

export type StoredSnapshot = {
  /** The snapshot's ref in a ViewSpec: its ULID, or `demo:<size>` for a stored demo organisation. */
  readonly id: string;
  readonly meta: SnapshotMeta;
  /** The snapshot document itself (JSON, gzip-compressed where the browser can), stored as an opaque blob. */
  readonly blob: Blob;
  /** Its history as a base and daily mutations, encoded like `blob` (demo organisations, for the timeline). */
  readonly history?: Blob;
};

export type StoredView = {
  readonly id: string;
  readonly name: string;
  /** The ViewSpec exactly as it appears in the URL hash, so a saved view reopens as a link would. */
  readonly viewSpecHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/**
 * A timeline tick read from Cloud Asset Inventory (storage/tickCache.ts): the snapshot of a scope at a day's
 * 00:00 UTC, kept so that scrubbing back to it reads nothing again. Keyed by `key`, the tick's cache key
 * (timeline/cacheKey.ts: scope, read time, content type and asset types), never shared across scopes.
 */
export type StoredTick = {
  /** `tickCacheKey(scope, readTime, contentType, assetTypes)`: the store's key. */
  readonly key: string;
  /** Full scope name, e.g. `organizations/123` (indexed: `byScope`). */
  readonly scope: string;
  /** The tick's read time, `YYYY-MM-DDT00:00:00Z`. */
  readonly readTime: string;
  /** The tick's day, `YYYY-MM-DD`. */
  readonly day: string;
  /** `RESOURCE`. */
  readonly contentType: string;
  /** The RE2 patterns the read was limited to; absent: every type. */
  readonly assetTypes?: readonly string[];
  /**
   * The latest tick, read at "now" rather than at its day's start (skill cai-ingestion §5): valid only while its day
   * is still the latest, then read again at 00:00 UTC.
   */
  readonly now: boolean;
  /** The read time Cloud Asset Inventory reported. */
  readonly actualReadTime: string;
  /** RFC 3339 time it was read. */
  readonly fetchedAt: string;
  readonly assetCount: number;
  /** The stored size of `blob`. */
  readonly bytes: number;
  /** The model `Snapshot` as JSON, gzip-compressed where the browser can (snapshots/codec.ts), like a snapshot's. */
  readonly blob: Blob;
};

export interface GcportraitDBSchema extends DBSchema {
  /** Key/value preferences; values are validated on read (storage/preferences.ts). */
  preferences: { key: string; value: unknown };
  snapshots: { key: string; value: StoredSnapshot; indexes: { byReadTime: string; bySavedAt: string } };
  savedViews: { key: string; value: StoredView; indexes: { byUpdatedAt: string } };
  /** Keyed by the tick's cache key (version 2). */
  tickCache: { key: string; value: StoredTick; indexes: { byScope: string } };
}

export type GcportraitDB = IDBPDatabase<GcportraitDBSchema>;
type UpgradeTransaction = IDBPTransaction<
  GcportraitDBSchema,
  StoreNames<GcportraitDBSchema>[],
  'versionchange'
>;
type Migration = (db: GcportraitDB, transaction: UpgradeTransaction) => void;

const MIGRATIONS: readonly Migration[] = [
  // 0 → 1: initial schema.
  (db) => {
    db.createObjectStore('preferences');
    const snapshots = db.createObjectStore('snapshots', { keyPath: 'id' });
    snapshots.createIndex('byReadTime', 'meta.readTime');
    snapshots.createIndex('bySavedAt', 'meta.savedAt');
    const savedViews = db.createObjectStore('savedViews', { keyPath: 'id' });
    savedViews.createIndex('byUpdatedAt', 'updatedAt');
    const tickCache = db.createObjectStore('tickCache', { keyPath: ['scope', 'readTime'] });
    tickCache.createIndex('byScope', 'scope');
  },
  // 1 → 2: the tick cache keyed by the tick's cache key, (scope, readTime, contentType, assetTypes) as one string
  // (skill cai-ingestion §5). The version-1 store holds no data, so it is replaced.
  (db) => {
    db.deleteObjectStore('tickCache');
    const tickCache = db.createObjectStore('tickCache', { keyPath: 'key' });
    tickCache.createIndex('byScope', 'scope');
  },
];

export const DB_VERSION = MIGRATIONS.length;

/** Runs the migrations from `oldVersion` up to `newVersion` (exported for tests). */
export function upgradeDatabase(
  db: GcportraitDB,
  oldVersion: number,
  newVersion: number,
  transaction: UpgradeTransaction,
): void {
  for (let version = oldVersion; version < newVersion; version += 1) {
    const migration = MIGRATIONS[version];
    if (migration === undefined) throw new Error(`No migration from database version ${String(version)}`);
    migration(db, transaction);
  }
}

/** How long to wait for IndexedDB before booting without it (some private modes never answer). */
export const OPEN_TIMEOUT_MS = 3000;

/**
 * Opens (and if needed creates or upgrades) the database. Resolves to null instead of rejecting when
 * IndexedDB is missing, throws, or does not answer in time, so the app always boots; callers then keep
 * state in memory for the session. `onClose` is called when the connection it gives is closed under the page
 * (another tab's upgrade, the browser terminating it), so the caller can open a new one (storage/connection.ts).
 */
export async function openDatabase(
  timeoutMs = OPEN_TIMEOUT_MS,
  onClose: () => void = () => undefined,
): Promise<GcportraitDB | null> {
  let indexedDb: IDBFactory | undefined;
  try {
    indexedDb = globalThis.indexedDB;
  } catch {
    // A getter that throws (some locked-down browsers): no IndexedDB, as when it is missing.
    return null;
  }
  if (typeof indexedDb === 'undefined') return null;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    let connection: GcportraitDB | undefined;
    const opening = openDB<GcportraitDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, newVersion, transaction) {
        upgradeDatabase(db, oldVersion, newVersion ?? DB_VERSION, transaction);
      },
      // Another tab wants a newer schema: let it upgrade; the next read here opens again (or falls back to memory).
      blocking() {
        connection?.close();
        onClose();
      },
      terminated() {
        onClose();
      },
    }).then((db) => {
      connection = db;
      if (timedOut) db.close();
      return db;
    });
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve(null);
      }, timeoutMs);
    });
    return await Promise.race([opening, timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
