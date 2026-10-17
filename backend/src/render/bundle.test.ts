// SPDX-License-Identifier: MIT
/**
 * The production bundles (bundle.ts): written into a temporary directory, the render worker draws a demo view
 * to the committed goldens' bytes (the PNG and the `.drawio` file) from its own asset directory, with no
 * node_modules involved, and `server.mjs` holds none of the render library: no React, no resvg, no frontend
 * component, no native addon. Neither carries a file of the tests, nor a zod locale but the English one. The
 * licence file names the files each package ships in, lists each exactly pinned package at the version
 * installed and carries the MPL-2.0 text, and the notices script's table of the asset directory's packages
 * (scripts/third-party-notices.mjs) matches the directory the bundle writes.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { RenderOptionsSchema } from '@gcportrait/model';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { workerRunner } from './runner.js';

const BACKEND_ROOT = path.resolve(import.meta.dirname, '../..');
const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');
const GOLDEN = path.resolve(REPO_ROOT, 'e2e/baselines/render/S-overview-auto-light.png');
const DRAWIO_GOLDEN = path.resolve(REPO_ROOT, 'e2e/baselines/render/S-overview-auto-light.drawio');
const out = mkdtempSync(path.join(tmpdir(), 'gcportrait-bundle-'));

beforeAll(() => {
  const tsx = createRequire(import.meta.url).resolve('tsx/cli');
  const result = spawnSync(process.execPath, [tsx, 'bundle.ts', '--outdir', out], {
    cwd: BACKEND_ROOT,
    encoding: 'utf8',
    timeout: 180_000,
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/^bundle: .*server\.mjs .*render-worker\.mjs .*render-assets\//);
}, 180_000);

afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

/** The part of scripts/lib/dependency-versions.mjs this test uses (repository tooling, loaded by its path). */
interface DependencyVersions {
  readonly exactPin: (root: string, workspace: string, name: string) => string;
}

const versions = (await import(
  pathToFileURL(path.join(REPO_ROOT, 'scripts/lib/dependency-versions.mjs')).href
)) as DependencyVersions;

/**
 * The version of `name` installed for the workspace package that declares it (the lockfile's), read from the
 * package's own package.json, after checking that the declaration pins exactly that version: it throws what
 * is wrong otherwise.
 */
function exactPin(workspace: string, name: string): string {
  return versions.exactPin(REPO_ROOT, workspace, name);
}

describe('the bundles', () => {
  it('draw demo S overview in the bundled worker to the golden’s bytes, from the bundled assets', async () => {
    const run = workerRunner({
      source: {
        url: pathToFileURL(path.join(out, 'render-worker.mjs')),
        assetDir: path.join(out, 'render-assets'),
      },
    })({
      source: { kind: 'demo', size: 'S' },
      options: RenderOptionsSchema.parse({}),
      maxAssets: 60_000,
      maxPixels: 2 ** 26,
    });
    const result = await run.end();
    expect(result).toMatchObject({
      contentType: 'image/png',
      viewHash: 'snapshot=demo:S',
      scale: 2,
      assets: 96,
    });
    expect(Buffer.from(result.bytes).equals(readFileSync(GOLDEN))).toBe(true);
  }, 120_000);

  it('draw demo S overview as a `.drawio` file in the bundled worker: the golden with the instance’s version', async () => {
    const run = workerRunner({
      source: {
        url: pathToFileURL(path.join(out, 'render-worker.mjs')),
        assetDir: path.join(out, 'render-assets'),
      },
    })({
      source: { kind: 'demo', size: 'S' },
      options: RenderOptionsSchema.parse({ format: 'drawio' }),
      maxAssets: 60_000,
      maxPixels: 2 ** 26,
      version: '1.2.3',
    });
    const result = await run.end();
    expect(result).toMatchObject({ contentType: 'application/vnd.jgraph.mxfile', assets: 96 });
    expect(new TextDecoder().decode(result.bytes)).toBe(
      readFileSync(DRAWIO_GOLDEN, 'utf8').replace(' agent="gcportrait" ', ' agent="gcportrait 1.2.3" '),
    );
  }, 120_000);

  it('keep the render library out of server.mjs, and every native addon out of both', () => {
    const server = readFileSync(path.join(out, 'server.mjs'), 'utf8');
    const map = readFileSync(path.join(out, 'server.mjs.map'), 'utf8');
    for (const marker of ['renderToStaticMarkup', 'initWasm', 'resvg', 'react-dom'])
      expect(server, marker).not.toContain(marker);
    for (const source of ['packages/render/', 'frontend/src/', 'node_modules/react'])
      expect(map, source).not.toContain(source);
    // The worker's location is the build-time define, next to server.mjs.
    expect(server).toContain('"./render-worker.mjs"');
    expect(server).toContain('"./render-assets/"');
    const worker = readFileSync(path.join(out, 'render-worker.mjs'), 'utf8');
    expect(worker).toContain('renderToStaticMarkup');
    expect(worker).not.toMatch(/require\([^)]*\.node["']\)/);
    const manifest = JSON.parse(readFileSync(path.join(out, 'render-assets/manifest.json'), 'utf8')) as {
      fonts: string[];
      licenses: string[];
    };
    expect(manifest.fonts.every((font) => existsSync(path.join(out, 'render-assets', font)))).toBe(true);
  });

  it('carry no file of the tests: no test, no `*.testing.ts` helper, no package’s `testing` export', () => {
    // Nothing the entry points reach imports them, which is all that keeps them out.
    for (const bundle of ['server.mjs', 'render-worker.mjs']) {
      const { sources } = JSON.parse(readFileSync(path.join(out, `${bundle}.map`), 'utf8')) as {
        sources: string[];
      };
      const entry = bundle === 'server.mjs' ? 'backend/src/main.ts' : 'backend/src/render/worker.ts';
      expect(
        sources.some((source) => source.endsWith(entry)),
        bundle,
      ).toBe(true);
      expect(
        sources.filter((source) => /\.test\.tsx?$|\.testing\.tsx?$|\/src\/testing\//.test(source)),
        bundle,
      ).toEqual([]);
    }
  });

  it('keep zod’s locales out of both, but the English one its messages use', () => {
    // zod imported as a namespace (eslint.config.js); a named or default `z` anywhere keeps every locale.
    for (const bundle of ['server.mjs', 'render-worker.mjs']) {
      const map = readFileSync(path.join(out, `${bundle}.map`), 'utf8');
      const locales = new Set(
        [...map.matchAll(/node_modules\/zod\/v4\/locales\/([\w-]+)\.js/g)].map((match) => match[1]),
      );
      expect(locales.has('en'), bundle).toBe(true);
      expect(
        [...locales].filter((locale) => locale !== 'en' && locale !== 'index'),
        bundle,
      ).toEqual([]);
    }
  });

  it('name the files each package ships in, and carry the MPL-2.0 text for resvg-wasm', () => {
    const licences = readFileSync(path.join(out, 'licenses/server-dependencies.txt'), 'utf8');
    const resvg = exactPin('packages/render', '@resvg/resvg-wasm');
    expect(licences).toContain(
      `- @resvg/resvg-wasm@${resvg} (MPL-2.0): render-worker.mjs, render-assets/resvg.wasm\n`,
    );
    expect(licences).toMatch(/\n- @fontsource\/roboto@[\d.]+ \(OFL-1\.1\): render-assets\/fonts\/\n/);
    expect(licences).toMatch(/\n- react-dom@[\d.]+ \(MIT\): render-worker\.mjs\n/);
    expect(licences).toContain(`- fflate@${exactPin('frontend', 'fflate')} (MIT): render-worker.mjs\n`);
    expect(licences).toContain(
      `- @fastify/multipart@${exactPin('backend', '@fastify/multipart')} (MIT): server.mjs\n`,
    );
    expect(licences).toMatch(/\n- zod@[\d.]+ \(MIT\): server\.mjs, render-worker\.mjs\n/);
    expect(licences).not.toMatch(/ render\/|resvg-wasm@[\d.]+ \(MPL-2\.0\): server\.mjs/);
    // MPL-2.0 sections 3.2 and 3.3 in its section, and the canonical text (scripts/licenses/) once, at the end.
    expect(licences).toContain(
      `Code Form is available at https://registry.npmjs.org/@resvg/resvg-wasm/-/resvg-wasm-${resvg}.tgz.`,
    );
    const mpl = readFileSync(path.join(REPO_ROOT, 'scripts/licenses/MPL-2.0.txt'), 'utf8').trimEnd();
    expect(licences.split(mpl)).toHaveLength(2);
    expect(licences.trimEnd().endsWith(mpl)).toBe(true);
  });

  it('match the asset directory the notices script names for THIRD_PARTY_NOTICES.txt', async () => {
    const script = pathToFileURL(path.join(REPO_ROOT, 'scripts/third-party-notices.mjs')).href;
    const { RENDER_ASSET_FILES } = (await import(script)) as {
      RENDER_ASSET_FILES: Readonly<Record<string, { files: string; code: boolean }>>;
    };
    const manifest = JSON.parse(readFileSync(path.join(out, 'render-assets/manifest.json'), 'utf8')) as {
      wasm: string;
      fonts: string[];
      packages: Record<string, string>;
    };
    expect(Object.keys(RENDER_ASSET_FILES).sort()).toEqual(Object.keys(manifest.packages).sort());
    for (const [name, asset] of Object.entries(RENDER_ASSET_FILES)) {
      const shipped = asset.files.replace(/^backend\/dist\/render-assets\//, '');
      if (name === '@resvg/resvg-wasm') expect(shipped).toBe(manifest.wasm);
      else expect(manifest.fonts.every((font) => font.startsWith(shipped))).toBe(true);
      // Its code is in the worker exactly when the table says so.
      const map = readFileSync(path.join(out, 'render-worker.mjs.map'), 'utf8');
      expect(map.includes(`node_modules/${name}/`), name).toBe(asset.code);
    }
  });
});
