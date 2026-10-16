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
 * The worker is warmed up with a small job first (module loading through tsx is not ingest work). A
 * wall-clock budget is only meaningful on a machine that is not busy with other work, so the strict 1.5 s
 * assertion runs when GCPORTRAIT_INGEST_BUDGET=strict (`pnpm --filter @gcportrait/ingest test:budget`, which
 * runs this file alone). Inside the shared, parallel test run the same measurement asserts a regression
 * ceiling of 2 × the budget, as every budget does there, and prints the figures (`--silent=false`). Both
 * measure by the rule of `@gcportrait/model/testing` that every package timing its work applies: a run over
 * the limit is measured again after a pause, at most `BATCHES` runs and only while another fits in the test's
 * timeout, and the best run counts (`measureBatches`); under a local `pnpm test`, never on CI (where the
 * ceiling is the check that blocks) and never strictly, a best run still over the ceiling while the machine's
 * load average is above 1.5 per core is skipped with the load and the figures as its reason
 * (`skipIfOverloaded`).
 */
import { ProjectIndexSchema, SnapshotSchema } from '@gcportrait/model';
import { BATCHES, measureBatches, skipIfOverloaded } from '@gcportrait/model/testing';
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
/** One run per batch: a run takes about a second on a quiet machine. */
const PLAN = { batches: BATCHES, runs: 1, warmUp: 0 };
const STRICT = process.env['GCPORTRAIT_INGEST_BUDGET'] === 'strict';
/** What the best run must stay under: the budget itself when strict, else a regression ceiling. */
const LIMIT_MS = STRICT ? BUDGET_MS : 2 * BUDGET_MS;

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
    `parses it in under ${String(LIMIT_MS)} ms (${STRICT ? 'strict budget' : '2 × budget'})`,
    { timeout: 120_000 },
    async ({ skip, task }) => {
      let jobs = 0;
      const {
        best: { ms: best, result },
        medians,
        outOfTime,
      } = await measureBatches(
        async (runs) => {
          const timings: number[] = [];
          let last: IngestResult | undefined;
          for (let run = 0; run < runs; run += 1) {
            jobs += 1;
            const started = performance.now();
            last = await worker.run(`run-${String(jobs)}`, blob);
            timings.push(performance.now() - started);
          }
          if (last === undefined) throw new Error('no result');
          return { ms: Math.min(...timings), result: last };
        },
        (figures) => figures.ms,
        { plan: PLAN, limit: LIMIT_MS, timeoutMs: task.timeout, laterWarmUp: 0 },
      );
      console.log(
        [
          `ingest budget: ${String(ASSETS)} assets, ${(size / 2 ** 20).toFixed(1)} MiB (${(size / ASSETS).toFixed(0)} B per line)`,
          `worker start-up incl. tsx and a 20-line warm-up job: ${bootMs.toFixed(0)} ms`,
          `runs: ${medians.map((ms) => `${ms.toFixed(0)} ms`).join(', ')}; best ${best.toFixed(0)} ms (budget ${String(BUDGET_MS)} ms; asserted < ${String(LIMIT_MS)} ms, ${STRICT ? 'strict' : 'regression ceiling, set GCPORTRAIT_INGEST_BUDGET=strict for the budget'})` +
            (outOfTime ? ' · no further run fits in the timeout' : ''),
          `throughput (best run): ${(size / 2 ** 20 / (best / 1000)).toFixed(0)} MiB/s`,
        ].join('\n'),
      );

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
      skipIfOverloaded({
        value: best,
        limit: LIMIT_MS,
        strict: STRICT,
        what: `ingest of ${String(ASSETS)} assets over its ${String(LIMIT_MS)} ms ceiling`,
        figures: `best run ${best.toFixed(0)} ms of ${medians.map((ms) => ms.toFixed(0)).join(', ')} ms`,
        skip,
      });
      expect(best).toBeLessThan(LIMIT_MS);
    },
  );
});
