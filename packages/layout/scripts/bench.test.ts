// SPDX-License-Identifier: MIT
/**
 * The bench command (scripts/bench.ts) on a small run: the non-affiliation banner, the machine the figures come
 * from, one line per case with its budget, the memo line, the verdict; its help and its argument errors. The
 * full run (S, M, L, XL, the memory check) is `pnpm --filter @gcportrait/layout bench`; the budgets themselves
 * are asserted by test/performance.test.ts and test/worker.test.ts, which measure a case in batches within the
 * test's timeout and skip a missed 2 × ceiling on an overloaded machine but never on CI (the rule of
 * `@gcportrait/model/testing`, tested there: src/testing/budget.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { run } from './bench.js';
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
