// SPDX-License-Identifier: MIT
/** The render-scene command: argument parsing, the summary, JSON output, errors, and the entry point. */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { SceneBuildSchema, type SceneBuild } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import { flipIdOf, viewportBudget } from '../src/index.js';
import { BANNER, USAGE, UsageError, loadFixture, parseCommand, run } from './render-scene.js';

async function capture(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await run(argv, {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

describe('parseCommand', () => {
  it('defaults to the M fixture’s overview at auto detail, as a summary', () => {
    expect(parseCommand([])).toMatchObject({
      fixture: 'M',
      json: false,
      budget: undefined,
      spec: { snapshot: 'demo:M', lens: 'overview', detail: 'auto', flips: [] },
    });
  });

  it('reads the fixture, every part of the view, the viewport and the output mode', () => {
    const command = parseCommand([
      '--fixture',
      'S',
      '--lens',
      'networking',
      '--focus',
      'kind=shared-vpc,host=demo-net-1',
      '--root',
      '//cloudresourcemanager.googleapis.com/folders/20000000001',
      '--detail',
      'projects',
      '--filter',
      'hideEmptyProjects=true',
      '--filter',
      'hideDisconnected',
      '--filter',
      'regions=europe-west3,us-central1',
      '--filter',
      'depth=2',
      '--filter',
      'showIdentities=false',
      '--flip',
      '//cloudresourcemanager.googleapis.com/projects/10000000001',
      '--viewport',
      '1920x1080',
      '--selection',
      '//cloudresourcemanager.googleapis.com/projects/10000000001',
      '--highlight',
      '10.0.0.2',
      '--json',
    ]);
    expect(command).toEqual({
      fixture: 'S',
      json: true,
      budget: 148,
      spec: {
        snapshot: 'demo:S',
        lens: 'networking',
        detail: 'projects',
        focus: { kind: 'shared-vpc', params: { host: 'demo-net-1' } },
        root: '//cloudresourcemanager.googleapis.com/folders/20000000001',
        filters: {
          hideEmptyProjects: true,
          hideEmptyFolders: false,
          hideDisconnected: true,
          regions: ['europe-west3', 'us-central1'],
          depth: 2,
          showIdentities: false,
        },
        flips: [flipIdOf('//cloudresourcemanager.googleapis.com/projects/10000000001')],
        selection: '//cloudresourcemanager.googleapis.com/projects/10000000001',
        highlight: '10.0.0.2',
      },
    });
  });

  it('takes an explicit budget instead of the viewport', () => {
    expect(parseCommand(['--budget', '30'])).toMatchObject({ budget: 30 });
  });

  it('answers --help with the usage', () => {
    expect(parseCommand(['--help'])).toBe('help');
  });

  it('reads a viewport into its budget, the budget winning when both are given', () => {
    expect(parseCommand(['--viewport', '16384x16384'])).toMatchObject({
      budget: viewportBudget(16_384, 16_384),
    });
    expect(parseCommand(['--budget', '30', '--viewport', '1920x1080'])).toMatchObject({ budget: 30 });
  });

  it.each([
    [['--fixture', 'XL'], /^--fixture takes S, M, L, not "XL"$/],
    [['--lens', 'nope'], /^--lens takes overview, networking, .*, not "nope"$/],
    [['--detail', 'some'], /^--detail takes auto, folders, projects, networks, all, not "some"$/],
    [['--focus', 'project'], /^--focus takes NAME=VALUE pairs, not "project"$/],
    [['--focus', 'kind=nope'], /^--focus needs kind=project\|shared-vpc\|.*, not "nope"$/],
    // As pnpm render and the render API: a focus parameter's name starts with a letter.
    [['--focus', 'kind=project,=demo-web-1'], /^--focus parameter "": must start with a letter/],
    [['--filter', 'colour=red'], /^--filter takes hideEmptyProjects, .*, not "colour"$/],
    [['--filter', 'hideDisconnected=maybe'], /^--filter hideDisconnected takes true or false, not "maybe"$/],
    // As pnpm render and the render API: a boolean filter is true or false, never 1 or 0.
    [['--filter', 'showRegions=1'], /^--filter showRegions takes true or false, not "1"$/],
    [['--filter', 'showIdentities=0'], /^--filter showIdentities takes true or false, not "0"$/],
    [['--filter', 'depth=0'], /^--filter depth: Too small: expected number to be >=1$/],
    [['--filter', 'includeTypes=not a type'], /^--filter includeTypes: must be an asset type/],
    [['--root', ''], /^--root: must be non-empty, well-formed text$/],
    [['--budget', '0'], /--budget takes a positive integer/],
    [['--budget', 'many'], /--budget takes a positive integer/],
    [['--viewport', 'big'], /^--viewport takes WIDTHxHEIGHT, not "big"$/],
    [['--viewport', '20000x800'], /^--viewport width: Too big: expected number to be <=16384$/],
  ])('refuses %j', (argv, message) => {
    expect(() => parseCommand(argv)).toThrow(UsageError);
    expect(() => parseCommand(argv)).toThrow(message);
  });
});

describe('run', () => {
  it('prints a summary of the scene: zones by kind, cards, edges by kind, chips, dangling, warnings', async () => {
    const { code, out, err } = await capture(['--fixture', 'S', '--lens', 'networking', '--detail', 'all']);
    expect(code).toBe(0);
    expect(err).toBe('');
    const lines = out.trimEnd().split('\n');
    // The banner names the command only: no affiliation line (footers and long-form texts only).
    expect(lines[0]).toBe('gcportrait render-scene');
    expect(out).not.toMatch(/affiliated/i);
    expect(lines.map((line) => line.split(/\s+/)[0])).toEqual([
      'gcportrait',
      'fixture',
      'view',
      'rects',
      'root',
      'focus',
      'zones',
      'chips',
      'cards',
      'edges',
      'external',
      'dangling',
      'warnings',
    ]);
    expect(out).toContain('fixture    demo S: 96 assets read at 2026-10-08T00:00:00Z');
    expect(out).toContain('view       lens networking · detail all\n');
    expect(out).toContain('root       example.com (the whole scope)');
    expect(out).toMatch(/zones {6}\d+: folder \d+, project \d+, vpc \d+, subnet \d+/);
    expect(out).toContain('warnings   none');
  });

  it('reports the auto level, a focus and the warnings', async () => {
    const focused = await capture(['--fixture', 'S', '--focus', 'kind=project,project=demo-web-1']);
    expect(focused.out).toMatch(/view {7}lens overview · detail auto → all \(budget 73\)/);
    expect(focused.out).toContain(
      'focus      project //cloudresourcemanager.googleapis.com/projects/10000000007 (1 project)',
    );
    const refused = await capture(['--fixture', 'S', '--focus', 'kind=perimeter,perimeter=nope']);
    expect(refused.out).toContain('focus      perimeter: error unknown-perimeter');
    expect(refused.out).toMatch(/warnings {3}Focus not applied/);
  });

  it('prints the scene and its report as JSON, the banner on stderr', async () => {
    const { code, out, err } = await capture(['--fixture', 'S', '--lens', 'everything', '--json']);
    expect(code).toBe(0);
    expect(err).toBe(`${BANNER}\n`);
    const build: SceneBuild = SceneBuildSchema.parse(JSON.parse(out));
    expect(build.scene.metadata).toMatchObject({ lens: 'everything', rootLabel: 'example.com' });
  });

  it('answers a usage error with exit code 2 and the usage, and --help with the usage', async () => {
    const bad = await capture(['--lens', 'nope']);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain(USAGE);
    const unknown = await capture(['--colour']);
    expect(unknown.code).toBe(2);
    const help = await capture(['--help']);
    expect([help.code, help.out]).toEqual([0, `${USAGE}\n`]);
  });

  it('loads the L organisation by generating it', async () => {
    const snapshot = await loadFixture('L');
    expect(snapshot.assets.length).toBeGreaterThan(5000);
    // Each demo size is its own organisation: L is 30000000003.
    expect(snapshot.scope).toEqual({ kind: 'organization', id: '30000000003', displayName: 'example.com' });
  });
});

describe('the command line', () => {
  it('runs through tsx as `pnpm render-scene` does', () => {
    const tsx = path.resolve(import.meta.dirname, '../node_modules/.bin/tsx');
    const out = execFileSync(
      tsx,
      [path.join(import.meta.dirname, 'render-scene.ts'), '--fixture', 'S', '--lens', 'networking'],
      {
        encoding: 'utf8',
      },
    );
    // The networking lens opens at `networks`, but all of S's networking view fits in 100 rects, so `auto`
    // opens it whole.
    expect(out).toContain(
      'view       lens networking · detail auto → all (budget 73, lens ceiling networks)',
    );
  });
});
