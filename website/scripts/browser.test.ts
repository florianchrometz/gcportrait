// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';

import { SITE_URL } from '../src/site.js';
import { axeProblems, readSitemapPages, sitemapPages } from './browser.js';

type FakeAxeResult = {
  readonly violations: readonly {
    readonly id: string;
    readonly help: string;
    readonly nodes: readonly { readonly target: readonly unknown[] }[];
  }[];
};

const { mockSetLegacyMode, mockAnalyze } = vi.hoisted(() => ({
  mockSetLegacyMode: vi.fn<(mode?: boolean) => void>(),
  mockAnalyze: vi.fn<() => Promise<FakeAxeResult>>(),
}));

vi.mock('@axe-core/playwright', () => ({
  AxeBuilder: class {
    setLegacyMode(mode?: boolean) {
      mockSetLegacyMode(mode);
      return this;
    }
    analyze(): Promise<FakeAxeResult> {
      return mockAnalyze();
    }
  },
}));

describe('sitemapPages', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'gcportrait-sitemap-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws an error when sitemap.xml is missing', () => {
    expect(() => sitemapPages(tmpDir)).toThrow(
      'website/dist/sitemap.xml is missing; run pnpm --filter @gcportrait/website build first.',
    );
  });

  it('parses sitemap locs, strips SITE_URL, and filters out demo URL', () => {
    const sitemapContent = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      `  <url><loc>${SITE_URL}/</loc></url>`,
      `  <url><loc>${SITE_URL}/docs/</loc></url>`,
      `  <url><loc>${SITE_URL}/demo/</loc></url>`,
      `  <url><loc>${SITE_URL}/demo/index.html</loc></url>`,
      `  <url><loc>${SITE_URL}/imprint/</loc></url>`,
      '</urlset>',
    ].join('\n');
    writeFileSync(path.join(tmpDir, 'sitemap.xml'), sitemapContent);

    expect(sitemapPages(tmpDir)).toEqual(['/', '/docs/', '/imprint/']);
    expect(readSitemapPages(tmpDir)).toEqual(['/', '/docs/', '/imprint/']);

    expect(sitemapPages(tmpDir, true)).toEqual(['/', '/docs/', '/imprint/', '/404.html']);
    expect(sitemapPages(tmpDir, { include404: true })).toEqual(['/', '/docs/', '/imprint/', '/404.html']);
    expect(sitemapPages(tmpDir, { include404: false })).toEqual(['/', '/docs/', '/imprint/']);
  });
});

describe('axeProblems', () => {
  it('enables legacy mode on AxeBuilder and formats violations', async () => {
    mockAnalyze.mockResolvedValueOnce({
      violations: [
        {
          id: 'color-contrast',
          help: 'Elements must have sufficient color contrast',
          nodes: [{ target: ['#header'] }],
        },
      ],
    });

    const fakePage = {} as unknown as Page;
    const problems = await axeProblems(fakePage);

    expect(mockSetLegacyMode).toHaveBeenCalledWith(true);
    expect(problems).toEqual([
      'axe color-contrast: Elements must have sufficient color contrast (["#header"])',
    ]);
  });
});
