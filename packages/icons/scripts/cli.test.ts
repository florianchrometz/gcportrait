// SPDX-License-Identifier: MIT
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { archiveFileName } from './lib/archives.mjs';
import { loadMapping } from './lib/mapping.mjs';
import { svgZip } from './test-zip.js';

const run = (script: string, ...args: string[]) =>
  spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args], {
    encoding: 'utf8',
  });

describe('build.mjs', () => {
  it('--check finds the committed module up to date', () => {
    const result = run('./build.mjs', '--check');
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('is up to date');
    expect(result.status).toBe(0);
  });

  it('refuses unknown options with exit code 2', () => {
    expect(run('./build.mjs', '--frobnicate').status).toBe(2);
  });
});

describe('vendor.mjs', () => {
  it('refuses unknown options and malformed dates with exit code 2, before any download', () => {
    expect(run('./vendor.mjs', '--frobnicate').status).toBe(2);
    const badDate = run('./vendor.mjs', '--check', '--date', '9 October');
    expect(badDate.status).toBe(2);
    expect(badDate.stderr).toContain('--date must be YYYY-MM-DD');
  });

  it('fails cleanly when a ZIP file is missing from --zips', () => {
    const result = run(
      './vendor.mjs',
      '--check',
      '--zips',
      fileURLToPath(new URL('./no-such-dir', import.meta.url)),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('vendor: FAILED');
  });
});

describe('drift.mjs', () => {
  const work = mkdtempSync(path.join(tmpdir(), 'gcportrait-icon-drift-test-'));
  afterAll(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it('refuses unknown options, and --offline without --zips, with exit code 2', () => {
    expect(run('./drift.mjs', '--frobnicate').status).toBe(2);
    const offline = run('./drift.mjs', '--offline');
    expect(offline.status).toBe(2);
    expect(offline.stderr).toContain('--offline needs --zips');
  });

  it('reports drift (exit 1) for synthetic archives offline, and writes the Markdown and JSON reports', () => {
    // Synthetic archives under the real file names: none of the vendored entries is in them, so every mapped
    // entry is missing and every indexed one removed. No network is touched (--offline).
    const zips = path.join(work, 'zips');
    mkdirSync(zips);
    const mapping = loadMapping();
    for (const set of ['core', 'legacy', 'category'] as const) {
      const target = path.join(zips, archiveFileName(mapping.sources[set].url));
      writeFileSync(
        target,
        svgZip({
          [`Synthetic/${set}/SVG/Synthetic-512-color.svg`]: '<svg xmlns="http://www.w3.org/2000/svg"/>',
        }),
      );
    }
    const page = path.join(work, 'icons.html');
    writeFileSync(page, mapping.sources.core.url);
    const markdown = path.join(work, 'report.md');
    const json = path.join(work, 'report.json');
    const result = run(
      './drift.mjs',
      '--offline',
      '--zips',
      zips,
      '--page',
      page,
      '--markdown',
      markdown,
      '--json',
      json,
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('GONE LINK');
    expect(result.stdout).toContain('REMOVED');
    expect(result.stdout).toContain('MISSING mapped core entry');
    expect(result.stdout).toMatch(/^icon drift: \d+ new, /m);
    expect(readFileSync(markdown, 'utf8')).toContain('### Removed icons');
    const report = JSON.parse(readFileSync(json, 'utf8')) as { drift: boolean; digest: string };
    expect(report.drift).toBe(true);
    expect(report.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('counts archives missing from --zips as unavailable (exit 1), and keeps nothing behind', () => {
    const empty = mkdtempSync(path.join(work, 'empty-'));
    const result = run('./drift.mjs', '--offline', '--zips', empty);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('UNAVAILABLE');
    expect(result.stdout).toContain('page https://cloud.google.com/icons: not checked');
    expect(existsSync(path.join(empty, 'core-products-icons.zip'))).toBe(false);
  });
});
