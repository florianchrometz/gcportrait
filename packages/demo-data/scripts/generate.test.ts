// SPDX-License-Identifier: MIT
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertSyntheticOnly } from '@gcportrait/model/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DEMO_SIZES,
  DEMO_TODAY,
  checklistMarkdown,
  computeStats,
  generateOrganization,
  historyFor,
  realismChecklist,
  toCaiNdjson,
  type DemoOrganization,
} from '../src/index.js';
import { FIXTURES_DIR, parseCommand, render, renderFixtures } from './generate.js';

const PACKAGE_DIR = path.resolve(import.meta.dirname, '..');

function committed(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

interface Stats {
  readonly seed: number;
  readonly today: string;
  readonly sizes: Record<
    string,
    {
      readonly count: number;
      readonly byType: Record<string, number>;
      readonly history: { readonly adds: number; readonly removes: number; readonly changes: number };
    }
  >;
}

describe('committed fixtures', () => {
  let rendered: Map<string, string>;
  beforeAll(() => {
    rendered = renderFixtures();
  });

  it.each(['S.ndjson', 'M.ndjson', 'stats.json'])(
    '%s matches a fresh generation byte for byte (run `pnpm --filter @gcportrait/demo-data fixtures` after an intended change)',
    (name) => {
      const fresh = rendered.get(name);
      expect(fresh === committed(name), `${name} is stale`).toBe(true);
    },
  );

  it('pins golden statistics for all four sizes, L and XL included', () => {
    const stats = JSON.parse(committed('stats.json')) as Stats;
    expect(Object.keys(stats.sizes)).toEqual([...DEMO_SIZES]);
    expect(stats.sizes['S']?.count).toBeGreaterThanOrEqual(80);
    expect(stats.sizes['S']?.count).toBeLessThan(110);
    // M carries one of every catalog generator case, which is what lifts it above 800.
    expect(stats.sizes['M']?.count).toBeGreaterThan(800);
    expect(stats.sizes['M']?.count).toBeLessThan(1000);
    expect(stats.sizes['L']?.count).toBeGreaterThan(5000);
    expect(stats.sizes['L']?.count).toBeLessThan(7000);
    expect(stats.sizes['XL']?.count).toBeGreaterThan(45000);
    expect(stats.sizes['XL']?.count).toBeLessThan(55000);
    for (const size of DEMO_SIZES) {
      const entry = stats.sizes[size];
      expect(Object.values(entry?.byType ?? {}).reduce((a, b) => a + b, 0)).toBe(entry?.count);
    }
    // History grows with the size.
    const adds = DEMO_SIZES.map((size) => stats.sizes[size]?.history.adds ?? 0);
    expect([...adds].sort((a, b) => a - b)).toEqual(adds);
  });

  it.each(['S.ndjson', 'M.ndjson'])('%s contains no data that looks real', (name) => {
    expect(() => {
      assertSyntheticOnly(
        committed(name),
        { allowedIpv4Ranges: ['10.0.0.0/8', '172.16.0.0/12', '203.0.113.0/24', '169.254.0.0/16'] },
        name,
      );
    }).not.toThrow();
  });
});

describe('performance', () => {
  /**
   * A wall-clock budget fails when other processes take the machine's cores (XL has taken 6.6 s to generate and
   * 29.5 s to sweep at a load average of 30, against 1.6 s and 6.2 s on the rerun): a retry measures again.
   */
  const RETRY = { retry: 2 };
  // XL (≈50 000 assets) is generated once: the timing test generates it, and the sweep reuses that, or generates
  // it itself when it runs alone.
  let xl: DemoOrganization | undefined;

  it('generates XL, history included, in under five seconds', RETRY, () => {
    const start = performance.now();
    const org = generateOrganization({ size: 'XL' });
    const elapsed = performance.now() - start;
    xl = org;
    const stats = JSON.parse(committed('stats.json')) as Stats;
    expect(computeStats(org.assets).count).toBe(stats.sizes['XL']?.count);
    expect(elapsed).toBeLessThan(5000);
  });

  it('sweeps XL with the synthetic-only guard in linear time', RETRY, () => {
    xl ??= generateOrganization({ size: 'XL' });
    const text = toCaiNdjson(xl.assets);
    const start = performance.now();
    expect(() => {
      assertSyntheticOnly(text, {}, 'XL');
    }).not.toThrow();
    // The guard's e-mail masking used to copy the whole text per address (XL: minutes); now it is one pass.
    expect(performance.now() - start).toBeLessThan(20_000);
  });
});

describe('README', () => {
  const readme = readFileSync(path.join(PACKAGE_DIR, 'README.md'), 'utf8');

  it('lists the real counts of every size', () => {
    const stats = JSON.parse(committed('stats.json')) as Stats;
    for (const size of DEMO_SIZES) {
      const entry = stats.sizes[size];
      if (entry === undefined) throw new Error(`no stats for ${size}`);
      const row = `| ${size} | ${String(entry.count)} | ${String(Object.keys(entry.byType).length)} | ${String(entry.history.adds)} | ${String(entry.history.removes)} | ${String(entry.history.changes)} |`;
      expect(readme, `README row for ${size}`).toContain(row);
    }
  });

  it('shows the realism checklist of the generated M organisation', () => {
    const rows = checklistMarkdown(realismChecklist(generateOrganization({ size: 'M' }).assets));
    expect(readme).toContain(rows);
  });
});

describe('generate command', () => {
  const generate = { kind: 'generate', format: 'cai', seed: 1, today: DEMO_TODAY } as const;

  it.each([
    [['--size', 'L', '--out', 'x.ndjson'], { ...generate, size: 'L', out: 'x.ndjson' }],
    [
      ['--size', 'M', '--format', 'snapshot', '--tick', '3', '--seed', '9'],
      { ...generate, size: 'M', format: 'snapshot', tick: 3, seed: 9 },
    ],
    [['--size', 'S', '--tick', '2026-09-20'], { ...generate, size: 'S', tick: '2026-09-20' }],
    [['--fixtures'], { kind: 'fixtures' }],
    [['--help'], { kind: 'help' }],
  ])('reads %j', (argv, command) => {
    expect(parseCommand(argv)).toEqual(command);
  });

  it.each([
    [[], /--size/],
    [['--size', 'XXL'], /--size/],
    [['--size', 'S', '--format', 'csv'], /--format/],
    [['--size', 'S', '--seed', '-1'], /--seed/],
    [['--size', 'S', '--bogus'], /'--bogus'/],
  ])('refuses %j', (argv, message) => {
    expect(() => parseCommand(argv)).toThrow(message);
  });

  it('renders every format', () => {
    const history = historyFor('S');
    expect(render(history, 'cai', undefined)).toBe(committed('S.ndjson'));
    expect(render(history, 'cai-export', undefined).split('\n')[0]).toContain('"asset_type":');
    expect(JSON.parse(render(history, 'snapshot', 0))).toMatchObject({ readTime: '2026-09-04T00:00:00Z' });
    expect(JSON.parse(render(history, 'history', undefined))).toMatchObject({
      size: 'S',
      today: '2026-10-08',
    });
    expect(JSON.parse(render(history, 'stats', undefined))).toEqual(
      computeStats(generateOrganization({ size: 'S' }).assets),
    );
    expect(render(history, 'checklist', undefined)).toContain('| Shared VPC host projects | 1 |');
  });

  it('writes a file relative to the directory pnpm was started from', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'demo-data-'));
    try {
      const tsx = createRequire(import.meta.url).resolve('tsx/cli');
      execFileSync(process.execPath, [tsx, 'scripts/generate.ts', '--size', 'S', '--out', 'out/S.ndjson'], {
        cwd: PACKAGE_DIR,
        env: { ...process.env, INIT_CWD: dir },
        stdio: 'pipe',
      });
      expect(readFileSync(path.join(dir, 'out', 'S.ndjson'), 'utf8')).toBe(committed('S.ndjson'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
