// SPDX-License-Identifier: MIT
/**
 * The tests' rule for a wall-clock limit (budget.ts): a case over its limit measured again in batches within
 * the test's timeout (`measureBatches`), each batch stopped at the deadline (`measureRuns`), and a limit still
 * missed, or a batch cut short, skipped on an overloaded machine but never on CI and never in a strict run
 * (`overloadReason`, `onCi`, `skipIfOverloaded`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  anotherBatchFits,
  BATCH_TIMEOUT_SHARE,
  cutNote,
  measureBatches,
  measureRuns,
  OVERLOAD_PER_CORE,
  onCi,
  overloadReason,
  PAUSE_MS,
  skipIfOverloaded,
} from './budget.js';

/** The Node process the tests run in, through `globalThis` (this package has no Node types). */
interface ProcessView {
  readonly stderr: { write(text: string): boolean };
  getBuiltinModule(id: string): unknown;
}
const nodeProcess = (globalThis as unknown as { process: ProcessView }).process;

/** Lets `node:os` report `load` on `cores` cores while `run` runs. */
function onMachine<T>(load: number, cores: number, run: () => T): T {
  const spy = vi
    .spyOn(nodeProcess, 'getBuiltinModule')
    .mockImplementation((id: string) =>
      id === 'node:os'
        ? { loadavg: () => [load, load, load], cpus: () => Array.from({ length: cores }, () => ({})) }
        : undefined,
    );
  try {
    return run();
  } finally {
    spy.mockRestore();
  }
}

describe('measureBatches (a budget case measured again while over its limit)', () => {
  const PLAN = { batches: 5, runs: 2, warmUp: 1 };
  /** A measurement whose medians are `values`, one batch at a time; it records each call's arguments. */
  function batches(values: readonly number[]) {
    const calls: { runs: number; warmUp: number }[] = [];
    const measure = (runs: number, warmUp: number): number => {
      calls.push({ runs, warmUp });
      return values[calls.length - 1] ?? Number.NaN;
    };
    return { calls, measure };
  }
  const options = { plan: PLAN, limit: 10, timeoutMs: 60_000, laterWarmUp: 0 };

  it('stops at the first batch under the limit and keeps the best median', async () => {
    const { calls, measure } = batches([30, 12, 9, 1]);
    const result = await measureBatches(measure, (median) => median, options);
    expect(result).toEqual({ best: 9, medians: [30, 12, 9], outOfTime: false });
    expect(calls).toEqual([
      { runs: 2, warmUp: 1 },
      { runs: 2, warmUp: 0 },
      { runs: 2, warmUp: 0 },
    ]);
  });

  it('measures at most the budget plan’s batches and keeps the lowest median of all', async () => {
    const { measure } = batches([30, 12, 40, 11, 50, 1]);
    const result = await measureBatches(measure, (median) => median, { ...options, laterWarmUp: 1 });
    expect(result).toEqual({ best: 11, medians: [30, 12, 40, 11, 50], outOfTime: false });
  });

  it('starts no batch that would not fit in the test’s timeout', async () => {
    const { calls, measure } = batches([30, 1]);
    const result = await measureBatches(measure, (median) => median, { ...options, timeoutMs: 0 });
    expect(result).toEqual({ best: 30, medians: [30], outOfTime: true });
    expect(calls).toHaveLength(1);
  });

  it('hands every batch the deadline at 95 % of the test’s timeout', async () => {
    const clock = (globalThis as unknown as { performance: { now(): number } }).performance;
    const deadlines: number[] = [];
    const before = clock.now();
    await measureBatches(
      (_runs, _warmUp, deadline) => {
        deadlines.push(deadline);
        return deadlines.length === 1 ? 30 : 1;
      },
      (median) => median,
      options,
    );
    const after = clock.now();
    const share = BATCH_TIMEOUT_SHARE * options.timeoutMs;
    expect(deadlines).toHaveLength(2);
    expect(deadlines[1]).toBe(deadlines[0]);
    expect(deadlines[0]).toBeGreaterThanOrEqual(before + share);
    expect(deadlines[0]).toBeLessThanOrEqual(after + share);
  });

  it('awaits a measurement that returns a promise', async () => {
    const result = await measureBatches(
      (runs) => Promise.resolve({ runs, ms: 3 }),
      (figures) => figures.ms,
      options,
    );
    expect(result).toEqual({ best: { runs: 2, ms: 3 }, medians: [3], outOfTime: false });
  });

  it('refuses a plan without a batch', async () => {
    await expect(
      measureBatches(
        () => 1,
        (median) => median,
        { ...options, plan: { ...PLAN, batches: 0 } },
      ),
    ).rejects.toThrow('at least one batch');
  });

  it.each([
    { name: 'fits with time to spare', elapsed: 20_000, batch: 10_000, timeout: 60_000, fits: true },
    {
      name: 'does not fit past 95 % of the timeout',
      elapsed: 40_000,
      batch: 17_000,
      timeout: 60_000,
      fits: false,
    },
    {
      name: 'counts the pause before the batch',
      elapsed: BATCH_TIMEOUT_SHARE * 60_000 - PAUSE_MS / 2,
      batch: 0,
      timeout: 60_000,
      fits: false,
    },
  ])('anotherBatchFits $name', ({ elapsed, batch, timeout, fits }) => {
    expect(anotherBatchFits(elapsed, batch, timeout)).toBe(fits);
  });
});

describe('measureRuns (one batch, stopped at its deadline)', () => {
  const clock = (globalThis as unknown as { performance: { now(): number } }).performance;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * A clock that stands at `start` and moves only when a run advances it, for runs that return no promise
   * (`measureRuns` then reads it before it returns, and the clock is restored before the result is awaited).
   */
  function fakeClock(start = 0) {
    let now = start;
    const spy = vi.spyOn(clock, 'now').mockImplementation(() => now);
    return {
      advance: (ms: number) => {
        now += ms;
      },
      restore: () => {
        spy.mockRestore();
      },
    };
  }

  /** A run that takes `durations[i]` ms on the fake clock and returns how many runs were made. */
  function runOf(time: ReturnType<typeof fakeClock>, durations: readonly number[]): () => number {
    let made = 0;
    return () => {
      time.advance(durations[made] ?? 0);
      made += 1;
      return made;
    };
  }

  it('makes the warm-up runs, then the timed ones, each timed on the wall clock', async () => {
    const time = fakeClock();
    const pending = measureRuns(runOf(time, [5, 7, 9, 11]), 3, 1);
    time.restore();
    const timed = [
      { ms: 7, value: 2 },
      { ms: 9, value: 3 },
      { ms: 11, value: 4 },
    ];
    expect(await pending).toEqual({
      warmUp: [{ ms: 5, value: 1 }],
      runs: timed,
      counted: timed,
      last: 4,
      cut: false,
    });
  });

  it('starts no run that would end past the deadline if it took as long as the longest so far', async () => {
    const time = fakeClock();
    // 0 → 10, then 10 + 10 ≤ 55: 10 → 40, then 40 + 30 > 55: stop.
    const pending = measureRuns(runOf(time, [10, 30, 10, 10]), 4, 0, 55);
    time.restore();
    const result = await pending;
    expect(result.runs).toEqual([
      { ms: 10, value: 1 },
      { ms: 30, value: 2 },
    ]);
    expect(result.cut).toBe(true);
    expect(result.last).toBe(2);
  });

  it('always makes the first run, and counts the warm-up when the deadline leaves no timed run', async () => {
    const time = fakeClock(100);
    const pending = measureRuns(runOf(time, [4, 4, 4, 4, 4]), 3, 2, 0);
    time.restore();
    expect(await pending).toEqual({
      warmUp: [{ ms: 4, value: 1 }],
      runs: [],
      counted: [{ ms: 4, value: 1 }],
      last: 1,
      cut: true,
    });
  });

  it('makes a run that ends exactly at the deadline', async () => {
    const time = fakeClock();
    const pending = measureRuns(runOf(time, [10, 10]), 2, 0, 20);
    time.restore();
    expect((await pending).cut).toBe(false);
  });

  it('awaits a run that returns a promise', async () => {
    let made = 0;
    const result = await measureRuns(() => Promise.resolve((made += 1)), 2, 1);
    expect(result.warmUp.map(({ value }) => value)).toEqual([1]);
    expect(result.runs.map(({ value }) => value)).toEqual([2, 3]);
    expect(result.cut).toBe(false);
    for (const { ms } of [...result.warmUp, ...result.runs]) expect(ms).toBeGreaterThanOrEqual(0);
  });

  it('makes runs that return no promise back to back, without a yield between them', async () => {
    let yielded = false;
    void Promise.resolve().then(() => {
      yielded = true;
    });
    const seen: boolean[] = [];
    await measureRuns(
      () => {
        seen.push(yielded);
      },
      3,
      1,
    );
    expect(seen).toEqual([false, false, false, false]);
    expect(yielded).toBe(true);
  });

  it('refuses a batch without a run', async () => {
    await expect(measureRuns(() => 1, 0, 3)).rejects.toThrow('at least one run');
  });

  it('notes a batch cut short with the runs it made, and nothing for a whole one', () => {
    expect(cutNote({ cut: true, made: 4, planned: 10 })).toBe(
      '; the batch stopped at the deadline after 4 of 10 runs',
    );
    expect(cutNote({ cut: false, made: 10, planned: 10 })).toBe('');
  });
});

describe('overloadReason (a missed limit on a busy machine)', () => {
  it.each([
    {
      name: 'fails the strict run however busy',
      strict: true,
      ci: false,
      load: 34,
      cores: 8,
      skipped: false,
    },
    { name: 'fails on CI however busy', strict: false, ci: true, load: 34, cores: 8, skipped: false },
    {
      name: 'fails on a machine with cores to spare',
      strict: false,
      ci: false,
      load: 4,
      cores: 8,
      skipped: false,
    },
    {
      name: 'fails at the threshold itself',
      strict: false,
      ci: false,
      load: OVERLOAD_PER_CORE * 8,
      cores: 8,
      skipped: false,
    },
    {
      name: 'skips locally on a machine four times oversubscribed',
      strict: false,
      ci: false,
      load: 34,
      cores: 8,
      skipped: true,
    },
    {
      name: 'counts a machine that reports no cores as one core',
      strict: false,
      ci: false,
      load: 2,
      cores: 0,
      skipped: true,
    },
  ])('$name (load $load on $cores cores)', ({ strict, ci, load, cores, skipped }) => {
    const reason = overloadReason({ strict, ci, load, cores });
    expect(reason !== undefined).toBe(skipped);
    if (skipped) expect(reason).toContain(`load average ${load.toFixed(1)}`);
  });

  it('reads the running machine’s load and cores when none are given, and CI from the environment', () => {
    vi.stubEnv('CI', '');
    expect(onMachine(24, 8, () => overloadReason({ strict: false }))).toBe(
      'machine overloaded: load average 24.0 on 8 cores (3.0 per core, over 1.5); the limit would measure the machine, not the code',
    );
    expect(onMachine(8, 8, () => overloadReason({ strict: false }))).toBeUndefined();
    vi.stubEnv('CI', 'true');
    expect(onMachine(24, 8, () => overloadReason({ strict: false }))).toBeUndefined();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
});

describe('onCi (where a limit blocks a pull request)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it.each([
    { value: 'true', ci: true },
    { value: '1', ci: true },
    { value: '', ci: false },
    { value: 'false', ci: false },
    { value: '0', ci: false },
  ])('reads CI=$value as $ci', ({ value, ci }) => {
    vi.stubEnv('CI', value);
    expect(onCi()).toBe(ci);
  });

  it('reads an unset CI as not on CI', () => {
    vi.stubEnv('CI', undefined);
    expect(onCi()).toBe(false);
  });
});

describe('skipIfOverloaded (a test over its limit)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** What `skipIfOverloaded` does for `value` against a limit of 100 at load 24 on 8 cores. */
  function attempt(
    value: number,
    strict: boolean,
    cut?: boolean,
  ): { skipped: readonly string[]; lines: readonly string[] } {
    const skipped: string[] = [];
    const lines: string[] = [];
    vi.spyOn(nodeProcess.stderr, 'write').mockImplementation((text: string) => {
      lines.push(text);
      return true;
    });
    onMachine(24, 8, () => {
      skipIfOverloaded({
        value,
        limit: 100,
        ...(cut === undefined ? {} : { cut }),
        strict,
        what: 'case X over its 100 ms limit',
        figures: `best ${String(value)} ms`,
        skip: (note) => {
          skipped.push(note);
        },
      });
    });
    return { skipped, lines };
  }

  it('does nothing for a figure under its limit, however busy the machine', () => {
    vi.stubEnv('CI', '');
    expect(attempt(99, false)).toEqual({ skipped: [], lines: [] });
  });

  it('leaves a missed limit to fail on CI and in a strict run', () => {
    vi.stubEnv('CI', 'true');
    expect(attempt(150, false)).toEqual({ skipped: [], lines: [] });
    vi.stubEnv('CI', '');
    expect(attempt(150, true)).toEqual({ skipped: [], lines: [] });
  });

  it('skips a missed limit on an overloaded machine with the load and the figures, naming the case', () => {
    vi.stubEnv('CI', '');
    const { skipped, lines } = attempt(100, false);
    const note =
      'machine overloaded: load average 24.0 on 8 cores (3.0 per core, over 1.5); the limit would measure the machine, not the code (best 100 ms)';
    expect(skipped).toEqual([note]);
    expect(lines).toEqual([`skipped: case X over its 100 ms limit; ${note}\n`]);
  });

  it('counts a batch cut short at its deadline as a miss, whatever its figure', () => {
    vi.stubEnv('CI', '');
    expect(attempt(99, false, true).skipped).toHaveLength(1);
    expect(attempt(99, false, false)).toEqual({ skipped: [], lines: [] });
    vi.stubEnv('CI', 'true');
    expect(attempt(99, false, true)).toEqual({ skipped: [], lines: [] });
    vi.stubEnv('CI', '');
    expect(attempt(99, true, true)).toEqual({ skipped: [], lines: [] });
  });
});
