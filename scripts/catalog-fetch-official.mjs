// SPDX-License-Identifier: MIT
// @ts-check
/**
 * `pnpm catalog:fetch-official`: downloads Google's list of asset types supported by Cloud Asset Inventory,
 * extracts every asset-type identifier and the product section it is listed under, and writes a dated snapshot
 * next to the existing ones (skill gcp-asset-catalog §8):
 *
 *   .agents/skills/gcp-asset-catalog/references/cai-supported-asset-types.<YYYY-MM-DD>.txt
 *       one identifier per line, sorted, after a short `#` header (the format the catalog check and the
 *       weekly catalog-drift workflow read);
 *   .agents/skills/gcp-asset-catalog/references/cai-supported-asset-types.<YYYY-MM-DD>.products.json
 *       the product sections: which product lists which types, with each type's API reference link.
 *
 * It then prints the identifiers added and removed since the newest snapshot that existed before the run (a
 * snapshot of the same date is compared as it was, then replaced). It never commits.
 *
 * The English original is requested (`hl=en`) and anything else refused: the site sometimes serves a
 * machine-translated copy of the page whose list is months behind.
 *
 * Usage: node scripts/catalog-fetch-official.mjs [--from <saved.html>] [--url <url>] [--out-dir <dir>]
 *                                                [--date <YYYY-MM-DD>] [--force]
 *   --from     parse a saved copy of the page instead of downloading it (tests use a trimmed sample)
 *   --out-dir  where the snapshots live (default: the skill's references directory)
 *   --date     the snapshot date (default: today, UTC)
 *   --force    write even when the page yields fewer than half the identifiers of the previous snapshot
 *              (without it, that is treated as a page-layout change and nothing is written)
 *
 * Plain ESM, Node built-ins only (Prettier, a root dev dependency, formats the JSON when it is installed).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const OFFICIAL_URL = 'https://docs.cloud.google.com/asset-inventory/docs/supported-asset-types';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, '.agents', 'skills', 'gcp-asset-catalog', 'references');
const SNAPSHOT_FILE = /^cai-supported-asset-types\.([0-9]{4}-[0-9]{2}-[0-9]{2})\.txt$/;
const IDENTIFIER = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+\/[A-Za-z][A-Za-z0-9]*$/;

/** The page's three tables, by the id of the heading that introduces each. */
const SECTIONS = /** @type {const} */ ([
  ['resource-types', 'resource'],
  ['policy-types', 'policy'],
  ['runtime-information-types', 'runtime'],
]);

/** @typedef {'resource' | 'policy' | 'runtime'} SectionKind */
/** @typedef {{ type: string, reference?: string }} OfficialType */
/** @typedef {{ product: string, section: SectionKind, types: OfficialType[] }} OfficialProduct */

/** @type {Record<string, string>} */
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * Decodes the HTML character references the page uses.
 * @param {string} text
 * @returns {string}
 */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, /** @type {string} */ ref) => {
    if (ref.startsWith('#x') || ref.startsWith('#X')) return String.fromCodePoint(parseInt(ref.slice(2), 16));
    if (ref.startsWith('#')) return String.fromCodePoint(parseInt(ref.slice(1), 10));
    return NAMED_ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

/**
 * The visible text of an HTML fragment: tags removed, references decoded, whitespace collapsed.
 * @param {string} html
 * @returns {string}
 */
function textOf(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts the product sections from the page: each table row names a product in its first cell and lists
 * that product's asset types as `<code>` identifiers (broken up with `<wbr>`) in the following cells.
 * @param {string} html
 * @param {string} [baseUrl] resolves relative API reference links
 * @returns {OfficialProduct[]}
 */
export function parseOfficialPage(html, baseUrl = OFFICIAL_URL) {
  const starts = SECTIONS.map(([id, kind]) => ({
    kind,
    at: html.search(new RegExp(`<h2[^>]*\\bid="${id}"`)),
  }))
    .filter((section) => section.at !== -1)
    .sort((a, b) => a.at - b.at);
  /** @type {OfficialProduct[]} */
  const products = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/g)) {
    const section = starts.filter((start) => start.at < row.index).at(-1);
    if (section === undefined) continue;
    const [, first = '', ...rest] = (row[1] ?? '').split(/<td\b/);
    const name = /<b\b[^>]*>([\s\S]*?)<\/b\s*>/.exec(first);
    if (name === null) continue;
    const product = textOf(name[1] ?? '');
    /** @type {OfficialType[]} */
    const types = [];
    for (const code of rest
      .join('<td')
      .matchAll(/(?:<a\b[^>]*\bhref="([^"]*)"[^>]*>\s*)?<code\b[^>]*>([\s\S]*?)<\/code\s*>/g)) {
      const type = textOf(code[2] ?? '').replace(/\s+/g, '');
      if (!IDENTIFIER.test(type) || types.some((known) => known.type === type)) continue;
      const href = code[1] === undefined ? undefined : decodeEntities(code[1]);
      types.push(href === undefined ? { type } : { type, reference: new URL(href, baseUrl).href });
    }
    if (product !== '' && types.length > 0) products.push({ product, section: section.kind, types });
  }
  return products;
}

/**
 * Every identifier, once, in byte order (the order `LC_ALL=C sort` gives).
 * @param {readonly OfficialProduct[]} products
 * @returns {string[]}
 */
export function identifiersOf(products) {
  const all = new Set(products.flatMap((product) => product.types.map((entry) => entry.type)));
  return [...all].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The snapshot file's text.
 * @param {string} date
 * @param {readonly string[]} identifiers
 * @returns {string}
 */
export function snapshotText(date, identifiers) {
  return [
    `# Cloud Asset Inventory supported asset types, snapshot ${date}`,
    `# Source: ${OFFICIAL_URL}`,
    '# One identifier per line. Includes resource, policy and runtime-information types.',
    '# Regenerate with scripts/catalog-fetch-official.mjs (pnpm catalog:fetch-official) and commit a new dated file.',
    ...identifiers,
    '',
  ].join('\n');
}

/**
 * The identifiers of a snapshot file's text.
 * @param {string} text
 * @returns {string[]}
 */
export function snapshotIdentifiers(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/**
 * Identifiers added and removed between two lists.
 * @param {readonly string[]} before
 * @param {readonly string[]} after
 * @returns {{ added: string[], removed: string[] }}
 */
export function diffLists(before, after) {
  const old = new Set(before);
  const now = new Set(after);
  return { added: after.filter((id) => !old.has(id)), removed: before.filter((id) => !now.has(id)) };
}

/**
 * The JSON text, formatted like the rest of the repository when Prettier is available.
 * @param {unknown} value
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function formatJson(value, filePath) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  try {
    const prettier = await import('prettier');
    const config = (await prettier.resolveConfig(filePath)) ?? {};
    return await prettier.format(text, { ...config, filepath: filePath });
  } catch {
    return text;
  }
}

/**
 * The page's language, from its `<html lang>`; undefined when the page does not say.
 * @param {string} html
 * @returns {string | undefined}
 */
export function pageLanguage(html) {
  return /<html\b[^>]*\blang="([^"]*)"/i.exec(html)?.[1];
}

/**
 * Whether a page is the English original. The site sometimes redirects to a machine-translated copy
 * (`lang="ko-x-mtfrom-en"`, `?hl=ko`) whose list lags the original by months, so anything else is refused.
 * A page without a `lang` attribute (a trimmed test sample) is accepted.
 * @param {string} html
 * @returns {boolean}
 */
export function isEnglishOriginal(html) {
  const lang = pageLanguage(html);
  return lang === undefined || (/^en(?:-|$)/i.test(lang) && !lang.includes('-x-'));
}

/**
 * The page's own "Last updated" date, if it shows one.
 * @param {string} html
 * @returns {string | undefined}
 */
export function pageUpdated(html) {
  return /Last updated ([0-9]{4}-[0-9]{2}-[0-9]{2}) UTC/.exec(html)?.[1];
}

/**
 * Downloads the English original of the page (`hl=en`, `Accept-Language: en`).
 * @param {string} url
 * @returns {Promise<string>}
 */
async function download(url) {
  const english = new URL(url);
  english.searchParams.set('hl', 'en');
  const response = await fetch(english, {
    headers: {
      'user-agent': 'gcportrait catalog:fetch-official',
      accept: 'text/html',
      'accept-language': 'en',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`GET ${english.href}: HTTP ${String(response.status)}`);
  return response.text();
}

/** @param {string} message */
function fail(message) {
  console.error(`catalog:fetch-official: ${message}`);
  process.exit(1);
}

async function main() {
  const { values } = parseArgs({
    options: {
      from: { type: 'string' },
      url: { type: 'string', default: OFFICIAL_URL },
      'out-dir': { type: 'string', default: DEFAULT_OUT_DIR },
      date: { type: 'string', default: new Date().toISOString().slice(0, 10) },
      force: { type: 'boolean', default: false },
    },
  });
  const { url, date, force } = values;
  const outDir = path.resolve(values['out-dir']);
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) fail(`--date must be YYYY-MM-DD, not ${date}`);

  const html = values.from === undefined ? await download(url) : readFileSync(values.from, 'utf8');
  if (!isEnglishOriginal(html)) {
    fail(
      `the page is a machine translation (lang="${pageLanguage(html) ?? ''}"), whose list lags the English ` +
        'original; nothing written (re-run, or save the English page and pass it with --from)',
    );
  }
  const products = parseOfficialPage(html, url);
  const identifiers = identifiersOf(products);
  if (identifiers.length === 0) fail('found no asset-type identifiers; has the page layout changed?');

  const target = `cai-supported-asset-types.${date}.txt`;
  const existing = (existsSync(outDir) ? readdirSync(outDir) : [])
    .filter((name) => SNAPSHOT_FILE.test(name))
    .sort();
  // The newest snapshot before this run; when it carries today's date, it is compared as it was, then replaced.
  const previous = existing.at(-1);
  const before =
    previous === undefined ? [] : snapshotIdentifiers(readFileSync(path.join(outDir, previous), 'utf8'));
  if (!force && identifiers.length < before.length / 2) {
    fail(
      `found ${String(identifiers.length)} identifiers, fewer than half of the ${String(before.length)} in ` +
        `${previous ?? ''}; the page layout has probably changed (re-run with --force to write anyway)`,
    );
  }

  mkdirSync(outDir, { recursive: true });
  const textFile = path.join(outDir, target);
  const productsFile = path.join(outDir, target.replace(/\.txt$/, '.products.json'));
  writeFileSync(textFile, snapshotText(date, identifiers));
  const updated = pageUpdated(html);
  const companion = {
    date,
    source: url,
    ...(updated === undefined ? {} : { pageUpdated: updated }),
    description:
      'Product sections of the official supported-asset-types page, as extracted by ' +
      'scripts/catalog-fetch-official.mjs; the .txt file next to this one is the identifier list.',
    products,
  };
  writeFileSync(productsFile, await formatJson(companion, productsFile));

  const shown = (/** @type {string} */ file) => path.relative(process.cwd(), file) || file;
  console.log(
    `catalog:fetch-official: ${String(identifiers.length)} asset types in ${String(products.length)} product ` +
      `sections; wrote ${shown(textFile)} and ${shown(productsFile)}.`,
  );
  if (previous === undefined) {
    console.log('No earlier snapshot to compare with.');
    return;
  }
  const { added, removed } = diffLists(before, identifiers);
  const replaced = previous === target ? ' (its content before this run, which this run replaced)' : '';
  console.log(
    `Compared with ${previous}${replaced}: ${String(added.length)} added, ${String(removed.length)} removed.`,
  );
  for (const id of added) console.log(`+ ${id}`);
  for (const id of removed) console.log(`- ${id}`);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
