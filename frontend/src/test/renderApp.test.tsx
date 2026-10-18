// SPDX-License-Identifier: MIT
import 'fake-indexeddb/auto';

import { useEffect } from 'react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { App } from '../App';
import { createDatabaseConnection, type DatabaseConnection } from '../storage/connection';
import * as storage from '../storage/db';
import { TEST_OPEN_TIMEOUT_MS, useFreshIndexedDb } from './indexedDb';
import { renderApp } from './renderApp';

vi.mock('../App', () => ({ App: vi.fn(() => <></>) }));

const { database } = useFreshIndexedDb();

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(App).mockReset();
  vi.mocked(App).mockReturnValue(<></>);
});

function suppliedConnection(): DatabaseConnection {
  const connection = vi.mocked(App).mock.calls.at(-1)?.[0].database;
  expect(connection).toBeDefined();
  if (connection === undefined) throw new Error('expected a test-owned database connection');
  return connection;
}

describe('renderApp database ownership', () => {
  it('automatically unmounts before closing its database after the test', async () => {
    let opened: storage.GcportraitDB | null = null;
    let unmountedWithOpenDatabase = false;
    vi.mocked(App).mockImplementation(function AppProbe() {
      useEffect(
        () => () => {
          if (opened !== null) {
            opened.transaction('preferences');
            unmountedWithOpenDatabase = true;
          }
        },
        [],
      );
      return <></>;
    });
    renderApp('/');
    const db = await suppliedConnection().database();
    expect(db).not.toBeNull();
    if (db === null) throw new Error('expected IndexedDB to open');
    opened = db;
    onTestFinished(() => {
      expect(unmountedWithOpenDatabase).toBe(true);
      expect(() => db.transaction('preferences')).toThrow();
    });
  });

  it('opens lazily with the test timeout and persists across unmounts', async () => {
    const open = vi.spyOn(storage, 'openDatabase');
    const first = renderApp('/');
    const connection = suppliedConnection();
    expect(open).not.toHaveBeenCalled();
    const db = await connection.database();
    expect(db).not.toBeNull();
    if (db === null) throw new Error('expected IndexedDB to open');
    expect(open).toHaveBeenCalledExactlyOnceWith(TEST_OPEN_TIMEOUT_MS, expect.any(Function));
    await db.put('preferences', 'dark', 'theme');
    const close = vi.spyOn(db, 'close');
    first.unmount();
    expect(close).toHaveBeenCalledOnce();
    expect(await connection.database()).toBeNull();
    const second = renderApp('/');
    const next = await suppliedConnection().database();
    expect(next).not.toBe(db);
    expect(await next?.get('preferences', 'theme')).toBe('dark');
    second.unmount();
  });

  it('preserves an explicit connection without taking ownership', async () => {
    const db = await database();
    const close = vi.spyOn(db, 'close');
    const connection = createDatabaseConnection(() => Promise.resolve(db));
    const app = renderApp('/', { database: connection });
    expect(suppliedConnection()).toBe(connection);
    expect(await suppliedConnection().database()).toBe(db);
    app.unmount();
    expect(close).not.toHaveBeenCalled();
    await db.put('preferences', 'light', 'theme');
    expect(await db.get('preferences', 'theme')).toBe('light');
  });

  it('closes an owned connection that opens after unmount', async () => {
    const db = await database();
    const close = vi.spyOn(db, 'close');
    let resolveOpen: (value: storage.GcportraitDB) => void = () => undefined;
    vi.spyOn(storage, 'openDatabase').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOpen = resolve;
        }),
    );
    const app = renderApp('/');
    const pending = suppliedConnection().database();
    app.unmount();
    resolveOpen(db);
    expect(await pending).toBeNull();
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes an owned connection that opens after automatic cleanup', async () => {
    const db = await storage.openDatabase(TEST_OPEN_TIMEOUT_MS);
    if (db === null) throw new Error('expected IndexedDB to open');
    let resolveOpen: (value: storage.GcportraitDB) => void = () => undefined;
    vi.spyOn(storage, 'openDatabase').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOpen = resolve;
        }),
    );
    renderApp('/');
    const pending = suppliedConnection().database();
    onTestFinished(async () => {
      try {
        resolveOpen(db);
        expect(await pending).toBeNull();
        expect(() => db.transaction('preferences')).toThrow();
      } finally {
        db.close();
      }
    });
  });
});
