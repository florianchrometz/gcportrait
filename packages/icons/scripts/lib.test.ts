// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { composite, contrastRatio, isTwoToneBlue, parseColour } from './lib/colour.mjs';
import { needsPlate } from './lib/icon-module.mjs';
import { MAPPING_PATH, mappingProblems } from './lib/mapping.mjs';

describe('colour helpers', () => {
  it('parse the forms the icon sets use', () => {
    expect(parseColour('#4285F4')).toEqual([66, 133, 244]);
    expect(parseColour('#fff')).toEqual([255, 255, 255]);
    expect(parseColour('white')).toEqual([255, 255, 255]);
    expect(() => parseColour('rgb(0,0,0)')).toThrow(/unsupported colour/);
  });

  it('compute WCAG contrast ratios', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#4285F4', '#FFFFFF')).toBeCloseTo(3.56, 2);
    expect(contrastRatio('#669DF6', '#FFFFFF')).toBeCloseTo(2.72, 2);
    expect(contrastRatio('#4285F4', '#2B2C2F')).toBeGreaterThan(3);
  });

  it('composite a translucent plate over a card', () => {
    expect(composite('#FFFFFF', 0.92, '#2B2C2F')).toBe('#eeeeee');
    expect(composite('#000000', 0, '#123456')).toBe('#123456');
  });

  it('tell the two-tone blues (and white) from colour and grey marks', () => {
    for (const blue of ['#4285f4', '#aecbfa', '#669df6', '#3367d6', '#185abc', '#fff']) {
      expect(isTwoToneBlue(blue)).toBe(true);
    }
    for (const other of ['#9aa0a6', '#ea4335', '#34a853', '#fbbc04', '#000000', '#00ffff']) {
      expect(isTwoToneBlue(other)).toBe(false);
    }
  });
});

describe('needsPlate', () => {
  it('puts colour and category marks and non-blue legacy symbols on the dark plate (style skill §2)', () => {
    expect(needsPlate('core', ['#4285f4'])).toBe(true);
    expect(needsPlate('category', ['#4285f4'])).toBe(true);
    expect(needsPlate('legacy', ['#4285f4', '#aecbfa'])).toBe(false);
    expect(needsPlate('legacy', ['#4285f4', '#9aa0a6'])).toBe(true);
    expect(needsPlate('own', ['#4285f4', '#aecbfa'])).toBe(false);
  });
});

describe('mappingProblems', () => {
  /** The committed mapping, which data.test.ts holds valid: each case below breaks a fresh copy of it. */
  const valid = (): Record<string, unknown> =>
    JSON.parse(readFileSync(MAPPING_PATH, 'utf8')) as Record<string, unknown>;

  it('reports bad keys, missing artwork, unknown categories, missing own files and generic marks', () => {
    const mapping = valid();
    const icons = mapping.icons as Record<string, Record<string, unknown>>;
    icons['Bad-Key'] = { legacy: 'x/x.svg' };
    icons.empty_entry = {};
    icons.bad_category = { category: 'category_nowhere' };
    icons.missing_own = { own: 'no-such-drawing.svg' };
    icons.second_generic = { legacy: 'y/y.svg', generic: true };
    icons.odd_field = { legacy: 'z/z.svg', colour: 'red' };
    const problems = mappingProblems(mapping);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('icon key Bad-Key'),
        'icons.empty_entry names no artwork',
        'icons.bad_category.category names no key of "categories"',
        'icons.missing_own.own: own/no-such-drawing.svg does not exist',
        'exactly one icon is the generic mark (generic: true); found 2',
        'icons.odd_field.colour is unknown',
      ]),
    );
  });

  it('reports legibility decisions that contradict the mapping', () => {
    const mapping = valid();
    mapping.legibility16 = [{ subject: 'x', key: 'compute_engine', decision: 'own', note: 'n' }];
    expect(mappingProblems(mapping)).toEqual([
      'legibility16[0]: compute_engine is decided "own" but mapped otherwise',
    ]);
  });

  it('refuses non-objects and missing sections', () => {
    expect(mappingProblems(null)).toEqual(['mapping.json is not an object']);
    expect(mappingProblems({})).toEqual(
      expect.arrayContaining(['description missing', 'sources missing', 'categories missing']),
    );
  });
});
