// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';

import { createDatabaseConnection as compatibleFactory } from './connection';
import { createDatabaseConnection } from './databaseConnection';
import * as storage from './db';

describe('the React-free database connection factory', () => {
  it('keeps the page module’s factory export identical', () => {
    expect(compatibleFactory).toBe(createDatabaseConnection);
  });

  it('coalesces concurrent callers on one pending open', () => {
    const pending = new Promise<storage.GcportraitDB | null>(() => undefined);
    const open = vi.fn(() => pending);
    const connection = createDatabaseConnection(open);
    expect(open).not.toHaveBeenCalled();
    expect(connection.database()).toBe(pending);
    expect(connection.database()).toBe(pending);
    expect(open).toHaveBeenCalledOnce();
  });

  it('keeps a null opening instead of repeatedly opening unavailable storage', async () => {
    const open = vi.fn(() => Promise.resolve(null));
    const connection = createDatabaseConnection(open);
    const first = connection.database();
    expect(await first).toBeNull();
    expect(connection.database()).toBe(first);
    expect(open).toHaveBeenCalledOnce();
  });

  it('does not add retries to a rejected custom opener', async () => {
    const error = new Error('opening refused');
    const open = vi.fn(() => Promise.reject(error));
    const connection = createDatabaseConnection(open);
    const first = connection.database();
    await expect(first).rejects.toBe(error);
    expect(connection.database()).toBe(first);
    expect(open).toHaveBeenCalledOnce();
  });

  it('opens again when the current opening reports a close', async () => {
    const callbacks: (() => void)[] = [];
    const open = vi.fn((onClose: () => void) => {
      callbacks.push(onClose);
      return Promise.resolve(null);
    });
    const connection = createDatabaseConnection(open);
    const first = connection.database();
    await first;
    callbacks[0]?.();
    const second = connection.database();
    expect(second).not.toBe(first);
    expect(await second).toBeNull();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('does not let an old close callback invalidate a newer opening', () => {
    const callbacks: (() => void)[] = [];
    const open = vi.fn((onClose: () => void) => {
      callbacks.push(onClose);
      return Promise.resolve(null);
    });
    const connection = createDatabaseConnection(open);
    const first = connection.database();
    callbacks[0]?.();
    const second = connection.database();
    callbacks[0]?.();
    expect(second).not.toBe(first);
    expect(connection.database()).toBe(second);
    expect(open).toHaveBeenCalledTimes(2);
    callbacks[1]?.();
    expect(connection.database()).not.toBe(second);
    expect(open).toHaveBeenCalledTimes(3);
  });

  it('delegates the default timeout and close callback to openDatabase', async () => {
    const open = vi.spyOn(storage, 'openDatabase').mockResolvedValue(null);
    try {
      expect(await createDatabaseConnection().database()).toBeNull();
      expect(open).toHaveBeenCalledExactlyOnceWith(undefined, expect.any(Function));
      expect(storage.OPEN_TIMEOUT_MS).toBe(3000);
    } finally {
      open.mockRestore();
    }
  });

  it('can be imported without loading React', async () => {
    vi.doMock('react', () => {
      throw new Error('React must not load in the connection core');
    });
    vi.resetModules();
    try {
      const core = await import('./databaseConnection');
      expect(core.createDatabaseConnection).toBeTypeOf('function');
    } finally {
      vi.doUnmock('react');
      vi.resetModules();
    }
  });
});
