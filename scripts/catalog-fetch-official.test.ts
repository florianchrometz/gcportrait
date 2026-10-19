// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  OFFICIAL_URL,
  decodeEntities,
  diffLists,
  driftMarkdown,
  driftReport,
  identifiersOf,
  isEnglishOriginal,
  pageLanguage,
  pageUpdated,
  parseOfficialPage,
  snapshotIdentifiers,
  snapshotText,
} from './catalog-fetch-official.mjs';
import { SCRIPTS_DIR, createTempTree, runScript, type TempTree } from './testing/temp-tree.js';

const SAMPLE = path.join(SCRIPTS_DIR, 'testing', 'supported-asset-types.sample.html');
const SAMPLE_IDS = [
  'apps.k8s.io/Deployment',
  'compute.googleapis.com/Instance',
  'compute.googleapis.com/Network',
  'compute.googleapis.com/Subnetwork',
  'iap.googleapis.com/Tunnel',
  'k8s.io/Namespace',
  'oracledatabase.googleapis.com/AutonomousDatabase',
];

describe('parseOfficialPage', () => {
  const products = parseOfficialPage(readFileSync(SAMPLE, 'utf8'));

  it('reads product sections and their identifiers, nothing else', () => {
    expect(
      products.map((product) => [product.product, product.section, product.types.map((t) => t.type)]),
    ).toEqual([
      ['Compute Engine', 'resource', ['compute.googleapis.com/Network', 'compute.googleapis.com/Subnetwork']],
      ['Google Kubernetes Engine', 'resource', ['k8s.io/Namespace', 'apps.k8s.io/Deployment']],
      [
        'Oracle Database@Google Cloud & friends',
        'resource',
        ['oracledatabase.googleapis.com/AutonomousDatabase'],
      ],
      ['Access policy', 'policy', ['compute.googleapis.com/Network', 'iap.googleapis.com/Tunnel']],
      ['OS inventory', 'runtime', ['compute.googleapis.com/Instance']],
    ]);
  });

  it('resolves API reference links against the page', () => {
    expect(products[0]?.types[0]).toEqual({
      type: 'compute.googleapis.com/Network',
      reference: 'https://docs.cloud.google.com/compute/docs/reference/rest/v1/networks',
    });
    expect(products[1]?.types[0]?.reference).toBe(
      'https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/namespace-v1/',
    );
    expect(products[1]?.types[1]).toEqual({ type: 'apps.k8s.io/Deployment' });
    expect(products[2]?.types[0]?.reference).toBe('https://docs.cloud.google.com/oracle/reference?a=1&b=2');
  });

  it('lists every identifier once, in byte order', () => {
    expect(identifiersOf(products)).toEqual(SAMPLE_IDS);
  });

  it('finds nothing in a page without the sections', () => {
    expect(parseOfficialPage('<table><tr><td><b>X</b></td><td><code>a.b/C</code></td></tr></table>')).toEqual(
      [],
    );
  });
});

describe('helpers', () => {
  it('decodes character references', () => {
    expect(decodeEntities('a&amp;b &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x40; &nbsp;&unknown;')).toBe(
      `a&b <c> "d" 'e' @  &unknown;`,
    );
  });

  it('writes and reads the snapshot format', () => {
    const text = snapshotText('2026-01-02', ['a.googleapis.com/A', 'b.googleapis.com/B']);
    expect(text.split('\n').slice(0, 2)).toEqual([
      '# Cloud Asset Inventory supported asset types, snapshot 2026-01-02',
      `# Source: ${OFFICIAL_URL}`,
    ]);
    expect(text.endsWith('a.googleapis.com/A\nb.googleapis.com/B\n')).toBe(true);
    expect(snapshotIdentifiers(text)).toEqual(['a.googleapis.com/A', 'b.googleapis.com/B']);
  });

  it('recognises the English original and its update date', () => {
    expect(isEnglishOriginal('<html lang="en" dir="ltr">')).toBe(true);
    expect(isEnglishOriginal('<html\n  lang="en-GB">')).toBe(true);
    expect(isEnglishOriginal('<html lang="ko-x-mtfrom-en">')).toBe(false);
    expect(isEnglishOriginal('<html lang="de">')).toBe(false);
    expect(isEnglishOriginal('<html>')).toBe(true);
    expect(pageLanguage('<html lang="ko-x-mtfrom-en">')).toBe('ko-x-mtfrom-en');
    expect(pageUpdated('<p>Last updated 2026-10-07 UTC.</p>')).toBe('2026-10-07');
    expect(pageUpdated('<p>업데이트: 2026-01-06(UTC)</p>')).toBeUndefined();
  });

  it('diffs two lists', () => {
    expect(diffLists(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual({ added: ['d'], removed: ['a'] });
  });
});

describe('the drift report', () => {
  const before = ['a.googleapis.com/A', 'b.googleapis.com/B'];
  const after = ['a.googleapis.com/A', 'c.googleapis.com/C', 'd.googleapis.com/D'];
  const report = driftReport('cai-supported-asset-types.2026-01-01.txt', before, after);

  it('lists the added and removed identifiers under a digest of exactly them', () => {
    expect(report).toEqual({
      drift: true,
      snapshot: 'cai-supported-asset-types.2026-01-01.txt',
      added: ['c.googleapis.com/C', 'd.googleapis.com/D'],
      removed: ['b.googleapis.com/B'],
      // The digest the open issue's marker carries: the same change found again notifies no one.
      digest: createHash('sha256')
        .update('c.googleapis.com/C\nd.googleapis.com/D\n--\nb.googleapis.com/B')
        .digest('hex'),
      summary: 'catalog drift: 2 added, 1 removed asset types.',
    });
    expect(driftReport(null, [], ['x.googleapis.com/X'])).toMatchObject({
      drift: true,
      snapshot: null,
      added: ['x.googleapis.com/X'],
    });
  });

  it('reports no drift between equal lists', () => {
    const same = driftReport('s.txt', before, before);
    expect(same).toMatchObject({ drift: false, added: [], removed: [], summary: 'catalog drift: none.' });
    expect(driftMarkdown(same)).toBe(
      `The [official list of supported asset types](${OFFICIAL_URL}) matches the newest committed snapshot, ` +
        '`s.txt`.\n',
    );
  });

  it('writes the issue body: both lists, the diff and the steps that resolve it', () => {
    const markdown = driftMarkdown(report);
    expect(markdown).toContain(
      `The [official list of supported asset types](${OFFICIAL_URL}) no longer matches the newest committed ` +
        'snapshot, `cai-supported-asset-types.2026-01-01.txt`.',
    );
    expect(markdown).toContain(
      '### Added (2)\n\n- `c.googleapis.com/C`\n- `d.googleapis.com/D`\n\n### Removed (1)\n\n- `b.googleapis.com/B`\n',
    );
    expect(markdown).toContain('```diff\n-b.googleapis.com/B\n+c.googleapis.com/C\n+d.googleapis.com/D\n```');
    expect(markdown).toContain('1. Run `pnpm catalog:fetch-official` and commit the new dated snapshot.');
    expect(driftMarkdown(driftReport(null, [], ['x.googleapis.com/X']))).toContain(
      'no longer matches the newest committed snapshot, (none).',
    );
  });

  it('lists at most 200 identifiers of each kind and points at the diff for the rest', () => {
    const many = Array.from({ length: 205 }, (_, i) => `x.googleapis.com/T${String(i).padStart(3, '0')}`);
    const markdown = driftMarkdown(driftReport('s.txt', [], many));
    expect(markdown).toContain('- `x.googleapis.com/T199`\n- … and 5 more (see the diff)');
    expect(markdown).not.toContain('- `x.googleapis.com/T200`');
    expect(markdown).toContain('+x.googleapis.com/T204');
  });
});

describe('catalog-fetch-official', () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = createTempTree('fetch-official');
  });
  afterEach(() => {
    tree.remove();
  });

  /**
   * Runs the command on `from` (the sample page by default) into the tree's `outDir` (refs/), dated `date`
   * (2026-01-02; null: no --date), with `extra` arguments after.
   */
  const fetchOfficial = (
    {
      from = SAMPLE,
      outDir = 'refs',
      date = '2026-01-02',
    }: { from?: string; outDir?: string; date?: string | null } = {},
    ...extra: string[]
  ) =>
    runScript('catalog-fetch-official.mjs', [
      '--from',
      from,
      '--out-dir',
      path.join(tree.root, outDir),
      ...(date === null ? [] : ['--date', date]),
      ...extra,
    ]);

  it('writes a dated snapshot and its products file, and prints the drift', () => {
    tree.write(
      'refs/cai-supported-asset-types.2026-01-01.txt',
      snapshotText('2026-01-01', [
        'compute.googleapis.com/Network',
        'compute.googleapis.com/Route',
        'k8s.io/Namespace',
      ]),
    );
    const result = fetchOfficial();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('catalog:fetch-official: 7 asset types in 5 product sections; wrote ');
    expect(result.stdout).toContain(
      'Compared with cai-supported-asset-types.2026-01-01.txt: 5 added, 1 removed.',
    );
    expect(result.stdout).toContain('+ oracledatabase.googleapis.com/AutonomousDatabase\n');
    expect(result.stdout).toContain('- compute.googleapis.com/Route\n');
    expect(tree.read('refs/cai-supported-asset-types.2026-01-02.txt')).toBe(
      snapshotText('2026-01-02', SAMPLE_IDS),
    );
    const products = JSON.parse(tree.read('refs/cai-supported-asset-types.2026-01-02.products.json')) as {
      date: string;
      source: string;
      pageUpdated: string;
      products: Array<{ product: string }>;
    };
    expect(products.date).toBe('2026-01-02');
    expect(products.source).toBe(OFFICIAL_URL);
    expect(products.pageUpdated).toBe('2026-01-01');
    expect(products.products.map((product) => product.product)).toContain('OS inventory');
  });

  it('writes the drift report as JSON and Markdown when asked, with or without drift', () => {
    tree.write(
      'refs/cai-supported-asset-types.2026-01-01.txt',
      snapshotText('2026-01-01', [...SAMPLE_IDS.slice(1), 'compute.googleapis.com/Route']),
    );
    const result = fetchOfficial(
      {},
      '--json',
      path.join(tree.root, 'out', 'drift.json'),
      '--markdown',
      path.join(tree.root, 'out', 'drift.md'),
    );
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const report = JSON.parse(tree.read('out/drift.json')) as ReturnType<typeof driftReport>;
    expect(report).toEqual(
      driftReport(
        'cai-supported-asset-types.2026-01-01.txt',
        [...SAMPLE_IDS.slice(1), 'compute.googleapis.com/Route'].sort(),
        SAMPLE_IDS,
      ),
    );
    expect(report.added).toEqual(['apps.k8s.io/Deployment']);
    expect(report.removed).toEqual(['compute.googleapis.com/Route']);
    expect(tree.read('out/drift.md')).toBe(driftMarkdown(report));

    const again = fetchOfficial({}, '--json', path.join(tree.root, 'out', 'again.json'));
    expect(again.status).toBe(0);
    expect(JSON.parse(tree.read('out/again.json'))).toMatchObject({
      drift: false,
      summary: 'catalog drift: none.',
    });
  });

  it('exits with code 2 when --fail-on-drift is passed and drift is detected', () => {
    tree.write(
      'refs/cai-supported-asset-types.2026-01-01.txt',
      snapshotText('2026-01-01', SAMPLE_IDS.slice(1)),
    );
    // With drift and without --fail-on-drift: exit 0
    expect(fetchOfficial({ date: '2026-01-02' }).status).toBe(0);

    // Overwrite previous snapshot to have drift for date 2026-01-03
    tree.write(
      'refs/cai-supported-asset-types.2026-01-02.txt',
      snapshotText('2026-01-02', SAMPLE_IDS.slice(1)),
    );
    // With drift and with --fail-on-drift: exit 2
    expect(fetchOfficial({ date: '2026-01-03' }, '--fail-on-drift').status).toBe(2);

    // Running again against the written 2026-01-03 snapshot has no drift: exit 0
    expect(fetchOfficial({ date: '2026-01-03' }, '--fail-on-drift').status).toBe(0);
  });

  it('compares a same-day snapshot as it was before replacing it', () => {
    tree.write(
      'refs/cai-supported-asset-types.2026-01-02.txt',
      snapshotText('2026-01-02', SAMPLE_IDS.slice(1)),
    );
    const result = fetchOfficial();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'Compared with cai-supported-asset-types.2026-01-02.txt (its content before this run, which this run replaced): 1 added, 0 removed.',
    );
    expect(fetchOfficial().stdout).toContain('0 added, 0 removed.');
  });

  it('says so when there is nothing to compare with', () => {
    const result = fetchOfficial({ outDir: 'new' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No earlier snapshot to compare with.');
  });

  it('refuses a page that yields far fewer identifiers than the last snapshot, unless forced', () => {
    const many = Array.from({ length: 20 }, (_, i) => `x.googleapis.com/T${String(i)}`);
    tree.write('refs/cai-supported-asset-types.2026-01-01.txt', snapshotText('2026-01-01', many));
    const refused = fetchOfficial();
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('found 7 identifiers, fewer than half of the 20');
    expect(fetchOfficial({}, '--force').status).toBe(0);
  });

  it('refuses a machine-translated page and writes nothing', () => {
    tree.write(
      'translated.html',
      readFileSync(SAMPLE, 'utf8').replace('<html lang="en">', '<html lang="ko-x-mtfrom-en">'),
    );
    const result = fetchOfficial({ from: path.join(tree.root, 'translated.html') });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('the page is a machine translation (lang="ko-x-mtfrom-en")');
    expect(existsSync(path.join(tree.root, 'refs'))).toBe(false);
  });

  it('fails on a page without identifiers and on a malformed date', () => {
    tree.write('empty.html', '<html></html>');
    const empty = fetchOfficial({ from: path.join(tree.root, 'empty.html'), outDir: '', date: null });
    expect(empty.status).toBe(1);
    expect(empty.stderr).toContain('found no asset-type identifiers');
    const badDate = fetchOfficial({ outDir: '', date: '2026-1-2' });
    expect(badDate.status).toBe(1);
    expect(badDate.stderr).toContain('--date must be YYYY-MM-DD');
  });
});
