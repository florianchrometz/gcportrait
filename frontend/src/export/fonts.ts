// SPDX-License-Identifier: Apache-2.0
/**
 * The "embed fonts" option (skill gcp-diagram-style §8): the Roboto faces the diagram uses (Roboto 400, 500 and
 * 700, Roboto Mono 400), latin subset, as `@font-face` rules with `data:` URIs. Off by default for SVG files
 * (the file then names the font stack only); always on for the PNG, because an SVG drawn as an image cannot use
 * the page's fonts and would fall back to a system font whose widths the layout did not measure.
 *
 * The files are the app's own self-hosted fontsource files (OFL-1.1, shipped with their licence in
 * `dist/licenses/`), fetched from the app's origin when an export first needs them and kept for the session.
 */
import robotoMono400 from '@fontsource/roboto-mono/files/roboto-mono-latin-400-normal.woff2?url';
import roboto400 from '@fontsource/roboto/files/roboto-latin-400-normal.woff2?url';
import roboto500 from '@fontsource/roboto/files/roboto-latin-500-normal.woff2?url';
import roboto700 from '@fontsource/roboto/files/roboto-latin-700-normal.woff2?url';

export interface EmbeddedFace {
  readonly family: 'Roboto' | 'Roboto Mono';
  readonly weight: 400 | 500 | 700;
  /** The woff2 file, as the bundler serves it. */
  readonly url: string;
}

export const EMBEDDED_FACES: readonly EmbeddedFace[] = [
  { family: 'Roboto', weight: 400, url: roboto400 },
  { family: 'Roboto', weight: 500, url: roboto500 },
  { family: 'Roboto', weight: 700, url: roboto700 },
  { family: 'Roboto Mono', weight: 400, url: robotoMono400 },
];

/** Reads a font file and returns it as a `data:` URI. */
export type FontFileLoader = (url: string) => Promise<string>;

function blobAsDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('The font file could not be read.'));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('The font file could not be read.'));
    };
    reader.readAsDataURL(blob);
  });
}

/** The browser's loader: the file from the app's origin, typed `font/woff2`. */
export async function fetchFontFile(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`The font file ${url} could not be loaded (HTTP ${String(response.status)}).`);
  return blobAsDataUri(new Blob([await response.arrayBuffer()], { type: 'font/woff2' }));
}

/** The `@font-face` rules for the embedded faces, one per line. */
export async function fontFaceCss(load: FontFileLoader): Promise<string> {
  const sources = await Promise.all(EMBEDDED_FACES.map((face) => load(face.url)));
  return EMBEDDED_FACES.map(
    (face, index) =>
      `@font-face { font-family: '${face.family}'; font-style: normal; font-weight: ${String(face.weight)}; ` +
      `src: url(${sources[index] ?? ''}) format('woff2'); }`,
  ).join('\n');
}

let cached: Promise<string> | null = null;

/** The rules with the browser's loader, fetched once per session (a failed fetch is retried next time). */
export function sessionFontFaceCss(): Promise<string> {
  if (cached === null) {
    const pending = fontFaceCss(fetchFontFile);
    cached = pending;
    pending.catch(() => {
      if (cached === pending) cached = null;
    });
  }
  return cached;
}
