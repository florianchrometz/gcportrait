// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DataError } from '../../diagram/pipeline/dataHandler';
import { findStoredExtra, loadStoredHistory, storedSnapshotVersion } from '../../snapshots/load';
import { storedRecord } from '../../snapshots/testing';
import * as storage from '../../storage/db';
import { resetWorkerDatabase } from '../../storage/workerDatabase';
import { TEST_OPEN_TIMEOUT_MS, useFreshIndexedDb } from '../../test/indexedDb';
import { storedTick } from '../testing/fixtures';
import { readCachedTick } from './store';

const REF = '01J0000000000000000000000E';
const RECORD = storedRecord(REF);
const TICK = storedTick('organizations/30000000001', '2026-10-06');
const OWNER = {
  ref: REF,
  scopePath: TICK.scope,
  readTime: RECORD.meta.readTime,
};
const { database } = useFreshIndexedDb({ resetSnapshots: true });

beforeEach(() => {
  resetWorkerDatabase(TEST_OPEN_TIMEOUT_MS);
  vi.spyOn(storage, 'openDatabase');
});

afterEach(() => {
  for (const result of vi.mocked(storage.openDatabase).mock.settledResults) {
    if (result.type === 'fulfilled') result.value?.close();
  }
  vi.restoreAllMocks();
  resetWorkerDatabase();
});

async function populate(): Promise<void> {
  const db = await database();
  await db.put('snapshots', RECORD);
  await db.put('tickCache', TICK);
  vi.mocked(storage.openDatabase).mockClear();
}

describe('the worker’s shared snapshot and tick database', () => {
  it('reads both persisted stores through one opening', async () => {
    await populate();
    const [version, tick] = await Promise.all([storedSnapshotVersion(REF), readCachedTick(TICK.key)]);
    expect(version).toBe(RECORD.meta.savedAt);
    expect(tick).toEqual(TICK);
    expect(storage.openDatabase).toHaveBeenCalledExactlyOnceWith(TEST_OPEN_TIMEOUT_MS, expect.any(Function));
  });

  it('shares a recovered connection after a manual close', async () => {
    await populate();
    expect(await readCachedTick(TICK.key)).toEqual(TICK);
    const opened = vi.mocked(storage.openDatabase).mock.settledResults[0];
    if (opened?.type !== 'fulfilled' || opened.value === null) throw new Error('expected an open database');
    opened.value.close();
    expect(await storedSnapshotVersion(REF)).toBe(RECORD.meta.savedAt);
    expect(await readCachedTick(TICK.key)).toEqual(TICK);
    expect(storage.openDatabase).toHaveBeenCalledTimes(2);
  });

  it('reopens for both readers after the current connection reports a close', async () => {
    await populate();
    expect(await readCachedTick(TICK.key)).toEqual(TICK);
    const open = vi.mocked(storage.openDatabase);
    const first = open.mock.settledResults[0];
    if (first?.type !== 'fulfilled' || first.value === null) throw new Error('expected an open database');
    first.value.close();
    open.mock.calls[0]?.[1]?.();
    expect(await storedSnapshotVersion(REF)).toBe(RECORD.meta.savedAt);
    expect(await readCachedTick(TICK.key)).toEqual(TICK);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('keeps the snapshot reader’s newer opening when an older tick read fails late', async () => {
    await populate();
    await readCachedTick(TICK.key);
    const open = vi.mocked(storage.openDatabase);
    const first = open.mock.settledResults[0];
    if (first?.type !== 'fulfilled' || first.value === null) throw new Error('expected an open database');
    let fail: (error: Error) => void = () => undefined;
    const delayed = new Promise<never>((_resolve, reject) => {
      fail = reject;
    });
    const get = vi.spyOn(first.value, 'get').mockImplementationOnce(() => delayed);
    const reading = readCachedTick(TICK.key);
    await Promise.resolve();
    expect(get).toHaveBeenCalledOnce();
    first.value.close();
    open.mock.calls[0]?.[1]?.();
    expect(await storedSnapshotVersion(REF)).toBe(RECORD.meta.savedAt);
    expect(open).toHaveBeenCalledTimes(2);
    fail(new DOMException('closed', 'InvalidStateError'));
    expect(await reading).toEqual(TICK);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('restores the shared production timeout through worker database reset', async () => {
    await populate();
    resetWorkerDatabase();
    expect(await storedSnapshotVersion(REF)).toBe(RECORD.meta.savedAt);
    expect(await readCachedTick(TICK.key)).toEqual(TICK);
    expect(storage.openDatabase).toHaveBeenCalledExactlyOnceWith(
      storage.OPEN_TIMEOUT_MS,
      expect.any(Function),
    );
  });

  for (const kind of ['synchronous', 'rejected'] as const) {
    it(`retries a snapshot’s ${kind} initial opening failure once`, async () => {
      await populate();
      const error = new Error('opening failed');
      const open = vi.mocked(storage.openDatabase);
      if (kind === 'synchronous')
        open.mockImplementationOnce(() => {
          throw error;
        });
      else open.mockRejectedValueOnce(error);
      expect(await loadStoredHistory(REF)).toBeNull();
      expect(open).toHaveBeenCalledTimes(2);
    });

    for (const [name, read] of [
      ['tick', () => readCachedTick(TICK.key)],
      ['snapshot listing', () => findStoredExtra(OWNER, TICK.readTime)],
    ] as const) {
      it(`does not retry the ${name} reader’s ${kind} initial opening failure`, async () => {
        const error = new Error('opening failed');
        const open = vi.mocked(storage.openDatabase);
        if (kind === 'synchronous')
          open.mockImplementationOnce(() => {
            throw error;
          });
        else open.mockRejectedValueOnce(error);
        await expect(read()).rejects.toBe(error);
        expect(open).toHaveBeenCalledOnce();
      });
    }
  }

  for (const [name, method, read] of [
    ['snapshot', 'get', () => loadStoredHistory(REF)],
    ['tick', 'get', () => readCachedTick(TICK.key)],
    ['snapshot listing', 'getAll', () => findStoredExtra(OWNER, TICK.readTime)],
  ] as const) {
    it(`propagates the ${name} reader’s second read failure`, async () => {
      await populate();
      const error = new DOMException('closed', 'InvalidStateError');
      const get = vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(() => {
        throw error;
      });
      await expect(read()).rejects.toBe(error);
      expect(get).toHaveBeenCalledTimes(2);
      expect(storage.openDatabase).toHaveBeenCalledTimes(2);
    });
  }

  it('does not retry a snapshot DataError', async () => {
    await populate();
    const error = new DataError('unknown-snapshot', 'unavailable');
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(() => {
      throw error;
    });
    await expect(loadStoredHistory(REF)).rejects.toBe(error);
    expect(storage.openDatabase).toHaveBeenCalledOnce();
  });

  it('preserves each reader’s unavailable-storage result without reopening', async () => {
    vi.mocked(storage.openDatabase).mockResolvedValue(null);
    expect(await readCachedTick(TICK.key)).toBeUndefined();
    expect(await findStoredExtra(OWNER, TICK.readTime)).toBeNull();
    await expect(loadStoredHistory(REF)).rejects.toBeInstanceOf(DataError);
    expect(await storedSnapshotVersion(REF)).toBe('missing');
    expect(storage.openDatabase).toHaveBeenCalledOnce();
  });
});
