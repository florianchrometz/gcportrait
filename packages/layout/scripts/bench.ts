// SPDX-License-Identifier: MIT
/**
 * `pnpm --filter @gcportrait/layout bench`: the layout's performance harness. Lays out the demo
 * organisations S, M and L (overview, networking, load-balancing at `auto` and `all`) and XL (the same lenses
 * collapsed, at `folders`) through a real layout worker, 10 times each after 3 warm-up runs, and prints the
 * median round trip (page → worker → page) and the layout's own time in the worker against the budgets of
 * skill gcp-diagram-layout §7. Then a memo hit, a cancellation, and the worker's heap before and after 100 XL
 * layouts (the worker must not accumulate). Exits 1 when a median is over its budget or the heap grew by
 * `MEMORY_GROWTH_LIMIT_MIB` or more.
 *
 *   pnpm --filter @gcportrait/layout bench
 *   pnpm --filter @gcportrait/layout bench --fixtures S,M --runs 5 --memory 0
 *
 * Building the demo organisations' graphs and Scenes (XL takes a few seconds) happens before and is not timed.
 */
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { Scene } from '@gcportrait/model';
import {
  BENCH_CASES,
  BUDGET_MS,
  MEMORY_GROWTH_LIMIT_MIB,
  RUNS,
  WARM_UP,
  caseName,
  machine,
  measureCancellation,
  measureInWorker,
  measureMemo,
  measureMemory,
  mib,
  ms,
  type BenchCase,
} from './lib/bench.js';
import { startLayoutWorker } from './lib/node-worker.js';
import { demoScene, type Fixture } from './lib/scenes.js';

const USAGE = `Usage:
  pnpm --filter @gcportrait/layout bench [--fixtures S,M,L,XL] [--runs 10] [--warm-up 3] [--memory 100]

Lays out the demo organisations through a layout worker and prints the median times against the budgets
(S 10 ms, M 60 ms, L 400 ms, XL collapsed 2 s), a memo hit, a cancellation and the worker's heap before and
after --memory XL layouts (0 skips it). Exits 1 when a budget is missed or the heap grows.`;

const FIXTURES: readonly Fixture[] = ['S', 'M', 'L', 'XL'];

function count(value: string, name: string, min: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min)
    throw new Error(`--${name} must be an integer ≥ ${String(min)}`);
  return parsed;
}

function pad(text: string, width: number, right = false): string {
  return right ? text.padStart(width) : text.padEnd(width);
}

export async function run(
  argv: readonly string[],
  write: (text: string) => void = (text) => process.stdout.write(text),
): Promise<number> {
  let fixtures: Fixture[];
  let runs: number;
  let warmUp: number;
  let memory: number;
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: {
        fixtures: { type: 'string', default: FIXTURES.join(',') },
        runs: { type: 'string', default: String(RUNS) },
        'warm-up': { type: 'string', default: String(WARM_UP) },
        memory: { type: 'string', default: '100' },
        help: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    });
    if (values.help) {
      write(`${USAGE}\n`);
      return 0;
    }
    fixtures = values.fixtures.split(',').map((name) => {
      const fixture = FIXTURES.find((candidate) => candidate === name.trim());
      if (fixture === undefined) throw new Error(`unknown fixture ${name} (S, M, L or XL)`);
      return fixture;
    });
    runs = count(values.runs, 'runs', 1);
    warmUp = count(values['warm-up'], 'warm-up', 0);
    memory = count(values.memory, 'memory', 0);
  } catch (error) {
    write(`bench: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}\n`);
    return 2;
  }

  write(`gcportrait layout bench\n${machine()}\n`);
  const cases = BENCH_CASES.filter((entry) => fixtures.includes(entry.fixture));
  let started = performance.now();
  const scenes = new Map<BenchCase, Scene>(
    cases.map((entry) => [entry, demoScene(entry.fixture, entry.lens, entry.detail)]),
  );
  write(
    `scenes built in ${(performance.now() - started).toFixed(0)} ms (demo-data → graph → scene; not timed below)\n`,
  );
  started = performance.now();
  const measuring = startLayoutWorker({ memoCapacity: 0 });
  const memoised = startLayoutWorker();
  const failures: string[] = [];
  try {
    const first = scenes.values().next().value;
    if (first !== undefined) await measuring.client.layout(first);
    write(
      `worker started in ${(performance.now() - started).toFixed(0)} ms (tsx); memo off for the timings\n\n`,
    );
    write(
      `${pad('case', 32)}${pad('rects', 7, true)}${pad('edges', 7, true)}  ${pad('mode (passes)', 18)}${pad('round trip', 12, true)}${pad('in worker', 12, true)}${pad('budget', 10, true)}\n`,
    );
    for (const entry of cases) {
      const scene = scenes.get(entry) as Scene;
      const figures = await measureInWorker(measuring, scene, runs, warmUp);
      const budget = BUDGET_MS[entry.fixture];
      const over = figures.roundTrip >= budget;
      if (over) failures.push(`${caseName(entry)}: ${ms(figures.roundTrip)} ≥ ${String(budget)} ms`);
      write(
        `${pad(caseName(entry), 32)}${pad(String(figures.rects), 7, true)}${pad(String(figures.edges), 7, true)}  ${pad(`${figures.mode} (${String(figures.passes)})`, 18)}${pad(ms(figures.roundTrip), 12, true)}${pad(ms(figures.layout), 12, true)}${pad(`${String(budget)} ms`, 10, true)}  ${over ? 'OVER' : 'ok'}\n`,
      );
    }

    const memoCase = cases.find((entry) => entry.fixture === 'M' && entry.detail === 'auto') ?? cases[0];
    if (memoCase !== undefined) {
      const memo = await measureMemo(memoised, scenes.get(memoCase) as Scene);
      write(
        `\nmemo (${caseName(memoCase)}): first request ${ms(memo.miss)}, then ${String(memo.hits)} identical requests answered from the memo, median ${ms(memo.hit)} round trip; ${memo.identical ? 'byte-identical' : 'NOT byte-identical'}\n`,
      );
      if (!memo.identical) failures.push('memo hits were not byte-identical');
    }

    const long = cases.find(
      (entry) => entry.fixture === 'L' && entry.lens === 'overview' && entry.detail === 'all',
    );
    const short = cases.find((entry) => entry.fixture === 'S' && entry.detail === 'auto');
    if (long !== undefined && short !== undefined) {
      const cancel = await measureCancellation(
        measuring,
        scenes.get(long) as Scene,
        scenes.get(short) as Scene,
      );
      write(
        `cancellation: ${caseName(long)} superseded after ${String(cancel.stepsBefore)} step(s) by ${caseName(short)}, answered in ${ms(cancel.latency)}; the superseded request ${cancel.superseded && cancel.quiet ? 'was rejected and got no result' : 'MISBEHAVED'}\n`,
      );
      if (!cancel.superseded || !cancel.quiet)
        failures.push('a superseded request was not cancelled cleanly');
    }

    const xl = cases.find((entry) => entry.fixture === 'XL' && entry.lens === 'overview');
    if (xl !== undefined && memory > 0) {
      const figures = await measureMemory(memoised, scenes.get(xl) as Scene, memory);
      const growth = figures.after - figures.before;
      write(
        `memory (${String(figures.layouts)} × ${caseName(xl)}, each a memo miss; memo of 8 full before and after): worker heap ${mib(figures.before)} before, ${mib(figures.after)} after (${growth >= 0 ? '+' : ''}${mib(growth)})\n`,
      );
      if (growth >= MEMORY_GROWTH_LIMIT_MIB * 2 ** 20)
        failures.push(`the worker heap grew by ${mib(growth)}`);
    }
  } finally {
    await measuring.terminate();
    await memoised.terminate();
  }
  write(
    failures.length === 0
      ? '\nall within budget\n'
      : `\n${failures.map((line) => `FAILED ${line}`).join('\n')}\n`,
  );
  return failures.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2));
}
