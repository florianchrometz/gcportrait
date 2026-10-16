// SPDX-License-Identifier: MIT
/**
 * The bench command (scripts/bench.ts) on a small run: the non-affiliation banner, the machine the figures come
 * from, one line per case with its budget, the memo line, the verdict; its help and its argument errors. The
 * full run (S, M, L, XL, the memory check) is `pnpm --filter @gcportrait/layout bench`; the budgets themselves
 * are asserted by test/performance.test.ts and test/worker.test.ts, which measure a case in batches within the
 * test's timeout (`measureBatches`, below) and skip a missed 2 × ceiling on an overloaded machine but never on
 * CI (`overloadReason` and `onCi`, below).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { run } from './bench.js';
import {
  anotherBatchFits,
  BATCH_TIMEOUT_SHARE,
  measureBatches,
  OVERLOAD_PER_CORE,
  onCi,
  overloadReason,
  PAUSE_MS,
} from './lib/bench.js';
import { capture } from './lib/capture.js';

describe('bench', () => {
  it('measures the S cases through a worker and prints the figures', { timeout: 120_000 }, async () => {
    const { code, text } = await capture(run, [
      '--fixtures',
      'S',
      '--runs',
      '2',
      '--warm-up',
      '1',
      '--memory',
      '0',
    ]);
    expect(text.split('\n')[0]).toBe('gcportrait layout bench');
    // The machine on the second line, so a figure quoted anywhere carries it (the budgets describe a quiet
    // M1-class machine; packages/layout/README.md, "Performance").
    expect(text.split('\n')[1]).toMatch(
      /^Node v\d+\.\d+\.\d+ · \w+ \w+ · .+ \(\d+ cores\) · load average \d+\.\d( \d+\.\d)*$/,
    );
    expect(text).not.toMatch(/affiliated/i);
    expect(text).toMatch(/^S overview auto +\d+ +\d+ +three-pass \(\d+\) .* 10 ms {2}(ok|OVER)$/m);
    expect(text.match(/^S (overview|networking|load-balancing) (auto|all) /gm)).toHaveLength(6);
    expect(text).toContain('memo (S overview auto): first request');
    expect(text).toContain('byte-identical');
    expect(text).not.toContain('memory (');
    // On a quiet machine S is well within 10 ms; the verdict line matches the exit code either way.
    expect(text).toMatch(code === 0 ? /all within budget\n$/ : /FAILED S /);
  });

  it('prints its usage with --help and refuses bad arguments', async () => {
    const help = await capture(run, ['--help']);
    expect(help.code).toBe(0);
    expect(help.text).toContain('Usage:');
    expect(help.text).not.toMatch(/affiliated/i);
    for (const argv of [
      ['--fixtures', 'Q'],
      ['--runs', '0'],
      ['--memory', '-1'],
      ['--warm-up', 'x'],
      ['--nope'],
    ]) {
      const bad = await capture(run, argv);
      expect(bad.code).toBe(2);
      expect(bad.text).toMatch(/^bench: /);
    }
  });
});

describe('measureBatches (a budget case measured again while over its limit)', () => {
  const PLAN = { batches: 5, runs: 2, warmUp: 1 };
  /** A measurement whose medians are `values`, one batch at a time; it records each call's runs and warm-up. */
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

describe('overloadReason (the budget tests on a busy machine)', () => {
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
});

describe('onCi (where the 2 × ceiling blocks a pull request)', () => {
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
