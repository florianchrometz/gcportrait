// SPDX-License-Identifier: MIT
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { fullTitle } from '../lib/seo.js';
import mediaList from './media.json' with { type: 'json' };
import { DOC_MENU_EXTRAS, DOC_PAGES, NOT_ON_SITE, menuItems } from './docs.js';

const REPO = path.resolve(import.meta.dirname, '..', '..', '..');

describe('the docs manifest (src/data/docs.ts)', () => {
  it('checks commands in every published guide except the separately checked getting-started guide', () => {
    const guides: unknown = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          "import { GUIDES } from './scripts/user-docs.mjs'; process.stdout.write(JSON.stringify(GUIDES));",
        ],
        { cwd: REPO, encoding: 'utf8', timeout: 30_000 },
      ),
    );
    const sources = DOC_PAGES.map((page) => page.source).filter(
      (source) => source !== 'docs/getting-started.md',
    );
    expect(guides).toHaveLength(sources.length);
    expect(guides).toEqual(expect.arrayContaining(sources));
  });

  it('lists every published guide in the documentation index', () => {
    const index = readFileSync(path.join(REPO, 'docs/README.md'), 'utf8');
    const sources = Array.from(index.matchAll(/^\| \[[^\]]+\]\(([^)]+)\) \|/gm), (match) =>
      path.posix.join('docs', match[1] ?? ''),
    );
    expect(sources).toEqual(expect.arrayContaining(DOC_PAGES.map((page) => page.source)));
  });

  it('covers every guide under docs/: each is a page of the site or listed as not one, with the reason', () => {
    const guides = readdirSync(path.join(REPO, 'docs'))
      .filter((name) => name.endsWith('.md'))
      .map((name) => `docs/${name}`);
    const pages = new Set(DOC_PAGES.map((page) => page.source));
    const unaccounted = guides.filter((guide) => !pages.has(guide) && NOT_ON_SITE[guide] === undefined);
    expect(
      unaccounted,
      'A new guide under docs/ must be added to DOC_PAGES (a page of the website) or to NOT_ON_SITE with the reason, in website/src/data/docs.ts.',
    ).toEqual([]);
    for (const page of DOC_PAGES) expect(NOT_ON_SITE[page.source]).toBeUndefined();
  });

  it('has unique slugs, a link-preview card for each page, and descriptions search engines show whole', () => {
    const slugs = DOC_PAGES.map((page) => page.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const cards = new Set(mediaList.cards.map((card) => card.id));
    for (const page of DOC_PAGES) {
      expect(page.slug).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(cards.has(`docs-${page.slug}`), `media.json has no card docs-${page.slug}`).toBe(true);
      expect(page.description.length, page.slug).toBeGreaterThanOrEqual(50);
      expect(page.description.length, page.slug).toBeLessThanOrEqual(160);
    }
  });

  it('gives every page a document title search results show whole (60 characters), naming the product once', () => {
    for (const page of DOC_PAGES) {
      const heading = /^# (.+)$/m.exec(readFileSync(path.join(REPO, page.source), 'utf8'))?.[1] ?? page.label;
      const title = fullTitle({ title: page.searchTitle ?? heading, path: `/docs/${page.slug}/` });
      expect(title.length, title).toBeLessThanOrEqual(60);
      expect(title.split('gcportrait'), title).toHaveLength(2);
    }
  });

  it('lists the sample exports in the docs menu right after the Export guide', () => {
    const use = DOC_PAGES.filter((page) => page.group === 'Use');
    const items = menuItems(use, 'Use').map((item) => ('slug' in item ? item.slug : item.path));
    expect(items.slice(items.indexOf('export'), items.indexOf('export') + 2)).toEqual([
      'export',
      '/exports/',
    ]);
    // Without its guide, an extra still shows, at the end of its group.
    expect(menuItems([], 'Use').map((item) => ('slug' in item ? item.slug : item.path))).toEqual([
      '/exports/',
    ]);
    expect(menuItems(use, 'Start').some((item) => !('slug' in item))).toBe(false);
    for (const extra of DOC_MENU_EXTRAS) {
      expect(extra.path).toMatch(/^\/[a-z-]+\/$/);
      expect(extra.description.length).toBeGreaterThanOrEqual(50);
    }
  });

  it('keeps the self-hosting guide at /docs/self-host/, where the demo-only Connect page links', () => {
    expect(DOC_PAGES.find((page) => page.source === 'docs/self-host.md')?.slug).toBe('self-host');
  });
});
