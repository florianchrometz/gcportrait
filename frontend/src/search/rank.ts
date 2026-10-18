// SPDX-License-Identifier: Apache-2.0
/**
 * The search ranking (a Fuse.js index over the Graph's nodes). Pure; runs in the data worker.
 *
 * A node matches in the best of four tiers, and tiers never mix: every exact match ranks above every prefix
 * match, and so on, so typing a full resource name, an IP or a project id lands on that node first, whatever a
 * fuzzy match on some label scores.
 *
 * | Tier | When | Score inside the tier (lower ranks higher) |
 * |---|---|---|
 * | exact | the query (case-insensitive, trimmed) equals the label, display name, last name segment, full name, an IP, a domain, or (for a project) its project id | `EXACT_FIELD_SCORE` of the field, less `EXACT_EXTRA_FIELD` for every further field it equals (an instance named and labelled `orders-db` before a backup labelled `orders-db`) |
 * | prefix | one of those fields starts with the query, or a word inside the label, display name, name segment or a project's id does ("web" in "Retail web (prod)" and in `demo-web-1`) | 0.2 plus up to 0.5 for the rest of the field, plus `WORD_START_PENALTY` for a word inside it |
 * | range | the query is an IPv4 address inside one of the node's IPv4 ranges (a subnet's CIDR, a route) | 0.5 × (1 − prefix length / 32): the narrowest range first |
 * | fuzzy | Fuse.js finds the query in a field of `FUZZY_FIELDS` (location ignored, each field with its own threshold); a query with a `/` also matches inside the full resource name; a query of several words matches a node that holds every word in some field, in any order ("compute instance", "web retail") | the field's Fuse score plus its weight's penalty, `(3 − weight) / 10`, best field; for several words `WORDS_SCORE` plus the mean penalty of the fields that hold them |
 *
 * Typos: a field's Fuse threshold is capped at `MAX_TYPOS` typos for the whole query, and at `STRONG_TYPOS` once
 * the query has matched some node exactly, by a prefix or in a range: then a two-typo guess inside a longer
 * label ("bastion" in "notifications") is noise, while a misspelt name ("bastoin") that matches nothing better
 * still finds its node.
 *
 * Each field has its own Fuse index, so a node ranks by its best field: Fuse's own score over several keys
 * multiplies them, which ranks a node that half-matches many fields above one whose label matches exactly. Each
 * field is indexed over its distinct values (a type name, a product, a project id, a folder is shared by many
 * nodes and searched once); a name or display name that repeats the node's label is left out (the label's match
 * ranks higher), and the substring-only fields (threshold 0) are matched without Fuse.
 *
 * Containers (folders, projects, networks, clusters, …) are boosted inside every tier: their score is
 * multiplied by `CONTAINER_BOOST`, so "web" lists the instance groups and the projects with "web" in their names
 * before the VMs and addresses that start with it, while an exact match on a VM still beats a fuzzy match on a
 * container. Ties go to nodes drawn by default, then to the types the default lens draws (a VM before its disk
 * of the same name), then to architecture (role `core`) before records (`leaf`), then by label and id.
 */
import Fuse, { type FuseIndex } from 'fuse.js/basic';

import type { SearchDoc } from './documents';
import type { MatchField, MatchTier } from './protocol';

type FuzzyKey =
  | 'label'
  | 'displayName'
  | 'name'
  | 'ips'
  | 'domains'
  | 'projectId'
  | 'typeName'
  | 'assetType'
  | 'product'
  | 'ancestors';

export interface FuzzyField {
  readonly key: FuzzyKey;
  /** What the field means for a result's hint. */
  readonly field: MatchField;
  /** 3 for what is written on the card, less for the context a node lives in; adds `(3 − weight) / 10`. */
  readonly weight: number;
  /** Fuse's threshold for this field: 0 matches only exact substrings, 1 matches anything. */
  readonly threshold: number;
}

/**
 * The fuzzy tier's fields, weightiest first (a word of a query of several words counts in the first field that
 * holds it): the card's label weighs most, then the names and addresses people paste, then the project, the type
 * and the folders above. Addresses and asset types only match as substrings (a near-miss address is another
 * address; "kms" finds `cloudkms.googleapis.com/…`); context fields take fewer typos.
 */
export const FUZZY_FIELDS: readonly FuzzyField[] = [
  { key: 'label', field: 'label', weight: 3, threshold: 0.3 },
  { key: 'displayName', field: 'displayName', weight: 2.5, threshold: 0.3 },
  { key: 'name', field: 'name', weight: 2.5, threshold: 0.3 },
  { key: 'ips', field: 'ip', weight: 2.5, threshold: 0 },
  { key: 'domains', field: 'domain', weight: 2.5, threshold: 0.25 },
  { key: 'projectId', field: 'project', weight: 2, threshold: 0.2 },
  { key: 'typeName', field: 'type', weight: 1, threshold: 0.2 },
  { key: 'assetType', field: 'type', weight: 0.5, threshold: 0 },
  { key: 'product', field: 'type', weight: 0.5, threshold: 0.2 },
  { key: 'ancestors', field: 'ancestor', weight: 0.5, threshold: 0.2 },
];

/** A container's score is multiplied by this in every tier. */
export const CONTAINER_BOOST = 0.6;
/** Fuzzy matching starts at this many characters; shorter queries match exactly or by prefix only. */
export const FUZZY_MIN_LENGTH = 2;
/**
 * At most this many typos in any query: a field's threshold is capped at `MAX_TYPOS / query length`, so a long
 * query (a pasted domain) stays as fast and as strict as a short one.
 */
export const MAX_TYPOS = 2;
/** At most this many typos once the query has matched some node in the exact, prefix or range tier. */
export const STRONG_TYPOS = 1;
/** A path-like query (with a `/`) of at least this length also matches inside full resource names. */
export const NAME_PART_MIN_LENGTH = 3;
/** The fuzzy score of a match inside the full resource name. */
const NAME_PART_SCORE = 0.35;
/** What a match at the start of a word inside a field (not at the field's start) adds to a prefix score. */
export const WORD_START_PENALTY = 0.1;
/** The fuzzy score of a node that holds every word of a query of several words, before the fields' penalties. */
export const WORDS_SCORE = 0.1;
/** At most this many words of a query are matched one by one. */
export const MAX_WORDS = 8;

type ExactField = Extract<MatchField, 'id' | 'ip' | 'domain' | 'project' | 'label' | 'name' | 'displayName'>;

/** Each exact field's score inside the exact tier. */
export const EXACT_FIELD_SCORE: Readonly<Record<ExactField, number>> = {
  id: 0.1,
  ip: 0.1,
  domain: 0.1,
  project: 0.1,
  label: 0.1,
  name: 0.15,
  displayName: 0.15,
};
/** What every further exactly matching field takes off an exact match's score. */
export const EXACT_EXTRA_FIELD = 0.01;

/** The fields a word inside matches by its start too: what is written on a card, and a project's id. */
const WORD_FIELDS: ReadonlySet<ExactField> = new Set<ExactField>(['label', 'displayName', 'name', 'project']);
/** Fields not indexed again where they repeat the node's label (the label's match always ranks higher). */
const LABEL_REPEATS: ReadonlySet<FuzzyKey> = new Set<FuzzyKey>(['displayName', 'name']);

const TIER_RANK: Readonly<Record<MatchTier, number>> = { exact: 0, prefix: 1, range: 2, fuzzy: 3 };

export interface RankedHit {
  readonly doc: SearchDoc;
  readonly tier: MatchTier;
  /** The score inside the tier, after the container boost (lower is better). */
  readonly score: number;
  readonly field: MatchField;
  /** The field's value that matched. */
  readonly value: string;
}

export interface SearchResult {
  /** Every node that matched. */
  readonly total: number;
  /** The best `limit` of them, best first. */
  readonly hits: readonly RankedHit[];
}

/** A document's exact-match fields, lower-cased once. */
interface Exact {
  readonly field: ExactField;
  readonly value: string;
  readonly lower: string;
}

interface IpRange {
  readonly value: string;
  readonly network: number;
  readonly bits: number;
}

/** One fuzzy field over its distinct values. */
interface FieldIndex {
  readonly field: FuzzyField;
  /** The field's distinct values, as written. */
  readonly values: readonly string[];
  /** The same values, lower-cased (substring matches, the words of a query of several words). */
  readonly lower: readonly string[];
  /** For each value, the positions (in `SearchIndex.docs`) of the documents that hold it. */
  readonly holders: readonly (readonly number[])[];
  /** Fuse's index over `values`; null for a substring-only field (threshold 0). */
  readonly fuse: FuseIndex<string> | null;
}

export interface SearchIndex {
  readonly docs: readonly SearchDoc[];
  /** One index per fuzzy field, in `FUZZY_FIELDS` order, built once. */
  readonly fields: readonly FieldIndex[];
  readonly exact: readonly (readonly Exact[])[];
  /** Each document's IPv4 ranges (not single addresses). */
  readonly ranges: readonly (readonly IpRange[])[];
  /** Each document's full resource name, lower-cased. */
  readonly ids: readonly string[];
}

/** An IPv4 address as an unsigned 32-bit number, or null. */
export function ipv4(text: string): number | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** An IPv4 CIDR range (`10.0.14.0/24`), or null for anything else (a single address included). */
function ipv4Range(text: string): IpRange | null {
  const slash = text.indexOf('/');
  if (slash === -1) return null;
  const address = ipv4(text.slice(0, slash));
  const bitsText = text.slice(slash + 1);
  if (address === null || !/^\d{1,2}$/.test(bitsText)) return null;
  const bits = Number(bitsText);
  if (bits > 32) return null;
  return { value: text, network: address - (address % 2 ** (32 - bits)), bits };
}

function exactFields(doc: SearchDoc): Exact[] {
  const fields: { field: ExactField; value: string }[] = [
    { field: 'label', value: doc.label },
    { field: 'displayName', value: doc.displayName },
    { field: 'name', value: doc.name },
    { field: 'id', value: doc.id },
    ...doc.ips.map((value) => ({ field: 'ip' as const, value })),
    ...doc.domains.map((value) => ({ field: 'domain' as const, value })),
    // A project id names the project itself; the nodes inside it only match it fuzzily, after the project.
    ...(doc.kind === 'project' && doc.projectId !== ''
      ? [{ field: 'project' as const, value: doc.projectId }]
      : []),
  ];
  return fields
    .filter((entry) => entry.value !== '')
    .map((entry) => ({ ...entry, lower: entry.value.toLowerCase() }));
}

/** A document's values of a fuzzy field. */
function fieldValues(doc: SearchDoc, key: FuzzyKey): readonly string[] {
  const value = doc[key];
  return typeof value === 'string' ? [value] : value;
}

function fieldIndex(field: FuzzyField, docs: readonly SearchDoc[]): FieldIndex {
  const holders = new Map<string, number[]>();
  docs.forEach((doc, position) => {
    const label = doc.label.toLowerCase();
    for (const value of fieldValues(doc, field.key)) {
      if (value === '' || (LABEL_REPEATS.has(field.key) && value.toLowerCase() === label)) continue;
      const known = holders.get(value);
      if (known === undefined) holders.set(value, [position]);
      else if (known.at(-1) !== position) known.push(position);
    }
  });
  const values = [...holders.keys()];
  return {
    field,
    values,
    lower: values.map((value) => value.toLowerCase()),
    holders: [...holders.values()],
    fuse: field.threshold === 0 ? null : Fuse.createIndex<string>([], values),
  };
}

export function createSearchIndex(docs: readonly SearchDoc[]): SearchIndex {
  return {
    docs,
    fields: FUZZY_FIELDS.map((field) => fieldIndex(field, docs)),
    exact: docs.map(exactFields),
    ranges: docs.map((doc) =>
      doc.ips.map(ipv4Range).filter((range): range is IpRange => range !== null && range.bits < 32),
    ),
    ids: docs.map((doc) => doc.id.toLowerCase()),
  };
}

function boosted(doc: SearchDoc, score: number): number {
  return doc.container ? score * CONTAINER_BOOST : score;
}

/** The weight penalty of a fuzzy field. */
function penaltyOf(field: FuzzyField): number {
  return (3 - field.weight) / 10;
}

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/** Whether `query` starts a word inside `text` (not at its start), both lower-cased. */
function startsWord(text: string, query: string): boolean {
  for (let at = text.indexOf(query, 1); at !== -1; at = text.indexOf(query, at + 1)) {
    if (!WORD_CHARACTER.test(text.charAt(at - 1))) return true;
  }
  return false;
}

/** The best exact or prefix match of a document, if any. */
function directMatch(fields: readonly Exact[], query: string, doc: SearchDoc): RankedHit | null {
  const exact = fields.filter((entry) => entry.lower === query);
  const first = exact.reduce<Exact | undefined>(
    (best, entry) =>
      best === undefined || EXACT_FIELD_SCORE[entry.field] < EXACT_FIELD_SCORE[best.field] ? entry : best,
    undefined,
  );
  if (first !== undefined) {
    const score = Math.max(0.01, EXACT_FIELD_SCORE[first.field] - EXACT_EXTRA_FIELD * (exact.length - 1));
    return { doc, tier: 'exact', score: boosted(doc, score), field: first.field, value: first.value };
  }
  let best: RankedHit | null = null;
  for (const entry of fields) {
    const atStart = entry.lower.startsWith(query);
    if (!atStart && !(WORD_FIELDS.has(entry.field) && startsWord(entry.lower, query))) continue;
    const rest = 1 - query.length / entry.lower.length;
    const hit: RankedHit = {
      doc,
      tier: 'prefix',
      score: boosted(doc, 0.2 + 0.5 * rest + (atStart ? 0 : WORD_START_PENALTY)),
      field: entry.field,
      value: entry.value,
    };
    if (best === null || compareHits(hit, best) < 0) best = hit;
  }
  return best;
}

/** The narrowest of a document's IPv4 ranges that holds `address`, if any. */
function rangeMatch(ranges: readonly IpRange[], address: number, doc: SearchDoc): RankedHit | null {
  let best: IpRange | null = null;
  for (const range of ranges) {
    const size = 2 ** (32 - range.bits);
    const inside = address >= range.network && address < range.network + size;
    if (inside && (best === null || range.bits > best.bits)) best = range;
  }
  if (best === null) return null;
  return {
    doc,
    tier: 'range',
    score: boosted(doc, 0.5 * (1 - best.bits / 32)),
    field: 'ip',
    value: best.value,
  };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Best first: tier, then score, then drawn by default before hidden, types the default lens draws first,
 * architecture (`core`) before records (`leaf`), then label and id (code-point order).
 */
export function compareHits(a: RankedHit, b: RankedHit): number {
  return (
    TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
    a.score - b.score ||
    Number(a.doc.hidden) - Number(b.doc.hidden) ||
    Number(b.doc.prominent) - Number(a.doc.prominent) ||
    Number(a.doc.leaf) - Number(b.doc.leaf) ||
    compareText(a.doc.label, b.doc.label) ||
    compareText(a.doc.id, b.doc.id)
  );
}

/** The words of a query of several words (each once, at most `MAX_WORDS`); none for a single word. */
function wordsOf(query: string): string[] {
  const words = [...new Set(query.split(/\s+/).filter((word) => word !== ''))];
  return words.length < 2 ? [] : words.slice(0, MAX_WORDS);
}

function bitCount(mask: number): number {
  let count = 0;
  for (let rest = mask; rest !== 0; rest &= rest - 1) count += 1;
  return count;
}

interface WordsFound {
  /** Bit `i`: word `i` was found. */
  mask: number;
  /** The sum of the penalties of the fields the words were found in. */
  penalty: number;
  /** The weightiest field a word was found in, and its value. */
  readonly field: FuzzyField;
  readonly value: string;
}

/**
 * The nodes that hold every word of a query of several words, each word in some field, in any order ("web retail"
 * finds the project "Retail web (prod)" and the nodes in it, "compute instance" the Compute Engine instances). A
 * word counts in the weightiest field that holds it; the score is `WORDS_SCORE` plus the mean of those fields'
 * penalties.
 */
function wordMatches(index: SearchIndex, words: readonly string[], keep: (hit: RankedHit) => void): void {
  const all = 2 ** words.length - 1;
  const found = new Map<number, WordsFound>();
  // FUZZY_FIELDS order, weightiest first: a word's first field is its weightiest.
  for (const { field, values, lower, holders } of index.fields) {
    lower.forEach((text, position) => {
      let mask = 0;
      words.forEach((word, bit) => {
        if (text.includes(word)) mask |= 1 << bit;
      });
      if (mask === 0) return;
      for (const holder of holders[position] ?? []) {
        const known = found.get(holder);
        if (known === undefined) {
          const value = values[position] ?? '';
          found.set(holder, { mask, penalty: penaltyOf(field) * bitCount(mask), field, value });
          continue;
        }
        const added = mask & ~known.mask;
        if (added === 0) continue;
        known.mask |= added;
        known.penalty += penaltyOf(field) * bitCount(added);
      }
    });
  }
  for (const [holder, entry] of found) {
    const doc = index.docs[holder];
    if (entry.mask !== all || doc === undefined) continue;
    keep({
      doc,
      tier: 'fuzzy',
      score: boosted(doc, WORDS_SCORE + entry.penalty / words.length),
      field: entry.field.field,
      value: entry.value,
    });
  }
}

/** The nodes that match `text`, ranked; at most `limit` of them in `hits`. */
export function searchIndex(index: SearchIndex, text: string, limit: number): SearchResult {
  const query = text.trim().toLowerCase();
  if (query === '') return { total: 0, hits: [] };
  const best = new Map<string, RankedHit>();
  const keep = (hit: RankedHit | null): void => {
    if (hit === null) return;
    const current = best.get(hit.doc.id);
    if (current === undefined || compareHits(hit, current) < 0) best.set(hit.doc.id, hit);
  };
  const address = ipv4(query);
  const pathLike = query.includes('/') && query.length >= NAME_PART_MIN_LENGTH;
  index.docs.forEach((doc, position) => {
    keep(directMatch(index.exact[position] ?? [], query, doc));
    const ranges = index.ranges[position] ?? [];
    if (address !== null && ranges.length > 0) keep(rangeMatch(ranges, address, doc));
    if (pathLike && index.ids[position]?.includes(query) === true) {
      keep({ doc, tier: 'fuzzy', score: boosted(doc, NAME_PART_SCORE), field: 'id', value: doc.id });
    }
  });
  const words = wordsOf(query);
  if (words.length > 0) wordMatches(index, words, keep);
  if (query.length >= FUZZY_MIN_LENGTH) {
    // A node's best hit is in a better tier than fuzzy when it matched exactly, by a prefix or in a range.
    const strong = [...best.values()].some((hit) => hit.tier !== 'fuzzy');
    const typos = strong ? STRONG_TYPOS : MAX_TYPOS;
    for (const entry of index.fields) {
      const { field } = entry;
      const hold = (position: number, score: number): void => {
        const value = entry.values[position] ?? '';
        for (const holder of entry.holders[position] ?? []) {
          const doc = index.docs[holder];
          if (doc === undefined) continue;
          keep({
            doc,
            tier: 'fuzzy',
            score: boosted(doc, score + penaltyOf(field)),
            field: field.field,
            value,
          });
        }
      };
      if (entry.fuse === null) {
        // A substring-only field: what Fuse finds at threshold 0, without it.
        entry.lower.forEach((value, position) => {
          if (value.includes(query)) hold(position, 0);
        });
        continue;
      }
      // A Fuse searcher over the prebuilt index (cheap to make), with this query's threshold.
      const fuse = new Fuse<string>(
        entry.values,
        {
          includeScore: true,
          ignoreLocation: true,
          threshold: Math.min(field.threshold, typos / query.length),
        },
        entry.fuse,
      );
      for (const result of fuse.search(query)) hold(result.refIndex, result.score ?? 1);
    }
  }
  const ranked = [...best.values()].sort(compareHits);
  return { total: ranked.length, hits: ranked.slice(0, Math.max(0, limit)) };
}
