// SPDX-License-Identifier: Apache-2.0
// @ts-check
/**
 * The icon drift check's logic, pure and synchronous so the tests can feed it synthetic archives: compare the
 * icon archives Google Cloud provides at https://cloud.google.com/icons with `archive-index.json` (what was there
 * when the icons were last vendored), `mapping.json` and `manifest.json`, and describe the difference.
 *
 * What counts as drift (exit code 1 of drift.mjs, an issue in the weekly workflow):
 *  - the page links an archive mapping.json does not name, or no longer links one it names;
 *  - an archive gained, changed, renamed or lost an SVG entry since it was vendored, or is gone (HTTP 4xx);
 *  - an entry mapping.json uses is missing from the current archive;
 *  - a product still drawn with an older symbol (a legacy console icon, or a category mark standing in) has a
 *    matching new-style icon in the current archives, and mapping.json's `keepOlderSymbol` does not record a
 *    decision to keep the older one.
 * Which products still use the older symbols, and which icons on the page the repository does not vendor, is
 * reported too, as information.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';

import { SETS } from './mapping.mjs';

/**
 * @typedef {import('./mapping.mjs').SetName} SetName
 * @typedef {import('./mapping.mjs').Mapping} Mapping
 * @typedef {import('./manifest.mjs').Manifest} Manifest
 * @typedef {import('./archive-index.mjs').ArchiveIndex} ArchiveIndex
 * @typedef {import('./catalog-keys.mjs').CatalogProduct} CatalogProduct
 *
 * @typedef {object} FetchedArchive an archive as fetched now
 * @property {string} url
 * @property {boolean} available false when it could not be had (HTTP 4xx, not linked, not in --zips)
 * @property {string} [reason] why it is not available
 * @property {number} [bytes]
 * @property {string} [sha256]
 * @property {Record<string, string>} [entries] SVG entry name → SHA-256
 *
 * @typedef {{ from: string, to: string, sameContent: boolean }} Rename
 * @typedef {{ added: string[], changed: string[], renamed: Rename[], removed: string[] }} InventoryDiff
 *
 * @typedef {object} Guess the catalog product (icon key) a new icon probably belongs to, by its name
 * @property {string} key
 * @property {string} label the name or icon key that matched
 * @property {number} score 1 same name, 0.9 acronym, else the share of common words
 * @property {string[]} also other keys that matched as well
 *
 * @typedef {{ key: string, label: string, compact: string, acronym: string, tokens: Set<string> }} Candidate
 *
 * @typedef {object} SetReport
 * @property {SetName} set
 * @property {string} title
 * @property {string} url
 * @property {boolean} available
 * @property {string} [reason]
 * @property {boolean} baseline whether archive-index.json has this set
 * @property {string} [baselineSha256]
 * @property {string} [sha256]
 * @property {boolean} unchanged the archive's bytes equal the baseline's
 * @property {number} entryCount SVG entries in the current archive
 * @property {Array<{ name: string, guess: Guess | undefined }>} added
 * @property {Array<{ name: string, usedBy: string[] }>} changed
 * @property {Array<Rename & { usedBy: string[] }>} renamed
 * @property {Array<{ name: string, usedBy: string[] }>} removed
 * @property {Array<{ name: string, guess: Guess | undefined }>} notVendored current entries mapping.json does not
 *   name (so not vendored)
 *
 * @typedef {object} ExtraReport an archive the page links that mapping.json does not name
 * @property {string} url
 * @property {boolean} available
 * @property {string} [reason]
 * @property {Array<{ name: string, guess: Guess | undefined }>} added
 *
 * @typedef {object} DriftReport
 * @property {{ url: string, checked: boolean, links: string[], unknownLinks: string[], missingLinks: Array<{ set: SetName, url: string }> }} page
 * @property {SetReport[]} sets
 * @property {ExtraReport[]} extra
 * @property {Array<{ set: SetName, entry: string, keys: string[], fallback: string[] }>} mappedMissing
 * @property {Array<{ key: string, uses: 'legacy' | 'category', current: string, set: string, entry: string, score: number }>} newerAvailable
 * @property {Array<{ key: string, reason: string, entry: string }>} keptOlder newer icons ignored by keepOlderSymbol
 * @property {{ core: string[], legacy: string[], category: string[], own: string[] }} symbols which artwork each product key uses
 * @property {boolean} drift
 * @property {string} digest identifies this drift (stable across runs that find the same thing)
 * @property {string} summary
 */

/** Connector words an acronym skips (GKE is Google Kubernetes Engine, IAM Identity and Access Management). */
const ACRONYM_SKIPS = new Set(['a', 'an', 'and', 'by', 'for', 'in', 'of', 'on', 'the', 'to', 'with']);

/** Words that say nothing about which product an icon shows: the brand and the connectors. */
const STOP_WORDS = new Set([...ACRONYM_SKIPS, 'cloud', 'gcp', 'google']);

/** Directory names that group files rather than name a product. */
const GROUPING_DIR = /^(svg|png|color|colour|mono|rgb|cmyk)$|icons?$/i;

/** File-name suffixes that describe the rendition, not the product. */
const RENDITION_SUFFIX = /[-_ ](\d+(px)?|color|colour|rgb|cmyk|mono|grey|gray|white|black|dark|light|icon)$/i;

/** The score at or above which a name match is reported as a guess. */
export const GUESS_SCORE = 0.5;

/** The score at or above which a new-style icon is taken to show a product that uses an older symbol. */
export const NEWER_SCORE = 0.66;

/**
 * The product name an archive entry is filed under: the innermost directory that names something (not `SVG`,
 * `PNG` or `… Icons`), else the file name without its rendition suffixes.
 * @param {string} entry
 * @returns {string}
 */
export function iconNameOf(entry) {
  const segments = entry.split('/');
  const file = segments.pop() ?? '';
  const named = segments.filter((segment) => segment !== '' && !GROUPING_DIR.test(segment));
  const last = named.at(-1);
  if (last !== undefined) return last;
  let stem = path.posix.basename(file, path.posix.extname(file));
  while (RENDITION_SUFFIX.test(stem)) stem = stem.replace(RENDITION_SUFFIX, '');
  return stem;
}

/**
 * Lower-case words of a name, camelCase and acronyms split (`AlloyDB` → alloy db, `AIHypercomputer` → ai
 * hypercomputer).
 * @param {string} name
 * @returns {string[]}
 */
function wordsOf(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
}

/**
 * @param {string} key
 * @param {string} label
 * @returns {Candidate}
 */
function candidate(key, label) {
  const words = wordsOf(label);
  const tokens = words.filter((word) => !STOP_WORDS.has(word) && !/^\d+$/.test(word));
  return {
    key,
    label,
    compact: tokens.join(''),
    acronym: words
      .filter((word) => !ACRONYM_SKIPS.has(word))
      .map((word) => word[0])
      .join(''),
    tokens: new Set(tokens),
  };
}

/**
 * How alike two names are: 1 when their significant words read the same run together (`Vertex AI` and
 * `vertexai`), 0.9 when one is the other's acronym (`GKE`), 0.45 for the same words in another order (below
 * `GUESS_SCORE`: `Text-to-Speech` is not `Speech-to-Text`), else the share of significant words in common.
 * @param {Candidate} a
 * @param {Candidate} b
 * @returns {number}
 */
export function nameScore(a, b) {
  if (a.compact === '' || b.compact === '') return 0;
  if (a.compact === b.compact) return 1;
  if (
    (a.compact.length >= 2 && a.compact === b.acronym) ||
    (b.compact.length >= 2 && b.compact === a.acronym)
  )
    return 0.9;
  let common = 0;
  for (const token of a.tokens) if (b.tokens.has(token)) common += 1;
  const union = a.tokens.size + b.tokens.size - common;
  if (union === 0) return 0;
  return common === union ? 0.45 : common / union;
}

/**
 * What a new product icon's name is matched against: every icon key of mapping.json, the archive names its
 * entries already use (Google's spelling, e.g. `cloud_api_gateway` for `api_gateway`), and the catalog's product
 * names (and a name in parentheses, e.g. "Access Policy (Access Context Manager)").
 * @param {Mapping} mapping
 * @param {readonly CatalogProduct[]} products
 * @returns {Candidate[]}
 */
export function productCandidates(mapping, products) {
  /** @type {Candidate[]} */
  const list = [];
  for (const [key, entry] of Object.entries(mapping.icons)) {
    list.push(candidate(key, key));
    for (const source of [entry.core, entry.legacy]) {
      if (source !== undefined) list.push(candidate(key, iconNameOf(source)));
    }
  }
  for (const { product, key } of products) {
    if (!(key in mapping.icons)) continue;
    const inner = /\(([^)]*)\)/.exec(product)?.[1];
    list.push(candidate(key, product.replace(/\s*\([^)]*\)\s*/g, ' ').trim()));
    if (inner !== undefined) list.push(candidate(key, inner));
  }
  return list;
}

/**
 * What a new category mark's name is matched against: the category keys and the names their entries use.
 * @param {Mapping} mapping
 * @returns {Candidate[]}
 */
export function categoryCandidates(mapping) {
  return Object.entries(mapping.categories).flatMap(([key, entry]) => [
    candidate(key, key.replace(/^category_/, '')),
    candidate(key, iconNameOf(entry)),
  ]);
}

/**
 * The best-matching key for an icon's name, or undefined when nothing reaches `GUESS_SCORE`.
 * @param {string} name
 * @param {readonly Candidate[]} candidates
 * @returns {Guess | undefined}
 */
export function guessKey(name, candidates) {
  const subject = candidate('', name);
  let best = 0;
  /** @type {Candidate[]} */
  let winners = [];
  for (const other of candidates) {
    const score = nameScore(subject, other);
    if (score > best) {
      best = score;
      winners = [other];
    } else if (score === best && score > 0) winners.push(other);
  }
  const first = winners[0];
  if (first === undefined || best < GUESS_SCORE) return undefined;
  const keys = [...new Set(winners.map((winner) => winner.key))].sort();
  const key = first.key;
  return {
    key,
    label: first.label,
    score: Math.round(best * 100) / 100,
    also: keys.filter((k) => k !== key),
  };
}

/**
 * Two inventories (entry name → SHA-256) compared: entries added, changed (same name, other bytes), renamed
 * (the same bytes under another name, or one removed and one added entry that name the same product) and
 * removed. Every list is sorted.
 * @param {Readonly<Record<string, string>>} before
 * @param {Readonly<Record<string, string>>} after
 * @returns {InventoryDiff}
 */
export function compareInventories(before, after) {
  const added = Object.keys(after)
    .filter((name) => !(name in before))
    .sort();
  const removed = Object.keys(before)
    .filter((name) => !(name in after))
    .sort();
  const changed = Object.keys(after)
    .filter((name) => name in before && before[name] !== after[name])
    .sort();
  /** @type {Rename[]} */
  const renamed = [];
  const addedLeft = new Set(added);
  const removedLeft = new Set(removed);
  for (const from of removed) {
    const to = added.find((name) => addedLeft.has(name) && after[name] === before[from]);
    if (to === undefined) continue;
    renamed.push({ from, to, sameContent: true });
    addedLeft.delete(to);
    removedLeft.delete(from);
  }
  /** @param {string} name */
  const product = (name) => candidate('', iconNameOf(name)).compact;
  for (const from of [...removedLeft]) {
    const key = product(from);
    if (key === '') continue;
    const sameRemoved = [...removedLeft].filter((name) => product(name) === key);
    const sameAdded = [...addedLeft].filter((name) => product(name) === key);
    const to = sameAdded[0];
    if (sameRemoved.length !== 1 || sameAdded.length !== 1 || to === undefined) continue;
    renamed.push({ from, to, sameContent: false });
    addedLeft.delete(to);
    removedLeft.delete(from);
  }
  return {
    added: [...addedLeft].sort(),
    changed,
    renamed: renamed.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)),
    removed: [...removedLeft].sort(),
  };
}

/**
 * Which keys use each mapped entry, per set (core and legacy entries by icon key, category marks by category key).
 * @param {Mapping} mapping
 * @returns {Record<SetName, Map<string, string[]>>}
 */
export function mappedEntries(mapping) {
  /** @type {Record<SetName, Map<string, string[]>>} */
  const uses = { core: new Map(), legacy: new Map(), category: new Map() };
  /**
   * @param {SetName} set
   * @param {string} entry
   * @param {string} key
   */
  const add = (set, entry, key) => uses[set].set(entry, [...(uses[set].get(entry) ?? []), key].sort());
  for (const [key, entry] of Object.entries(mapping.categories)) add('category', entry, key);
  for (const [key, entry] of Object.entries(mapping.icons)) {
    if (entry.core !== undefined) add('core', entry.core, key);
    if (entry.legacy !== undefined) add('legacy', entry.legacy, key);
  }
  return uses;
}

/**
 * Which artwork every product key uses today (the generic mark aside): Google Cloud's core colour mark (the 2025
 * icon system), a legacy console icon (the older symbols the page still offers), a category mark standing in, or
 * an own drawing.
 * @param {Mapping} mapping
 * @param {Manifest} manifest
 * @returns {DriftReport['symbols']}
 */
export function symbolsInUse(mapping, manifest) {
  /** @type {DriftReport['symbols']} */
  const symbols = { core: [], legacy: [], category: [], own: [] };
  for (const [key, entry] of Object.entries(mapping.icons).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (entry.generic === true) continue;
    if (entry.own !== undefined) {
      symbols.own.push(key);
      continue;
    }
    const icon = manifest.icons[key];
    if (icon === undefined) continue;
    if (icon.kind === 'category') symbols.category.push(key);
    else if (manifest.files[icon.file]?.set === 'core') symbols.core.push(key);
    else symbols.legacy.push(key);
  }
  return symbols;
}

/**
 * The candidates vendor.mjs would fall back to for a key whose `set` entry vanished, in its order.
 * @param {string} key
 * @param {SetName} set
 * @param {Mapping} mapping
 * @param {Partial<Record<SetName, FetchedArchive>>} current
 * @returns {string[]}
 */
function fallbackOf(key, set, mapping, current) {
  if (set === 'category')
    return ['none: vendor.mjs stops until mapping.json names an existing category mark'];
  const entry = mapping.icons[key];
  if (entry === undefined) return [];
  /** @type {string[]} */
  const next = [];
  if (set === 'core' && entry.legacy !== undefined) {
    const there = current.legacy?.entries?.[entry.legacy] !== undefined;
    next.push(`legacy "${entry.legacy}"${there ? '' : ' (missing too)'}`);
  }
  if (entry.category !== undefined) next.push(`category mark ${entry.category}`);
  return next.length === 0 ? ['none: vendor.mjs stops'] : next;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
const digestOf = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/**
 * Compares the archives fetched now with the baseline and the mapping.
 * @param {object} input
 * @param {Mapping} input.mapping
 * @param {Manifest} input.manifest
 * @param {ArchiveIndex | undefined} input.index
 * @param {readonly CatalogProduct[]} input.products
 * @param {{ url: string, links: readonly string[] } | undefined} input.page undefined when the page was not read
 * @param {Partial<Record<SetName, FetchedArchive>>} input.current the mapped sets as fetched now
 * @param {readonly FetchedArchive[]} input.extra archives the page links that mapping.json does not name
 * @returns {DriftReport}
 */
export function driftReport({ mapping, manifest, index, products, page, current, extra }) {
  const productNames = productCandidates(mapping, products);
  const categories = categoryCandidates(mapping);
  const used = mappedEntries(mapping);
  /** @param {SetName | undefined} set */
  const candidatesFor = (set) => (set === 'category' ? categories : productNames);

  const mappedUrls = SETS.map((set) => mapping.sources[set].url);
  const links = page === undefined ? [] : [...page.links].sort();
  const reportPage = {
    url: page?.url ?? index?.page ?? 'https://cloud.google.com/icons',
    checked: page !== undefined,
    links,
    unknownLinks: links.filter((link) => !mappedUrls.includes(link)),
    missingLinks:
      page === undefined
        ? []
        : SETS.filter((set) => !links.includes(mapping.sources[set].url)).map((set) => ({
            set,
            url: mapping.sources[set].url,
          })),
  };

  /** @type {SetReport[]} */
  const sets = [];
  /** @type {DriftReport['mappedMissing']} */
  const mappedMissing = [];
  for (const set of SETS) {
    const { title, url } = mapping.sources[set];
    const fetched = current[set];
    const baseline = index?.sources[set];
    const entries = fetched?.entries;
    /** @type {SetReport} */
    const report = {
      set,
      title,
      url,
      available: fetched?.available === true && entries !== undefined,
      baseline: baseline !== undefined && baseline.url === url,
      unchanged: false,
      entryCount: entries === undefined ? 0 : Object.keys(entries).length,
      added: [],
      changed: [],
      renamed: [],
      removed: [],
      notVendored: [],
    };
    if (fetched?.reason !== undefined) report.reason = fetched.reason;
    if (baseline !== undefined) report.baselineSha256 = baseline.sha256;
    if (fetched?.sha256 !== undefined) report.sha256 = fetched.sha256;
    const usedHere = used[set];
    /** @param {string} name */
    const usedBy = (name) => usedHere.get(name) ?? [];
    if (entries !== undefined && fetched?.available === true) {
      report.unchanged = report.baseline && baseline?.sha256 === fetched.sha256;
      const diff = compareInventories(report.baseline ? (baseline?.entries ?? {}) : {}, entries);
      report.added = diff.added.map((name) => ({
        name,
        guess: guessKey(iconNameOf(name), candidatesFor(set)),
      }));
      report.changed = diff.changed.map((name) => ({ name, usedBy: usedBy(name) }));
      report.renamed = diff.renamed.map((rename) => ({ ...rename, usedBy: usedBy(rename.from) }));
      report.removed = diff.removed.map((name) => ({ name, usedBy: usedBy(name) }));
      report.notVendored = Object.keys(entries)
        .filter((name) => !usedHere.has(name))
        .sort()
        .map((name) => ({ name, guess: guessKey(iconNameOf(name), candidatesFor(set)) }));
      for (const [entry, keys] of [...usedHere].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        if (entry in entries) continue;
        mappedMissing.push({
          set,
          entry,
          keys,
          fallback: keys.flatMap((key) =>
            fallbackOf(key, set, mapping, current).map((step) => `${key}: ${step}`),
          ),
        });
      }
    }
    sets.push(report);
  }

  /** @type {ExtraReport[]} */
  const extraReports = [...extra]
    .sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
    .map((archive) => {
      /** @type {ExtraReport} */
      const report = {
        url: archive.url,
        available: archive.available && archive.entries !== undefined,
        added: Object.keys(archive.entries ?? {})
          .sort()
          .map((name) => ({ name, guess: guessKey(iconNameOf(name), productNames) })),
      };
      if (archive.reason !== undefined) report.reason = archive.reason;
      return report;
    });

  // Products on an older symbol that a new-style icon in the current archives (the core set, or an archive the
  // mapping does not know yet) probably shows.
  const symbols = symbolsInUse(mapping, manifest);
  const older = new Map([
    ...symbols.legacy.map((key) => /** @type {const} */ ([key, 'legacy'])),
    ...symbols.category.map((key) => /** @type {const} */ ([key, 'category'])),
  ]);
  const keep = mapping.keepOlderSymbol ?? {};
  /** @type {DriftReport['newerAvailable']} */
  const newerAvailable = [];
  /** @type {DriftReport['keptOlder']} */
  const keptOlder = [];
  /** @type {Array<{ set: string, name: string }>} */
  const newStyle = [
    ...Object.keys(current.core?.entries ?? {})
      .filter((name) => !used.core.has(name))
      .map((name) => ({ set: 'core', name })),
    ...extraReports.flatMap((report) => report.added.map(({ name }) => ({ set: report.url, name }))),
  ];
  for (const { set, name } of newStyle) {
    const subject = candidate('', iconNameOf(name));
    for (const [key, uses] of older) {
      const score = Math.max(
        0,
        ...productNames.filter((other) => other.key === key).map((other) => nameScore(subject, other)),
      );
      if (score < NEWER_SCORE) continue;
      const reason = keep[key];
      if (reason !== undefined) {
        keptOlder.push({ key, reason, entry: name });
        continue;
      }
      const entry = mapping.icons[key];
      const currentSource =
        uses === 'legacy' ? `legacy "${entry?.legacy ?? '?'}"` : `category mark ${entry?.category ?? '?'}`;
      newerAvailable.push({
        key,
        uses,
        current: currentSource,
        set,
        entry: name,
        score: Math.round(score * 100) / 100,
      });
    }
  }
  newerAvailable.sort(
    (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0),
  );

  const counts = {
    added:
      sets.reduce((n, s) => n + s.added.length, 0) + extraReports.reduce((n, e) => n + e.added.length, 0),
    changed: sets.reduce((n, s) => n + s.changed.length, 0),
    renamed: sets.reduce((n, s) => n + s.renamed.length, 0),
    removed: sets.reduce((n, s) => n + s.removed.length, 0),
  };
  const unavailable = sets.filter((s) => !s.available);
  const drift =
    reportPage.unknownLinks.length > 0 ||
    reportPage.missingLinks.length > 0 ||
    unavailable.length > 0 ||
    extraReports.length > 0 ||
    counts.added + counts.changed + counts.renamed + counts.removed > 0 ||
    mappedMissing.length > 0 ||
    newerAvailable.length > 0;

  const digest = digestOf({
    links: { unknown: reportPage.unknownLinks, missing: reportPage.missingLinks.map((l) => l.url) },
    sets: sets.map((s) => ({
      set: s.set,
      available: s.available,
      sha256: s.unchanged ? 'unchanged' : (s.sha256 ?? null),
      added: s.added.map((a) => a.name),
      changed: s.changed.map((c) => c.name),
      renamed: s.renamed.map((r) => [r.from, r.to]),
      removed: s.removed.map((r) => r.name),
    })),
    extra: extraReports.map((e) => [e.url, e.available, e.added.map((a) => a.name)]),
    mappedMissing: mappedMissing.map((m) => [m.set, m.entry]),
    newerAvailable: newerAvailable.map((n) => [n.key, n.entry]),
  });

  /**
   * @param {number} count
   * @param {string} one
   * @param {string} many
   */
  const amount = (count, one, many) => `${String(count)} ${count === 1 ? one : many}`;
  const parts = [
    `${String(counts.added)} new`,
    `${String(counts.changed)} changed`,
    `${String(counts.renamed)} renamed`,
    `${String(counts.removed)} removed icons`,
    `${amount(mappedMissing.length, 'mapped entry', 'mapped entries')} missing`,
    `${amount(newerAvailable.length, 'product', 'products')} on an older symbol with a newer icon available`,
    amount(
      reportPage.unknownLinks.length + reportPage.missingLinks.length,
      'archive link change',
      'archive link changes',
    ),
  ];
  if (unavailable.length > 0) parts.push(`${amount(unavailable.length, 'archive', 'archives')} unavailable`);
  const summary = drift
    ? `icon drift: ${parts.join(', ')}.`
    : `icon drift: none. The ${String(sets.length)} archives match what was vendored` +
      `${reportPage.checked ? ' and the page links exactly them' : ' (page not checked)'}; ` +
      `${String(symbols.core.length)} product keys use a core colour mark, ${String(symbols.legacy.length)} a legacy ` +
      `console icon, ${String(symbols.category.length)} a category mark, ${String(symbols.own.length)} an own drawing.`;

  return {
    page: reportPage,
    sets,
    extra: extraReports,
    mappedMissing,
    newerAvailable,
    keptOlder,
    symbols,
    drift,
    digest,
    summary,
  };
}

/**
 * @param {Guess | undefined} guess
 * @returns {string}
 */
function describeGuess(guess) {
  if (guess === undefined) return 'no catalog product matched by name';
  const others = guess.also.slice(0, 3).map((key) => `\`${key}\``);
  if (guess.also.length > 3) others.push(`${String(guess.also.length - 3)} more`);
  const also = others.length > 0 ? ` (or ${others.join(', ')})` : '';
  return `probably \`${guess.key}\`${also}, by the name "${guess.label}" (${String(guess.score)})`;
}

/**
 * @param {readonly string[]} keys
 * @returns {string}
 */
const usedByText = (keys) =>
  keys.length === 0 ? 'not used' : `used by ${keys.map((k) => `\`${k}\``).join(', ')}`;

/**
 * The report as plain text, for the terminal and the workflow log.
 * @param {DriftReport} report
 * @returns {string[]}
 */
export function formatText(report) {
  /** @type {string[]} */
  const lines = [];
  const plain = (/** @type {string} */ text) => text.replaceAll('`', '');
  lines.push(
    report.page.checked
      ? `page ${report.page.url}: ${String(report.page.links.length)} archive links` +
          (report.page.unknownLinks.length + report.page.missingLinks.length === 0
            ? ', exactly the ones mapping.json names'
            : '')
      : `page ${report.page.url}: not checked (offline without --page)`,
  );
  for (const link of report.page.unknownLinks)
    lines.push(`  NEW LINK  ${link} (mapping.json does not name it)`);
  for (const { set, url } of report.page.missingLinks)
    lines.push(`  GONE LINK ${url} (${set}; no longer on the page)`);
  for (const set of report.sets) {
    if (!set.available) {
      lines.push(`${set.set} (${set.title}): UNAVAILABLE: ${set.reason ?? 'not fetched'}`);
      continue;
    }
    const state = set.unchanged
      ? 'unchanged'
      : set.baseline
        ? 'CHANGED'
        : 'no baseline in archive-index.json (run vendor)';
    lines.push(
      `${set.set} (${set.title}): ${state}; sha256 ${(set.sha256 ?? '').slice(0, 16)}…, ${String(set.entryCount)} SVG entries, ` +
        `${String(set.entryCount - set.notVendored.length)} named in mapping.json, ${String(set.notVendored.length)} not`,
    );
    for (const { name, guess } of set.added) lines.push(`  NEW      ${name}: ${plain(describeGuess(guess))}`);
    for (const { name, usedBy } of set.changed)
      lines.push(`  CHANGED  ${name} (${plain(usedByText(usedBy))})`);
    for (const { from, to, sameContent, usedBy } of set.renamed)
      lines.push(
        `  RENAMED  ${from} -> ${to}${sameContent ? '' : ' (content changed too)'} (${plain(usedByText(usedBy))})`,
      );
    for (const { name, usedBy } of set.removed)
      lines.push(`  REMOVED  ${name} (${plain(usedByText(usedBy))})`);
  }
  for (const extra of report.extra) {
    lines.push(
      `archive not in mapping.json: ${extra.url}: ${extra.available ? `${String(extra.added.length)} SVG entries` : `not read (${extra.reason ?? '?'})`}`,
    );
    for (const { name, guess } of extra.added)
      lines.push(`  NEW      ${name}: ${plain(describeGuess(guess))}`);
  }
  for (const { set, entry, keys, fallback } of report.mappedMissing)
    lines.push(
      `MISSING mapped ${set} entry "${entry}" (${keys.join(', ')}); falls back to: ${fallback.join('; ')}`,
    );
  for (const item of report.newerAvailable)
    lines.push(
      `NEWER ICON for ${item.key}: uses the ${item.current}; "${item.entry}" (${item.set}) matches by name (${String(item.score)})`,
    );
  for (const item of report.keptOlder)
    lines.push(`  kept older symbol for ${item.key} despite "${item.entry}": ${item.reason}`);
  const core = report.sets.find((set) => set.set === 'core');
  if (core !== undefined && core.notVendored.length > 0)
    lines.push(
      `core marks on the page that mapping.json does not name (not vendored): ` +
        core.notVendored
          .map(({ name, guess }) => `${iconNameOf(name)}${guess === undefined ? '' : ` (~${guess.key})`}`)
          .join(', '),
    );
  lines.push(
    `older symbols still in use: ${String(report.symbols.legacy.length)} product keys use a legacy console icon, ` +
      `${String(report.symbols.category.length)} a category mark standing in (no product icon of their own); ` +
      `${String(report.symbols.core.length)} use a core colour mark, ${String(report.symbols.own.length)} an own drawing`,
  );
  lines.push(report.summary);
  return lines;
}

/**
 * An archive entry name (untrusted text from the download) as inline code: no backticks, no line breaks.
 * @param {string} text
 * @returns {string}
 */
const code = (text) => `\`${text.replace(/[`\r\n]/g, "'")}\``;

/**
 * The report as Markdown: the body of the drift issue and the workflow's job summary.
 * @param {DriftReport} report
 * @returns {string}
 */
export function formatMarkdown(report) {
  /** @type {string[]} */
  const out = [];
  /**
   * @param {string} title
   * @param {readonly string[]} items
   */
  const section = (title, items) => {
    out.push(
      `### ${title} (${String(items.length)})`,
      '',
      items.length === 0 ? '_none_' : items.join('\n'),
      '',
    );
  };
  out.push(
    report.drift
      ? `The weekly check found that the icon archives Google Cloud provides at <${report.page.url}> no longer match ` +
          'what `packages/icons` vendored (`archive-index.json`, `mapping.json`).'
      : `The icon archives Google Cloud provides at <${report.page.url}> match what \`packages/icons\` vendored.`,
    '',
    `**${report.summary}**`,
    '',
    '| Set | Archive | State | SVG entries | Not named in mapping.json |',
    '|---|---|---|---|---|',
    ...report.sets.map(
      (set) =>
        `| \`${set.set}\` | <${set.url}> | ${
          !set.available
            ? `unavailable: ${set.reason ?? '?'}`
            : set.unchanged
              ? 'unchanged'
              : set.baseline
                ? 'changed'
                : 'no baseline'
        } | ${String(set.entryCount)} | ${String(set.notVendored.length)} |`,
    ),
    '',
  );
  const links = [
    ...report.page.unknownLinks.map((link) => `- new: <${link}> (mapping.json does not name it)`),
    ...report.page.missingLinks.map(({ set, url }) => `- gone: <${url}> (\`${set}\`)`),
  ];
  if (!report.page.checked) out.push('_The page was not read (offline run)._', '');
  else section('Archive links on the page that changed', links);
  section('New icons', [
    ...report.sets.flatMap((set) =>
      set.added.map(({ name, guess }) => `- \`${set.set}\`: ${code(name)}: ${describeGuess(guess)}`),
    ),
    ...report.extra.flatMap((extra) =>
      extra.available
        ? extra.added.map(({ name, guess }) => `- <${extra.url}>: ${code(name)}: ${describeGuess(guess)}`)
        : [`- <${extra.url}>: not read (${extra.reason ?? '?'})`],
    ),
  ]);
  section(
    'Changed icons',
    report.sets.flatMap((set) =>
      set.changed.map(({ name, usedBy }) => `- \`${set.set}\`: ${code(name)} (${usedByText(usedBy)})`),
    ),
  );
  section(
    'Renamed icons',
    report.sets.flatMap((set) =>
      set.renamed.map(
        ({ from, to, sameContent, usedBy }) =>
          `- \`${set.set}\`: ${code(from)} → ${code(to)}${sameContent ? '' : ' (content changed too)'} (${usedByText(usedBy)})`,
      ),
    ),
  );
  section(
    'Removed icons',
    report.sets.flatMap((set) =>
      set.removed.map(({ name, usedBy }) => `- \`${set.set}\`: ${code(name)} (${usedByText(usedBy)})`),
    ),
  );
  section(
    'Entries mapping.json uses that are missing upstream',
    report.mappedMissing.map(
      ({ set, entry, keys, fallback }) =>
        `- \`${set}\`: ${code(entry)} (${keys.map((k) => `\`${k}\``).join(', ')}); falls back to: ${fallback.join('; ')}`,
    ),
  );
  section(
    'Products on an older symbol although a newer icon exists',
    report.newerAvailable.map(
      (item) =>
        `- \`${item.key}\` uses the ${item.current}; ${code(item.entry)} (${item.set}) matches by name (${String(item.score)})`,
    ),
  );
  const core = report.sets.find((set) => set.set === 'core');
  out.push(
    '<details><summary>Products still on the older symbols</summary>',
    '',
    `The page still offers the legacy console icons for products the 2025 icon system has not updated yet. ` +
      `${String(report.symbols.legacy.length)} product keys use one: ${report.symbols.legacy.map((k) => `\`${k}\``).join(', ')}.`,
    '',
    `${String(report.symbols.category.length)} product keys have no product icon of their own and use their category mark: ` +
      `${report.symbols.category.map((k) => `\`${k}\``).join(', ')}.`,
    '',
    `${String(report.symbols.core.length)} use a core colour mark: ${report.symbols.core.map((k) => `\`${k}\``).join(', ')}.` +
      (core !== undefined && core.notVendored.length > 0
        ? ` Core marks on the page that mapping.json does not name: ${core.notVendored.map(({ name }) => code(iconNameOf(name))).join(', ')}.`
        : ''),
    ...(report.keptOlder.length > 0
      ? [
          '',
          `Kept on purpose (\`keepOlderSymbol\` in mapping.json): ${report.keptOlder
            .map((item) => `\`${item.key}\` (${item.reason})`)
            .join(', ')}.`,
        ]
      : []),
    '',
    '</details>',
    '',
    '### To resolve',
    '',
    '1. `pnpm --filter @gcportrait/icons drift --keep-temp` locally to see the report and the downloaded archives.',
    '2. For a new product icon, add it to the key in `packages/icons/mapping.json` (a new-style mark as `core`, ' +
      'ahead of the `legacy` symbol), or record a decision to keep the older symbol under `keepOlderSymbol`; for a ' +
      'missing or renamed entry, point the mapping at the current name (never edit the artwork).',
    '3. `pnpm --filter @gcportrait/icons vendor --verify-render`, then `... build` and `... contact-sheet` (look at ' +
      'both themes), `pnpm --filter @gcportrait/icons test` and `pnpm catalog:check --strict-icons`.',
    '4. Commit `vendored/`, `manifest.json`, `archive-index.json`, `mapping.json` and `src/generated/icons.ts` in a ' +
      'pull request that closes this issue (packages/icons/README.md, "Keeping the icons current").',
  );
  return `${out.join('\n')}\n`;
}
