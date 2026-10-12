// SPDX-License-Identifier: MIT
/**
 * One IndexedDB connection for the whole page: the preferences, the saved views and the snapshot library
 * (the Snapshots page, the Snapshot menu, "Try the demo") all read the database through it, so a connection that
 * goes away (another tab upgrading the schema closes it through `blocking`, or the browser terminates it) is
 * opened again on the next read, for all of them at once, instead of leaving one of them on a closed connection.
 * main.tsx creates it and the app provides it (`DatabaseContext`); the stores take its `database` getter (or, in
 * tests, a fixed promise: `DatabaseSource`). The data worker opens its own (snapshots/load.ts): a worker cannot
 * share a page's connection.
 */
import { createContext, useContext } from 'react';

import { openDatabase, type GcportraitDB } from './db';

/** What a store reads the database from: the connection's getter, or one fixed promise (tests). */
export type DatabaseSource = Promise<GcportraitDB | null> | (() => Promise<GcportraitDB | null>);

/** The database getter of a source. */
export function databaseOf(source: DatabaseSource): () => Promise<GcportraitDB | null> {
  return typeof source === 'function' ? source : () => source;
}

export interface DatabaseConnection {
  /**
   * The open database: opened on the first call, and again on the call after it was closed; null when the browser
   * gives the page no IndexedDB (then every store keeps its data in memory for the session).
   */
  readonly database: () => Promise<GcportraitDB | null>;
}

/** Opens the database: `onClose` is called once when the connection it gives is closed. */
export type DatabaseOpener = (onClose: () => void) => Promise<GcportraitDB | null>;

export function createDatabaseConnection(
  open: DatabaseOpener = (onClose) => openDatabase(undefined, onClose),
): DatabaseConnection {
  let current: Promise<GcportraitDB | null> | null = null;
  const database = (): Promise<GcportraitDB | null> => {
    if (current !== null) return current;
    const opening = open(() => {
      if (current === opening) current = null;
    });
    current = opening;
    return opening;
  };
  return { database };
}

let browser: DatabaseConnection | null = null;

/** The page's connection when the app was given none (tests that render a part of the app). */
function browserConnection(): DatabaseConnection {
  browser ??= createDatabaseConnection();
  return browser;
}

/** The app's IndexedDB connection (App.tsx provides main.tsx's). */
export const DatabaseContext = createContext<DatabaseConnection | null>(null);

export function useDatabaseConnection(): DatabaseConnection {
  return useContext(DatabaseContext) ?? browserConnection();
}
