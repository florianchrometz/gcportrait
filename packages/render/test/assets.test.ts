// SPDX-License-Identifier: MIT
/**
 * The asset directory the backend's bundle ships (ADR 0033): written and read back by the same module, it holds the
 * packages' own bytes in the loading order of the fonts, so the bundle draws with what `pnpm render` draws with.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  ASSET_MANIFEST,
  fontFiles,
  fontPackageVersions,
  packageAssets,
  readAssetDir,
  writeAssetDir,
} from '../src/index.js';

const dir = mkdtempSync(path.join(tmpdir(), 'gcportrait-render-assets-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the asset directory', () => {
  it('holds the wasm module and the faces unmodified, in loading order, with their licences', () => {
    const manifest = writeAssetDir(dir);
    expect(manifest.wasm).toBe('resvg.wasm');
    expect(manifest.fonts).toHaveLength(fontFiles().length);
    expect(manifest.fonts[0]).toMatch(/^fonts\/0+-roboto-latin-400-normal\.woff$/);
    expect(manifest.packages).toEqual({ '@resvg/resvg-wasm': '2.6.2', ...fontPackageVersions() });
    // The OFL-1.1 fonts travel with their licence (ADR 0019); resvg-wasm ships none of its own.
    expect(manifest.licenses.some((name) => name.includes('fontsource__roboto-'))).toBe(true);
    for (const name of manifest.licenses) expect(existsSync(path.join(dir, name))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(dir, ASSET_MANIFEST), 'utf8'))).toEqual(manifest);

    const fromDir = readAssetDir(dir);
    const fromPackages = packageAssets();
    expect(Buffer.from(fromDir.wasm).equals(Buffer.from(fromPackages.wasm))).toBe(true);
    expect(fromDir.wasm.subarray(0, 4)).toEqual(new Uint8Array([0x00, 0x61, 0x73, 0x6d]));
    expect(fromDir.fonts.map((bytes) => Buffer.from(bytes).toString('base64'))).toEqual(
      fromPackages.fonts.map((bytes) => Buffer.from(bytes).toString('base64')),
    );
  });

  it('refuses a directory without a manifest of its own', () => {
    expect(() => readAssetDir(path.join(dir, 'fonts'))).toThrow();
  });
});
