// SPDX-License-Identifier: MIT
/**
 * Reading snapshot files in the worker (worker/handler.ts): the `.gcportrait.json` bundle of ../bundle.ts and the
 * history document it may carry. Everything is checked before anything is stored; a problem is a
 * `SnapshotFileError` whose message is for the person.
 */
import { snapshotAt, type DemoHistory } from '@gcportrait/demo-data';
import { DemoHistorySchema, migrateSnapshot, type Asset, type Snapshot } from '@gcportrait/model';

import { isRecord } from '../../guards';
import { BUNDLE_FORMAT, BUNDLE_VERSION } from '../bundle';

/** A file that is not what it claims, or not one gcportrait reads; the message is for the person. */
export class SnapshotFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotFileError';
  }
}

/**
 * A history document (`DemoHistory`): `DemoHistorySchema` checks its shape, every asset and its last tick being
 * `today`; then a replay to the last tick (every change must apply to the assets before it).
 */
function replayed(value: unknown): { readonly history: DemoHistory; readonly last: readonly Asset[] } {
  const parsed = DemoHistorySchema.safeParse(value);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    const where = issue?.path.map(String).join('.') ?? '';
    throw new SnapshotFileError(
      where === '' ? 'The history is not an object.' : `The history is invalid at ${where}.`,
    );
  }
  const history = parsed.data;
  try {
    return { history, last: snapshotAt(history, history.ticks.length - 1).assets };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SnapshotFileError(`The history does not replay: ${reason}.`);
  }
}

/** A history document checked by `replayed`: the history itself. */
export function parseHistory(value: unknown): DemoHistory {
  return replayed(value).history;
}

/**
 * `parseHistory`, and the history must end with `snapshot`: its last day holds the snapshot's assets (by name), so
 * a history is never kept with another organisation's snapshot (the timeline replays it).
 */
export function parseHistoryOf(value: unknown, snapshot: Snapshot): DemoHistory {
  const { history, last } = replayed(value);
  const names = new Set(last.map((item) => item.name));
  const same = names.size === snapshot.assets.length && snapshot.assets.every((item) => names.has(item.name));
  if (!same)
    throw new SnapshotFileError(
      `The history does not belong to the snapshot: its last day holds ${String(names.size)} assets, the ` +
        `snapshot ${String(snapshot.assets.length)}${names.size === snapshot.assets.length ? ', not the same ones' : ''}.`,
    );
  return history;
}

export interface ParsedBundle {
  readonly snapshot: Snapshot;
  readonly history?: DemoHistory;
}

/**
 * Reads a bundle's text: its format and version, the snapshot through `migrateSnapshot`, and the history, which must
 * end with that snapshot.
 */
export function parseBundle(text: string): ParsedBundle {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new SnapshotFileError('The file is not valid JSON.');
  }
  if (!isRecord(value) || value['format'] !== BUNDLE_FORMAT)
    throw new SnapshotFileError('The file is not a gcportrait snapshot file.');
  const version = value['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    throw new SnapshotFileError('The snapshot file has no valid version.');
  if (version > BUNDLE_VERSION)
    throw new SnapshotFileError(
      `The snapshot file uses version ${String(version)}; this build reads version ${String(BUNDLE_VERSION)}. ` +
        'Update gcportrait to open it.',
    );
  const snapshot = migrateSnapshot(value['snapshot']);
  if (value['history'] === undefined) return { snapshot };
  return { snapshot, history: parseHistoryOf(value['history'], snapshot) };
}
