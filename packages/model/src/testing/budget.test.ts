// SPDX-License-Identifier: MIT
/**
 * The tests' rule for a wall-clock limit (budget.ts): a case over its limit measured again in batches within
 * the test's timeout (`measureBatches`), and a limit still missed skipped on an overloaded machine but never
 * on CI and never in a strict run (`overloadReason`, `onCi`, `skipIfOverloaded`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  anotherBatchFits,
  BATCH_TIMEOUT_SHARE,
  measureBatches,
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
  function attempt(value: number, strict: boolean): { skipped: readonly string[]; lines: readonly string[] } {
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
});
