// SPDX-License-Identifier: MIT
/**
 * The fonts the rasteriser draws with: the Roboto and Roboto Mono faces the app self-hosts (`@fontsource`, the
 * same package versions the layout's metrics table was generated from, so text drawn here has the advances the
 * layout measured). The packages ship WOFF; the rasteriser loads OpenType, so each face is unwrapped in memory
 * (woff.ts) when the rasteriser starts: nothing is written to disk.
 *
 * Every unicode-range subset of a face carries the same family name, and the rasteriser takes the first loaded
 * face that matches a family and weight, falling back to other faces only for glyphs that one lacks. The Latin
 * subsets therefore come first: otherwise "Roboto Mono" could resolve to its Cyrillic subset. `faceFiles` is the
 * one source of that order; assets.ts keeps it when it copies the faces next to the backend's bundle.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { woffToSfnt } from './woff.js';

const require = createRequire(import.meta.url);

export interface FontFace {
  readonly pkg: '@fontsource/roboto' | '@fontsource/roboto-mono';
  /** File-name prefix inside the package's files/ directory. */
  readonly prefix: string;
  readonly family: string;
  readonly weight: number;
}

/** The faces the diagram uses (the layout's `TEXT_WEIGHTS`, the app's `main.tsx` imports). */
export const FONT_FACES: readonly FontFace[] = [
  { pkg: '@fontsource/roboto', prefix: 'roboto', family: 'Roboto', weight: 400 },
  { pkg: '@fontsource/roboto', prefix: 'roboto', family: 'Roboto', weight: 500 },
  { pkg: '@fontsource/roboto', prefix: 'roboto', family: 'Roboto', weight: 700 },
  { pkg: '@fontsource/roboto-mono', prefix: 'roboto-mono', family: 'Roboto Mono', weight: 400 },
];

/** The font packages, in name order. */
export const FONT_PACKAGES: readonly FontFace['pkg'][] = [
  ...new Set(FONT_FACES.map((face) => face.pkg)),
].sort();

/**
 * An installed package's directory (development, tests and the bundle step; never at run time in the image): the
 * nearest directory above its entry point whose package.json names it (a package's `exports` may hide its
 * package.json).
 */
export function packageDir(pkg: string): string {
  let dir = path.dirname(require.resolve(pkg));
  for (;;) {
    const manifest = path.join(dir, 'package.json');
    if (
      existsSync(manifest) &&
      (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }).name === pkg
    )
      return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`${pkg}: no package directory found`);
    dir = parent;
  }
}

/** The installed version of a package. */
export function packageVersion(pkg: string): string {
  const json = JSON.parse(readFileSync(path.join(packageDir(pkg), 'package.json'), 'utf8')) as unknown;
  const version =
    typeof json === 'object' && json !== null ? (json as { version?: unknown }).version : undefined;
  if (typeof version !== 'string') throw new Error(`${pkg}: package.json has no version`);
  return version;
}

/** The installed version of each font package, to compare with the layout metrics table's `sources`. */
export function fontPackageVersions(): Record<string, string> {
  return Object.fromEntries(FONT_PACKAGES.map((pkg) => [pkg, packageVersion(pkg)]));
}

/** The package's subsets: latin, latin-ext, then the others in code-point order of their names. */
export function subsetsOf(pkg: string): string[] {
  const unicode = JSON.parse(readFileSync(path.join(packageDir(pkg), 'unicode.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  const rank = (name: string): number => (name === 'latin' ? 0 : name === 'latin-ext' ? 1 : 2);
  return Object.keys(unicode).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/** The WOFF files of one face, in loading order (subsets the package does not ship for a weight are skipped). */
export function faceFiles(face: FontFace): string[] {
  const dir = path.join(packageDir(face.pkg), 'files');
  return subsetsOf(face.pkg)
    .map((subset) => path.join(dir, `${face.prefix}-${subset}-${String(face.weight)}-normal.woff`))
    .filter((file) => existsSync(file));
}

/** Every WOFF file of every face, in loading order. */
export function fontFiles(): string[] {
  return FONT_FACES.flatMap(faceFiles);
}

/** WOFF faces unwrapped to OpenType in memory, in the order given. */
export function fontBuffers(woffs: readonly Uint8Array[]): Uint8Array[] {
  return woffs.map((woff) => woffToSfnt(woff));
}
