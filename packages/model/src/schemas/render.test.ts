// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { issueLines } from '../testing/issues.js';
import { RenderOptionsSchema } from './render.js';

const issues = (input: unknown): string[] => issueLines(RenderOptionsSchema, input);

describe('RenderOptionsSchema (ADR 0033)', () => {
  it('fills in the defaults: the overview at auto detail, light, PNG, a 1280×800 viewport', () => {
    expect(RenderOptionsSchema.parse({})).toEqual({
      view: {},
      theme: 'light',
      format: 'png',
      viewport: { width: 1280, height: 800 },
    });
  });

  it('takes a view as an app link’s hash or as explicit fields, checked strictly', () => {
    expect(RenderOptionsSchema.parse({ view: { hash: 'snapshot=demo%3AM&lens=networking' } }).view).toEqual({
      hash: 'snapshot=demo%3AM&lens=networking',
    });
    const explicit = {
      lens: 'security',
      detail: 'projects',
      focus: { kind: 'project', params: { project: 'demo-web-1' } },
      root: '//cloudresourcemanager.googleapis.com/folders/20000000001',
      filters: { hideEmptyProjects: true, regions: ['europe-west3'] },
      flips: ['//cloudresourcemanager.googleapis.com/projects/demo-web-1'],
    };
    expect(RenderOptionsSchema.parse({ view: explicit }).view).toEqual(explicit);
    expect(issues({ view: { lens: 'nope' } })[0]).toMatch(/^view\.lens: /);
    expect(issues({ view: { filters: { depth: 0 } } })[0]).toMatch(/^view\.filters\.depth: /);
    expect(issues({ view: { colour: 'blue' } })[0]).toMatch(/^view: Unrecognized key/);
  });

  it('refuses a hash with other view fields, or one that names a timeline day', () => {
    expect(issues({ view: { hash: 'lens=networking', lens: 'overview' } })).toEqual([
      'view.lens: cannot be given with hash (the hash holds the whole view)',
    ]);
    expect(issues({ view: { hash: 'snapshot=demo%3AS&tick=2026-10-01' } })).toEqual([
      'view.hash: names a timeline day (tick); a render draws the snapshot’s own day',
    ]);
  });

  it('takes a PNG scale above 0 and up to 3, or a width, never both and never for an SVG', () => {
    expect(RenderOptionsSchema.parse({ scale: 3 }).scale).toBe(3);
    expect(RenderOptionsSchema.parse({ width: 1600 }).width).toBe(1600);
    expect(issues({ scale: 0 })[0]).toMatch(/^scale: /);
    expect(issues({ scale: 3.5 })[0]).toMatch(/^scale: /);
    expect(issues({ width: 16_385 })[0]).toMatch(/^width: /);
    expect(issues({ scale: 2, width: 800 })).toEqual(['width: give scale or width, not both']);
    expect(issues({ format: 'svg', scale: 2 })).toEqual(['scale: applies to a PNG only']);
    expect(issues({ viewport: { width: 0, height: 800 } })[0]).toMatch(/^viewport\.width: /);
    expect(issues({ theme: 'sepia' })[0]).toMatch(/^theme: /);
  });

  it('takes a draw.io file, compressed or plain, with or without the fonts’ stylesheet, and no PNG size', () => {
    expect(RenderOptionsSchema.parse({ format: 'drawio' })).toMatchObject({ format: 'drawio' });
    expect(
      RenderOptionsSchema.parse({ format: 'drawio', compressed: false, fontSource: false }),
    ).toMatchObject({
      compressed: false,
      fontSource: false,
    });
    expect(issues({ format: 'drawio', width: 800 })).toEqual(['width: applies to a PNG only']);
    expect(issues({ format: 'svg', compressed: false })).toEqual([
      'compressed: applies to a draw.io file only',
    ]);
    expect(issues({ fontSource: true })).toEqual(['fontSource: applies to a draw.io file only']);
    expect(issues({ format: 'drawio', compressed: 'no' })[0]).toMatch(/^compressed: /);
    expect(issues({ format: 'vsdx' })[0]).toMatch(/^format: /);
  });
});
