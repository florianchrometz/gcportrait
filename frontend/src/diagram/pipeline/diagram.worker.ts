// SPDX-License-Identifier: Apache-2.0
/**
 * The diagram's worker script (ingest, graph build and layout off the UI thread; AGENTS.md, Architecture and code).
 * The page starts it twice, as two dedicated workers: the data worker (ingest, graph and Scene; dataRole.ts) and the
 * layout worker (layoutRole.ts), told apart by the name the page gives each instance (roles.ts); src/snapshots starts
 * a third instance for file import (snapshots/worker/role.ts; it loads no demo generator) and src/import a
 * fourth for live pulls and export reads (import/worker/role.ts); "Try the demo" starts a fifth for one job
 * (demoRole.ts), so preparing a demo organisation never holds back the data worker.
 * One script for all lets the build share the modules the roles have in common (the model and zod) instead of
 * bundling them twice; each instance loads only its own role's code, with a dynamic import.
 *
 * The listener is registered at once and messages wait for the role to load, so none is lost. If the role
 * cannot load (a chunk or a data table fails to download), the error is rethrown outside the promise, once at
 * start and once for every message after, so the page's `error` listener sees it and fails whatever is pending
 * (workers.ts), including a request sent after the failure.
 */
import { WORKER_ROLES } from './roles';
import { encodeLarge } from './transfer';

interface WorkerScope {
  readonly name: string;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

const scope = self as unknown as WorkerScope;
// The data and layout roles post a large Scene answer or Layout as transferred JSON bytes (transfer.ts).
const transfers = scope.name === WORKER_ROLES.data || scope.name === WORKER_ROLES.layout;
const post = (message: unknown): void => {
  const encoded = transfers ? encodeLarge(message) : null;
  if (encoded === null) scope.postMessage(message);
  else scope.postMessage(encoded, [encoded.bytes]);
};
/** Reports an error as an uncaught one, which the page receives as the worker's `error` event. */
const report = (error: unknown): void => {
  setTimeout(() => {
    throw error instanceof Error ? error : new Error(String(error));
  });
};
const role =
  scope.name === WORKER_ROLES.layout
    ? import('./layoutRole')
    : scope.name === WORKER_ROLES.snapshots
      ? import('../../snapshots/worker/role')
      : scope.name === WORKER_ROLES.imports
        ? import('../../import/worker/role')
        : scope.name === WORKER_ROLES.demo
          ? import('./demoRole')
          : import('./dataRole');
const handler = role.then((module) => module.startRole(post));
handler.catch(report);
scope.addEventListener('message', (event) => {
  handler.then((handle) => {
    handle(event.data);
  }, report);
});
