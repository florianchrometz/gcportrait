// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
  FONT_FACE_KEYS,
  defaultFontMetrics,
  fontFaceKey,
  measureText,
  parseFontMetricsTable,
  type FontMetricsTable,
} from './metrics.js';

const table = defaultFontMetrics();
const advance = (key: (typeof FONT_FACE_KEYS)[number], codePoint: number): number | undefined => {
  for (const run of table.faces[key].runs) {
    const first = run[0] ?? 0;
    if (codePoint >= first && codePoint < first + run.length - 1) return run[codePoint - first + 1];
  }
  return undefined;
};

describe('the generated Roboto table', () => {
  it('has the four faces, from the fontsource packages', () => {
    expect(Object.keys(table.faces).sort()).toEqual([...FONT_FACE_KEYS].sort());
    expect(Object.keys(table.sources).sort()).toEqual(['@fontsource/roboto', '@fontsource/roboto-mono']);
    expect(table.faces['sans-700'].family).toBe('Roboto');
    expect(table.faces['mono-400'].family).toBe('Roboto Mono');
    for (const key of FONT_FACE_KEYS) {
      const face = table.faces[key];
      expect(face.unitsPerEm).toBeGreaterThan(0);
      expect(face.ascent).toBeGreaterThan(0);
      expect(face.descent).toBeGreaterThan(0);
      // Printable ASCII and Latin-1 are covered by every face.
      for (let codePoint = 0x20; codePoint <= 0x7e; codePoint += 1)
        expect(advance(key, codePoint)).toBeDefined();
      expect(advance(key, 0xe9)).toBeDefined();
    }
  });

  it('is validated once and returned as the same object', () => {
    expect(defaultFontMetrics()).toBe(table);
  });

  it('has a monospace face where every printable ASCII glyph has the same advance', () => {
    const widths = new Set<number | undefined>();
    for (let codePoint = 0x21; codePoint <= 0x7e; codePoint += 1) widths.add(advance('mono-400', codePoint));
    expect(widths.size).toBe(1);
  });
});

describe('measureText', () => {
  it('sums advance widths at 1 px per font unit / unitsPerEm, scaled by the size', () => {
    const unitsPerEm = table.faces['sans-400'].unitsPerEm;
    const a = advance('sans-400', 0x41) ?? 0;
    const b = advance('sans-400', 0x42) ?? 0;
    expect(measureText('A', 400, unitsPerEm)).toBe(a);
    expect(measureText('AB', 400, 1)).toBeCloseTo((a + b) / unitsPerEm, 12);
    expect(measureText('AB', 400, 13)).toBeCloseTo(((a + b) * 13) / unitsPerEm, 12);
    expect(measureText('', 700, 13)).toBe(0);
  });

  it('uses the weight and the family', () => {
    const text = 'Shared VPC host (Production)';
    expect(measureText(text, 700, 13)).toBeGreaterThan(measureText(text, 400, 13));
    expect(measureText(text, 500, 13)).toBeGreaterThan(measureText(text, 400, 13));
    const mono = measureText('iiii', 400, 10, { family: 'mono' });
    expect(measureText('WWWW', 700, 10, { family: 'mono' })).toBe(mono);
    expect(measureText('iiii', 400, 10)).toBeLessThan(mono);
  });

  it('measures unknown code points as zero, one em or the fallback average', () => {
    const face = table.faces['sans-400'];
    expect(measureText('\u{E0100}', 400, face.unitsPerEm)).toBe(0); // variation selector
    expect(measureText('\u0001', 400, face.unitsPerEm)).toBe(0); // control character
    expect(measureText('中', 400, face.unitsPerEm)).toBe(face.unitsPerEm); // CJK: one em
    expect(measureText('😀', 400, face.unitsPerEm)).toBe(face.unitsPerEm); // emoji, a surrogate pair: once
    expect(measureText('\u{10FFFD}', 400, face.unitsPerEm)).toBe(face.fallback); // private use
    expect(measureText('ࠀ', 400, face.unitsPerEm)).toBe(face.fallback); // Samaritan: not in Roboto
  });

  it('reads code points beyond the direct lookup range from the table', () => {
    // U+20AC EURO SIGN is in the latin subset, above the flat-array range.
    const euro = advance('sans-400', 0x20ac);
    expect(euro).toBeDefined();
    expect(measureText('€', 400, table.faces['sans-400'].unitsPerEm)).toBe(euro);
  });

  it('measures with a table passed in the options', () => {
    const custom: FontMetricsTable = {
      format: 1,
      sources: { test: '1' },
      faces: Object.fromEntries(
        FONT_FACE_KEYS.map((key) => [
          key,
          {
            family: 'T',
            weight: 400,
            unitsPerEm: 10,
            ascent: 8,
            descent: 2,
            lineGap: 0,
            fallback: 5,
            runs: [[65, 10, 20]],
          },
        ]),
      ) as unknown as FontMetricsTable['faces'],
    };
    expect(measureText('AB', 400, 1, { metrics: custom })).toBe(3);
    expect(measureText('AZ', 700, 10, { metrics: custom })).toBe(15);
  });
});

describe('fontFaceKey', () => {
  it('maps weight and family to a face', () => {
    expect(fontFaceKey(400)).toBe('sans-400');
    expect(fontFaceKey(500, 'sans')).toBe('sans-500');
    expect(fontFaceKey(700)).toBe('sans-700');
    expect(fontFaceKey(700, 'mono')).toBe('mono-400');
  });
});

describe('parseFontMetricsTable', () => {
  const face = {
    family: 'T',
    weight: 400,
    unitsPerEm: 10,
    ascent: 8,
    descent: 2,
    lineGap: 0,
    fallback: 5,
    runs: [[65, 1, 2]],
  };
  const valid = {
    format: 1,
    sources: { a: '1' },
    faces: Object.fromEntries(FONT_FACE_KEYS.map((key) => [key, face])),
  };
  const withFace = (patch: Record<string, unknown>): unknown => ({
    ...valid,
    faces: { ...valid.faces, 'sans-500': { ...face, ...patch } },
  });

  it('accepts a well-formed table', () => {
    expect(parseFontMetricsTable(valid)).toBe(valid);
  });

  it.each([
    ['not an object', null, /not an object/],
    ['an array', [], /not an object/],
    ['an unknown format', { ...valid, format: 2 }, /unknown format/],
    ['sources that are not versions', { ...valid, sources: { a: 1 } }, /sources/],
    ['sources missing', { ...valid, sources: undefined }, /sources/],
    ['faces missing', { ...valid, faces: 3 }, /faces must be an object/],
    ['a missing face', { ...valid, faces: { 'sans-400': face } }, /face sans-500: not an object/],
    ['an empty family', withFace({ family: '' }), /family/],
    ['a fractional weight', withFace({ weight: 400.5 }), /weight/],
    ['zero units per em', withFace({ unitsPerEm: 0 }), /unitsPerEm/],
    ['a negative ascent', withFace({ ascent: -1 }), /ascent/],
    ['runs that are not an array', withFace({ runs: {} }), /runs must be an array/],
    ['a run without an advance', withFace({ runs: [[65]] }), /every run/],
    ['a run with a negative advance', withFace({ runs: [[65, -1]] }), /every run/],
    [
      'overlapping runs',
      withFace({
        runs: [
          [65, 1, 2],
          [66, 3],
        ],
      }),
      /sorted/,
    ],
    [
      'unsorted runs',
      withFace({
        runs: [
          [70, 1],
          [65, 3],
        ],
      }),
      /sorted/,
    ],
  ])('rejects %s', (_name, value, message) => {
    expect(() => parseFontMetricsTable(value)).toThrow(message);
  });
});
