// SPDX-License-Identifier: MIT
/**
 * Reads the catalog's data files and the official asset-type snapshot from disk for the compiler
 * (`src/compiler/compile.ts`), which is pure. YAML is parsed with line tracking, so violations point at lines.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isNode, LineCounter, parseDocument } from 'yaml';
import type {
  CatalogSources,
  OfficialList,
  SourceFile,
  UnparsedFile,
  Violation,
} from '../src/compiler/types.js';

/** packages/catalog. */
export const CATALOG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The repository root. */
export const REPO_ROOT = path.resolve(CATALOG_ROOT, '..', '..');

/** Where the dated official snapshots live (skill gcp-asset-catalog). */
export const OFFICIAL_DIR = path.join(REPO_ROOT, '.agents', 'skills', 'gcp-asset-catalog', 'references');

/** Where the build writes its runtime module, relative to the catalog root: git-ignored, never committed. */
export const GENERATED_DIR = 'src/generated';

/** The generated runtime module, relative to the catalog root (`pnpm catalog:build`; git-ignored). */
export const GENERATED_MODULE = `${GENERATED_DIR}/compiled-catalog.ts`;

/** The directory of the authoring groups' known-unmapped files, relative to the catalog root. */
export const KNOWN_UNMAPPED_DIR = 'known-unmapped';

/** The compiled catalog file, relative to the catalog root (git-ignored). */
export const DIST_CATALOG = 'dist/catalog.json';

const SNAPSHOT_FILE = /^cai-supported-asset-types\.([0-9]{4}-[0-9]{2}-[0-9]{2})\.txt$/;

function relative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

/** Parses YAML text into a SourceFile, or into load violations when it is not valid YAML. */
export function yamlSource(filePath: string, text: string): { source?: SourceFile; violations: Violation[] } {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, uniqueKeys: true, prettyErrors: false });
  if (doc.errors.length > 0) {
    return {
      violations: doc.errors.map((error) => ({
        code: 'load',
        file: filePath,
        line: lineCounter.linePos(error.pos[0]).line,
        message: `invalid YAML: ${error.message.split('\n')[0] ?? error.code}`,
      })),
    };
  }
  const lineOf = (target: ReadonlyArray<PropertyKey>): number | undefined => {
    for (let length = target.length; length >= 0; length -= 1) {
      const keys = target.slice(0, length).map((key) => (typeof key === 'symbol' ? String(key) : key));
      const node = length === 0 ? doc.contents : doc.getIn(keys, true);
      if (isNode(node) && node.range !== undefined && node.range !== null) {
        return lineCounter.linePos(node.range[0]).line;
      }
    }
    return undefined;
  };
  return {
    source: { path: filePath, content: doc.toJS({ maxAliasCount: 0 }), lineOf, text },
    violations: [],
  };
}

/** Parses JSON text into a SourceFile, or into a load violation. */
export function jsonSource(filePath: string, text: string): { source?: SourceFile; violations: Violation[] } {
  try {
    return { source: { path: filePath, content: JSON.parse(text) as unknown, text }, violations: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { violations: [{ code: 'load', file: filePath, message: `invalid JSON: ${message}` }] };
  }
}

function listDir(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

/**
 * Reads every data file of a catalog rooted at `root` (normally packages/catalog). A file that does not parse
 * becomes `load` violations and an `unparsed` entry with its text, so the compiler can still tell whose it is.
 */
export function loadSources(root: string = CATALOG_ROOT): CatalogSources {
  const violations: Violation[] = [];
  const unparsed: UnparsedFile[] = [];
  const read = (absolute: string, parse: typeof yamlSource): SourceFile | undefined => {
    const file = relative(root, absolute);
    const text = readFileSync(absolute, 'utf8');
    const result = parse(file, text);
    violations.push(...result.violations);
    if (result.source === undefined) unparsed.push({ path: file, text });
    return result.source;
  };
  const stray = (absolute: string, expected: string): void => {
    violations.push({
      code: 'file-name',
      file: relative(root, absolute),
      message: `only ${expected} belong here`,
    });
  };

  const yamlFiles = (dir: string, expected: string): SourceFile[] => {
    const out: SourceFile[] = [];
    for (const name of listDir(path.join(root, dir))) {
      const absolute = path.join(root, dir, name);
      if (!name.endsWith('.yaml') || !statSync(absolute).isFile()) {
        stray(absolute, expected);
        continue;
      }
      const source = read(absolute, yamlSource);
      if (source !== undefined) out.push(source);
    }
    return out;
  };

  const products = yamlFiles('products', '<service>[.<suffix>].yaml product files');
  const lenses = yamlFiles('lenses', '<lens id>.yaml lens files');
  const knownUnmapped = yamlFiles(KNOWN_UNMAPPED_DIR, '<group>.yaml group files');
  if (!existsSync(path.join(root, KNOWN_UNMAPPED_DIR))) {
    violations.push({ code: 'load', file: `${KNOWN_UNMAPPED_DIR}/`, message: 'known-unmapped/ is missing' });
  }
  if (existsSync(path.join(root, 'known-unmapped.yaml'))) {
    violations.push({
      code: 'file-name',
      file: 'known-unmapped.yaml',
      message:
        'the single file became known-unmapped/<group>.yaml (one per authoring group): move its entries there',
    });
  }

  const fixtures: SourceFile[] = [];
  for (const service of listDir(path.join(root, 'fixtures'))) {
    const serviceDir = path.join(root, 'fixtures', service);
    if (!statSync(serviceDir).isDirectory()) {
      stray(serviceDir, '<service>/ directories');
      continue;
    }
    for (const name of listDir(serviceDir)) {
      const absolute = path.join(serviceDir, name);
      if (!name.endsWith('.json') || !statSync(absolute).isFile()) {
        stray(absolute, '<Type>.json fixture files');
        continue;
      }
      const source = read(absolute, jsonSource);
      if (source !== undefined) fixtures.push(source);
    }
  }

  const optional = (name: string, parse: typeof yamlSource): SourceFile | undefined => {
    const absolute = path.join(root, name);
    if (existsSync(absolute)) return read(absolute, parse);
    violations.push({ code: 'load', file: name, message: `${name} is missing` });
    return undefined;
  };
  const iconKeys = optional('icon-keys.json', jsonSource);

  return { products, lenses, fixtures, knownUnmapped, iconKeys, loadViolations: violations, unparsed };
}

/** The paths of every data file `loadSources` found, parsed or not, so a `--file` selection can be checked. */
export function sourcePaths(sources: CatalogSources): Set<string> {
  return new Set([
    ...[
      ...sources.products,
      ...sources.lenses,
      ...sources.fixtures,
      ...sources.knownUnmapped,
      sources.iconKeys,
    ]
      .filter((file): file is SourceFile => file !== undefined)
      .map((file) => file.path),
    ...sources.loadViolations
      .filter((violation) => violation.code === 'load')
      .map((violation) => violation.file)
      .filter((file): file is string => file !== undefined),
  ]);
}

/**
 * Files under the generated directory that git tracks and that exist: the compiled catalog is a build
 * artefact (git-ignored, written by `pnpm catalog:build`), and committing it would bring back the merge
 * conflicts it was taken out of the repository to avoid. Paths relative to the catalog root; empty outside a
 * git checkout.
 */
export function committedGeneratedFiles(root: string = CATALOG_ROOT): string[] {
  const directory = path.join(root, GENERATED_DIR);
  const result = spawnSync('git', ['ls-files', '-z', '--', directory], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0 || typeof result.stdout !== 'string') return [];
  return result.stdout
    .split('\0')
    .filter((file) => file !== '')
    .map((file) => path.resolve(root, file))
    .filter((file) => existsSync(file))
    .map((file) => relative(root, file))
    .sort();
}

/** The dated snapshot files in a directory, oldest first. */
export function snapshotFiles(dir: string): Array<{ date: string; file: string }> {
  return listDir(dir)
    .map((name) => ({ name, match: SNAPSHOT_FILE.exec(name) }))
    .filter((item): item is { name: string; match: RegExpExecArray } => item.match !== null)
    .map(({ name, match }) => ({ date: match[1] ?? '', file: path.join(dir, name) }));
}

/** The identifiers of a snapshot text file: one per line, `#` comments and blank lines ignored. */
export function parseSnapshotText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Product section per type from a snapshot's `.products.json` companion (resource sections win). */
export function parseProductsFile(content: unknown): Map<string, string> {
  const productOf = new Map<string, string>();
  const products =
    isRecord(content) && Array.isArray(content['products']) ? (content['products'] as unknown[]) : [];
  const ordered = [...products].sort((a, b) => {
    const rank = (item: unknown): number => (isRecord(item) && item['section'] === 'resource' ? 0 : 1);
    return rank(a) - rank(b);
  });
  for (const item of ordered) {
    if (!isRecord(item) || typeof item['product'] !== 'string' || !Array.isArray(item['types'])) continue;
    for (const type of item['types'] as unknown[]) {
      const id = isRecord(type) ? type['type'] : undefined;
      if (typeof id === 'string' && !productOf.has(id)) productOf.set(id, item['product']);
    }
  }
  return productOf;
}

/** Reads the newest official snapshot in `dir` (and its products file, when present). */
export function readOfficialList(dir: string = OFFICIAL_DIR): OfficialList {
  const newest = snapshotFiles(dir).at(-1);
  if (newest === undefined) {
    throw new Error(`no cai-supported-asset-types.<date>.txt in ${dir}; run pnpm catalog:fetch-official`);
  }
  const types = new Set(parseSnapshotText(readFileSync(newest.file, 'utf8')));
  const productsFile = newest.file.replace(/\.txt$/, '.products.json');
  const productOf = existsSync(productsFile)
    ? parseProductsFile(JSON.parse(readFileSync(productsFile, 'utf8')) as unknown)
    : undefined;
  return {
    date: newest.date,
    file: relative(REPO_ROOT, newest.file),
    types,
    ...(productOf === undefined ? {} : { productOf }),
  };
}

/** The `license` field of the repository's root package.json (the SPDX id every source file carries). */
export function repositoryLicense(): string {
  const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as unknown;
  const license = isRecord(manifest) ? manifest['license'] : undefined;
  if (typeof license !== 'string') throw new Error('the root package.json has no license field');
  return license;
}

/** The catalog package's version, stamped into catalog.json. */
export function catalogVersion(root: string = CATALOG_ROOT): string {
  const file = path.join(root, 'package.json');
  if (!existsSync(file)) return '0.0.0';
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  const version = isRecord(manifest) ? manifest['version'] : undefined;
  return typeof version === 'string' ? version : '0.0.0';
}
