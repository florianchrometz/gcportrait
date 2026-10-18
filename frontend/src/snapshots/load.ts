// SPDX-License-Identifier: Apache-2.0
/**
 * How the diagram's data worker loads the snapshot a view names (diagram/pipeline/dataRole.ts): a demo
 * organisation (`demo:<size>`) is generated as before (`loadDemoSnapshot`), so the demo needs no storage at all;
 * any other ref is a stored snapshot's ULID, read from IndexedDB through storage/db.ts in the worker itself and
 * checked by `migrateSnapshot` (the only way to read a stored snapshot). The stored history of a demo
 * organisation is read the same way (`loadStoredHistory`, for the timeline). The data worker keeps the
 * Graph of the last snapshot it loaded; `storedSnapshotVersion` tells it whether that record is still stored as it
 * was, so a snapshot deleted on the Snapshots page is not drawn from memory until a reload. An extra tick of a
 * timeline (an export or a manual pull of the same scope) is found among the stored records by its read time
 * (`findStoredExtra`), looked up again for every view that names it, so a deleted one is never drawn.
 */
import type { DemoHistory } from '@gcportrait/demo-data';
import { migrateSnapshot, SnapshotFormatError, type Snapshot, type SnapshotRef } from '@gcportrait/model';

import { DataError, loadDemoSnapshot, type SnapshotLoader } from '../diagram/pipeline/dataHandler';
import { OPEN_TIMEOUT_MS, type GcportraitDB, type StoredSnapshot } from '../storage/db';
import { recoverWorkerDatabase, resetWorkerDatabase, workerDatabase } from '../storage/workerDatabase';
import { pickExtra, type TimelineOwner } from '../timeline/extraTicks';
import type { StoredExtra } from '../timeline/worker/source';
import { decodeJson } from './codec';
import { parseHistory } from './worker/parse';

/** Forgets the worker's shared connection and sets its next opens' timeout (tests replace IndexedDB). */
export function resetStoredSnapshotDatabase(timeoutMs = OPEN_TIMEOUT_MS): void {
  resetWorkerDatabase(timeoutMs);
}

async function read(ref: string, opening: Promise<GcportraitDB | null>): Promise<StoredSnapshot | undefined> {
  const db = await opening;
  if (db === null)
    throw new DataError(
      'unknown-snapshot',
      'This browser does not let gcportrait store snapshots, so only the demo organisations can be opened.',
    );
  return db.get('snapshots', ref);
}

async function storedRecord(ref: string): Promise<StoredSnapshot> {
  let record: StoredSnapshot | undefined;
  let opening: Promise<GcportraitDB | null> | undefined;
  try {
    opening = workerDatabase();
    record = await read(ref, opening);
  } catch (error) {
    if (error instanceof DataError) throw error;
    // The connection was closed (another tab upgraded the schema): open a new one, once.
    record = await read(ref, recoverWorkerDatabase(opening));
  }
  if (record === undefined)
    throw new DataError('unknown-snapshot', `No snapshot "${ref}" is stored in this browser.`);
  return record;
}

/**
 * A stored record's snapshot. A record that does not decompress or parse, or whose snapshot the model cannot read,
 * is a `DataError` with a sentence for people (the canvas shows it), not the parser's message.
 */
async function storedSnapshot(ref: string, record: StoredSnapshot): Promise<Snapshot> {
  let value: unknown;
  try {
    value = await decodeJson(record.blob);
  } catch {
    throw new DataError(
      'unknown-snapshot',
      `The snapshot "${ref}" stored in this browser is damaged and cannot be read. Delete it on the Snapshots ` +
        'page, then import or generate it again.',
    );
  }
  try {
    return migrateSnapshot(value);
  } catch (error) {
    if (!(error instanceof SnapshotFormatError)) throw error;
    throw new DataError(
      'unknown-snapshot',
      `The snapshot "${ref}" stored in this browser cannot be read: ${error.message}`,
    );
  }
}

/**
 * What the data worker compares before it reuses the Graph it kept for `ref` (`snapshotVersion` of
 * diagram/pipeline/dataHandler.ts): null for a demo organisation (generated, always the same), else when the record
 * was saved, or `'missing'` when it is not stored (any more). Imports never reuse an id (worker/handler.ts), so
 * this matters when a snapshot is deleted, here or in another tab, while its Graph is kept.
 */
export async function storedSnapshotVersion(ref: SnapshotRef): Promise<string | null> {
  if (ref.startsWith('demo:')) return null;
  try {
    return (await storedRecord(ref)).meta.savedAt;
  } catch {
    return 'missing';
  }
}

/** The data worker's snapshot loader: demo organisations generated, every other snapshot from IndexedDB. */
export const loadAnySnapshot: SnapshotLoader = async (ref: SnapshotRef, onStage) => {
  if (ref.startsWith('demo:')) return loadDemoSnapshot(ref, onStage);
  onStage('ingest');
  return storedSnapshot(ref, await storedRecord(ref));
};

/** A stored snapshot's history (base and daily mutations), or null when it has none. */
export async function loadStoredHistory(ref: SnapshotRef): Promise<DemoHistory | null> {
  const record = await storedRecord(ref);
  return record.history === undefined ? null : parseHistory(await decodeJson(record.history));
}

/** Every stored record (their Blobs are handles, read only when a snapshot is loaded); none without IndexedDB. */
async function allRecords(): Promise<readonly StoredSnapshot[]> {
  const opening = workerDatabase();
  const db = await opening;
  if (db === null) return [];
  try {
    return await db.getAll('snapshots');
  } catch {
    // The connection was closed (another tab upgraded the schema): open a new one, once.
    const again = await recoverWorkerDatabase(opening);
    return again === null ? [] : again.getAll('snapshots');
  }
}

/**
 * The stored snapshot extra tick `id` of `owner`'s timeline shows (timeline/extraTicks.ts `pickExtra`: an
 * export or a pull of the same scope read in that second, the copy stored last), or null when none is stored.
 */
export async function findStoredExtra(owner: TimelineOwner, id: string): Promise<StoredExtra | null> {
  const records = await allRecords();
  const picked = pickExtra(records, owner, id);
  const record = picked === null ? undefined : records.find((candidate) => candidate.id === picked.id);
  if (record === undefined) return null;
  return {
    version: `${record.id} ${record.meta.savedAt}`,
    load: () => storedSnapshot(record.id, record),
  };
}
