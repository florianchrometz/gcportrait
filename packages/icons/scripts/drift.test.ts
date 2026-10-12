// SPDX-License-Identifier: MIT
/**
 * The icon drift check's comparison logic (lib/drift.mjs) and archive helpers (lib/archives.mjs), fed small
 * synthetic archives built in memory (test-zip.ts) and read back through the same safe reader drift.mjs uses:
 * no network, no real Google artwork.
 */
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';

import type { ArchiveIndex } from './lib/archive-index.mjs';
import { archiveLinksOf, inventoryOf, isDownloadableLink, sha256, svgEntries } from './lib/archives.mjs';
import type { CatalogProduct } from './lib/catalog-keys.mjs';
import {
  compareInventories,
  driftReport,
  formatMarkdown,
  formatText,
  guessKey,
  iconNameOf,
  productCandidates,
  type FetchedArchive,
} from './lib/drift.mjs';
import type { Manifest } from './lib/manifest.mjs';
import { mappingProblems, type Mapping, type SetName } from './lib/mapping.mjs';
import { svgZip, zip } from './test-zip.js';

const svg = (label: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>${label}</title><path d="M0 0h24v24H0z"/></svg>`;

const URLS: Record<SetName, string> = {
  core: 'https://services.example.google.com/files/core.zip',
  legacy: 'https://services.example.google.com/files/legacy.zip',
  category: 'https://services.example.google.com/files/category.zip',
};

const CORE_CE = 'Unique Icons/Compute Engine/SVG/ComputeEngine-512-color.svg';
const CORE_MANDIANT = 'Unique Icons/Mandiant/SVG/Mandiant-512-color.svg';
const LEGACY_CE = 'compute_engine/compute_engine.svg';
const LEGACY_SQL = 'cloud_sql/cloud_sql.svg';
const LEGACY_GENERIC = 'cloud_generic/cloud_generic.svg';
const LEGACY_TRANSFER = 'transfer/transfer.svg';
const CAT_COMPUTE = 'Category Icons/Compute/SVG/Compute-512-color.svg';
const CAT_DATABASES = 'Category Icons/Databases/SVG/Databases-512-color.svg';

const MAPPING: Mapping = {
  description: 'synthetic',
  sources: {
    core: { title: 'Core product icons', url: URLS.core, viewBox: 512 },
    legacy: { title: 'Legacy console icons', url: URLS.legacy, viewBox: 24 },
    category: { title: 'Product category icons', url: URLS.category, viewBox: 512 },
  },
  categories: { category_compute: CAT_COMPUTE, category_databases: CAT_DATABASES },
  icons: {
    batch: { category: 'category_compute' },
    cloud_generic: { legacy: LEGACY_GENERIC, generic: true },
    cloud_sql: { legacy: LEGACY_SQL, category: 'category_databases' },
    compute_engine: { core: CORE_CE, legacy: LEGACY_CE, category: 'category_compute' },
    folder: { own: 'folder.svg' },
    google_kubernetes_engine: { legacy: 'google_kubernetes_engine/google_kubernetes_engine.svg' },
    speech_to_text: { legacy: 'speech-to-text/speech-to-text.svg' },
  },
  legibility16: [{ subject: 'VM', key: 'compute_engine', decision: 'official', note: 'kept' }],
};

const PRODUCTS: CatalogProduct[] = [
  { product: 'Cloud SQL', key: 'cloud_sql' },
  { product: 'Google Kubernetes Engine', key: 'google_kubernetes_engine' },
  { product: 'Access Policy (Access Context Manager)', key: 'compute_engine' },
];

const file = (set: SetName, source: string, raw: string) => ({
  set,
  source,
  viewBox: '0 0 24 24',
  raw: { bytes: raw.length, sha256: sha256(raw) },
  vendored: { bytes: raw.length, sha256: sha256(raw) },
  colours: [],
  date: '2026-10-09',
});

/** The archives as they were when the synthetic set was vendored. */
const BEFORE: Record<SetName, Record<string, string>> = {
  core: { [CORE_CE]: svg('ce'), [CORE_MANDIANT]: svg('mandiant') },
  legacy: {
    [LEGACY_CE]: svg('ce-legacy'),
    [LEGACY_SQL]: svg('sql'),
    [LEGACY_GENERIC]: svg('generic'),
    [LEGACY_TRANSFER]: svg('transfer'),
    'google_kubernetes_engine/google_kubernetes_engine.svg': svg('gke'),
    'speech-to-text/speech-to-text.svg': svg('stt'),
  },
  category: { [CAT_COMPUTE]: svg('compute'), [CAT_DATABASES]: svg('databases') },
};

const MANIFEST: Manifest = {
  description: 'synthetic',
  sources: {
    core: { url: URLS.core, bytes: 1, sha256: 'x', date: '2026-10-09' },
    legacy: { url: URLS.legacy, bytes: 1, sha256: 'x', date: '2026-10-09' },
    category: { url: URLS.category, bytes: 1, sha256: 'x', date: '2026-10-09' },
  },
  files: {
    'compute_engine.svg': file('core', CORE_CE, svg('ce')),
    'cloud_sql.svg': file('legacy', LEGACY_SQL, svg('sql')),
    'cloud_generic.svg': file('legacy', LEGACY_GENERIC, svg('generic')),
    'google_kubernetes_engine.svg': file(
      'legacy',
      'google_kubernetes_engine/google_kubernetes_engine.svg',
      svg('gke'),
    ),
    'speech_to_text.svg': file('legacy', 'speech-to-text/speech-to-text.svg', svg('stt')),
    'category_compute.svg': file('category', CAT_COMPUTE, svg('compute')),
    'category_databases.svg': file('category', CAT_DATABASES, svg('databases')),
  },
  icons: {
    batch: { file: 'category_compute.svg', kind: 'category' },
    category_compute: { file: 'category_compute.svg', kind: 'category' },
    category_databases: { file: 'category_databases.svg', kind: 'category' },
    cloud_generic: { file: 'cloud_generic.svg', kind: 'generic' },
    cloud_sql: { file: 'cloud_sql.svg', kind: 'official' },
    compute_engine: { file: 'compute_engine.svg', kind: 'official' },
    google_kubernetes_engine: { file: 'google_kubernetes_engine.svg', kind: 'official' },
    speech_to_text: { file: 'speech_to_text.svg', kind: 'official' },
  },
};

/** An archive as drift.mjs sees it: built as a real ZIP, then listed through the safe reader. */
function fetched(set: string, files: Record<string, string>): FetchedArchive {
  const archive = svgZip(files);
  const url = set in URLS ? URLS[set as SetName] : set;
  return {
    url,
    available: true,
    bytes: archive.length,
    sha256: sha256(archive),
    entries: inventoryOf(svgEntries(archive)),
  };
}

function indexOf(archives: Record<SetName, FetchedArchive>): ArchiveIndex {
  const entry = (set: SetName) => {
    const { url, bytes, sha256: digest, entries } = archives[set];
    return { url, bytes: bytes ?? 0, sha256: digest ?? '', entries: entries ?? {} };
  };
  return {
    description: 'synthetic',
    page: 'https://cloud.google.com/icons',
    sources: { core: entry('core'), legacy: entry('legacy'), category: entry('category') },
  };
}

const BEFORE_ARCHIVES = {
  core: fetched('core', BEFORE.core),
  legacy: fetched('legacy', BEFORE.legacy),
  category: fetched('category', BEFORE.category),
};
const INDEX = indexOf(BEFORE_ARCHIVES);
const PAGE = { url: 'https://cloud.google.com/icons', links: [URLS.core, URLS.legacy, URLS.category] };

function report(
  changes: Partial<Record<SetName, Record<string, string> | FetchedArchive>> = {},
  options: { mapping?: Mapping; page?: typeof PAGE | undefined; extra?: FetchedArchive[] } = {},
) {
  const current: Partial<Record<SetName, FetchedArchive>> = {};
  for (const set of ['core', 'legacy', 'category'] as const) {
    const change = changes[set];
    current[set] =
      change === undefined
        ? BEFORE_ARCHIVES[set]
        : 'available' in change && typeof change.available === 'boolean'
          ? (change as FetchedArchive)
          : fetched(set, change as Record<string, string>);
  }
  return driftReport({
    mapping: options.mapping ?? MAPPING,
    manifest: MANIFEST,
    index: INDEX,
    products: PRODUCTS,
    page: 'page' in options ? options.page : PAGE,
    current,
    extra: options.extra ?? [],
  });
}

describe('the synthetic fixture', () => {
  it('is a valid mapping', () => {
    // The own drawing's file is looked up in the real own/ directory, which has folder.svg.
    expect(mappingProblems(MAPPING)).toEqual([]);
  });
});

describe('driftReport', () => {
  it('finds no drift when the archives and the page are what was vendored', () => {
    const result = report();
    expect(result.drift).toBe(false);
    expect(result.sets.map((set) => [set.set, set.unchanged, set.entryCount])).toEqual([
      ['core', true, 2],
      ['legacy', true, 6],
      ['category', true, 2],
    ]);
    expect(result.newerAvailable).toEqual([]);
    expect(result.mappedMissing).toEqual([]);
    expect(result.summary).toMatch(/^icon drift: none\./);
    expect(report().digest).toBe(result.digest);
  });

  it('reports which products still use the older symbols, the generic mark aside', () => {
    expect(report().symbols).toEqual({
      core: ['compute_engine'],
      legacy: ['cloud_sql', 'google_kubernetes_engine', 'speech_to_text'],
      category: ['batch'],
      own: ['folder'],
    });
  });

  it('lists the icons on the page that the mapping does not name, with a guess', () => {
    const core = report().sets.find((set) => set.set === 'core');
    expect(core?.notVendored).toEqual([{ name: CORE_MANDIANT, guess: undefined }]);
  });

  it('reports a new icon with a guess of its product, and a newer icon for a product on an older symbol', () => {
    const sqlCore = 'Unique Icons/Cloud SQL/SVG/CloudSQL-512-color.svg';
    const result = report({ core: { ...BEFORE.core, [sqlCore]: svg('sql-2025') } });
    expect(result.drift).toBe(true);
    const core = result.sets.find((set) => set.set === 'core');
    expect(core?.unchanged).toBe(false);
    expect(core?.added).toEqual([
      { name: sqlCore, guess: { key: 'cloud_sql', label: 'cloud_sql', score: 1, also: [] } },
    ]);
    expect(result.newerAvailable).toEqual([
      {
        key: 'cloud_sql',
        uses: 'legacy',
        current: `legacy "${LEGACY_SQL}"`,
        set: 'core',
        entry: sqlCore,
        score: 1,
      },
    ]);
    expect(result.summary).toContain('1 new');
    expect(result.summary).toContain('1 product on an older symbol with a newer icon available');
  });

  it('matches an acronym (GKE) and does not take reordered words for the same product', () => {
    const candidates = productCandidates(MAPPING, PRODUCTS);
    expect(guessKey('GKE', candidates)?.key).toBe('google_kubernetes_engine');
    expect(guessKey('GKE', candidates)?.score).toBe(0.9);
    expect(guessKey('text-to-speech', candidates)).toBeUndefined();
    expect(guessKey('Access Context Manager', candidates)?.key).toBe('compute_engine');
    expect(guessKey('Something Else Entirely', candidates)).toBeUndefined();
  });

  it('records keepOlderSymbol decisions instead of reporting them as drift', () => {
    const gke = 'Unique Icons/GKE/SVG/GKE-512-color.svg';
    const mapping: Mapping = {
      ...MAPPING,
      keepOlderSymbol: { google_kubernetes_engine: 'synthetic: the two-tone glyph reads better at 16 px' },
    };
    expect(mappingProblems(mapping)).toEqual([]);
    const result = report({ core: { ...BEFORE.core, [gke]: svg('gke-2025') } }, { mapping });
    expect(result.newerAvailable).toEqual([]);
    expect(result.keptOlder).toEqual([
      {
        key: 'google_kubernetes_engine',
        reason: 'synthetic: the two-tone glyph reads better at 16 px',
        entry: gke,
      },
    ]);
    // The new icon itself is still new until it is vendored (archive-index.json).
    expect(result.drift).toBe(true);
    expect(report({ core: { ...BEFORE.core, [gke]: svg('gke-2025') } }).newerAvailable).toHaveLength(1);
  });

  it('reports a changed icon with the keys that use it', () => {
    const result = report({ legacy: { ...BEFORE.legacy, [LEGACY_SQL]: svg('sql, redrawn') } });
    expect(result.drift).toBe(true);
    const legacy = result.sets.find((set) => set.set === 'legacy');
    expect(legacy?.changed).toEqual([{ name: LEGACY_SQL, usedBy: ['cloud_sql'] }]);
    expect(result.mappedMissing).toEqual([]);
  });

  it('reports renames: the same bytes under another name, or the same product under another file name', () => {
    const renamedCore = 'Unique Icons/Compute Engine/SVG/ComputeEngine-512-color-rgb.svg';
    const legacy = Object.fromEntries(
      Object.entries({ ...BEFORE.legacy, 'transfer_service/transfer_service.svg': svg('transfer') }).filter(
        ([name]) => name !== LEGACY_TRANSFER,
      ),
    );
    const result = report({
      core: { [renamedCore]: svg('ce, redrawn'), [CORE_MANDIANT]: svg('mandiant') },
      legacy,
    });
    const byName = Object.fromEntries(result.sets.map((set) => [set.set, set]));
    expect(byName.legacy?.renamed).toEqual([
      { from: LEGACY_TRANSFER, to: 'transfer_service/transfer_service.svg', sameContent: true, usedBy: [] },
    ]);
    expect(byName.core?.renamed).toEqual([
      { from: CORE_CE, to: renamedCore, sameContent: false, usedBy: ['compute_engine'] },
    ]);
    expect(byName.core?.added).toEqual([]);
    expect(byName.core?.removed).toEqual([]);
    expect(result.mappedMissing).toEqual([
      {
        set: 'core',
        entry: CORE_CE,
        keys: ['compute_engine'],
        fallback: [`compute_engine: legacy "${LEGACY_CE}"`, 'compute_engine: category mark category_compute'],
      },
    ]);
  });

  it('reports a removed icon and a category mark the mapping can no longer find', () => {
    const result = report({ category: { [CAT_COMPUTE]: svg('compute') } });
    const category = result.sets.find((set) => set.set === 'category');
    expect(category?.removed).toEqual([{ name: CAT_DATABASES, usedBy: ['category_databases'] }]);
    expect(result.mappedMissing).toEqual([
      {
        set: 'category',
        entry: CAT_DATABASES,
        keys: ['category_databases'],
        fallback: [
          'category_databases: none: vendor.mjs stops until mapping.json names an existing category mark',
        ],
      },
    ]);
    expect(result.drift).toBe(true);
  });

  it('reports archive links that appeared on or vanished from the page, and reads a new archive', () => {
    const extraUrl = 'https://services.example.google.com/files/product-icons-2027.zip';
    const result = report(
      {},
      {
        page: { url: PAGE.url, links: [URLS.core, URLS.category, extraUrl] },
        extra: [fetched(extraUrl, { 'Product Icons/Cloud SQL/SVG/CloudSQL.svg': svg('sql-2027') })],
      },
    );
    expect(result.page.unknownLinks).toEqual([extraUrl]);
    expect(result.page.missingLinks).toEqual([{ set: 'legacy', url: URLS.legacy }]);
    expect(result.extra).toEqual([
      {
        url: extraUrl,
        available: true,
        added: [
          {
            name: 'Product Icons/Cloud SQL/SVG/CloudSQL.svg',
            guess: { key: 'cloud_sql', label: 'cloud_sql', score: 1, also: [] },
          },
        ],
      },
    ]);
    expect(result.newerAvailable.map((item) => [item.key, item.set])).toEqual([['cloud_sql', extraUrl]]);
    expect(result.drift).toBe(true);
  });

  it('counts an archive that answers HTTP 404 as drift, and says when the page was not read', () => {
    const result = report(
      { legacy: { url: URLS.legacy, available: false, reason: 'GET … answered HTTP 404 Not Found' } },
      { page: undefined },
    );
    expect(result.page.checked).toBe(false);
    expect(result.sets.find((set) => set.set === 'legacy')?.available).toBe(false);
    expect(result.drift).toBe(true);
    expect(result.summary).toContain('1 archive unavailable');
  });

  it('formats the report as text and as Markdown', () => {
    const sqlCore = 'Unique Icons/Cloud SQL/SVG/CloudSQL-512-color.svg';
    const result = report({ core: { ...BEFORE.core, [sqlCore]: svg('sql-2025') } });
    const text = formatText(result).join('\n');
    expect(text).toContain(`NEW      ${sqlCore}: probably cloud_sql`);
    expect(text).toContain('NEWER ICON for cloud_sql');
    expect(text).toContain('older symbols still in use: 3 product keys use a legacy console icon');
    const markdown = formatMarkdown(result);
    expect(markdown).toContain('### New icons (1)');
    expect(markdown).toContain('### Products on an older symbol although a newer icon exists (1)');
    expect(markdown).toContain('pnpm --filter @gcportrait/icons vendor');
    expect(formatMarkdown(report())).toContain('match what `packages/icons` vendored');
  });
});

describe('compareInventories', () => {
  it('sorts entries into added, changed, renamed and removed', () => {
    expect(
      compareInventories(
        { 'a/a.svg': '1', 'b/b.svg': '2', 'c/c.svg': '3', 'd/d.svg': '4' },
        { 'a/a.svg': '1', 'b/b.svg': '20', 'c2/c2.svg': '3', 'e/e.svg': '5' },
      ),
    ).toEqual({
      added: ['e/e.svg'],
      changed: ['b/b.svg'],
      renamed: [{ from: 'c/c.svg', to: 'c2/c2.svg', sameContent: true }],
      removed: ['d/d.svg'],
    });
  });
});

describe('iconNameOf', () => {
  it.each([
    ['Unique Icons/Cloud Run/SVG/CloudRun-512-color-rgb.svg', 'Cloud Run'],
    ['Category Icons/AI _ Machine Learning/SVG/AIMachineLearning-512-color.svg', 'AI _ Machine Learning'],
    ['identity-aware_proxy/identity-aware_proxy.svg', 'identity-aware_proxy'],
    ['SVG/BigQuery-512-color-rgb.svg', 'BigQuery'],
    ['Looker-512-color.svg', 'Looker'],
  ])('%s → %s', (entry, name) => {
    expect(iconNameOf(entry)).toBe(name);
  });
});

describe('the archive helpers', () => {
  it('list SVG entries only, without resource forks, refuse unsafe names and pass on read errors', () => {
    const archive = svgZip({
      'Icons/a.svg': svg('a'),
      'Icons/a.png': 'png',
      '__MACOSX/Icons/._a.svg': 'fork',
      'Icons/._b.svg': 'fork',
    });
    expect(svgEntries(archive).map((entry) => entry.name)).toEqual(['Icons/a.svg']);
    // svgEntries' own guard, then one of the zip reader's errors (the rest are zip.test.ts's), which it must
    // pass on rather than skip the entry it cannot read.
    expect(() => svgEntries(svgZip({ '../escape.svg': svg('x') }))).toThrow(/unsafe entry name/);
    expect(() =>
      svgEntries(zip([{ name: 'Icons/x.svg', data: Buffer.from(svg('x')), method: 8, size: 3 }])),
    ).toThrow(/does not inflate/);
  });

  it('find the ZIP links of the library page, escaped or not, once each', () => {
    const html = [
      '<a href="https://services.google.com/fh/files/misc/category-icons.zip">ZIP</a>',
      '<a href="https://services.google.com/fh/files/misc/category-icons.zip">again</a>',
      '"https:\\/\\/services.google.com\\/fh\\/files\\/misc\\/core-products-icons.zip"',
      '<a href="https://services.google.com/fh/files/misc/google-cloud-product-icons.pdf">PDF</a>',
      '<a href="http://insecure.example/x.zip">no</a> https://example.com/a.zipper',
    ].join('\n');
    expect(archiveLinksOf(html)).toEqual([
      'https://services.google.com/fh/files/misc/category-icons.zip',
      'https://services.google.com/fh/files/misc/core-products-icons.zip',
    ]);
  });

  it('download only from Google hosts over https', () => {
    expect(isDownloadableLink('https://services.google.com/fh/files/misc/core-products-icons.zip')).toBe(
      true,
    );
    expect(isDownloadableLink('https://www.gstatic.com/x.zip')).toBe(true);
    expect(isDownloadableLink('https://google.com.example.net/x.zip')).toBe(false);
    expect(isDownloadableLink('http://services.google.com/x.zip')).toBe(false);
  });
});
