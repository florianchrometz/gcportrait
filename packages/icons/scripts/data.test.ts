// SPDX-License-Identifier: MIT
/**
 * Guards on the committed icon data: every icon key the real catalog uses resolves; no icon file exceeds
 * 8 kB; the vendored files are exactly what the manifest recorded after the mechanical transforms (hash,
 * size, colours: nothing recoloured since vendoring); the own drawings stay in the two-tone palette; the
 * generated module is not stale; and every icon stays visible on the card and plate backgrounds of both
 * themes (the contrast checks of the style skill §10).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { ICON_KEYS, iconFor, isOwnDrawing } from '../src/index.js';
import { readArchiveIndex } from './lib/archive-index.mjs';
import { PACKAGE_DIR, catalogIconKeyList, catalogIconUses } from './lib/catalog-keys.mjs';
import { composite, contrastRatio } from './lib/colour.mjs';
import { MODULE_PATH, renderIconModule } from './lib/icon-module.mjs';
import { VENDORED_DIR, loadManifest } from './lib/manifest.mjs';
import { MAPPING_PATH, MAX_ICON_BYTES, OWN_DIR, SETS, loadMapping, mappingProblems } from './lib/mapping.mjs';
import { coloursOf, transformIcon } from './lib/svg.mjs';

const mapping = loadMapping();
const manifest = loadManifest();
const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const svgFiles = (dir: string): string[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.svg'))
    .sort();

/** Card and plate backgrounds (gcp-diagram-style §2): light card, dark card, the light plate on a dark card. */
const LIGHT_CARD = '#FFFFFF';
const DARK_CARD = '#2B2C2F';
const DARK_PLATE = composite('#FFFFFF', 0.92, DARK_CARD);
/** WCAG 2.2 non-text contrast (1.4.11). */
const NON_TEXT = 3;

describe('the catalog', () => {
  const uses = catalogIconUses();

  it('uses icon keys (sanity check that the product files were read)', () => {
    expect(uses.length).toBeGreaterThan(150);
  });

  it.each(uses.map((use) => [use.key, use.file, use.where] as const))(
    'icon key %s (%s, %s) resolves',
    (key) => {
      expect(iconFor(key)).toBeDefined();
    },
  );

  // With the per-use check above, every listed key resolves too.
  it('lists in icon-keys.json exactly the keys its product files use', () => {
    const listed = catalogIconKeyList();
    expect([...listed].sort()).toEqual([...new Set(uses.map((use) => use.key))].sort());
  });
});

describe('mapping.json', () => {
  it('is valid', () => {
    expect(mappingProblems(JSON.parse(readFileSync(MAPPING_PATH, 'utf8')))).toEqual([]);
  });

  it('maps every key the table holds, and the table holds every mapped and category key', () => {
    const expected = [...Object.keys(mapping.icons), ...Object.keys(mapping.categories)].sort();
    expect([...ICON_KEYS]).toEqual(expected);
  });

  it('marks exactly the keys with an own drawing as own drawings', () => {
    const own = Object.entries(mapping.icons)
      .filter(([, entry]) => entry.own !== undefined)
      .map(([key]) => key)
      .sort();
    expect(ICON_KEYS.filter((key) => isOwnDrawing(key))).toEqual(own);
  });
});

describe('archive-index.json (the drift check’s baseline)', () => {
  const index = readArchiveIndex();

  it('records the same three archives as the manifest, byte for byte', () => {
    expect(index?.page).toBe('https://cloud.google.com/icons');
    for (const set of SETS) {
      const { url, bytes, sha256: digest } = manifest.sources[set];
      expect(index?.sources[set]).toMatchObject({ url, bytes, sha256: digest });
    }
  });

  it('lists every vendored file’s source entry with the raw file’s SHA-256', () => {
    for (const [name, entry] of Object.entries(manifest.files)) {
      expect([name, index?.sources[entry.set].entries[entry.source]]).toEqual([name, entry.raw.sha256]);
    }
  });

  it('holds every entry mapping.json names, so the drift check can tell when one goes', () => {
    const named = (set: (typeof SETS)[number], entry: string | undefined) =>
      entry === undefined || index?.sources[set].entries[entry] !== undefined;
    for (const entry of Object.values(mapping.categories)) expect(named('category', entry)).toBe(true);
    for (const [key, entry] of Object.entries(mapping.icons)) {
      expect([key, named('core', entry.core), named('legacy', entry.legacy)]).toEqual([key, true, true]);
    }
  });

  it('lists SVG entries only, in name order, with SHA-256 hashes', () => {
    for (const set of SETS) {
      const names = Object.keys(index?.sources[set].entries ?? {});
      expect(names.length).toBeGreaterThan(0);
      expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
      for (const name of names) expect(name.toLowerCase().endsWith('.svg')).toBe(true);
      for (const hash of Object.values(index?.sources[set].entries ?? {}))
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('vendored files', () => {
  const files = Object.entries(manifest.files);

  it('are exactly the files the manifest lists', () => {
    expect(svgFiles(VENDORED_DIR)).toEqual(Object.keys(manifest.files).sort());
  });

  it('come from the three sets on cloud.google.com/icons', () => {
    for (const source of Object.values(manifest.sources)) {
      expect(source.url).toMatch(/^https:\/\/services\.google\.com\/fh\/files\/misc\/[a-z-]+\.zip$/);
      expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(Object.keys(manifest.sources).sort()).toEqual(['category', 'core', 'legacy']);
  });

  it.each(files)(
    '%s is unmodified since vendoring (size, SHA-256, colours) and at most 8 kB',
    (name, entry) => {
      const content = readFileSync(path.join(VENDORED_DIR, name));
      expect(content.length).toBe(entry.vendored.bytes);
      expect(sha256(content)).toBe(entry.vendored.sha256);
      expect(coloursOf(content.toString('utf8'))).toEqual(entry.colours);
      expect(content.length).toBeLessThanOrEqual(MAX_ICON_BYTES);
      expect(entry.raw.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.viewBox).toBe(entry.set === 'legacy' ? '0 0 24 24' : '0 0 512 512');
    },
  );

  it.each(files)('%s is in the canonical form of the mechanical transforms', (name, entry) => {
    const content = readFileSync(path.join(VENDORED_DIR, name), 'utf8');
    const size = entry.set === 'legacy' ? 24 : 512;
    const prefix = `icon-${name.replace(/\.svg$/, '').replaceAll('_', '-')}`;
    expect(`${transformIcon(content, { idPrefix: prefix, viewBoxSize: size }).svg}\n`).toBe(content);
  });

  it('carry no comment, so no notice was stripped or left behind', () => {
    for (const name of svgFiles(VENDORED_DIR)) {
      expect(readFileSync(path.join(VENDORED_DIR, name), 'utf8')).not.toContain('<!--');
    }
  });
});

describe('own drawings', () => {
  const own = Object.entries(mapping.icons).flatMap(([key, entry]) =>
    entry.own === undefined ? [] : [[key, entry.own] as const],
  );

  it.each(own)(
    '%s (own/%s) is marked as ours, on the 24 px grid, two-tone, at most 8 kB, with no plate',
    (key, file) => {
      const source = readFileSync(path.join(OWN_DIR, file), 'utf8');
      expect(statSync(path.join(OWN_DIR, file)).size).toBeLessThanOrEqual(MAX_ICON_BYTES);
      expect(source).toMatch(/^<!-- Own drawing for gcportrait \([a-z ]+\): not a Google icon\./);
      expect(source).toContain('viewBox="0 0 24 24"');
      expect(coloursOf(source)).toEqual(['#4285f4', '#aecbfa']);
      expect(iconFor(key)).toMatchObject({ kind: 'own', plateOnDark: false });
    },
  );

  it('are all listed in mapping.json', () => {
    expect(svgFiles(OWN_DIR)).toEqual(own.map(([, file]) => file).sort());
  });
});

describe('src/generated/icons.ts', () => {
  it('is not stale (run `pnpm --filter @gcportrait/icons build` after vendoring or editing an own drawing)', async () => {
    expect(readFileSync(MODULE_PATH, 'utf8')).toBe(await renderIconModule());
  });

  it('holds each artwork once', () => {
    const svgs = ICON_KEYS.map((key) => iconFor(key)?.svg ?? '');
    const distinct = new Set(svgs);
    const vendoredOrOwn = svgFiles(VENDORED_DIR).length + svgFiles(OWN_DIR).length;
    expect(distinct.size).toBe(vendoredOrOwn);
  });
});

/**
 * Official icons Google draws only in its two light tones (#669DF6 and #AECBFA): their best contrast on the
 * white light-theme card is 2.72:1. Icons are never recoloured (AGENTS.md, Style and accessibility), so they
 * ship as drawn; the card's title names the resource, so the glyph is not the only carrier of its meaning
 * (WCAG 1.4.11 asks 3:1 of graphics required to understand the content). The same kind of documented
 * exemption as the subnet stroke (style skill §10). Kept exact: the test fails when an entry no longer needs
 * it or another icon would.
 */
const LIGHT_CARD_EXEMPT: ReadonlyMap<string, number> = new Map([
  ['cloud_armor', 2.7],
  ['cloud_domains', 2.7],
]);

describe('contrast (both themes)', () => {
  const best = (colours: readonly string[], background: string): number =>
    Math.max(...colours.map((colour) => contrastRatio(colour, background)));

  it.each(ICON_KEYS.map((key) => [key] as const))('%s stays visible on its card or plate', (key) => {
    const icon = iconFor(key);
    if (icon === undefined) throw new Error(`${key} does not resolve`);
    const colours = coloursOf(icon.svg);
    const floor = LIGHT_CARD_EXEMPT.get(key);
    if (floor === undefined) expect(best(colours, LIGHT_CARD)).toBeGreaterThanOrEqual(NON_TEXT);
    else {
      expect(icon.kind).toBe('official');
      expect(best(colours, LIGHT_CARD)).toBeGreaterThanOrEqual(floor);
      expect(best(colours, LIGHT_CARD)).toBeLessThan(NON_TEXT);
    }
    expect(best(colours, icon.plateOnDark ? DARK_PLATE : DARK_CARD)).toBeGreaterThanOrEqual(NON_TEXT);
  });

  it('puts every colour mark and category mark on the plate', () => {
    for (const key of ICON_KEYS) {
      const icon = iconFor(key);
      if (icon?.set === 'core' || icon?.set === 'category') expect(icon.plateOnDark).toBe(true);
    }
  });
});

describe('README.md', () => {
  /**
   * The README's long form of the non-affiliation statement (AGENTS.md, Non-affiliation, brand and legal),
   * word for word the app's `NON_AFFILIATION_LONG` (frontend/src/branding.ts, read as text: the package may
   * not import the frontend).
   */
  const LONG_FORM =
    'gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project ' +
    'and is not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud ' +
    "product icons are trademarks of Google and are used under Google's icon usage terms.";
  const readme = readFileSync(path.join(OWN_DIR, '..', 'README.md'), 'utf8');
  const prose = readme.replace(/^> ?/gm, '').replace(/\s+/g, ' ');

  it('carries the long form of the non-affiliation statement verbatim, as the app words it', () => {
    expect(prose).toContain(LONG_FORM);
    const branding = readFileSync(
      path.join(PACKAGE_DIR, '..', '..', 'frontend', 'src', 'branding.ts'),
      'utf8',
    );
    const declaration = /export const NON_AFFILIATION_LONG\s*=([^;]+);/.exec(branding)?.[1] ?? '';
    const app = [...declaration.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]).join('');
    expect(app).toBe(LONG_FORM);
  });

  it('says the icons are Google Cloud’s, provided at cloud.google.com/icons, outside the licence', () => {
    // "Google" or "Google Cloud", never the company's legal name (AGENTS.md, Non-affiliation, brand and legal).
    expect(readme).not.toContain(['Google', 'LLC'].join(' '));
    expect(prose).toContain("The Google Cloud product icons are Google Cloud's.");
    expect(prose).toContain(
      'Google Cloud provides them in its icon library at <https://cloud.google.com/icons>',
    );
    expect(prose).toContain('also still offers the older symbols');
    expect(prose).toContain('uses the icons as provided there, under the terms stated on that page');
    expect(prose).toContain('neither gcportrait nor its maintainer licenses them');
    expect(prose).toContain("They are not covered by gcportrait's own licence (`MIT`");
  });

  it('documents keeping the icons current with the drift check', () => {
    expect(readme).toContain('## Keeping the icons current');
    expect(readme).toContain('pnpm --filter @gcportrait/icons drift');
    expect(readme).toContain('.github/workflows/icon-drift.yml');
  });

  it('records the source URLs and the usage-terms links', () => {
    for (const source of Object.values(manifest.sources)) expect(readme).toContain(source.url);
    expect(readme).toContain('https://cloud.google.com/icons');
    expect(readme).toContain('https://policies.google.com/terms');
  });

  it('lists every own drawing', () => {
    for (const [key, entry] of Object.entries(mapping.icons)) {
      if (entry.own !== undefined) expect(readme).toContain(`| \`${key}\` |`);
    }
  });
});
