// SPDX-License-Identifier: Apache-2.0
/**
 * The roles of the app's worker script (diagram.worker.ts): the page starts it once per role, and names each
 * instance after its role (`new Worker(url, { name })`), which the script reads as `self.name`.
 */
export const WORKER_ROLES = {
  /** Ingest, graph build and Scene build, the demo organisations drawn too (dataHandler.ts, demo.ts). */
  data: 'gcportrait-data',
  /** The layout (`@gcportrait/layout`'s worker handler). */
  layout: 'gcportrait-layout',
  /** Snapshot file import and the check before an export (src/snapshots/worker/). */
  snapshots: 'gcportrait-snapshots',
  /** Live pulls and export reads streamed from the backend into snapshots (src/import/worker/). */
  imports: 'gcportrait-imports',
  /** "Try the demo": one demo organisation prepared for storage, then the worker ends (demoRole.ts). */
  demo: 'gcportrait-demo',
} as const;

export type WorkerRole = keyof typeof WORKER_ROLES;
