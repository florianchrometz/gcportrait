// SPDX-License-Identifier: Apache-2.0
/**
 * Builds the font metrics table (`metrics/roboto.json`) from the Roboto and Roboto Mono font files the
 * frontend self-hosts (`@fontsource/roboto`, `@fontsource/roboto-mono`, installed in frontend/). Shared by
 * the generator (`pnpm --filter @gcportrait/layout metrics`), its staleness test and the debug renderer.
 *
 * The fontsource packages split each face into unicode-range subsets (latin, latin-ext, greek, …), one WOFF
 * file per subset and weight, and their CSS declares the subsets in the order of `unicode.json`. A browser
 * checks the last declared face first, so a code point claimed by several subsets is taken from the subset
 * declared last; a subset only contributes the code points inside its own unicode-range.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as prettier from 'prettier';
import type { FontFaceKey, FontFaceMetrics, FontMetricsTable } from '../../src/index.js';

type OpenType = typeof import('opentype.js');
const opentype = createRequire(import.meta.url)('opentype.js') as OpenType;

export const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
export const METRICS_PATH = path.resolve(import.meta.dirname, '../../metrics/roboto.json');

interface FaceSource {
  readonly key: FontFaceKey;
  readonly pkg: '@fontsource/roboto' | '@fontsource/roboto-mono';
  readonly filePrefix: string;
  readonly family: string;
  readonly weight: number;
}

const FACE_SOURCES: readonly FaceSource[] = [
  { key: 'sans-400', pkg: '@fontsource/roboto', filePrefix: 'roboto', family: 'Roboto', weight: 400 },
  { key: 'sans-500', pkg: '@fontsource/roboto', filePrefix: 'roboto', family: 'Roboto', weight: 500 },
  { key: 'sans-700', pkg: '@fontsource/roboto', filePrefix: 'roboto', family: 'Roboto', weight: 700 },
  {
    key: 'mono-400',
    pkg: '@fontsource/roboto-mono',
    filePrefix: 'roboto-mono',
    family: 'Roboto Mono',
    weight: 400,
  },
];

/** The installed fontsource package's directory, resolved the way the frontend resolves it. */
export function fontPackageDir(pkg: string): string {
  const require = createRequire(path.join(REPO_ROOT, 'frontend/package.json'));
  return path.dirname(require.resolve(`${pkg}/package.json`));
}

function packageVersion(pkg: string): string {
  const json = JSON.parse(readFileSync(path.join(fontPackageDir(pkg), 'package.json'), 'utf8')) as {
    version?: unknown;
  };
  if (typeof json.version !== 'string') throw new Error(`${pkg}: package.json has no version`);
  return json.version;
}

/** Parses a CSS unicode-range list ("U+0000-00FF,U+0131,U+4??") into inclusive [from, to] ranges. */
export function parseUnicodeRange(list: string): [number, number][] {
  return list.split(',').map((item) => {
    const match = /^U\+([0-9A-F?]+)(?:-([0-9A-F]+))?$/i.exec(item.trim());
    if (match === null) throw new Error(`unicode-range: cannot read "${item}"`);
    const [, start = '', end] = match;
    if (start.includes('?')) {
      return [parseInt(start.replaceAll('?', '0'), 16), parseInt(start.replaceAll('?', 'F'), 16)];
    }
    const from = parseInt(start, 16);
    return [from, end === undefined ? from : parseInt(end, 16)];
  });
}

interface Subset {
  readonly name: string;
  readonly ranges: readonly [number, number][];
}

/** The package's subsets, in the order a browser checks them (the last declared first). */
function subsetsOf(pkg: string): Subset[] {
  const unicode = JSON.parse(readFileSync(path.join(fontPackageDir(pkg), 'unicode.json'), 'utf8')) as Record<
    string,
    string
  >;
  return Object.entries(unicode)
    .map(([name, list]) => ({ name, ranges: parseUnicodeRange(list) }))
    .reverse();
}

/** The WOFF file of one subset of a face, or undefined when the package does not ship that subset. */
export function subsetFile(
  source: { pkg: string; filePrefix: string; weight: number },
  subset: string,
): string {
  return path.join(
    fontPackageDir(source.pkg),
    'files',
    `${source.filePrefix}-${subset}-${String(source.weight)}-normal.woff`,
  );
}

function readFont(file: string): ReturnType<OpenType['parse']> {
  const bytes = readFileSync(file);
  return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

interface HorizontalHeader {
  readonly ascender: number;
  readonly descender: number;
  readonly lineGap: number;
}

function faceMetrics(source: FaceSource): FontFaceMetrics {
  const advances = new Map<number, number>();
  let header: HorizontalHeader | undefined;
  let unitsPerEm: number | undefined;
  for (const subset of subsetsOf(source.pkg)) {
    let font: ReturnType<OpenType['parse']>;
    try {
      font = readFont(subsetFile(source, subset.name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    const hhea = font.tables.hhea as unknown as HorizontalHeader;
    header ??= { ascender: hhea.ascender, descender: hhea.descender, lineGap: hhea.lineGap };
    unitsPerEm ??= font.unitsPerEm;
    if (font.unitsPerEm !== unitsPerEm) throw new Error(`${source.key}: subsets disagree on unitsPerEm`);
    const cmap = (font.tables.cmap as unknown as { glyphIndexMap: Record<string, number> }).glyphIndexMap;
    for (const [codePointText, glyphIndex] of Object.entries(cmap)) {
      const codePoint = Number(codePointText);
      if (advances.has(codePoint)) continue;
      if (!subset.ranges.some(([from, to]) => codePoint >= from && codePoint <= to)) continue;
      const advance = font.glyphs.get(glyphIndex).advanceWidth;
      if (advance === undefined || !Number.isInteger(advance) || advance < 0) {
        throw new Error(`${source.key}: U+${codePoint.toString(16)} has no usable advance width`);
      }
      advances.set(codePoint, advance);
    }
  }
  if (header === undefined || unitsPerEm === undefined) throw new Error(`${source.key}: no font files found`);
  const codePoints = [...advances.keys()].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const codePoint of codePoints) {
    const advance = advances.get(codePoint) ?? 0;
    const last = runs.at(-1);
    if (last !== undefined && (last[0] ?? 0) + last.length - 1 === codePoint) last.push(advance);
    else runs.push([codePoint, advance]);
  }
  // The fallback for unknown code points: the plain average advance of printable ASCII (no kerning).
  let sum = 0;
  let count = 0;
  for (let codePoint = 0x21; codePoint <= 0x7e; codePoint += 1) {
    const advance = advances.get(codePoint);
    if (advance === undefined) continue;
    sum += advance;
    count += 1;
  }
  if (count === 0) throw new Error(`${source.key}: no printable ASCII glyphs`);
  return {
    family: source.family,
    weight: source.weight,
    unitsPerEm,
    ascent: header.ascender,
    descent: -header.descender,
    lineGap: header.lineGap,
    fallback: Math.round(sum / count),
    runs,
  };
}

/** The whole table, built from the installed font files. Deterministic: same files, same table. */
export function buildMetricsTable(): FontMetricsTable {
  const faces = Object.fromEntries(FACE_SOURCES.map((source) => [source.key, faceMetrics(source)])) as Record<
    FontFaceKey,
    FontFaceMetrics
  >;
  const sources = Object.fromEntries(
    [...new Set(FACE_SOURCES.map((source) => source.pkg))].map((pkg) => [pkg, packageVersion(pkg)]),
  );
  return { format: 1, sources, faces };
}

/** The table as committed: JSON formatted by the repository's Prettier settings. */
export async function formatMetricsTable(table: FontMetricsTable): Promise<string> {
  const config = (await prettier.resolveConfig(METRICS_PATH)) ?? {};
  return prettier.format(JSON.stringify(table), { ...config, filepath: METRICS_PATH });
}

/** Every WOFF file of a face, in the order the generator reads them (for the debug renderer's fonts). */
export function faceFiles(key: FontFaceKey): string[] {
  const source = FACE_SOURCES.find((candidate) => candidate.key === key);
  if (source === undefined) throw new Error(`unknown face ${key}`);
  return subsetsOf(source.pkg).map((subset) => subsetFile(source, subset.name));
}
