// SPDX-License-Identifier: Apache-2.0
import { openDatabase, type GcportraitDB } from './db';

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
