// SPDX-License-Identifier: Apache-2.0
import { createDatabaseConnection, type DatabaseOpener } from './databaseConnection';
import { OPEN_TIMEOUT_MS, openDatabase, type GcportraitDB } from './db';

let timeoutMs = OPEN_TIMEOUT_MS;
const open: DatabaseOpener = (onClose) => openDatabase(timeoutMs, onClose);
let connection = createDatabaseConnection(open);

export function workerDatabase(): Promise<GcportraitDB | null> {
  return connection.database();
}

export function recoverWorkerDatabase(
  failedOpening: Promise<GcportraitDB | null> | undefined,
): Promise<GcportraitDB | null> {
  const current = connection.database();
  if (current !== failedOpening) return current;
  connection = createDatabaseConnection(open);
  return connection.database();
}

export function resetWorkerDatabase(nextTimeoutMs = OPEN_TIMEOUT_MS): void {
  timeoutMs = nextTimeoutMs;
  connection = createDatabaseConnection(open);
}
