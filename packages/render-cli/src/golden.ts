// SPDX-License-Identifier: MIT
/**
 * Golden PNG checks. `exact` (the default) is tolerance-free: same size, same RGBA bytes, as the committed
 * S × overview × light golden under e2e/baselines/render/ is checked. For renders too large to commit as goldens
 * (screenshots, before/after self-checks) `exact: false` compares with pixelmatch and accepts up to
 * `maxDiffPixels` differing pixels. A mismatch leaves the actual image and a picture of the differences in
 * `failureDir` for review; `update` rewrites the golden instead (deliberately: review the diff and say why).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { comparePng, samePixels, type PngDiff } from './compare.js';

export interface GoldenOptions {
  /** Write `actual` as the new golden. */
  readonly update?: boolean;
  /** Tolerance-free (default true); false compares with pixelmatch. */
  readonly exact?: boolean;
  /** With `exact: false`: how many pixels may differ (default 0). */
  readonly maxDiffPixels?: number;
  /** With `exact: false`: pixelmatch's colour threshold, 0–1 (default 0). */
  readonly threshold?: number;
  /** Where a mismatch leaves `<name>.actual.png` and `<name>.diff.png`; nothing is written without it. */
  readonly failureDir?: string;
}

export type GoldenStatus = 'match' | 'mismatch' | 'missing' | 'updated';

export interface GoldenResult {
  readonly status: GoldenStatus;
  /** The pixelmatch comparison (also computed for an exact mismatch, to say how far off it is). */
  readonly diff?: PngDiff;
  /** The files a mismatch left for review. */
  readonly artefacts?: { readonly actual: string; readonly diff?: string };
  readonly message: string;
}

export function checkGolden(actual: Uint8Array, golden: string, options: GoldenOptions = {}): GoldenResult {
  const name = path.basename(golden, '.png');
  if (options.update === true) {
    mkdirSync(path.dirname(golden), { recursive: true });
    writeFileSync(golden, actual);
    return { status: 'updated', message: `${name}: golden written to ${golden}` };
  }
  if (!existsSync(golden)) {
    return {
      status: 'missing',
      message: `${name}: no golden at ${golden}; create it deliberately (update mode)`,
    };
  }
  const expected = readFileSync(golden);
  const exact = options.exact ?? true;
  const maxDiffPixels = exact ? 0 : (options.maxDiffPixels ?? 0);
  if (exact && samePixels(actual, expected)) return { status: 'match', message: `${name}: identical pixels` };
  const diff = comparePng(actual, expected, {
    threshold: exact ? 0 : (options.threshold ?? 0),
    diffImage: options.failureDir !== undefined,
  });
  if (!exact && !diff.sizeMismatch && diff.diffPixels <= maxDiffPixels) {
    return {
      status: 'match',
      diff,
      message: `${name}: ${String(diff.diffPixels)} pixels differ (allowed ${String(maxDiffPixels)})`,
    };
  }
  let artefacts: GoldenResult['artefacts'];
  if (options.failureDir !== undefined) {
    mkdirSync(options.failureDir, { recursive: true });
    const actualFile = path.join(options.failureDir, `${name}.actual.png`);
    writeFileSync(actualFile, actual);
    if (diff.diff === undefined) artefacts = { actual: actualFile };
    else {
      const diffFile = path.join(options.failureDir, `${name}.diff.png`);
      writeFileSync(diffFile, diff.diff);
      artefacts = { actual: actualFile, diff: diffFile };
    }
  }
  const what = diff.sizeMismatch
    ? `size ${String(diff.width)}×${String(diff.height)} differs`
    : exact && diff.diffPixels === 0
      ? 'pixels differ below pixelmatch threshold 0 (alpha or rounding only)'
      : `${String(diff.diffPixels)} of ${String(diff.width * diff.height)} pixels differ` +
        (exact ? ' (tolerance-free)' : ` (allowed ${String(maxDiffPixels)})`);
  return {
    status: 'mismatch',
    diff,
    ...(artefacts === undefined ? {} : { artefacts }),
    message:
      `${name}: ${what} from ${golden}` +
      (artefacts === undefined
        ? ''
        : `; actual ${artefacts.actual}${artefacts.diff === undefined ? '' : `, differences ${artefacts.diff}`}`),
  };
}

/**
 * A text golden (the render golden's draw.io file): the same bytes, nothing else. A mismatch leaves the actual file
 * as `<name>.actual<ext>` in `failureDir` and names the first line and column that differ; `update` rewrites the
 * golden instead.
 */
export function checkTextGolden(
  actual: string,
  golden: string,
  options: Pick<GoldenOptions, 'update' | 'failureDir'> = {},
): GoldenResult {
  const extension = path.extname(golden);
  const name = path.basename(golden, extension);
  if (options.update === true) {
    mkdirSync(path.dirname(golden), { recursive: true });
    writeFileSync(golden, actual);
    return { status: 'updated', message: `${name}: golden written to ${golden}` };
  }
  if (!existsSync(golden)) {
    return {
      status: 'missing',
      message: `${name}: no golden at ${golden}; create it deliberately (update mode)`,
    };
  }
  const expected = readFileSync(golden, 'utf8');
  if (expected === actual) return { status: 'match', message: `${name}: identical bytes` };
  let at = 0;
  while (at < actual.length && actual[at] === expected[at]) at += 1;
  const before = actual.slice(0, at).split('\n');
  const where = `line ${String(before.length)}, column ${String((before[before.length - 1] ?? '').length + 1)}`;
  let artefacts: GoldenResult['artefacts'];
  if (options.failureDir !== undefined) {
    mkdirSync(options.failureDir, { recursive: true });
    const actualFile = path.join(options.failureDir, `${name}.actual${extension}`);
    writeFileSync(actualFile, actual);
    artefacts = { actual: actualFile };
  }
  return {
    status: 'mismatch',
    ...(artefacts === undefined ? {} : { artefacts }),
    message:
      `${name}: differs from ${golden} at ${where}` +
      (artefacts === undefined ? '' : `; actual ${artefacts.actual}`),
  };
}
