// SPDX-License-Identifier: MIT
/**
 * The ingest budget: a 50 000-asset NDJSON export is parsed inside a worker in under
 * 1.5 s. The worker is a real `worker_threads` worker running test/worker-entry.ts (the package's handler,
 * mounted as a Web Worker would mount it). The input is an `exportAssets` file (snake_case envelope keys)
 * in a Blob, read and posted in chunks by `postIngestJob` exactly as the app will post a dropped file; the
 * clock runs from the first posted message to the `done` reply arriving on this thread, so it includes
 * reading, transfer, parsing, normalisation, the project index and the structured clone of the 50 000-asset
 * result back to this thread.
 *
 * The worker is warmed up with a small job first (module loading through tsx is not ingest work), and the
 * measured job runs three times; the best run counts. A wall-clock budget is only meaningful on a machine
 * that is not busy with other work, so the strict 1.5 s assertion runs when GCPORTRAIT_INGEST_BUDGET=strict
 * (`pnpm --filter @gcportrait/ingest test:budget`, which runs this file alone). Inside the shared, parallel
 * test run the same measurement guards against gross regressions only (under 3× the budget) and prints the
 * figures (`--silent=false`).
 */
import { ProjectIndexSchema, SnapshotSchema } from '@gcportrait/model';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  postIngestJob,
  type IngestResult,
  type IngestSettings,
  type IngestWorkerRequest,
  type IngestWorkerResponse,
} from '../src/index.js';
import { syntheticExport } from './synthetic-org.js';

const ASSETS = 50_000;
const BUDGET_MS = 1_500;
const RUNS = 3;
const STRICT = process.env['GCPORTRAIT_INGEST_BUDGET'] === 'strict';
/** What the best run must stay under: the budget itself when strict, else a regression ceiling. */
const LIMIT_MS = STRICT ? BUDGET_MS : 3 * BUDGET_MS;

const settings: IngestSettings = {
  scope: { kind: 'organization', id: '30000000001', displayName: 'example.com' },
  source: { kind: 'export', detail: 'synthetic-50k.ndjson' },
};

/** A worker_threads worker running the ingest handler, with a promise per job. */
class IngestWorker {
  readonly #worker: Worker;
  readonly #pending = new Map<
    string,
    { resolve: (result: IngestResult) => void; reject: (error: Error) => void }
  >();

  constructor() {
    const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
    this.#worker = new Worker(new URL('./worker-entry.ts', import.meta.url), { execArgv: ['--import', tsx] });
    this.#worker.on('message', (message: IngestWorkerResponse) => {
      const pending = this.#pending.get(message.job);
      if (pending === undefined || message.type === 'progress') return;
      this.#pending.delete(message.job);
      if (message.type === 'done') pending.resolve(message.result);
      else pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
    });
    this.#worker.on('error', (error) => {
      for (const pending of this.#pending.values()) pending.reject(error);
      this.#pending.clear();
    });
  }

  async run(job: string, input: Blob | string): Promise<IngestResult> {
    const result = new Promise<IngestResult>((resolve, reject) => {
      this.#pending.set(job, { resolve, reject });
    });
    const post = (message: IngestWorkerRequest, transfer: ArrayBuffer[]) => {
      this.#worker.postMessage(message, transfer);
    };
    await postIngestJob(post, job, input, settings);
    return result;
  }

  async terminate(): Promise<void> {
    await this.#worker.terminate();
  }
}

describe(`a ${String(ASSETS)}-asset export in a worker`, () => {
  let worker: IngestWorker;
  let blob: Blob;
  let size = 0;
  let bootMs = 0;

  beforeAll(async () => {
    const text = syntheticExport(ASSETS);
    blob = new Blob([text]);
    size = blob.size;
    const started = performance.now();
    worker = new IngestWorker();
    await worker.run('warm-up', syntheticExport(20, 7));
    bootMs = performance.now() - started;
  }, 60_000);

  afterAll(async () => {
    await worker.terminate();
  });

  it(
    `parses it in under ${String(LIMIT_MS)} ms${STRICT ? ' (strict budget)' : ' (regression ceiling)'}`,
    { timeout: 120_000 },
    async () => {
      const timings: number[] = [];
      let result: IngestResult | undefined;
      for (let run = 1; run <= RUNS; run += 1) {
        const started = performance.now();
        result = await worker.run(`run-${String(run)}`, blob);
        timings.push(performance.now() - started);
      }
      const best = Math.min(...timings);
      console.log(
        [
          `ingest budget: ${String(ASSETS)} assets, ${(size / 2 ** 20).toFixed(1)} MiB (${(size / ASSETS).toFixed(0)} B per line)`,
          `worker start-up incl. tsx and a 20-line warm-up job: ${bootMs.toFixed(0)} ms`,
          `runs: ${timings.map((ms) => `${ms.toFixed(0)} ms`).join(', ')}; best ${best.toFixed(0)} ms (budget ${String(BUDGET_MS)} ms; asserted < ${String(LIMIT_MS)} ms, ${STRICT ? 'strict' : 'regression ceiling, set GCPORTRAIT_INGEST_BUDGET=strict for the budget'})`,
          `throughput (best run): ${(size / 2 ** 20 / (best / 1000)).toFixed(0)} MiB/s`,
        ].join('\n'),
      );

      if (result === undefined) throw new Error('no result');
      expect(result.snapshot.stats.count).toBe(ASSETS);
      expect(result.snapshot.stats.bytes).toBe(size);
      expect(result.report.malformed).toBe(0);
      expect(result.report.duplicates).toBe(0);
      expect(Object.keys(result.report.projects.idByNumber)).toHaveLength(50);
      expect(ProjectIndexSchema.safeParse(result.report.projects).success).toBe(true);
      expect(result.report.unresolvedProjects).toEqual({
        numbers: [],
        ids: [],
        referencedIds: ['demo-host-1', 'demo-images-1'],
        inferred: {},
      });
      expect(SnapshotSchema.safeParse(result.snapshot).success).toBe(true);
      expect(best).toBeLessThan(LIMIT_MS);
    },
  );
});
