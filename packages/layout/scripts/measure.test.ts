// SPDX-License-Identifier: MIT
/**
 * The measure command (scripts/measure.ts) on S: the non-affiliation banner, the routing figures per view,
 * the packing figures per rule with --packing, JSON output, its help and its argument errors. The figures
 * themselves are the goldens' (test/golden.test.ts); this file checks the output's columns and labels.
 */
import { describe, expect, it } from 'vitest';
import { capture } from './lib/capture.js';
import { parseView, run } from './measure.js';

describe('measure', () => {
  it('prints the routing figures of a view', async () => {
    const { code, text } = await capture(run, ['--view', 'S:overview:auto', '--runs', '1']);
    expect(code).toBe(0);
    expect(text.split('\n')[0]).toBe('gcportrait layout measure');
    expect(text).not.toMatch(/affiliated/i);
    expect(text).toContain(
      'length\tbends\thugging\tdetours\tworstDetour\tcrossings\tmargin\tmarginEdges\tovershoots\tworstOvershoot',
    );
    expect(text).toContain('holders\twork\tmode');
    expect(text).toMatch(/^S overview auto\t\d+\t/m);
  });

  it('prints the packing rules side by side with --packing, and JSON with --json', async () => {
    const { code, text } = await capture(run, ['--view', 'S:networking', '--packing', '--json']);
    expect(code).toBe(0);
    const [row] = JSON.parse(text) as Record<string, string>[];
    expect(Object.keys(row ?? {})).toEqual(['view', 'order', 'height', 'chosen']);
    expect(row?.chosen).toMatch(
      /^\d+\.\d\d M px², fill \d+\.\d %, deviation \d+\.\d %, within 20 % \d+\/\d+$/,
    );
  });

  it('prints its usage with --help and refuses bad arguments', async () => {
    const help = await capture(run, ['--help']);
    expect(help.code).toBe(0);
    expect(help.text).toContain('Usage:');
    expect(help.text).not.toMatch(/affiliated/i);
    for (const argv of [['--view', 'Q:overview'], ['--runs', '0'], ['--nope']]) {
      expect((await capture(run, argv)).code).toBe(2);
    }
    expect(parseView('L:overview:projects')).toEqual({ fixture: 'L', lens: 'overview', detail: 'projects' });
  });
});
