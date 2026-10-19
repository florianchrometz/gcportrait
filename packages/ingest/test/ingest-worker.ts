// SPDX-License-Identifier: Apache-2.0
/**
 * The ingest worker of the budget test: a `worker_threads` worker that reads each input it is posted with
 * `ingest()` and posts the result back, as the app's snapshot worker reads a dropped export file. Started
 * through tsx, so it runs the TypeScript sources directly. The clock and the entropy are this worker's, as they
 * are the app worker's: the package reads neither itself.
 */
import { parentPort } from 'node:worker_threads';
import { ingest, type IngestResult, type IngestSettings } from '../src/index.js';

/** Test → worker: one input to ingest. */
export interface IngestJob {
  readonly job: string;
  readonly input: Blob | string;
  readonly settings: IngestSettings;
}

/** Worker → test: the job's result, or the message of what stopped it. */
export type IngestReply =
  { readonly job: string; readonly result: IngestResult } | { readonly job: string; readonly error: string };

const port = parentPort;
if (port === null) throw new Error('ingest-worker.ts must run in a worker thread.');
port.on('message', ({ job, input, settings }: IngestJob) => {
  const reply = (message: IngestReply): void => {
    port.postMessage(message);
  };
  ingest(input, { ...settings, clock: () => Date.now(), entropy: Math.random }).then(
    (result) => {
      reply({ job, result });
    },
    (error: unknown) => {
      reply({ job, error: error instanceof Error ? error.message : String(error) });
    },
  );
});
