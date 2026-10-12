// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { FOLDER, ULID, sampleViewSpec } from '../testing/fixtures.js';
import { issuePaths } from '../testing/issues.js';
import {
  DEFAULT_VIEW_SPEC,
  FocusKindSchema,
  VIEW_SPEC_MAX_FLIPS,
  ViewSpecSchema,
  normalizeViewSpec,
  type ViewSpec,
} from './view-spec.js';

const flips = (count: number): string[] => Array.from({ length: count }, (_, index) => `f${String(index)}`);

describe('ViewSpecSchema', () => {
  it('accepts the default view and a view that sets every field', () => {
    expect(issuePaths(ViewSpecSchema, DEFAULT_VIEW_SPEC)).toEqual([]);
    expect(issuePaths(ViewSpecSchema, sampleViewSpec())).toEqual([]);
  });

  it.each(FocusKindSchema.options)('accepts focus kind %s', (kind) => {
    expect(issuePaths(ViewSpecSchema, { ...DEFAULT_VIEW_SPEC, focus: { kind, params: {} } })).toEqual([]);
  });

  it(`accepts up to ${String(VIEW_SPEC_MAX_FLIPS)} flips`, () => {
    expect(issuePaths(ViewSpecSchema, { ...DEFAULT_VIEW_SPEC, flips: flips(48) })).toEqual([]);
    expect(issuePaths(ViewSpecSchema, { ...DEFAULT_VIEW_SPEC, flips: flips(49) })).toEqual(['flips']);
  });

  it.each([
    ['snapshot', { snapshot: ULID.toLowerCase() }],
    ['tick', { tick: '2026-02-30' }],
    ['lens', { lens: 'network' }],
    ['focus.kind', { focus: { kind: 'org', params: {} } }],
    ['focus.params.1st', { focus: { kind: 'project', params: { '1st': 'demo-app' } } }],
    ['focus.params.project', { focus: { kind: 'project', params: { project: '' } } }],
    ['root', { root: '' }],
    ['detail', { detail: 'some' }],
    ['flips.0', { flips: ['a b'] }],
    ['selection', { selection: '\uD800' }],
    ['highlight', { highlight: '' }],
    ['', { theme: 'dark' }],
  ])('rejects a bad %s', (path, patch) => {
    expect(issuePaths(ViewSpecSchema, { ...DEFAULT_VIEW_SPEC, ...patch })).toEqual([path]);
  });

  it.each([
    ['regions.0', { regions: ['europe west'] }],
    ['projects.0', { projects: ['Demo'] }],
    ['folders.0', { folders: ['folders/1'] }],
    ['includeTypes.0', { includeTypes: ['Instance'] }],
    ['excludeTypes.0', { excludeTypes: ['run.googleapis.com/S*'] }],
    ['depth', { depth: 0 }],
    ['depth', { depth: 65 }],
    ['depth', { depth: 1.5 }],
    ['showRegions', { showRegions: 'yes' }],
    ['', { hideEverything: true }],
  ])('rejects a bad filters.%s', (path, patch) => {
    const filters = { ...DEFAULT_VIEW_SPEC.filters, ...patch };
    expect(issuePaths(ViewSpecSchema, { ...DEFAULT_VIEW_SPEC, filters })).toEqual([
      `filters${path ? `.${path}` : ''}`,
    ]);
  });

  it('requires the three hide switches', () => {
    expect(issuePaths(ViewSpecSchema, { ...DEFAULT_VIEW_SPEC, filters: {} })).toEqual([
      'filters.hideEmptyProjects',
      'filters.hideEmptyFolders',
      'filters.hideDisconnected',
    ]);
  });
});

describe('DEFAULT_VIEW_SPEC', () => {
  it('is the overview of no particular snapshot, at automatic detail, with nothing hidden', () => {
    expect(DEFAULT_VIEW_SPEC).toEqual({
      snapshot: '',
      lens: 'overview',
      filters: { hideEmptyProjects: false, hideEmptyFolders: false, hideDisconnected: false },
      detail: 'auto',
      flips: [],
    });
  });

  it('is deeply frozen', () => {
    expect(Object.isFrozen(DEFAULT_VIEW_SPEC)).toBe(true);
    expect(Object.isFrozen(DEFAULT_VIEW_SPEC.filters)).toBe(true);
    expect(Object.isFrozen(DEFAULT_VIEW_SPEC.flips)).toBe(true);
  });
});

describe('normalizeViewSpec', () => {
  it('fills every default into an empty input, as a fresh mutable object', () => {
    const spec = normalizeViewSpec({});
    expect(spec).toEqual(DEFAULT_VIEW_SPEC);
    expect(spec).not.toBe(DEFAULT_VIEW_SPEC);
    expect(Object.isFrozen(spec.flips)).toBe(false);
  });

  it('keeps a valid, canonical view as it is', () => {
    expect(normalizeViewSpec(sampleViewSpec())).toEqual(sampleViewSpec());
  });

  it('fills the missing hide switches of partial filters', () => {
    expect(normalizeViewSpec({ filters: { hideDisconnected: true } }).filters).toEqual({
      hideEmptyProjects: false,
      hideEmptyFolders: false,
      hideDisconnected: true,
    });
  });

  it('replaces invalid scalars with their defaults and drops invalid optional fields', () => {
    const spec = normalizeViewSpec({
      snapshot: 'latest',
      tick: '2026-02-30',
      lens: 'network',
      detail: 'some',
      root: '',
      selection: '\uDC00',
      highlight: '',
      focus: { kind: 'org', params: {} },
      filters: { hideEmptyProjects: 'yes', depth: 0, showRegions: 1, showIdentities: null },
    });
    expect(spec).toEqual(DEFAULT_VIEW_SPEC);
  });

  it('keeps explicit switch values, false included', () => {
    const filters = normalizeViewSpec({
      filters: { showRegions: false, showIdentities: true, depth: 3 },
    }).filters;
    expect(filters).toMatchObject({ showRegions: false, showIdentities: true, depth: 3 });
  });

  it('turns filter lists into sorted sets of their valid items, and drops empty lists', () => {
    const filters = normalizeViewSpec({
      filters: {
        regions: ['us-central1', 'europe-west3', 'us-central1', 'not a region'],
        projects: [],
        folders: ['folders/1'],
        includeTypes: ['run.googleapis.com/*', 'compute.googleapis.com/Instance'],
        excludeTypes: 'compute.googleapis.com/Disk',
      },
    }).filters;
    expect(filters).toEqual({
      hideEmptyProjects: false,
      hideEmptyFolders: false,
      hideDisconnected: false,
      regions: ['europe-west3', 'us-central1'],
      includeTypes: ['compute.googleapis.com/Instance', 'run.googleapis.com/*'],
    });
  });

  it('keeps each flip once, at its newest position, and only the newest VIEW_SPEC_MAX_FLIPS', () => {
    expect(normalizeViewSpec({ flips: ['a', 'b', 'a', 'not valid!', 'c'] }).flips).toEqual(['b', 'a', 'c']);
    const many = flips(60);
    expect(normalizeViewSpec({ flips: many }).flips).toEqual(many.slice(12));
  });

  it.each([
    ['in name order', { alpha: 'a', perimeter: 'corp', zeta: 'z' }],
    ['in reverse order', { zeta: 'z', perimeter: 'corp', alpha: 'a' }],
    [
      'mixed with an invalid name and an empty value',
      { zeta: 'z', perimeter: 'corp', alpha: 'a', '9': 'nine', empty: '' },
    ],
  ])('keeps a focus with its valid parameters, sorted by name: given %s', (_order, params) => {
    const focus = normalizeViewSpec({ focus: { kind: 'perimeter', params } }).focus;
    expect(focus).toEqual({ kind: 'perimeter', params: { alpha: 'a', perimeter: 'corp', zeta: 'z' } });
    expect(Object.keys(focus?.params ?? {})).toEqual(['alpha', 'perimeter', 'zeta']);
  });

  it('accepts a focus without parameters from untyped input', () => {
    expect(normalizeViewSpec({ focus: { kind: 'standalone-projects' } }).focus).toEqual({
      kind: 'standalone-projects',
      params: {},
    });
  });

  it.each([null, 42, 'lens=networking', [], new Date(0)])('never throws, even for %j', (input) => {
    expect(normalizeViewSpec(input as unknown as Partial<ViewSpec>)).toEqual(DEFAULT_VIEW_SPEC);
  });

  it('keeps optional text fields that are valid', () => {
    const spec = normalizeViewSpec({ root: FOLDER, selection: 'web & api', highlight: '😀' });
    expect(spec).toMatchObject({ root: FOLDER, selection: 'web & api', highlight: '😀' });
  });

  it('is idempotent', () => {
    const once = normalizeViewSpec({ ...sampleViewSpec(), flips: ['x', 'y', 'x'] });
    expect(normalizeViewSpec(once)).toEqual(once);
  });
});
