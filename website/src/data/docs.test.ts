// SPDX-License-Identifier: MIT
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import mediaList from './media.json' with { type: 'json' };
import { DOC_MENU_EXTRAS, DOC_PAGES, NOT_ON_SITE, menuItems } from './docs.js';

const REPO = path.resolve(import.meta.dirname, '..', '..', '..');

describe('the docs manifest (src/data/docs.ts)', () => {
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
      expect(page.description.length, page.slug).toBeLessThanOrEqual(170);
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

  it('keeps the self-hosting guide at /docs/self-host/, where the demo-only Connect page links (ADR 0032)', () => {
    expect(DOC_PAGES.find((page) => page.source === 'docs/self-host.md')?.slug).toBe('self-host');
  });
});
