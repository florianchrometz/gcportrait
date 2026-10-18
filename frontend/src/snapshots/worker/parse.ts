// SPDX-License-Identifier: MIT
/**
 * Reading snapshot files in the worker (worker/handler.ts): the `.gcportrait.json` bundle of ../bundle.ts and the
 * history document it may carry. Everything is checked before anything is stored; a problem is a
 * `SnapshotFileError` whose message is for the person.
 */
import { snapshotAt, type DemoHistory, type HistoryTick, type Mutation } from '@gcportrait/demo-data';
import {
  AssetSchema,
  DateSchema,
  DemoSizeSchema,
  migrateSnapshot,
  TimestampSchema,
  type Asset,
  type Snapshot,
} from '@gcportrait/model';

import { isRecord } from '../../guards';
import { BUNDLE_FORMAT, BUNDLE_VERSION } from '../bundle';

/** A file that is not what it claims, or not one gcportrait reads; the message is for the person. */
export class SnapshotFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotFileError';
  }
}

function asset(value: unknown, where: string): Asset {
  const parsed = AssetSchema.safeParse(value);
  if (!parsed.success) throw new SnapshotFileError(`The history has an invalid asset (${where}).`);
  return parsed.data;
}

function mutation(value: unknown, where: string): Mutation {
  if (!isRecord(value)) throw new SnapshotFileError(`The history has an invalid change (${where}).`);
  if (value['kind'] === 'add') return { kind: 'add', asset: asset(value['asset'], where) };
  if (value['kind'] === 'change') {
    const fields = value['fields'];
    if (!Array.isArray(fields) || !fields.every((field) => typeof field === 'string'))
      throw new SnapshotFileError(`The history has an invalid change (${where}).`);
    return { kind: 'change', asset: asset(value['asset'], where), fields };
  }
  const name = value['name'];
  const assetType = value['assetType'];
  if (value['kind'] === 'remove' && typeof name === 'string' && typeof assetType === 'string')
    return { kind: 'remove', name, assetType };
  throw new SnapshotFileError(`The history has an invalid change (${where}).`);
}

function tick(value: unknown, index: number): HistoryTick {
  // A history's ticks are days (the model's TickSchema also takes an extra tick's read time).
  const day = isRecord(value) ? DateSchema.safeParse(value['tick']) : null;
  const readTime = isRecord(value) ? TimestampSchema.safeParse(value['readTime']) : null;
  const mutations = isRecord(value) ? value['mutations'] : null;
  if (day?.success !== true || readTime?.success !== true || !Array.isArray(mutations))
    throw new SnapshotFileError(`The history's tick ${String(index + 1)} is invalid.`);
  return {
    tick: day.data,
    readTime: readTime.data,
    mutations: mutations.map((item, at) => mutation(item, `tick ${day.data}, change ${String(at + 1)}`)),
  };
}

/** A history document checked and replayed: the history and its last day's assets. */
function replayed(value: unknown): { readonly history: DemoHistory; readonly last: readonly Asset[] } {
  if (!isRecord(value)) throw new SnapshotFileError('The history is not an object.');
  const size = DemoSizeSchema.safeParse(value['size']);
  const today = DateSchema.safeParse(value['today']);
  const seed = value['seed'];
  const base = value['base'];
  const ticks = value['ticks'];
  if (!size.success || !today.success || typeof seed !== 'number' || !Number.isInteger(seed))
    throw new SnapshotFileError('The history has no valid size, seed or day.');
  if (!Array.isArray(base) || !Array.isArray(ticks) || ticks.length === 0)
    throw new SnapshotFileError('The history has no base or no ticks.');
  const history: DemoHistory = {
    size: size.data,
    seed,
    today: today.data,
    base: base.map((item, at) => asset(item, `base, asset ${String(at + 1)}`)),
    ticks: ticks.map(tick),
  };
  if (history.ticks.at(-1)?.tick !== history.today)
    throw new SnapshotFileError('The history does not end on its own day.');
  try {
    return { history, last: snapshotAt(history, history.ticks.length - 1).assets };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SnapshotFileError(`The history does not replay: ${reason}.`);
  }
}

/**
 * A history document (`DemoHistory`), checked: its shape, every asset against the model's `AssetSchema`, the last
 * tick being `today`, and a replay to the last tick (every change must apply to the assets before it).
 */
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
