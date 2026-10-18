// SPDX-License-Identifier: Apache-2.0
/**
 * `pnpm website:lighthouse`: Lighthouse on every page of the built site (the sitemap's pages but the demo at /demo/,
 * which is the app), in the light and the dark theme, with Lighthouse's desktop and mobile settings, against website/dist
 * served the way GitHub Pages serves it (scripts/serve.ts). Prints the four category scores per page and fails when one is under its threshold
 * (accessibility, best practices and SEO 95, performance 90). Reports go to out/lighthouse/ (git-ignored).
 *
 *   pnpm website:build && pnpm website:lighthouse [--theme light|dark]... [--preset desktop|mobile]... [--page /docs/]...
 *   pnpm website:lighthouse --mobile                  the same as --preset mobile (phones only)
 *
 * Lighthouse is run with `pnpm dlx` at a pinned version (it is not a dependency of the repository) and drives
 * Chrome from CHROME_PATH, or else Playwright's Chromium (`pnpm --filter @gcportrait/e2e install-browsers`). The
 * theme is forced with Blink's preferredColorScheme setting, which is what prefers-color-scheme reads.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

import { chromium } from 'playwright';

import { DEMO_URL, SITE_URL } from '../src/site.js';
import { serve } from './serve.js';

const LIGHTHOUSE = 'lighthouse@13.5.0';
const THRESHOLDS: Readonly<Record<string, number>> = {
  performance: 90,
  accessibility: 95,
  'best-practices': 95,
  seo: 95,
};
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;

const WEBSITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(WEBSITE, '..', 'out', 'lighthouse');

const run = promisify(execFile);

type Report = { categories: Record<string, { score: number | null } | undefined> };

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      theme: { type: 'string', multiple: true, default: [] },
      preset: { type: 'string', multiple: true, default: [] },
      page: { type: 'string', multiple: true, default: [] },
      mobile: { type: 'boolean', default: false },
    },
  });
  const themes = values.theme.length > 0 ? values.theme : ['light', 'dark'];
  const presets = values.mobile
    ? ['mobile']
    : values.preset.length > 0
      ? values.preset
      : ['desktop', 'mobile'];
  const sitemap = readFileSync(path.join(WEBSITE, 'dist', 'sitemap.xml'), 'utf8');
  // The site's pages; the demo (/demo/) is the app, checked by the e2e suite and `… demo`.
  const all = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => (match[1] ?? '').slice(SITE_URL.length))
    .filter((page) => !page.startsWith(DEMO_URL));
  const pages = values.page.length > 0 ? values.page : all;

  const { base, close } = await serve(path.join(WEBSITE, 'dist'));
  const chrome = process.env.CHROME_PATH ?? chromium.executablePath();
  mkdirSync(OUT, { recursive: true });
  const failures: string[] = [];
  const rows: string[] = [];
  try {
    for (const preset of presets) {
      for (const theme of themes) {
        for (const page of pages) {
          const name = `${preset}-${theme}-${page.replace(/^\/|\/$/g, '').replace(/\//g, '_') || 'home'}`;
          const output = path.join(OUT, `${name}.json`);
          const flags = [
            '--headless=new',
            `--blink-settings=preferredColorScheme=${theme === 'dark' ? '0' : '1'}`,
          ].join(' ');
          await run(
            'pnpm',
            [
              'dlx',
              LIGHTHOUSE,
              `${base}${page}`,
              '--quiet',
              '--output=json',
              `--output-path=${output}`,
              `--chrome-flags=${flags}`,
              ...(preset === 'desktop' ? ['--preset=desktop'] : []),
            ],
            { env: { ...process.env, CHROME_PATH: chrome }, maxBuffer: 64 * 1024 * 1024 },
          );
          const report = JSON.parse(readFileSync(output, 'utf8')) as Report;
          const scores = CATEGORIES.map((category) =>
            Math.round((report.categories[category]?.score ?? 0) * 100),
          );
          rows.push(
            `${preset.padEnd(8)} ${theme.padEnd(6)} ${page.padEnd(30)} ${scores.map((score) => String(score).padStart(4)).join('')}`,
          );
          console.log(rows[rows.length - 1]);
          CATEGORIES.forEach((category, index) => {
            const score = scores[index] ?? 0;
            if (score < (THRESHOLDS[category] ?? 0))
              failures.push(`${preset} ${theme} ${page}: ${category} ${String(score)}`);
          });
        }
      }
    }
  } finally {
    await close();
  }
  console.log(
    `\n${String(rows.length)} runs (columns: performance, accessibility, best practices, SEO); reports in ${OUT}`,
  );
  if (failures.length > 0) {
    console.error(`website:lighthouse: ${String(failures.length)} score(s) under the thresholds:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    return 1;
  }
  console.log('website:lighthouse: every page meets the thresholds (performance 90, the others 95).');
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);
