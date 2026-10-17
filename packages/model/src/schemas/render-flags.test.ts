// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { LensIdSchema } from './lens.js';
import { FILTER_FLAG_KEYS, readRenderFlags, type RenderFlags } from './render-flags.js';
import { RenderOptionsSchema, type RenderFormat, type RenderOptionsInput } from './render.js';
import { FocusKindSchema, ViewFiltersSchema } from './view-spec.js';

const LENSES = LensIdSchema.options.join(', ');
const FILTERS = ViewFiltersSchema.keyof().options.join(', ');
const FOCUS_KINDS = FocusKindSchema.options.join('|');

/** The options the flags read into, or the reader's message. */
function read(flags: RenderFlags, format?: RenderFormat): unknown {
  const result = readRenderFlags(flags, format);
  return result.success ? result.options : result.error;
}

describe('readRenderFlags: what it takes', () => {
  it.each<[string, RenderFlags, RenderOptionsInput]>([
    ['no flags: every default', {}, {}],
    ['empty repeatable flags are none', { filter: [], flip: [] }, {}],
    [
      'a lens and a detail level',
      { lens: 'networking', detail: 'all' },
      { view: { lens: 'networking', detail: 'all' } },
    ],
    [
      'a focus: its kind and parameters, a value holding = kept whole',
      { focus: 'kind=project,project=demo-web-1,note=a=b' },
      { view: { focus: { kind: 'project', params: { project: 'demo-web-1', note: 'a=b' } } } },
    ],
    [
      'a focus of a kind alone; the last kind wins',
      { focus: 'kind=perimeter,kind=standalone-projects' },
      { view: { focus: { kind: 'standalone-projects', params: {} } } },
    ],
    [
      'a drill-in root and flips, in their order',
      { root: '//cloudresourcemanager.googleapis.com/folders/20000000001', flip: ['b-zone', 'a-zone'] },
      {
        view: {
          root: '//cloudresourcemanager.googleapis.com/folders/20000000001',
          flips: ['b-zone', 'a-zone'],
        },
      },
    ],
    [
      'boolean filters: true, false, or the key alone for true',
      { filter: ['hideEmptyProjects=true', 'showRegions=false', 'hideDisconnected'] },
      { view: { filters: { hideEmptyProjects: true, showRegions: false, hideDisconnected: true } } },
    ],
    [
      'list filters: comma-separated, empty items dropped; depth a number; the last entry of a key wins',
      {
        filter: [
          'regions=europe-west3,,global',
          'depth=5',
          'depth=3',
          'includeTypes=compute.googleapis.com/*',
        ],
      },
      {
        view: {
          filters: {
            regions: ['europe-west3', 'global'],
            depth: 3,
            includeTypes: ['compute.googleapis.com/*'],
          },
        },
      },
    ],
    [
      'an app link’s hash, with or without its #',
      { hash: '#snapshot=demo%3AM&lens=networking&selection=x' },
      { view: { hash: '#snapshot=demo%3AM&lens=networking&selection=x' } },
    ],
    [
      'the theme, the viewport and a PNG scale',
      { theme: 'dark', viewport: '1920x1080', scale: '1.5' },
      { theme: 'dark', viewport: { width: 1920, height: 1080 }, scale: 1.5 },
    ],
    [
      'the largest viewport and PNG width',
      { viewport: '16384x16384', width: '16384' },
      { viewport: { width: 16_384, height: 16_384 }, width: 16_384 },
    ],
  ])('%s', (_, flags, expected) => {
    expect(read(flags)).toEqual(RenderOptionsSchema.parse(expected));
  });

  it('checks the PNG-only and draw.io-only rules for the format the command writes', () => {
    expect(read({}, 'svg')).toEqual(RenderOptionsSchema.parse({ format: 'svg' }));
    expect(read({ hash: 'lens=networking' }, 'drawio')).toMatchObject({
      format: 'drawio',
      view: { hash: 'lens=networking' },
    });
  });

  it('names the filters by how --filter writes them, in the schema’s order', () => {
    expect(FILTER_FLAG_KEYS).toEqual({
      boolean: ['hideEmptyProjects', 'hideEmptyFolders', 'hideDisconnected', 'showRegions', 'showIdentities'],
      list: ['regions', 'projects', 'folders', 'includeTypes', 'excludeTypes'],
      number: ['depth'],
    });
    expect(Object.values(FILTER_FLAG_KEYS).flat().sort()).toEqual(
      ViewFiltersSchema.keyof().options.toSorted(),
    );
  });
});

describe('readRenderFlags: what it refuses, in the flags’ words', () => {
  it.each<[string, RenderFlags, string]>([
    ['an unknown lens', { lens: 'nope' }, `--lens takes ${LENSES}, not "nope"`],
    [
      'an unknown detail level',
      { detail: 'some' },
      '--detail takes auto, folders, projects, networks, all, not "some"',
    ],
    ['an unknown theme', { theme: 'sepia' }, '--theme takes light, dark, not "sepia"'],
    ['a focus without a kind', { focus: 'project=demo-web-1' }, `--focus needs kind=${FOCUS_KINDS}`],
    ['a focus of an unknown kind', { focus: 'kind=nope' }, `--focus needs kind=${FOCUS_KINDS}, not "nope"`],
    ['a focus pair without =', { focus: 'kind' }, '--focus takes NAME=VALUE pairs, not "kind"'],
    [
      'a focus parameter with an empty name (as the API refuses it)',
      { focus: 'kind=project,=demo-web-1' },
      '--focus parameter "": must start with a letter and use only letters, digits, _ and -',
    ],
    [
      'a focus parameter with an empty value',
      { focus: 'kind=project,project=' },
      '--focus project: must be non-empty, well-formed text',
    ],
    ['an empty root', { root: '' }, '--root: must be non-empty, well-formed text'],
    ['an empty flip', { flip: [''] }, '--flip: must be non-empty, well-formed text'],
    [
      'more flips than a view holds',
      { flip: Array.from({ length: 49 }, (_, index) => `zone-${String(index)}`) },
      '--flip: Too big: expected array to have <=48 items',
    ],
    ['an unknown filter', { filter: ['colour=blue'] }, `--filter takes ${FILTERS}, not "colour"`],
    [
      'a boolean filter as 1 (as the API refuses it)',
      { filter: ['showRegions=1'] },
      '--filter showRegions takes true or false, not "1"',
    ],
    [
      'a boolean filter as 0',
      { filter: ['hideEmptyFolders=0'] },
      '--filter hideEmptyFolders takes true or false, not "0"',
    ],
    ['a depth that is no number', { filter: ['depth=deep'] }, '--filter depth takes a number, not "deep"'],
    ['an empty depth', { filter: ['depth='] }, '--filter depth takes a number, not ""'],
    ['a fractional depth', { filter: ['depth=2.5'] }, '--filter depth takes a whole number, not "2.5"'],
    ['a depth of 0', { filter: ['depth=0'] }, '--filter depth: Too small: expected number to be >=1'],
    [
      'a list item that is no location',
      { filter: ['regions=Not A Region'] },
      '--filter regions: must be a location such as europe-west3',
    ],
    [
      'a list filter alone (true is no type)',
      { filter: ['includeTypes'] },
      '--filter includeTypes: must be an asset type, a <service>/* glob or *',
    ],
    [
      'a view flag with a hash',
      { hash: 'snapshot=demo%3AS', lens: 'networking' },
      '--lens: cannot be given with hash (the hash holds the whole view)',
    ],
    [
      'a filter with a hash',
      { hash: 'snapshot=demo%3AS', filter: ['hideDisconnected'] },
      '--filter: cannot be given with hash (the hash holds the whole view)',
    ],
    [
      'a hash that names a timeline day (as the API refuses it)',
      { hash: 'snapshot=demo%3AS&tick=2026-10-01' },
      '--hash: names a timeline day (tick); a render draws the snapshot’s own day',
    ],
    [
      'a hash longer than a link’s',
      { hash: 'x'.repeat(8193) },
      '--hash: Too big: expected string to have <=8192 characters',
    ],
    ['a viewport without its x', { viewport: '1280' }, '--viewport takes WIDTHxHEIGHT, not "1280"'],
    ['a negative viewport', { viewport: '-1x800' }, '--viewport takes WIDTHxHEIGHT, not "-1x800"'],
    [
      'a viewport wider than 16 384 px (as the API refuses it)',
      { viewport: '20000x800' },
      '--viewport width: Too big: expected number to be <=16384',
    ],
    [
      'a viewport of no height',
      { viewport: '800x0' },
      '--viewport height: Too small: expected number to be >=1',
    ],
    ['a scale above 3', { scale: '4' }, '--scale: Too big: expected number to be <=3'],
    ['a scale of 0', { scale: '0' }, '--scale: Too small: expected number to be >0'],
    ['a scale that is no number', { scale: 'big' }, '--scale takes a number, not "big"'],
    ['a fractional width', { width: '12.5' }, '--width takes a whole number, not "12.5"'],
    ['a width beyond 16 384 px', { width: '16385' }, '--width: Too big: expected number to be <=16384'],
    ['a scale and a width', { scale: '2', width: '800' }, '--width: give scale or width, not both'],
    [
      'every problem at once, in the options’ order',
      { lens: 'nope', filter: ['depth=0'], scale: '9' },
      `--lens takes ${LENSES}, not "nope"; --filter depth: Too small: expected number to be >=1; ` +
        '--scale: Too big: expected number to be <=3',
    ],
    [
      'every grammar problem at once',
      { focus: 'kind=project,x', viewport: 'big' },
      '--focus takes NAME=VALUE pairs, not "x"; --viewport takes WIDTHxHEIGHT, not "big"',
    ],
  ])('refuses %s', (_, flags, message) => {
    expect(read(flags)).toBe(message);
  });

  it('refuses a PNG size for an SVG or a draw.io file', () => {
    expect(read({ scale: '2' }, 'svg')).toBe('--scale: applies to a PNG only');
    expect(read({ width: '800' }, 'drawio')).toBe('--width: applies to a PNG only');
  });
});
