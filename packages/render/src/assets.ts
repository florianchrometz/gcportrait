// SPDX-License-Identifier: MIT
/**
 * What the rasteriser needs besides code: resvg's WebAssembly module (`@resvg/resvg-wasm`, used unmodified) and the
 * Roboto faces in their loading order (fonts.ts). In development and tests they come from the installed packages
 * (`packageAssets`); the backend's bundle step copies them into a directory next to the bundle with `writeAssetDir`,
 * and the render worker in the image, which has no node_modules, reads that directory back with `readAssetDir`. One
 * function writes the order and one reads it, so the bundle draws with the faces in the order the CLI uses.
 *
 * The directory: `resvg.wasm`, `fonts/NN-<face>.woff` (the packages' files, unmodified), the packages' licence
 * files under `licenses/`, and `manifest.json`, which lists the fonts in loading order and the package versions.
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { FONT_PACKAGES, fontFiles, packageDir, packageVersion } from './fonts.js';

const require = createRequire(import.meta.url);

export const RESVG_WASM_PACKAGE = '@resvg/resvg-wasm';

/** The bytes the rasteriser starts from. */
export interface RenderAssets {
  /** resvg's WebAssembly module (`index_bg.wasm`). */
  readonly wasm: Uint8Array;
  /** The faces as WOFF files, in loading order (Latin subsets first). */
  readonly fonts: readonly Uint8Array[];
}

/** The asset directory's `manifest.json`. */
export interface AssetManifest {
  readonly wasm: string;
  /** Font files relative to the directory, in loading order. */
  readonly fonts: readonly string[];
  /** Package name → version of everything copied. */
  readonly packages: Readonly<Record<string, string>>;
  /** Licence files relative to the directory. */
  readonly licenses: readonly string[];
}

export const ASSET_MANIFEST = 'manifest.json';
const WASM_FILE = 'resvg.wasm';
const LICENCE_FILE_NAME = /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i;

function wasmPath(): string {
  return require.resolve(`${RESVG_WASM_PACKAGE}/index_bg.wasm`);
}

/** The installed packages the asset directory copies from (the bundle step lists their licences). */
export function assetPackageDirs(): string[] {
  return [RESVG_WASM_PACKAGE, ...FONT_PACKAGES].map(packageDir);
}

/** The assets from the installed packages (development, tests, `pnpm render`). */
export function packageAssets(): RenderAssets {
  return {
    wasm: new Uint8Array(readFileSync(wasmPath())),
    fonts: fontFiles().map((file) => new Uint8Array(readFileSync(file))),
  };
}

/** Copies the assets into `dir` (created when missing) and returns its manifest. */
export function writeAssetDir(dir: string): AssetManifest {
  mkdirSync(path.join(dir, 'fonts'), { recursive: true });
  mkdirSync(path.join(dir, 'licenses'), { recursive: true });
  copyFileSync(wasmPath(), path.join(dir, WASM_FILE));
  const width = String(fontFiles().length).length;
  const fonts = fontFiles().map((file, index) => {
    const name = `fonts/${String(index).padStart(width, '0')}-${path.basename(file)}`;
    copyFileSync(file, path.join(dir, name));
    return name;
  });
  const packages = [RESVG_WASM_PACKAGE, ...FONT_PACKAGES];
  const licenses: string[] = [];
  for (const pkg of packages) {
    const source = packageDir(pkg);
    for (const file of readdirSync(source).filter((name) => LICENCE_FILE_NAME.test(name))) {
      const name = `licenses/${pkg.replace('/', '__')}-${file}`;
      copyFileSync(path.join(source, file), path.join(dir, name));
      licenses.push(name);
    }
  }
  const manifest: AssetManifest = {
    wasm: WASM_FILE,
    fonts,
    packages: Object.fromEntries(packages.map((pkg) => [pkg, packageVersion(pkg)])),
    licenses,
  };
  writeFileSync(path.join(dir, ASSET_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function isManifest(value: unknown): value is AssetManifest {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['wasm'] === 'string' &&
    Array.isArray(record['fonts']) &&
    record['fonts'].every((name) => typeof name === 'string')
  );
}

/** Reads a directory {@link writeAssetDir} wrote. */
export function readAssetDir(dir: string): RenderAssets {
  const manifest: unknown = JSON.parse(readFileSync(path.join(dir, ASSET_MANIFEST), 'utf8'));
  if (!isManifest(manifest))
    throw new Error(`${path.join(dir, ASSET_MANIFEST)}: not a render asset manifest`);
  return {
    wasm: new Uint8Array(readFileSync(path.join(dir, manifest.wasm))),
    fonts: manifest.fonts.map((name) => new Uint8Array(readFileSync(path.join(dir, name)))),
  };
}
