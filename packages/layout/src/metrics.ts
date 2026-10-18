// SPDX-License-Identifier: Apache-2.0
/**
 * Text measurement from the generated font metrics table (`metrics/roboto.json`, written by
 * `scripts/generate-metrics.ts` from the Roboto and Roboto Mono font files). Text is never measured from the
 * DOM: the same label has the same width in the worker, in Node and in every browser.
 *
 * A width is the sum of the advance widths of the text's code points, without kerning. A code point the
 * table does not know is measured as zero (format and zero-width characters), as one em (East Asian wide
 * and fullwidth characters, which Roboto does not cover) or as the face's average Latin advance (anything
 * else).
 */
import {
  FONT_FACE_KEYS as MODEL_FONT_FACE_KEYS,
  type FontFaceKey,
  type FontFaceMetrics,
  type FontMetricsTable,
} from '@gcportrait/model';
import robotoMetrics from '../metrics/roboto.json' with { type: 'json' };

export type FontFamily = 'sans' | 'mono';
export type FontWeight = 400 | 500 | 700;
export type { FontFaceKey, FontFaceMetrics, FontMetricsTable } from '@gcportrait/model';

export const FONT_FACE_KEYS: readonly FontFaceKey[] = MODEL_FONT_FACE_KEYS;

export interface MeasureOptions {
  /** `sans` (Roboto, default) or `mono` (Roboto Mono, which has one weight: 400 is used for any weight). */
  readonly family?: FontFamily;
  /** The table to measure with; default: the generated Roboto table. */
  readonly metrics?: FontMetricsTable;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function checkFace(key: string, value: unknown): FontFaceMetrics {
  const fail = (what: string): never => {
    throw new Error(`font metrics: face ${key}: ${what}`);
  };
  if (!isRecord(value)) return fail('not an object');
  const { family, weight, unitsPerEm, ascent, descent, lineGap, fallback, runs } = value;
  if (typeof family !== 'string' || family === '') fail('family must be a non-empty string');
  if (!isCount(weight)) fail('weight must be a whole number');
  if (!isCount(unitsPerEm) || unitsPerEm === 0) fail('unitsPerEm must be a positive whole number');
  for (const [name, metric] of [
    ['ascent', ascent],
    ['descent', descent],
    ['lineGap', lineGap],
    ['fallback', fallback],
  ] as const) {
    if (!isCount(metric)) fail(`${name} must be a non-negative whole number`);
  }
  if (!Array.isArray(runs)) return fail('runs must be an array');
  let next = 0;
  for (const run of runs) {
    if (!Array.isArray(run) || run.length < 2 || !run.every(isCount)) {
      fail('every run is [first code point, advance, …] of non-negative whole numbers');
    }
    const first = (run as number[])[0] ?? 0;
    if (first < next) fail('runs must be sorted and must not overlap');
    next = first + (run as number[]).length - 1;
  }
  return value as unknown as FontFaceMetrics;
}

/** Validates a metrics table (the generated JSON, or one passed in `LayoutOptions.fontMetrics`). */
export function parseFontMetricsTable(value: unknown): FontMetricsTable {
  if (!isRecord(value)) throw new Error('font metrics: not an object');
  if (value.format !== 1) throw new Error('font metrics: unknown format (expected 1)');
  const { sources, faces } = value;
  if (!isRecord(sources) || !Object.values(sources).every((v) => typeof v === 'string')) {
    throw new Error('font metrics: sources must map package names to versions');
  }
  if (!isRecord(faces)) throw new Error('font metrics: faces must be an object');
  for (const key of FONT_FACE_KEYS) checkFace(key, faces[key]);
  return value as unknown as FontMetricsTable;
}

/** The generated Roboto table, validated once on first use. */
let defaultTable: FontMetricsTable | undefined;
export function defaultFontMetrics(): FontMetricsTable {
  defaultTable ??= parseFontMetricsTable(robotoMetrics);
  return defaultTable;
}

/** Code points below this bound are looked up in a flat array; the rest in a map. */
const DIRECT_LIMIT = 0x0800;

interface FaceLookup {
  readonly direct: Int32Array;
  readonly sparse: ReadonlyMap<number, number>;
  readonly fallback: number;
  readonly unitsPerEm: number;
}

function buildLookup(face: FontFaceMetrics): FaceLookup {
  const direct = new Int32Array(DIRECT_LIMIT).fill(-1);
  const sparse = new Map<number, number>();
  for (const run of face.runs) {
    const first = run[0] ?? 0;
    for (let i = 1; i < run.length; i += 1) {
      const codePoint = first + i - 1;
      const advance = run[i] ?? 0;
      if (codePoint < DIRECT_LIMIT) direct[codePoint] = advance;
      else sparse.set(codePoint, advance);
    }
  }
  return { direct, sparse, fallback: face.fallback, unitsPerEm: face.unitsPerEm };
}

const lookups = new WeakMap<FontMetricsTable, Map<FontFaceKey, FaceLookup>>();

function lookupFor(table: FontMetricsTable, key: FontFaceKey): FaceLookup {
  let perTable = lookups.get(table);
  if (perTable === undefined) {
    perTable = new Map();
    lookups.set(table, perTable);
  }
  let lookup = perTable.get(key);
  if (lookup === undefined) {
    lookup = buildLookup(table.faces[key]);
    perTable.set(key, lookup);
  }
  return lookup;
}

/** Format and zero-width characters: no advance when the font does not list them. */
function isZeroWidth(codePoint: number): boolean {
  return (
    codePoint < 0x20 ||
    (codePoint >= 0x7f && codePoint < 0xa0) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x2060 && codePoint <= 0x2064) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    codePoint === 0xfeff ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  );
}

/** East Asian wide and fullwidth characters: one em when the font does not list them. */
function isWide(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

/** The face a family and weight resolve to. Roboto Mono ships one weight. */
export function fontFaceKey(weight: FontWeight, family: FontFamily = 'sans'): FontFaceKey {
  if (family === 'mono') return 'mono-400';
  return `sans-${String(weight)}` as FontFaceKey;
}

/** The advance width of `text` in font units of the face (no kerning). */
function advanceUnits(text: string, lookup: FaceLookup): number {
  let units = 0;
  for (let i = 0; i < text.length; i += 1) {
    const codePoint = text.codePointAt(i) ?? 0;
    if (codePoint > 0xffff) i += 1;
    let advance = codePoint < DIRECT_LIMIT ? (lookup.direct[codePoint] ?? -1) : -1;
    if (advance < 0) advance = lookup.sparse.get(codePoint) ?? -1;
    if (advance < 0) {
      if (isZeroWidth(codePoint)) advance = 0;
      else if (isWide(codePoint)) advance = lookup.unitsPerEm;
      else advance = lookup.fallback;
    }
    units += advance;
  }
  return units;
}

/**
 * The width in px of `text` set in Roboto (or Roboto Mono) at `weight` and `size` px, from the metrics
 * table. Not rounded; callers that place boxes round up.
 */
export function measureText(
  text: string,
  weight: FontWeight,
  size: number,
  options: MeasureOptions = {},
): number {
  const table = options.metrics ?? defaultFontMetrics();
  const lookup = lookupFor(table, fontFaceKey(weight, options.family));
  return (advanceUnits(text, lookup) * size) / lookup.unitsPerEm;
}
