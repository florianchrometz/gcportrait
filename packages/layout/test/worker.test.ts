// SPDX-License-Identifier: MIT
/**
 * The layout through a real worker: a Node `worker_threads` worker running the package's handler
 * (scripts/lib/layout-worker.ts, mounted as the app's Web Worker mounts it) and the page-side client.
 *
 * - **Budgets** (skill gcp-diagram-layout §7): S < 10 ms, M < 60 ms, L < 400 ms, XL collapsed < 2 s, as the
 *   median round trip of 10 requests (after 3 warm-up requests) from `client.layout()` to the resolved promise:
 *   posting the Scene, the memo key, the layout in steps, its progress messages and the Layout's way back. The
 *   worker keeps no memo here, so every request lays out. XL is the demo organisation of about 51 000 assets
 *   at detail `folders` (collapsed, as `auto` opens it). Under `pnpm test` the limit is 2 × the budget; under
 *   `test:budget` (GCPORTRAIT_LAYOUT_BUDGET=strict) the budget itself (scripts/lib/bench.ts). Measurement and
 *   overload handling use `measureBatches`, `measureRuns` and `skipIfOverloaded` from
 *   `@gcportrait/model/testing` (packages/model/README.md, "Testing export"). Under coverage each case is
 *   laid out once and no time limit is checked (`budgetPlan`).
 * - **Memoisation**: a repeated request is answered from the worker's memo in under 1 ms (in-process: the
 *   handler and the client on one thread, so the figure is the protocol's own) with a byte-identical Layout;
 *   through the real worker the round trip of a hit is printed.
 * - **Cancellation**: a superseded L layout never resolves and the worker posts nothing more for it; the next
 *   request is answered long before the superseded layout would have finished.
 * - **Memory**: the worker's heap after a full collection, before and after 100 XL layouts (25 under
 *   `pnpm test`), each a memo miss: the worker must not accumulate (growth under 16 MiB).
 */
import { performance } from 'node:perf_hooks';
import { cutNote, measureBatches, skipIfOverloaded } from '@gcportrait/model/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLayoutClient, createLayoutWorkerHandler, type LayoutResult } from '../src/index.js';
import {
  BENCH_CASES,
  BUDGET_MS,
  MEMORY_GROWTH_LIMIT_MIB,
  budgetPlan,
  instrumented,
  limitOf,
  measureCancellation,
  measureInWorker,
  measureMemo,
  measureMemory,
  median,
  mib,
  ms,
  strictBudget,
  type BenchCase,
} from '../scripts/lib/bench.js';
import { startLayoutWorker, type NodeLayoutWorker } from '../scripts/lib/node-worker.js';
import { demoScene } from '../scripts/lib/scenes.js';

const STRICT = strictBudget();
const INSTRUMENTED = instrumented();
const PLAN = budgetPlan();
const MEMORY_LAYOUTS = STRICT ? 100 : 25;

let measuring: NodeLayoutWorker;
let memoised: NodeLayoutWorker;

beforeAll(async () => {
  measuring = startLayoutWorker({ memoCapacity: 0 });
  memoised = startLayoutWorker();
  // Module loading through tsx is not layout work, nor is building the demo Scenes (XL takes seconds).
  for (const { fixture, lens, detail } of BENCH_CASES) demoScene(fixture, lens, detail);
  await measuring.client.layout(demoScene('S', 'overview'));
}, 120_000);

afterAll(async () => {
  await measuring.terminate();
  await memoised.terminate();
});

describe('budgets through a worker', () => {
  it.for(BENCH_CASES)(
    'demo $fixture, lens $lens, detail $detail',
    { timeout: 120_000 },
    async ({ fixture, lens, detail }: BenchCase, { skip, task }) => {
      const limit = limitOf(fixture, STRICT);
      const scene = demoScene(fixture, lens, detail);
      const { best, medians, outOfTime } = await measureBatches(
        (runs, warmUp, deadline) => measureInWorker(measuring, scene, runs, warmUp, deadline),
        (figures) => figures.roundTrip,
        { plan: PLAN, limit, timeoutMs: task.timeout, laterWarmUp: 1 },
      );
      const short = cutNote({ cut: best.cut, made: best.runs.length, planned: PLAN.runs });
      console.log(
        `worker ${fixture} ${lens} ${detail}: ${String(best.rects)} rects, ${String(best.edges)} edges (${best.mode}, ${String(best.passes)} pass(es)); ` +
          `median round trip ${ms(best.roundTrip)}, layout in the worker ${ms(best.layout)} · budget ${String(BUDGET_MS[fixture])} ms, asserted < ${String(limit)} ms (${STRICT ? 'strict' : '2 × budget'})` +
          (medians.length > 1 ? ` · batch medians ${medians.map((m) => ms(m)).join(', ')}` : '') +
          (outOfTime ? ' · no further batch fits in the timeout' : '') +
          short,
      );
      if (INSTRUMENTED) return;
      const figures = `median round trip ${ms(best.roundTrip)}${short}`;
      skipIfOverloaded({
        value: best.roundTrip,
        limit,
        cut: best.cut,
        strict: STRICT,
        what: `worker ${fixture} ${lens} ${detail} over its ${String(limit)} ms ceiling`,
        figures,
        skip,
      });
      expect(best.cut, `no whole batch within the test's timeout (${figures})`).toBe(false);
      expect(best.roundTrip).toBeLessThan(limit);
    },
  );

  it('stops a batch at its deadline after the first layout, and says it was cut short', async () => {
    const scene = demoScene('S', 'overview');
    const whole = await measureInWorker(measuring, scene, 3, 1, performance.now() + 60_000);
    expect(whole.cut).toBe(false);
    expect(whole.runs).toHaveLength(3);
    // A deadline already past: the first layout (a warm-up) runs, and no other; its round trip is the figure.
    const cut = await measureInWorker(measuring, scene, 3, 1, performance.now());
    expect(cut.cut).toBe(true);
    expect(cut.runs).toEqual([]);
    expect(cut.roundTrip).toBeGreaterThan(0);
  });
});

describe('memoisation', () => {
  // The views the app opens (detail `auto`) must hit in under 1 ms; XL's Scene is 15 times M's, and hashing it
  // alone takes about 0.7 ms, so it gets a sanity ceiling instead.
  const MEMO_CASES = [
    { name: 'S overview auto', scene: () => demoScene('S', 'overview'), limit: 1 },
    { name: 'M overview auto', scene: () => demoScene('M', 'overview'), limit: 1 },
    { name: 'L overview auto', scene: () => demoScene('L', 'overview'), limit: 1 },
    { name: 'XL overview folders', scene: () => demoScene('XL', 'overview', 'folders'), limit: 10 },
  ];
  it.each(MEMO_CASES)(
    'answers a repeated $name request from the memo, byte-identical (handler and client in-process)',
    async ({ name, scene: build, limit }) => {
      const scene = build();
      const handle = createLayoutWorkerHandler((message) => {
        client.receive(message);
      });
      const client = createLayoutClient((request) => {
        handle(request);
      });
      const first = await client.layout(scene);
      expect(first.cached).toBe(false);
      const expected = JSON.stringify(first.layout);
      const times: number[] = [];
      let last: LayoutResult | undefined;
      for (let i = 0; i < 21; i += 1) {
        // A fresh copy each time, as a structured clone would deliver it: the key is computed again.
        const copy = structuredClone(scene);
        const started = performance.now();
        last = await client.layout(copy);
        times.push(performance.now() - started);
        expect(last.cached).toBe(true);
        expect(JSON.stringify(last.layout)).toBe(expected);
      }
      console.log(
        `memo hit in-process, ${name} (${String(scene.metadata.rectCount)} rects): median ${ms(median(times))}, fastest ${ms(Math.min(...times))}; asserted < ${String(limit)} ms`,
      );
      if (!INSTRUMENTED) expect(median(times)).toBeLessThan(limit);
    },
  );

  it('answers a repeated request from the memo through the real worker, byte-identical', async () => {
    const figures = await measureMemo(memoised, demoScene('M', 'overview'));
    console.log(
      `memo hit through the worker (M overview auto): first ${ms(figures.miss)}, median hit round trip ${ms(figures.hit)} over ${String(figures.hits)}`,
    );
    expect(figures.identical).toBe(true);
  });
});

describe('cancellation through the worker', () => {
  it(
    'never resolves a superseded request; the next one is answered at once',
    { timeout: 60_000 },
    async () => {
      const long = demoScene('L', 'overview', 'all');
      const short = demoScene('S', 'overview');
      // How long the long layout takes when nothing cancels it.
      const started = performance.now();
      await measuring.client.layout(long);
      const full = performance.now() - started;
      const cancel = await measureCancellation(measuring, long, short);
      console.log(
        `cancellation: L overview all (${ms(full)} uncancelled) superseded after ${String(cancel.stepsBefore)} step(s); S overview auto answered in ${ms(cancel.latency)}`,
      );
      expect(cancel.superseded).toBe(true);
      expect(cancel.quiet).toBe(true);
      expect(cancel.latency).toBeLessThan(full / 2);
    },
  );
});

describe('memory', () => {
  it(`does not accumulate over ${String(MEMORY_LAYOUTS)} XL layouts`, { timeout: 300_000 }, async () => {
    const figures = await measureMemory(memoised, demoScene('XL', 'overview', 'folders'), MEMORY_LAYOUTS);
    const growth = figures.after - figures.before;
    console.log(
      `memory: worker heap ${mib(figures.before)} before, ${mib(figures.after)} after ${String(figures.layouts)} XL overview layouts (${growth >= 0 ? '+' : ''}${mib(growth)}); limit +${String(MEMORY_GROWTH_LIMIT_MIB)} MiB`,
    );
    expect(growth).toBeLessThan(MEMORY_GROWTH_LIMIT_MIB * 2 ** 20);
  });
});
