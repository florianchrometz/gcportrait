// SPDX-License-Identifier: Apache-2.0
/**
 * The render worker's entry: one render job (job.ts) on this thread's messages. The bundle writes it as
 * `dist/render-worker.mjs`; `workerData.assetDir` names the rasteriser's asset directory next to it, or is
 * null from source, where the installed packages provide the assets.
 */
import { parentPort, workerData } from 'node:worker_threads';

import { readAssetDir } from '@gcportrait/render';

import { createRenderJob } from './job.js';
import type { JobInput } from './protocol.js';

const port = parentPort;
if (port === null) throw new Error('The render worker runs in a worker thread only.');

const data: unknown = workerData;
const assetDir =
  typeof data === 'object' && data !== null && typeof (data as { assetDir?: unknown }).assetDir === 'string'
    ? (data as { assetDir: string }).assetDir
    : null;

const handle = createRenderJob(
  (message, transfer) => {
    port.postMessage(message, transfer === undefined ? [] : [...transfer]);
  },
  assetDir === null ? {} : { assets: readAssetDir(assetDir) },
);
port.on('message', (message: JobInput) => {
  handle(message);
});
