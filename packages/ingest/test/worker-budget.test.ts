// SPDX-License-Identifier: Apache-2.0
/**
 * The ingest budget: the demo organisation XL (@gcportrait/demo-data, default seed, the demo's day), written as
 * an `exportAssets` file (snake_case envelope keys), is read inside a worker in under 1.5 s. The worker is a
 * real `worker_threads` worker running test/ingest-worker.ts, which reads the file it is posted with
 * `ingest()`, as the app's snapshot worker reads a dropped export file; the clock runs from posting the Blob
 * to the result arriving on this thread, so it includes reading, parsing, normalisation, the project index and
 * the structured clone of the result back to this thread.
 *
 * The worker is warmed up with a small job first, the file's first lines (module loading through tsx is not
 * ingest work). A wall-clock budget is only meaningful on a machine that is not busy with other work, so the
 * strict 1.5 s assertion runs when GCPORTRAIT_INGEST_BUDGET=strict
 * (`pnpm --filter @gcportrait/ingest test:budget`, which runs this file alone). Inside the shared, parallel
 * test run the same measurement asserts a regression ceiling of 2 × the budget, as every budget does there,
 * and prints the figures (`--silent=false`). Measurement and overload handling use `measureBatches`,
 * `measureRuns` and `skipIfOverloaded` from `@gcportrait/model/testing` (packages/model/README.md,
 * "Testing export"), with one run per batch.
 */
import {
  DEMO_ORGANIZATION_DOMAIN,
  DEMO_ORGANIZATION_IDS,
  generateOrganization,
  toCaiNdjson,
} from '@gcportrait/demo-data';
import { ProjectIndexSchema, SnapshotSchema } from '@gcportrait/model';
import { BATCHES, cutNote, measureBatches, measureRuns, skipIfOverloaded } from '@gcportrait/model/testing';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IngestResult, IngestSettings } from '../src/index.js';
import type { IngestJob, IngestReply } from './ingest-worker.js';

const SIZE = 'XL';
const BUDGET_MS = 1_500;
/** The warm-up job and the deadline test read the first lines of the same file. */
const SMALL_LINES = 100;
/** One run per batch: a run is a whole ingest of XL. */
const PLAN = { batches: BATCHES, runs: 1, warmUp: 0 };
const STRICT = process.env['GCPORTRAIT_INGEST_BUDGET'] === 'strict';
/** What the best run must stay under: the budget itself when strict, else a regression ceiling. */
const LIMIT_MS = STRICT ? BUDGET_MS : 2 * BUDGET_MS;

const settings: IngestSettings = {
  scope: { kind: 'organization', id: DEMO_ORGANIZATION_IDS[SIZE], displayName: DEMO_ORGANIZATION_DOMAIN },
  source: { kind: 'export', detail: `demo-${SIZE}.ndjson` },
};

/** The first `count` lines of an NDJSON text. */
function firstLines(text: string, count: number): string {
  let end = 0;
  for (let line = 0; line < count; line += 1) {
    const newline = text.indexOf('\n', end);
    if (newline === -1) return text;
    end = newline + 1;
  }
  return text.slice(0, end);
}

/** A worker_threads worker running test/ingest-worker.ts, with a promise per job. */
class IngestWorker {
  readonly #worker: Worker;
  readonly #pending = new Map<
    string,
    { resolve: (result: IngestResult) => void; reject: (error: Error) => void }
  >();

  constructor() {
    const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
    this.#worker = new Worker(new URL('./ingest-worker.ts', import.meta.url), {
      execArgv: ['--import', tsx],
    });
    this.#worker.on('message', (message: IngestReply) => {
      const pending = this.#pending.get(message.job);
      if (pending === undefined) return;
      this.#pending.delete(message.job);
      if ('result' in message) pending.resolve(message.result);
      else pending.reject(new Error(message.error));
    });
    this.#worker.on('error', (error) => {
      for (const pending of this.#pending.values()) pending.reject(error);
      this.#pending.clear();
    });
  }

  run(job: string, input: Blob | string): Promise<IngestResult> {
    const result = new Promise<IngestResult>((resolve, reject) => {
      this.#pending.set(job, { resolve, reject });
    });
    this.#worker.postMessage({ job, input, settings } satisfies IngestJob);
    return result;
  }

  async terminate(): Promise<void> {
    await this.#worker.terminate();
  }
}

/** What `measureIngest` measured. */
interface IngestFigures {
  /** The fastest counted run. */
  readonly ms: number;
  /** The last run's result. */
  readonly result: IngestResult;
  /** The timed runs made. */
  readonly runs: number;
  /**
   * The batch stopped at its deadline before every run was made (`measureRuns`): the figures are those of the
   * runs that were, or of the warm-up runs when none was.
   */
  readonly cut: boolean;
}

describe(`the demo organisation ${SIZE} as an export, in a worker`, () => {
  let worker: IngestWorker;
  let blob: Blob;
  let small = '';
  let size = 0;
  let assets = 0;
  let projects = 0;
  let bootMs = 0;
  let jobs = 0;

  /**
   * Ingests `input` `runs` times through the worker after `warmUp` runs; with a `deadline` (a
   * `performance.now()` time, as `measureBatches` hands it), no run starts after the first that would end
   * past it if it took as long as the longest so far (`measureRuns`).
   */
  async function measureIngest(
    input: Blob | string,
    runs: number,
    warmUp: number,
    deadline?: number,
  ): Promise<IngestFigures> {
    const made = await measureRuns(
      () => {
        jobs += 1;
        return worker.run(`run-${String(jobs)}`, input);
      },
      runs,
      warmUp,
      deadline,
    );
    return {
      ms: Math.min(...made.counted.map(({ ms }) => ms)),
      result: made.last,
      runs: made.runs.length,
      cut: made.cut,
    };
  }

  beforeAll(async () => {
    const organisation = generateOrganization({ size: SIZE });
    assets = organisation.assets.length;
    projects = organisation.assets.filter(
      (asset) => asset.assetType === 'cloudresourcemanager.googleapis.com/Project',
    ).length;
    const text = toCaiNdjson(organisation.assets, 'export');
    blob = new Blob([text]);
    size = blob.size;
    small = firstLines(text, SMALL_LINES);
    const started = performance.now();
    worker = new IngestWorker();
    await worker.run('warm-up', small);
    bootMs = performance.now() - started;
  }, 60_000);

  afterAll(async () => {
    await worker.terminate();
  });

  it(
    `parses it in under ${String(LIMIT_MS)} ms (${STRICT ? 'strict budget' : '2 × budget'})`,
    { timeout: 120_000 },
    async ({ skip, task }) => {
      const {
        best: { ms: best, result, runs, cut },
        medians,
        outOfTime,
      } = await measureBatches(
        (planned, warmUp, deadline) => measureIngest(blob, planned, warmUp, deadline),
        (figures) => figures.ms,
        { plan: PLAN, limit: LIMIT_MS, timeoutMs: task.timeout, laterWarmUp: 0 },
      );
      const short = cutNote({ cut, made: runs, planned: PLAN.runs });
      console.log(
        [
          `ingest budget: demo ${SIZE} as an export, ${String(assets)} assets, ${(size / 2 ** 20).toFixed(1)} MiB (${(size / assets).toFixed(0)} B per line)`,
          `worker start-up incl. tsx and a ${String(SMALL_LINES)}-line warm-up job: ${bootMs.toFixed(0)} ms`,
          `runs: ${medians.map((ms) => `${ms.toFixed(0)} ms`).join(', ')}; best ${best.toFixed(0)} ms (budget ${String(BUDGET_MS)} ms; asserted < ${String(LIMIT_MS)} ms, ${STRICT ? 'strict' : 'regression ceiling, set GCPORTRAIT_INGEST_BUDGET=strict for the budget'})` +
            (outOfTime ? ' · no further run fits in the timeout' : '') +
            short,
          `throughput (best run): ${(size / 2 ** 20 / (best / 1000)).toFixed(0)} MiB/s`,
        ].join('\n'),
      );

      expect(result.snapshot.stats.count).toBe(assets);
      expect(result.snapshot.stats.bytes).toBe(size);
      expect(result.report.malformed).toBe(0);
      expect(result.report.duplicates).toBe(0);
      expect(Object.keys(result.report.projects.idByNumber)).toHaveLength(projects);
      expect(ProjectIndexSchema.safeParse(result.report.projects).success).toBe(true);
      // Every project the assets live in is named; only projects outside the organisation (public images,
      // service producers' tenant projects) are referenced without a number.
      expect(result.report.unresolvedProjects).toMatchObject({ numbers: [], ids: [], inferred: {} });
      expect(SnapshotSchema.safeParse(result.snapshot).success).toBe(true);
      const figures = `best run ${best.toFixed(0)} ms of ${medians.map((ms) => ms.toFixed(0)).join(', ')} ms${short}`;
      skipIfOverloaded({
        value: best,
        limit: LIMIT_MS,
        cut,
        strict: STRICT,
        what: `ingest of demo ${SIZE} (${String(assets)} assets) over its ${String(LIMIT_MS)} ms ceiling`,
        figures,
        skip,
      });
      expect(cut, `no whole batch within the test's timeout (${figures})`).toBe(false);
      expect(best).toBeLessThan(LIMIT_MS);
    },
  );

  it('stops a batch at its deadline after the first run, and says it was cut short', async () => {
    const whole = await measureIngest(small, 2, 1, performance.now() + 60_000);
    expect(whole).toMatchObject({ runs: 2, cut: false });
    // A deadline already past: the first run (a warm-up) is made, and no other; its time is the figure.
    const cut = await measureIngest(small, 2, 1, performance.now());
    expect(cut).toMatchObject({ runs: 0, cut: true });
    expect(cut.ms).toBeGreaterThan(0);
    expect(cut.result.snapshot.stats.count).toBe(whole.result.snapshot.stats.count);
  });
});
