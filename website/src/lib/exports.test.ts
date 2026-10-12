// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  diagramsNetLink,
  exportSamples,
  formatBytes,
  parseExportsManifest,
  sampleExport,
  sampleExports,
  type ExportsManifest,
} from './exports.js';

const REPO = path.resolve(import.meta.dirname, '..', '..', '..');
const MANIFEST = path.join(REPO, 'docs', 'media', 'exports', 'manifest.json');

function committed(): unknown {
  return JSON.parse(readFileSync(MANIFEST, 'utf8')) as unknown;
}

/** A manifest of one sample in both themes. */
function oneSample(): ExportsManifest {
  const files = (['light', 'dark'] as const).flatMap((theme) =>
    [
      { format: 'png', file: `S-overview-${theme}.png`, width: 4794, height: 2812, bytes: 742_928 },
      { format: 'svg', file: `S-overview-${theme}.svg`, width: 2349, height: 1358, bytes: 77_617 },
      { format: 'drawio', file: `S-overview-${theme}.drawio`, width: 2350, height: 1359, bytes: 32_525 },
      { format: 'webp', file: `S-overview-${theme}-960.webp`, width: 960, height: 563, bytes: 32_050 },
      { format: 'webp', file: `S-overview-${theme}-480.webp`, width: 480, height: 282, bytes: 11_468 },
    ].map((entry) => ({
      ...entry,
      format: entry.format as 'png' | 'svg' | 'drawio' | 'webp',
      sample: 'S-overview',
      fixture: 'S',
      lens: 'overview',
      theme,
      sha256: 'x',
      detail: 'all',
      command:
        entry.format === 'webp'
          ? 'node scripts/exports.mjs'
          : `pnpm render --fixture S --lens overview --theme ${theme}`,
    })),
  );
  return {
    generator: 'node scripts/exports.mjs',
    samples: [
      {
        id: 'S-overview',
        fixture: 'S',
        lens: 'overview',
        lensTitle: 'Overview',
        title: 'Demo S, Overview lens',
        summary: 'The whole of S.',
      },
    ],
    files,
  };
}

describe('the sample exports manifest (docs/media/exports/manifest.json)', () => {
  it('reads the committed manifest: demo S and M, a PNG, an SVG, a draw.io file and previews per theme', () => {
    const manifest = parseExportsManifest(committed());
    expect(manifest.samples.map((sample) => sample.fixture)).toEqual(['S', 'M', 'M']);
    for (const sample of manifest.samples) {
      for (const theme of ['light', 'dark']) {
        const formats = manifest.files
          .filter((file) => file.sample === sample.id && file.theme === theme)
          .map((file) => file.format)
          .sort();
        expect(formats, `${sample.id} ${theme}`).toEqual(['drawio', 'png', 'svg', 'webp', 'webp']);
      }
    }
  });

  it('refuses a manifest that lacks what the site shows', () => {
    expect(() => parseExportsManifest([])).toThrow(/the file is not an object/);
    expect(() => parseExportsManifest({ generator: 'g', samples: [], files: [] })).toThrow(
      /samples is not a non-empty list/,
    );
    const bad = oneSample() as unknown as { files: Record<string, unknown>[] };
    bad.files = bad.files.map((file, index) => (index === 1 ? { ...file, theme: 'sepia' } : file));
    expect(() => parseExportsManifest(bad)).toThrow(/files\[1\]\.theme is not light or dark/);
    const zero = oneSample() as unknown as { files: Record<string, unknown>[] };
    zero.files = zero.files.map((file) => ({ ...file, bytes: 0 }));
    expect(() => parseExportsManifest(zero)).toThrow(/files\[0\]\.bytes is not a positive integer/);
  });

  it('groups the files into samples: both themes, download names, sizes, the preview’s srcset', () => {
    const [sample] = exportSamples(oneSample(), (file) => `/_astro/${file}`);
    expect(sample?.detail).toBe('all');
    expect(sample?.themes.map((theme) => theme.theme)).toEqual(['light', 'dark']);
    const light = sample?.themes[0];
    expect(light?.png).toEqual({
      url: '/_astro/S-overview-light.png',
      bytes: 742_928,
      size: '743 kB',
      width: 4794,
      height: 2812,
      downloadName: 'gcportrait-demo-S-overview-light.png',
    });
    expect(light?.svg.downloadName).toBe('gcportrait-demo-S-overview-light.svg');
    expect(light?.drawio).toMatchObject({
      url: '/_astro/S-overview-light.drawio',
      size: '33 kB',
      downloadName: 'gcportrait-demo-S-overview-light.drawio',
      open: 'https://app.diagrams.net/?url=https%3A%2F%2Fgcportrait.app%2F_astro%2FS-overview-light.drawio',
    });
    expect(light?.preview).toEqual({
      src: '/_astro/S-overview-light-960.webp',
      srcset: '/_astro/S-overview-light-480.webp 480w, /_astro/S-overview-light-960.webp 960w',
      width: 960,
      height: 563,
    });
    expect(light?.command).toBe('pnpm render --fixture S --lens overview --theme light');
  });

  it('leaves out a sample whose files the build lacks, and names them', () => {
    const missing: string[] = [];
    const samples = exportSamples(
      oneSample(),
      (file) => (file === 'S-overview-dark.svg' ? undefined : `/_astro/${file}`),
      (file) => missing.push(file),
    );
    expect(samples).toEqual([]);
    expect(missing).toEqual(['S-overview-dark.svg']);
  });

  it('opens a draw.io file in diagrams.net from its public address on the site', () => {
    expect(diagramsNetLink('/_astro/S-overview-light.Ab1-x.drawio')).toBe(
      'https://app.diagrams.net/?url=https%3A%2F%2Fgcportrait.app%2F_astro%2FS-overview-light.Ab1-x.drawio',
    );
    expect(diagramsNetLink('/_astro/a.drawio', 'http://localhost:4321')).toBe(
      'https://app.diagrams.net/?url=http%3A%2F%2Flocalhost%3A4321%2F_astro%2Fa.drawio',
    );
  });

  it('writes sizes as browsers show them', () => {
    expect(formatBytes(77_617)).toBe('78 kB');
    expect(formatBytes(420)).toBe('1 kB');
    expect(formatBytes(1_897_325)).toBe('1.9 MB');
  });

  it('offers every committed sample on the site, from files the build publishes itself', () => {
    const samples = sampleExports();
    expect(samples.map((sample) => sample.id)).toEqual(['S-overview', 'M-overview', 'M-shared-vpc']);
    for (const sample of samples) {
      for (const theme of sample.themes) {
        expect(theme.png.url).toMatch(/\.png$/);
        expect(theme.svg.url).toMatch(/\.svg$/);
        expect(theme.drawio.url).toMatch(/\.drawio$/);
        expect(theme.drawio.open).toBe(diagramsNetLink(theme.drawio.url));
        expect(theme.png.url).not.toMatch(/^(?:https?:)?\/\//);
        expect(theme.preview.srcset.split(', ')).toHaveLength(2);
        expect(theme.command).toMatch(/^pnpm render --fixture [SM] /);
      }
    }
    expect(sampleExport('M-shared-vpc')?.lensTitle).toBe('Networking');
    expect(sampleExport('nope')).toBeUndefined();
  });
});
