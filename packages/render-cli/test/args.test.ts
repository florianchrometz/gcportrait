// SPDX-License-Identifier: MIT
import { encodeViewSpec, normalizeViewSpec } from '@gcportrait/model';
import { flipIdOf } from '@gcportrait/graph';
import { describe, expect, it } from 'vitest';

import { parseCommand, UsageError, viewFileName, type AllCommand, type RenderCommand } from '../src/index.js';

function render(argv: string[]): RenderCommand {
  const command = parseCommand(argv);
  if (command.kind !== 'render') throw new Error(`expected a render command, got ${command.kind}`);
  return command;
}

function all(argv: string[]): AllCommand {
  const command = parseCommand(argv);
  if (command.kind !== 'all') throw new Error(`expected --all, got ${command.kind}`);
  return command;
}

describe('parseCommand: one view', () => {
  it('takes the README’s first example and fills in the defaults', () => {
    const command = render(['--fixture', 'M', '--lens', 'networking', '--png', 'out.png']);
    expect(command).toEqual({
      kind: 'render',
      fixture: 'M',
      spec: normalizeViewSpec({ snapshot: 'demo:M', lens: 'networking', detail: 'auto' }),
      theme: 'light',
      viewport: { width: 1280, height: 800 },
      raster: {},
      png: 'out.png',
      drawioPlain: false,
      drawioUnversioned: false,
      strict: false,
    });
  });

  it('takes a draw.io file, plain on request, without the version in its agent on request', () => {
    expect(render(['--drawio', 'out.drawio'])).toMatchObject({
      drawio: 'out.drawio',
      drawioPlain: false,
      drawioUnversioned: false,
    });
    expect(render(['--drawio', '-', '--drawio-plain'])).toMatchObject({ drawio: '-', drawioPlain: true });
    expect(render(['--drawio', 'out.drawio', '--drawio-unversioned'])).toMatchObject({
      drawio: 'out.drawio',
      drawioUnversioned: true,
    });
  });

  it('defaults to demo M, the overview lens, and no output path (the caller picks out/render/)', () => {
    const command = render([]);
    expect(command.fixture).toBe('M');
    expect(command.spec.lens).toBe('overview');
    expect(command.png).toBeUndefined();
    expect(command.svg).toBeUndefined();
    expect(command.drawio).toBeUndefined();
  });

  it('reads every view option into the ViewSpec', () => {
    const command = render([
      '--fixture',
      'S',
      '--lens',
      'load-balancing',
      '--detail',
      'all',
      '--theme',
      'dark',
      '--focus',
      'kind=project,project=demo-web-1',
      '--root',
      '//cloudresourcemanager.googleapis.com/folders/20000000001',
      '--filter',
      'hideEmptyProjects=true',
      '--filter',
      'regions=europe-west3,global',
      '--filter',
      'depth=3',
      '--flip',
      '//cloudresourcemanager.googleapis.com/projects/demo-web-1',
      '--viewport',
      '1920x1080',
      '--width',
      '1600',
      '--svg',
      '-',
      '--strict',
    ]);
    expect(command.fixture).toBe('S');
    expect(command.theme).toBe('dark');
    expect(command.spec).toEqual(
      normalizeViewSpec({
        snapshot: 'demo:S',
        lens: 'load-balancing',
        detail: 'all',
        focus: { kind: 'project', params: { project: 'demo-web-1' } },
        root: '//cloudresourcemanager.googleapis.com/folders/20000000001',
        filters: { hideEmptyProjects: true, regions: ['europe-west3', 'global'], depth: 3 },
        flips: [flipIdOf('//cloudresourcemanager.googleapis.com/projects/demo-web-1')],
      }),
    );
    expect(command.viewport).toEqual({ width: 1920, height: 1080 });
    expect(command.raster).toEqual({ width: 1600 });
    expect(command.svg).toBe('-');
    expect(command.strict).toBe(true);
  });

  it('takes the whole view from an app URL hash, fixture included', () => {
    const spec = normalizeViewSpec({ snapshot: 'demo:L', lens: 'networking', detail: 'projects' });
    const command = render(['--hash', `#${encodeViewSpec(spec)}`, '--theme', 'dark']);
    expect(command.fixture).toBe('L');
    expect(command.spec).toEqual(spec);
    expect(render(['--hash', encodeViewSpec(spec)]).spec).toEqual(spec);
  });

  it('reads --compare with its limit and diff image', () => {
    const command = render(['--compare', 'before.png', '--max-diff', '12', '--diff', 'diff.png']);
    expect(command.compare).toEqual({ expected: 'before.png', maxDiff: 12, diff: 'diff.png' });
    expect(render(['--compare', 'before.png']).compare).toEqual({ expected: 'before.png', maxDiff: 0 });
  });

  it.each([
    [['--fixture', 'XXL'], /--fixture takes S, M, L, XL/],
    [['--lens', 'nope'], /--lens takes overview/],
    [['--theme', 'sepia'], /--theme takes light, dark/],
    [['--detail', 'some'], /--detail takes/],
    [['--filter', 'hideEmptyProjects=yes'], /takes true or false/],
    [['--filter', 'colour=blue'], /unknown filter "colour"/],
    [['--filter', 'depth=0'], /invalid --filter depth/],
    [['--filter', 'regions=Not A Region'], /invalid --filter regions/],
    [['--focus', 'project=demo-web-1'], /--focus needs kind=/],
    [['--focus', 'kind'], /--focus takes NAME=VALUE pairs/],
    [['--viewport', '1280'], /--viewport takes WIDTHxHEIGHT/],
    [['--scale', '4'], /--scale takes a number above 0 and up to 3/],
    [['--scale', '0'], /--scale takes/],
    [['--width', '12.5'], /--width takes a whole number/],
    [['--scale', '2', '--width', '800'], /--scale or --width, not both/],
    [['--png', '-', '--svg', '-'], /only one of --png, --svg and --drawio/],
    [['--svg', '-', '--drawio', '-'], /only one of --png, --svg and --drawio/],
    [['--drawio-plain'], /--drawio-plain needs --drawio/],
    [['--drawio-unversioned'], /--drawio-unversioned needs --drawio/],
    [['--max-diff', '3'], /--max-diff needs --compare/],
    [['--diff', 'd.png'], /--diff needs --compare/],
    [['--compare', 'a.png', '--max-diff=-1'], /--max-diff takes a whole number/],
    [['--out', 'dir'], /--out cannot be used with a single render/],
    [['--hash', 'snapshot=01J0000000000000000000000A&lens=overview'], /--hash must name a demo snapshot/],
    [['--hash', 'snapshot=demo%3AS', '--lens', 'networking'], /--lens cannot be used with --hash/],
    [['--bogus'], /Unknown option '--bogus'/],
    [['positional'], /Unexpected argument 'positional'/],
  ])('refuses %j', (argv, message) => {
    expect(() => parseCommand(argv)).toThrow(UsageError);
    expect(() => parseCommand(argv)).toThrow(message);
  });
});

describe('parseCommand: --all, --list-fixtures, --help', () => {
  it('renders every fixture × lens × theme in both formats by default', () => {
    const command = all(['--all']);
    expect(command.fixtures).toEqual(['S', 'M', 'L', 'XL']);
    expect(command.lenses).toHaveLength(11);
    expect(command.themes).toEqual(['light', 'dark']);
    expect(command.formats).toEqual(['png', 'svg']);
    expect(command.detail).toBe('auto');
    expect(command.out).toBeUndefined();
    expect(command.strict).toBe(false);
  });

  it('narrows the sets and keeps the shared options', () => {
    const command = all([
      '--all',
      '--out',
      'shots',
      '--fixtures',
      'S,M,S',
      '--lenses',
      'overview,networking',
      '--themes',
      'dark',
      '--formats',
      'png',
      '--detail',
      'all',
      '--scale',
      '1',
      '--strict',
    ]);
    expect(command).toMatchObject({
      out: 'shots',
      fixtures: ['S', 'M'],
      lenses: ['overview', 'networking'],
      themes: ['dark'],
      formats: ['png'],
      detail: 'all',
      raster: { scale: 1 },
      strict: true,
    });
  });

  it.each([
    [['--all', '--png', 'a.png'], /--png cannot be used with --all/],
    [['--all', '--drawio', 'a.drawio'], /--drawio cannot be used with --all/],
    [['--all', '--drawio-plain'], /--drawio-plain needs drawio in --formats/],
    [['--all', '--drawio-unversioned'], /--drawio-unversioned needs drawio in --formats/],
    [['--all', '--formats', 'png,vsdx'], /--formats takes png, svg, drawio, not "vsdx"/],
    [['--all', '--lens', 'networking'], /--lens cannot be used with --all/],
    [['--all', '--fixtures', 'S,XXL'], /--fixtures takes S, M, L, XL, not "XXL"/],
    [['--all', '--formats', ''], /--formats needs at least one value/],
    [['--list-fixtures', '--fixture', 'S'], /--fixture cannot be used with --list-fixtures/],
  ])('refuses %j', (argv, message) => {
    expect(() => parseCommand(argv)).toThrow(message);
  });

  it('writes draw.io files among the formats, compressed or plain', () => {
    expect(all(['--all', '--formats', 'drawio,png'])).toMatchObject({
      formats: ['drawio', 'png'],
      drawioPlain: false,
    });
    expect(all(['--all', '--formats', 'drawio', '--drawio-plain'])).toMatchObject({ drawioPlain: true });
    expect(all(['--all', '--formats', 'drawio', '--drawio-unversioned'])).toMatchObject({
      drawioUnversioned: true,
    });
  });

  it('knows --list-fixtures and --help', () => {
    expect(parseCommand(['--list-fixtures'])).toEqual({ kind: 'list-fixtures' });
    expect(parseCommand(['--help', '--fixture', 'nonsense'])).toEqual({ kind: 'help' });
  });

  it('names files like the renderer’s own baselines', () => {
    expect(viewFileName('M', 'networking', 'auto', 'dark')).toBe('M-networking-auto-dark');
  });
});
