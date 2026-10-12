// SPDX-License-Identifier: MIT
/**
 * `pnpm render` end to end: in process through `run` (every mode, exit codes, where output and the report go)
 * and once as the real command in two child processes, whose files must be byte-identical to each other and to
 * the in-process render (byte stability across runs and processes). The figures the output
 * names come from where they are made: asset counts from the demo data, the frame's size from the render golden
 * and the detail budget from the graph's budget at the app's smallest viewport.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { generateOrganization } from '@gcportrait/demo-data';
import { DEFAULT_VIEWPORT_BUDGET } from '@gcportrait/graph';
import { describe, expect, it } from 'vitest';

import {
  BANNER,
  CLI_VERSION,
  decodePng,
  DEFAULT_VIEWPORT,
  FIXTURES,
  REPO_ROOT,
  readDrawioFile,
  run,
  THEMES,
  type IndexEntry,
  type Io,
} from '../src/index.js';
import { tempDirs } from './helpers.js';

const PACKAGE_DIR = path.resolve(import.meta.dirname, '..');
const tempDir = tempDirs('gcportrait-render-cli-');
/** The render golden: demo S overview, light, at 2×, exactly as the first test below writes it. */
const GOLDEN = path.join(REPO_ROOT, 'e2e/baselines/render/S-overview-auto-light.png');
/** Its draw.io golden, written without a version in its `agent` (the command adds its own). */
const DRAWIO_GOLDEN = path.join(REPO_ROOT, 'e2e/baselines/render/S-overview-auto-light.drawio');

interface Captured {
  readonly code: number;
  readonly stdout: string;
  readonly stdoutBytes: Buffer;
  readonly stderr: string;
}

async function capture(argv: string[], cwd: string): Promise<Captured> {
  const out: Buffer[] = [];
  let stderr = '';
  const io: Io = {
    stdout: (chunk) => out.push(Buffer.from(chunk)),
    stderr: (text) => {
      stderr += text;
    },
    cwd,
  };
  const code = await run(argv, io);
  const stdoutBytes = Buffer.concat(out);
  return { code, stdout: stdoutBytes.toString('utf8'), stdoutBytes, stderr };
}

const baselineSvg = (name: string): string =>
  readFileSync(path.join(REPO_ROOT, 'e2e/baselines/diagram', `${name}.svg`), 'utf8');

describe('pnpm render, in process', () => {
  it('writes the PNG and the SVG of a view, with the command’s name first on standard error', async () => {
    const cwd = tempDir();
    const result = await capture(
      ['--fixture', 'S', '--lens', 'overview', '--png', 'shots/s.png', '--svg', 'shots/s.svg', '--strict'],
      cwd,
    );
    expect(result.code).toBe(0);
    // The banner names the command and nothing else: no affiliation line (ADR 0018: footers and long-form texts).
    const [banner] = result.stderr.split('\n');
    expect(banner).toBe(BANNER);
    expect(banner).toBe('gcportrait render');
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/affiliated/i);
    const assets = generateOrganization({ size: 'S' }).assets.length;
    expect(result.stdout).toMatch(
      new RegExp(
        `^demo S \\(${String(assets)} assets\\) · lens overview · detail auto → all \\(budget ${String(DEFAULT_VIEWPORT_BUDGET)}\\) · light$`,
        'm',
      ),
    );
    expect(result.stdout).toContain('invariants hold');
    expect(result.stdout).toContain(`→ ${path.join(cwd, 'shots/s.png')}`);
    expect(readFileSync(path.join(cwd, 'shots/s.svg'), 'utf8')).toBe(baselineSvg('S-overview-auto-light'));
    // The size of the golden: the frame (the title band's three lines; no affiliation line since 2026-10-11)
    // and 24 px margins, at 2× (2 × (2349 + 48) by 2 × (1358 + 48) when this was written).
    const { width, height } = decodePng(readFileSync(GOLDEN));
    expect(decodePng(readFileSync(path.join(cwd, 'shots/s.png')))).toMatchObject({ width, height });
  });

  it('writes to standard output with -, moving the report to standard error', async () => {
    const result = await capture(
      ['--fixture', 'S', '--lens', 'networking', '--theme', 'dark', '--svg', '-'],
      tempDir(),
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(baselineSvg('S-networking-auto-dark'));
    expect(result.stderr).toContain('svg: ');
    expect(result.stderr).toContain('standard output');

    const png = await capture(['--fixture', 'S', '--width', '1200', '--png', '-'], tempDir());
    expect(png.code).toBe(0);
    expect(decodePng(png.stdoutBytes).width).toBe(1200);
  });

  it('writes the draw.io file: the golden drawing with the command’s version, compressed or plain', async () => {
    const cwd = tempDir();
    const result = await capture(['--fixture', 'S', '--lens', 'overview', '--drawio', 's.drawio'], cwd);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(
      /^drawio: 15 zones, 40 nodes, 45 edges, \d+ cells, compressed → .*s\.drawio \([\d ]+ bytes\)$/m,
    );
    // Only what was asked for: no PNG beside it.
    expect(result.stdout).not.toContain('png: ');
    const golden = readFileSync(DRAWIO_GOLDEN, 'utf8');
    expect(readFileSync(path.join(cwd, 's.drawio'), 'utf8')).toBe(
      golden.replace(' agent="gcportrait" ', ` agent="gcportrait ${CLI_VERSION}" `),
    );
    const plain = await capture(['--fixture', 'S', '--drawio', '-', '--drawio-plain'], tempDir());
    expect(plain.code).toBe(0);
    expect(plain.stderr).toContain('plain XML → standard output');
    expect(readDrawioFile(plain.stdout)).toMatchObject({
      compressed: false,
      model: readDrawioFile(golden).model,
    });
  });

  it('compares with an earlier PNG: exit 0 when it matches, 1 with a picture of the differences when not', async () => {
    const cwd = tempDir();
    await capture(['--fixture', 'S', '--scale', '1', '--png', 'light.png'], cwd);
    await capture(['--fixture', 'S', '--scale', '1', '--theme', 'dark', '--png', 'dark.png'], cwd);
    const same = await capture(
      ['--fixture', 'S', '--scale', '1', '--compare', 'light.png', '--png', 'again.png'],
      cwd,
    );
    expect(same.code).toBe(0);
    expect(same.stdout).toMatch(/compare: ok: 0 of [\d ]+ pixels differ/);
    const other = await capture(
      ['--fixture', 'S', '--scale', '1', '--compare', 'dark.png', '--diff', 'diff.png', '--svg', 'only.svg'],
      cwd,
    );
    expect(other.code).toBe(1);
    expect(other.stdout).toMatch(/compare: FAIL: [\d ]+ of [\d ]+ pixels differ/);
    expect(decodePng(readFileSync(path.join(cwd, 'diff.png'))).width).toBe(
      decodePng(readFileSync(path.join(cwd, 'light.png'))).width,
    );
    // --svg alone writes no PNG, but --compare still rasterises.
    expect(other.stdout).not.toMatch(/^png: /m);
    const missing = await capture(['--fixture', 'S', '--compare', 'nowhere.png', '--svg', 'x.svg'], cwd);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('cannot read');
  });

  it('answers a usage error with exit 2 and the usage, and --help with the usage', async () => {
    const bad = await capture(['--lens', 'nope'], tempDir());
    expect(bad.code).toBe(2);
    expect(bad.stderr.split('\n')[0]).toBe(BANNER);
    expect(bad.stderr).toContain('render: --lens takes overview');
    expect(bad.stderr).toContain('Usage:');
    const help = await capture(['--help'], tempDir());
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('pnpm render --all');
  });

  it('lists the demo organisations, their asset counts grouped in thousands and right-aligned', async () => {
    const result = await capture(['--list-fixtures'], tempDir());
    expect(result.code).toBe(0);
    const rows = result.stdout
      .trimEnd()
      .split('\n')
      .map((line) => {
        const match = /^(\w+) +(\d{1,3}(?: \d{3})*) assets {3}demo:(\w+)$/.exec(line);
        expect(match, line).not.toBeNull();
        return {
          fixture: match?.[1],
          assets: Number(match?.[2]?.replaceAll(' ', '')),
          ref: match?.[3],
          line,
        };
      });
    expect(rows.map(({ fixture, assets, ref }) => ({ fixture, assets, ref }))).toEqual(
      FIXTURES.map((fixture) => ({
        fixture,
        assets: generateOrganization({ size: fixture }).assets.length,
        ref: fixture,
      })),
    );
    // One column: the counts end at the same place on every line.
    expect(new Set(rows.map(({ line }) => line.indexOf(' assets'))).size).toBe(1);
  });

  it('--all draws each fixture × lens × theme and describes exactly those files in its index', async () => {
    const cwd = tempDir();
    const argv = [
      '--all',
      '--out',
      'all',
      '--fixtures',
      'S',
      '--lenses',
      'overview,security',
      '--scale',
      '1',
    ];
    const result = await capture(argv, cwd);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('wrote 4 views to');
    expect(readFileSync(path.join(cwd, 'all/S-overview-auto-dark.svg'), 'utf8')).toBe(
      baselineSvg('S-overview-auto-dark'),
    );
    const index: unknown = JSON.parse(readFileSync(path.join(cwd, 'all/index.json'), 'utf8'));
    // The whole index, so that nothing that varies from run to run (a time, a path) can creep into it: the
    // command's arguments, then one entry per file in fixture × lens × theme order, sized as the file is.
    const renders = (['overview', 'security'] as const).flatMap((lens) =>
      THEMES.map((theme) => {
        const name = `S-${lens}-auto-${theme}`;
        const { width, height } = decodePng(readFileSync(path.join(cwd, 'all', `${name}.png`)));
        return {
          fixture: 'S',
          lens,
          detail: 'auto',
          detailUsed: 'all',
          theme,
          rects: expect.any(Number) as number,
          edges: expect.any(Number) as number,
          violations: 0,
          svg: `${name}.svg`,
          png: `${name}.png`,
          width,
          height,
        };
      }),
    );
    expect(index).toEqual({
      generator: 'gcportrait render',
      detail: 'auto',
      viewport: DEFAULT_VIEWPORT,
      raster: { scale: 1 },
      renders,
    });
    // Each entry's figures are the ones the command reported for that file.
    for (const entry of (index as { renders: IndexEntry[] }).renders) {
      expect(result.stdout).toContain(
        `${entry.png?.replace(/\.png$/, '') ?? ''}: ${String(entry.rects)} rects, ${String(entry.edges)} edges, ${String(entry.width)}×${String(entry.height)} px\n`,
      );
    }
  });

  it('--all writes draw.io files among its formats and lists them in its index', async () => {
    const cwd = tempDir();
    const result = await capture(
      [
        '--all',
        '--out',
        'all',
        '--fixtures',
        'S',
        '--lenses',
        'overview',
        '--themes',
        'light',
        '--formats',
        'drawio',
      ],
      cwd,
    );
    expect(result.code).toBe(0);
    const index = JSON.parse(readFileSync(path.join(cwd, 'all/index.json'), 'utf8')) as {
      renders: IndexEntry[];
    };
    expect(index.renders).toEqual([expect.objectContaining({ drawio: 'S-overview-auto-light.drawio' })]);
    expect(index.renders[0]?.png).toBeUndefined();
    expect(readFileSync(path.join(cwd, 'all/S-overview-auto-light.drawio'), 'utf8')).toBe(
      readFileSync(DRAWIO_GOLDEN, 'utf8').replace(
        ' agent="gcportrait" ',
        ` agent="gcportrait ${CLI_VERSION}" `,
      ),
    );
  });
});

describe('pnpm render, as a command', () => {
  it('writes byte-identical files in two separate processes, identical to the in-process render', async () => {
    const tsx = createRequire(import.meta.url).resolve('tsx/cli');
    const outputs = [tempDir(), tempDir()].map((cwd) => {
      const child = spawnSync(
        process.execPath,
        [
          tsx,
          '--tsconfig',
          '../../frontend/tsconfig.json',
          'src/cli.ts',
          '--fixture',
          'S',
          '--lens',
          'overview',
          '--png',
          'v.png',
          '--svg',
          'v.svg',
          '--drawio',
          'v.drawio',
        ],
        { cwd: PACKAGE_DIR, env: { ...process.env, INIT_CWD: cwd }, encoding: 'utf8', timeout: 120_000 },
      );
      expect(child.status, child.stderr).toBe(0);
      expect(child.stderr.split('\n')[0]).toBe(BANNER);
      return {
        png: readFileSync(path.join(cwd, 'v.png')),
        svg: readFileSync(path.join(cwd, 'v.svg')),
        drawio: readFileSync(path.join(cwd, 'v.drawio')),
      };
    });
    const [first, second] = outputs;
    expect(second?.png.equals(first?.png ?? Buffer.alloc(0))).toBe(true);
    expect(second?.svg.equals(first?.svg ?? Buffer.alloc(0))).toBe(true);
    expect(second?.drawio.equals(first?.drawio ?? Buffer.alloc(0))).toBe(true);

    const cwd = tempDir();
    await capture(['--fixture', 'S', '--lens', 'overview', '--png', 'v.png'], cwd);
    const inProcess = readFileSync(path.join(cwd, 'v.png'));
    expect(inProcess.equals(first?.png ?? Buffer.alloc(0))).toBe(true);
  });
});
