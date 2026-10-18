// @vitest-environment node
// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TEST_OPEN_TIMEOUT_MS } from '../test/indexedDb';
import * as storage from './db';
import { recoverWorkerDatabase, resetWorkerDatabase, workerDatabase } from './workerDatabase';

beforeEach(() => {
  resetWorkerDatabase(TEST_OPEN_TIMEOUT_MS);
  vi.spyOn(storage, 'openDatabase').mockResolvedValue(null);
});

afterEach(() => {
  resetWorkerDatabase();
  vi.restoreAllMocks();
});

describe('the worker database owner', () => {
  it('keeps the opening promise as its token, including a null result', async () => {
    const opening = workerDatabase();
    expect(workerDatabase()).toBe(opening);
    expect(await opening).toBeNull();
    expect(workerDatabase()).toBe(opening);
    expect(storage.openDatabase).toHaveBeenCalledExactlyOnceWith(TEST_OPEN_TIMEOUT_MS, expect.any(Function));
  });

  it('replaces only the failed opening and keeps the test timeout on recovery', () => {
    const first = workerDatabase();
    const second = recoverWorkerDatabase(first);
    expect(second).not.toBe(first);
    expect(workerDatabase()).toBe(second);
    expect(storage.openDatabase).toHaveBeenCalledTimes(2);
    expect(storage.openDatabase).toHaveBeenLastCalledWith(TEST_OPEN_TIMEOUT_MS, expect.any(Function));
  });

  it('keeps a newer opening in the same factory when an old read fails after close', () => {
    const first = workerDatabase();
    vi.mocked(storage.openDatabase).mock.calls[0]?.[1]?.();
    const second = workerDatabase();
    expect(second).not.toBe(first);
    expect(recoverWorkerDatabase(first)).toBe(second);
    expect(workerDatabase()).toBe(second);
    expect(storage.openDatabase).toHaveBeenCalledTimes(2);
  });

  it('opens only once when recovery is the first request after a close', () => {
    const first = workerDatabase();
    vi.mocked(storage.openDatabase).mock.calls[0]?.[1]?.();
    const second = recoverWorkerDatabase(first);
    expect(second).not.toBe(first);
    expect(workerDatabase()).toBe(second);
    expect(storage.openDatabase).toHaveBeenCalledTimes(2);
  });

  it('does not let a stale failure undo an explicit reset or its default timeout', () => {
    const first = workerDatabase();
    resetWorkerDatabase();
    const second = workerDatabase();
    expect(second).not.toBe(first);
    expect(recoverWorkerDatabase(first)).toBe(second);
    expect(storage.openDatabase).toHaveBeenCalledTimes(2);
    expect(storage.openDatabase).toHaveBeenLastCalledWith(storage.OPEN_TIMEOUT_MS, expect.any(Function));
  });

  it('recovers once after a synchronous opener failure produced no token', async () => {
    const error = new Error('opening failed');
    vi.mocked(storage.openDatabase).mockImplementationOnce(() => {
      throw error;
    });
    expect(workerDatabase).toThrow(error);
    expect(await recoverWorkerDatabase(undefined)).toBeNull();
    expect(storage.openDatabase).toHaveBeenCalledTimes(2);
  });

  it('leaves a rejected opening cached until a caller explicitly recovers', async () => {
    const error = new Error('opening failed');
    vi.mocked(storage.openDatabase).mockRejectedValueOnce(error);
    const first = workerDatabase();
    await expect(first).rejects.toBe(error);
    expect(workerDatabase()).toBe(first);
    expect(await recoverWorkerDatabase(first)).toBeNull();
    expect(storage.openDatabase).toHaveBeenCalledTimes(2);
  });

  it('imports without React', async () => {
    vi.doMock('react', () => {
      throw new Error('React must not load in the worker owner');
    });
    vi.resetModules();
    try {
      expect((await import('./workerDatabase')).workerDatabase).toBeTypeOf('function');
    } finally {
      vi.doUnmock('react');
      vi.resetModules();
    }
  });
});
