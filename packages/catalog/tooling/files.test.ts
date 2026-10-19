// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GENERATED_MODULE,
  catalogVersion,
  committedGeneratedFiles,
  jsonSource,
  loadSources,
  parseProductsFile,
  parseSnapshotText,
  readOfficialList,
  snapshotFiles,
  sourcePaths,
  yamlSource,
} from './files.js';

let root: string;
const write = (relative: string, content: string): void => {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'gcportrait-catalog-files-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('yamlSource', () => {
  it('parses YAML and finds the line of a path, or of its nearest ancestor', () => {
    const { source, violations } = yamlSource(
      'products/x.yaml',
      [
        'product: X',
        'types:',
        '  x.googleapis.com/Thing:',
        '    role: core',
        '    relations:',
        '      - { kind: uses }',
        '',
      ].join('\n'),
    );
    expect(violations).toEqual([]);
    expect(source?.content).toEqual({
      product: 'X',
      types: { 'x.googleapis.com/Thing': { role: 'core', relations: [{ kind: 'uses' }] } },
    });
    expect(source?.lineOf?.(['types', 'x.googleapis.com/Thing', 'role'])).toBe(4);
    expect(source?.lineOf?.(['types', 'x.googleapis.com/Thing', 'relations', 0, 'kind'])).toBe(6);
    expect(source?.lineOf?.(['types', 'x.googleapis.com/Thing', 'missing', 'deeper'])).toBe(4);
    expect(source?.lineOf?.([])).toBe(1);
  });

  it('reports invalid YAML and duplicate keys with their line', () => {
    const broken = yamlSource('lenses/a.yaml', 'title: [unclosed\n');
    expect(broken.source).toBeUndefined();
    expect(broken.violations[0]).toMatchObject({ code: 'load', file: 'lenses/a.yaml' });
    const duplicate = yamlSource('lenses/b.yaml', 'title: a\ntitle: b\n');
    expect(duplicate.violations[0]).toMatchObject({ code: 'load', line: 2 });
  });
});

describe('jsonSource', () => {
  it('parses JSON, keeping its text, or reports it', () => {
    expect(jsonSource('a.json', '{"a":1}').source?.content).toEqual({ a: 1 });
    expect(jsonSource('a.json', '{"a":1}').source?.text).toBe('{"a":1}');
    expect(jsonSource('a.json', '{').violations[0]?.message).toMatch(/^invalid JSON: /);
  });
});

describe('loadSources', () => {
  it('reads the data files and flags stray and missing ones', () => {
    write('products/x.googleapis.com.yaml', 'product: X\n');
    write('products/x.googleapis.com.extra.yaml', 'product: X\n');
    write('products/notes.txt', 'stray\n');
    write('products/nested/inner.yaml', 'x: 1\n');
    write('products/broken.googleapis.com.yaml', 'product: [\n');
    write('lenses/overview.yaml', 'title: Overview\n');
    write('fixtures/x.googleapis.com/Thing.json', '{}');
    write('fixtures/x.googleapis.com/README.md', 'stray');
    write('fixtures/loose.json', '{}');
    write('fixtures/x.googleapis.com/Broken.json', '{');
    const sources = loadSources(root);
    expect(sources.products.map((file) => file.path)).toEqual([
      'products/x.googleapis.com.extra.yaml',
      'products/x.googleapis.com.yaml',
    ]);
    expect(sources.lenses.map((file) => file.path)).toEqual(['lenses/overview.yaml']);
    expect(sources.fixtures.map((file) => file.path)).toEqual(['fixtures/x.googleapis.com/Thing.json']);
    expect(sources.fixtures[0]?.text).toBe('{}');
    // YAML keeps its text too, and a file that does not parse is kept as text for attributing it to a group.
    expect(sources.products[1]?.text).toBe('product: X\n');
    expect(sources.unparsed).toEqual([
      { path: 'products/broken.googleapis.com.yaml', text: 'product: [\n' },
      { path: 'fixtures/x.googleapis.com/Broken.json', text: '{' },
    ]);
    expect(sources.knownUnmapped).toEqual([]);
    expect(sources.iconKeys).toBeUndefined();
    expect(sources.loadViolations.map((v) => `${v.code} ${v.file ?? ''}`)).toEqual([
      'load products/broken.googleapis.com.yaml',
      'file-name products/nested',
      'file-name products/notes.txt',
      'load known-unmapped/',
      'file-name fixtures/loose.json',
      'load fixtures/x.googleapis.com/Broken.json',
      'file-name fixtures/x.googleapis.com/README.md',
      'load icon-keys.json',
    ]);
    // Files that did not parse still count as catalog files, so --file can select them.
    expect(sourcePaths(sources)).toEqual(
      new Set([
        'products/x.googleapis.com.extra.yaml',
        'products/x.googleapis.com.yaml',
        'lenses/overview.yaml',
        'fixtures/x.googleapis.com/Thing.json',
        'products/broken.googleapis.com.yaml',
        'known-unmapped/',
        'fixtures/x.googleapis.com/Broken.json',
        'icon-keys.json',
      ]),
    );
  });

  it('reads the known-unmapped group files and icon-keys.json when present', () => {
    write('known-unmapped/net.yaml', 'title: Net\ntypes: {}\n');
    write('known-unmapped/dns.yaml', 'title: DNS\n');
    write('icon-keys.json', '{"description":"x","keys":[]}');
    const sources = loadSources(root);
    expect(sources.knownUnmapped.map((file) => [file.path, file.content])).toEqual([
      ['known-unmapped/dns.yaml', { title: 'DNS' }],
      ['known-unmapped/net.yaml', { title: 'Net', types: {} }],
    ]);
    expect(sources.iconKeys?.content).toEqual({ description: 'x', keys: [] });
    expect(sources.loadViolations).toEqual([]);
  });

  it('falls back to version 0.0.0 without a package.json', () => {
    expect(catalogVersion(root)).toBe('0.0.0');
    write('package.json', '{"version":"1.2.3"}');
    expect(catalogVersion(root)).toBe('1.2.3');
  });
});

describe('committedGeneratedFiles', () => {
  const git = (...args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });

  it('finds a compiled catalog that git tracks, and nothing outside a repository or once it is deleted', () => {
    write(GENERATED_MODULE, 'export const CATALOG_DATA: unknown = {};\n');
    expect(committedGeneratedFiles(root)).toEqual([]);
    // A throwaway repository in the temporary directory, never the project's own.
    expect(git('init', '-q').status).toBe(0);
    expect(committedGeneratedFiles(root)).toEqual([]);
    expect(git('add', '-f', GENERATED_MODULE).status).toBe(0);
    expect(committedGeneratedFiles(root)).toEqual([GENERATED_MODULE]);
    rmSync(path.join(root, GENERATED_MODULE));
    expect(committedGeneratedFiles(root)).toEqual([]);
  });
});

describe('the official snapshot', () => {
  it('reads the newest dated file and its products companion', () => {
    write('cai-supported-asset-types.2026-10-08.txt', '# old\na.googleapis.com/A\n');
    write(
      'cai-supported-asset-types.2026-10-09.txt',
      '# header\n\na.googleapis.com/A\r\nb.googleapis.com/B\n',
    );
    write(
      'cai-supported-asset-types.2026-10-09.products.json',
      JSON.stringify({
        products: [
          { product: 'IAM policy', section: 'policy', types: [{ type: 'a.googleapis.com/A' }] },
          {
            product: 'A',
            section: 'resource',
            types: [{ type: 'a.googleapis.com/A' }, { type: 'b.googleapis.com/B' }],
          },
        ],
      }),
    );
    write('notes.txt', 'ignored');
    expect(snapshotFiles(root).map((file) => file.date)).toEqual(['2026-10-08', '2026-10-09']);
    const official = readOfficialList(root);
    expect(official.date).toBe('2026-10-09');
    expect([...official.types]).toEqual(['a.googleapis.com/A', 'b.googleapis.com/B']);
    expect(official.productOf).toEqual(
      new Map([
        ['a.googleapis.com/A', 'A'],
        ['b.googleapis.com/B', 'A'],
      ]),
    );
  });

  it('works without a products companion and fails without any snapshot', () => {
    write('cai-supported-asset-types.2026-10-08.txt', 'a.googleapis.com/A\n');
    expect(readOfficialList(root).productOf).toBeUndefined();
    rmSync(path.join(root, 'cai-supported-asset-types.2026-10-08.txt'));
    expect(() => readOfficialList(root)).toThrow('run pnpm catalog:fetch-official');
  });

  it('parses snapshot text and tolerates junk in the products companion', () => {
    expect(parseSnapshotText('# c\n a/b \n\n#x\nc/d')).toEqual(['a/b', 'c/d']);
    expect(parseProductsFile(null)).toEqual(new Map());
    expect(
      parseProductsFile({
        products: [null, { product: 1, types: [] }, { product: 'P', types: [null, { type: 3 }] }],
      }),
    ).toEqual(new Map());
  });
});
