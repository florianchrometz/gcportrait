// SPDX-License-Identifier: MIT
// @ts-check
/**
 * Provenance guard (agents.md, Licence and dependencies, and Names that never appear). Fails when a file of
 * the tree
 *   (a) mentions a forbidden name or carries a Google copyright notice (see FORBIDDEN_TERMS), in its contents
 *       or in its path (file or directory names),
 *   (b) is a Go file, a Graphviz .dot/.gv file or a Gizmo query,
 *   (c) is a text source file without the SPDX header line in its first lines, or a text file of a type for
 *       which no header form and no header-free rule is defined,
 *   (d) is a symbolic link,
 *   (e) writes a banned term (see BANNED_TERMS): Google's name with its company suffix, a citation of a
 *       decision record, a numbered rule of agents.md, or a phrase that records how something was built
 *       rather than saying what it is, in its contents or in its path,
 *   (f) writes an id of a work item: a task, a phase or, in Markdown, a decision (see PLAN_IDS),
 *   (g) names the denied network-copyleft licence family (see LICENCE_NAME_TERMS) in its path, or in its
 *       contents outside the deny list and the verbatim licence texts (see LICENCE_NAME_EXEMPTIONS), or
 *   (h) is a text file that is not UTF-8 without NUL bytes, or holds plain text under a binary extension.
 *
 * Every file is read. A text file is decoded whatever its encoding (UTF-16 by its byte-order mark or by the
 * place of its NUL bytes, anything else as UTF-8) and its NUL bytes are dropped before the term rules run,
 * so a stray byte or a wide encoding hides nothing. A binary file (an image, a video, a font, an archive)
 * is read through its printable runs and, in a PNG, its text chunks, where its metadata sits, for the terms
 * long enough not to occur by chance in compressed data. The walk covers every file under the root and
 * every file git tracks (see scripts/lib/repo-files.mjs).
 *
 * Usage:
 *   node scripts/check-provenance.mjs                     check the repository this script lives in
 *   node scripts/check-provenance.mjs --root <dir>        check another tree (used by the tests)
 *   node scripts/check-provenance.mjs --list-exempt       print the rules and exemptions, then exit
 *   node scripts/check-provenance.mjs --digest-of <text>  print the PHRASE_DIGESTS entry of a phrase
 *   --also-refuse <entry>                                 refuse one more phrase digest (used by the tests)
 *
 * Exit code 0 when the tree is clean, 1 on any violation, 2 on a usage error. Plain ESM, Node built-ins only.
 * Every refused string is assembled at run time, written as a pattern that does not match itself, or known
 * only by its digest, so that this file, which the check scans too, spells out none of them; `--list-exempt`
 * describes them without printing the forbidden names, the secret patterns or the digests.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { inflateSync } from 'node:zlib';

import {
  BINARY_EXTENSIONS,
  HEADER_EXEMPTIONS,
  HEADER_FREE_EXTENSIONS,
  HEADER_FREE_FILENAMES,
  HEADER_STYLE_BY_EXTENSION,
  HEADER_STYLE_BY_FILENAME,
  HEADER_WINDOW,
  SKIPPED_BUILD_DIR_NAMES,
  SKIPPED_DIR_NAMES,
  SKIPPED_FILE_PATTERNS,
  SKIPPED_ROOT_PATHS,
  findHeader,
  headerLine,
  isHeaderExempt,
  isHeaderFree,
  listRepoFiles,
  readProjectLicenseId,
  requiredHeaderStyle,
  splitLines,
} from './lib/repo-files.mjs';

const SELF = 'scripts/check-provenance.mjs';

/** How much of a line's end and the next line's start a pattern term is looked for in: longer than any. */
const WRAP_WINDOW = 80;

/**
 * @typedef {{ index: number, text: string }} Hit
 * @typedef {{
 *   label: string,
 *   message: string,
 *   secret: boolean,
 *   binary: boolean,
 *   pattern?: RegExp,
 *   digests?: number,
 *   window: number,
 *   first: (text: string) => Hit | undefined,
 *   find: (text: string) => Hit[],
 * }} Term
 *   `secret`: --list-exempt prints the label, not the pattern. `binary`: the term is long enough to be looked
 *   for in a binary file's printable runs. `digests`: how many phrase digests the term carries. `window`: how
 *   much of a line's end and of the next line's start can hold the term broken across them. `first` finds
 *   the first hit, `find` every hit.
 */

/**
 * Rule (a): names that never appear, matched case-insensitively per line. The names match anywhere, also
 * inside a longer word, so camelCase identifiers built on them are caught too, and with a hyphen or an
 * underscore between their two halves (the first two also with a space or a dot). A Google copyright notice
 * is any line with the word for copyright (or the © sign) followed later on the same line by Google's name,
 * which covers the usual header forms with a year or "(c)" in between. The names are assembled at run time,
 * so that this file does not contain them either; this file is exempt from rule (a) only because a
 * description of the notice could match it.
 */
const FORBIDDEN_NAMES = Object.freeze([
  { halves: ['gcp', 'viz'], separator: '[\\s._-]?' },
  { halves: ['kno', 'yog'], separator: '[\\s._-]?' },
  // Not with a space: the first half is an English word, and the second starts many.
  { halves: ['for', 'seti'], separator: '[_-]?' },
]);
const FORBIDDEN_TERMS = Object.freeze([
  ...FORBIDDEN_NAMES.map(({ halves, separator }) => ({
    label: halves.join(''),
    pattern: new RegExp(halves.join(separator), 'i'),
  })),
  { label: 'Copyright Google', pattern: /(?:copyright|©)[^\n]*\bgoogle/i },
]);

/** Files (root-relative) where rule (a) does not apply, in contents and in names. */
const FORBIDDEN_NAME_EXEMPTIONS = Object.freeze([
  { test: (/** @type {string} */ p) => p === SELF, rule: `${SELF} (this checker)` },
]);

/** The messages of rule (e), by the kind of term. */
const STATE_THE_RULE =
  'state the rule, or point to the section of agents.md that holds it ("agents.md, <heading>")';
const SAY_WHAT_IS = 'a file says what is, not how it came to be (agents.md, Documentation)';
const NEVER_APPEARS = 'it never appears (agents.md, Names that never appear)';

/** The three-letter abbreviation of a decision record, assembled. */
const DECISION_RECORD = ['A', 'DR'].join('');
/** The labels of rule (e) whose patterns `--list-exempt` does not print. */
const DECISION_RECORD_LABEL = 'a citation of a decision record';
const BUILD_RECORD_LABEL = 'a build-record phrase';
/** The month of a date written out, in full or abbreviated. */
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
/** A date as ISO 8601 or written out ("2 April 2030", "Apr 2, 2030"). */
const DATE = [
  '20\\d\\d-\\d\\d-\\d\\d',
  `\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\s+20\\d\\d`,
  `${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+20\\d\\d`,
].join('|');

/**
 * Rule (e), build-record wording written as patterns: a check stamped with its day, an amendment, and a
 * decision given as the reason for a thing. Dated records ("<word> of <date>") are matched by digest
 * (`dated`).
 */
const BUILD_RECORD_PATTERNS = Object.freeze([
  /\bverified\s+on\b/i,
  /\bamended\s+on\b|\bas\s+amended\b/i,
  /\bas\s+decided\b/i,
]);

/**
 * Rule (e), build-record phrases known only by digest: the SHA-256 of their normalised form, so that no file
 * of the tree spells them, this one and its test included. `--digest-of <phrase>` prints the entry of a new
 * one. An entry is "<form>:<length>:<fnv>:<sha256>": the length of the normalised phrase, its 32-bit FNV-1a
 * hash and its SHA-256, in hex; a candidate is hashed only when its length matches, and with SHA-256 only
 * when its FNV-1a hash matches too. Three forms:
 * - `words`: up to MAX_PHRASE_WORDS consecutive words. A word is a run of letters and digits, lowercased;
 *   between two words, whitespace counts as one space, a hyphen or an underscore joins them (so "a-b", "a_b",
 *   "aB" and "ab" are one phrase, and "a b" another), and any other separator is kept without its
 *   whitespace ("a/b"). The last word loses a plural "s".
 * - `path`: a directory at the start of a relative path ("name/", "./name/", "/name/" after a space, a quote
 *   or a bracket), lowercased with its slash, and the first directory of a file's own path.
 * - `dated`: a word right before a date, or before "on" or "of" and a date ("<word> of <date>"), lowercased;
 *   `--digest-of "<word> <date>"` prints its entry. A word that is not refused leaves the date legal, as
 *   "since <date>" and "as of <date>" are in the timeline's own wording.
 */
const PHRASE_DIGESTS = Object.freeze([
  'words:8:ada92314:017c3548afaae5f6b5193abd03a11b31bd57b05ac1888d9538c1cf64bd983a14',
  'dated:8:1bc03140:070c160a6299c5438070b1aa737b14fc2992ed49579c14264884886a5876f971',
  'path:7:a8bb70e3:1148a502169311041f440bd3a8e7b7e0faba589af2e72abf2196f521380b9778',
  'dated:9:353d7f80:1480fb125459cbca6cff13fbac5d846220d91cf906e466eb2842ef350878138b',
  'words:16:d805e362:1a4e0968ecbc25f80614150b300f880f7b05e6d4e298afd9a74bda6eddb84640',
  'dated:8:a286b8c5:1c34f88707b55e6104c4eb20e71ffa3d33e414b71ef689a15fad0640d0ac58cb',
  'dated:7:3eaa09b2:1f58b9145b24d108d7ac38887338b3ea3229833b9c1e418250343f907bfd1047',
  'words:12:3cd452b9:22f76ec3a4b5747da38ea4a005ae628003e7e837f830f5d3de39f8a435dec383',
  'words:7:0e454985:249215fed826e1cff9368c2c7490760a16f7bd49f875d39a9f23eaf1505d076d',
  'dated:8:9e0e3e7a:2687f86ed6784b8a5fca36e6c468e12aa44dc3c7e8137e3160d1a95079bdcd02',
  'dated:11:65429edd:27e9af2471cad8f872ec18b2963743d55a701156905919e7e71c91251f35048a',
  'words:9:b938162c:2bcd3e14dca8fdb18ca3d4e958bb1c4df002598ae6e5d80fc9d9824a6b5dc450',
  'words:8:136cc522:3c4c64b0988a15625f70e32912ba2552994ea1b1fcf98b75d9e23d7209a0487b',
  'dated:8:ca6784bd:3d96a458120e68868ccca6bad66be3fc8df4627a6b7372d69b98d3ba7688774d',
  'dated:7:c35f4cf7:3f3af1ecebbd1410ab417ec0d27bbfcb5d340e177ae159b59fc8626c2dfd9175',
  'dated:6:38309b79:3f8f09c8e09f712b362183db69f4f061bd948d7a61e7663b585d723602c559b1',
  'dated:10:97159cdd:444bd9c51d51643ccd939e7eb50c847bde7bfdfe271f2fca928e7dbfc73377f0',
  'dated:7:14cbe5d6:5b720147b6918dfc19baa0d7767cab75b76e17998837d04af43f2f3463c5350f',
  'dated:8:18000261:6a5cc68c4c3410fedb035486291349f57104fe7592f91c6ba052f983000244f6',
  'dated:11:59aed623:6c5a6990038d66c5ecddf6c983345ed18acc416e188ff1476e3cd7201699aaed',
  'words:17:ca3b02bf:71425a9fb8f6d67d203117d254cc74fe14e0e09179fb28e944902c51b6ec073c',
  'dated:4:fc2e40d3:7369949b47ef2c6ba26fbbee659cedc76123a75c17d321a52d8d1ef35e948042',
  'words:23:7bc20c2a:77ed2f7e8947f4699910f67691646592a4a6e796225528abd05b97434f90429d',
  'dated:5:bbd77415:798552d3924a30ba1defcdd9c1619ec2faaabe3b3e345806ca9458033b535b7b',
  'dated:8:6f65abe3:86ae35d58a6aa3b5742df94ef9d7162219f0106a911ae1954c1f0604aaec805d',
  'dated:6:bd983d4c:8a741eb9c8922e9e08fc1b0538535461c44d22bd48e1ed6bd7424f3fe7d78745',
  'dated:7:6916d126:8bf18252cb6dadd5f42fca108271e688696209cdb6fae22e32318b204e6eb37d',
  'dated:9:149ac294:8c0b602c4a07c24a872aba4e8a49a8fbd64bd6902ceb72f43606d50a3fd3ec7f',
  'dated:7:e0da8421:8c90591451015625541ebf5dc5203a8a27c89b66d3edfbbcda8e979bf4113326',
  'dated:7:1353559f:8d3c6686ec306db55ac57683ca4c4b96b3650d8d63e95599f9d5d1a8d3f31956',
  'dated:5:b3f55bf9:992a93455c71fedd36ac9bbc439952c041cf61445958472af479269b8d873513',
  'words:9:5f7a51aa:aab9b7e50432625a929a5266182599aaf9880d0b62f23e3cdfa1f15fd2f61cc1',
  'dated:3:2acd4eca:acba25512100f80b56fc3ccd14c65be55d94800cda77585c5f41a887e398f9be',
  'dated:7:49ce1c29:b19b2022fbca5eebe2f23af94ff755f30bbd176d59e5e1c746e11b0adde61a7a',
  'words:10:97dff027:b3eb5470e69668cf0e5a0df2a772f74477fb7959e66d094ab4f1c358c76273b8',
  'dated:5:f5615aa8:b81f37a043a6f767e7c94d105f4bd31282f3ecc20680bb9d09bd93461cf4c863',
  'words:22:6fb41f9a:bddfdc7de30a139e907758c22ad9a506f441e766db47fa7a6a1d1b801768acf1',
  'dated:6:b9962aec:c29a4b42073219ba62efff97387973eb72dcfbc1e126e7b45c7dc7d1960b911e',
  'words:18:48580da9:c5df5e6ee517bc081387135ac33b96521740e19922bc1d896945eeb7b873486a',
  'words:16:7a2e2165:c9299e8834180bbf0fdba5c46f40b942b4efd1013cbe35896333e0e973937ef1',
  'dated:6:225772e1:c97ace4c8fef2cee8fa0f3c9f52aab18dbd4f42438afe362ffb8f75ce4c04b84',
  'words:18:c18d6120:cb4b4c80e34b5e119fe805b07838e8064df2b5aea70c0b3447a3d52acf93ca03',
  'dated:6:8f735a56:cf83f0f9828551b6247bfc9288d0740dd5b3ccb8501f8caed37c19b912ae4438',
  'dated:4:7b7a7318:d74ff0ee8da3b9806b18c877dbf29bbde50b5bd8e4dad7a3a725000feb82e8f1',
  'words:17:09e57d86:df47229adfadbe30813dac4a4c7385e005297e3e6eb388fb76d737e36e754e9d',
  'dated:11:bf9dcc39:e0837458ff79b45618210c16c558b7ce42451bbfd211f0ebdf99b8f3741530a5',
  'dated:8:1b78a778:e4f934f321eb76c9bf8b5103e0a0d9afe72d6e62ace3d3ea849790619bf7487a',
  'dated:7:21114ec6:e61a3d78c65133c7260c43e719d97c46e16bd50c64ee7800536cf14c6407a617',
  'words:17:86dce19d:e624d37c9dc7b66a406380a273f701bb8b4862be1c91e71d3cb7c8088496cedf',
  'words:9:d142c950:ef8d721c93dde0f34f8b74d9118301dd8bc680e09b613cde641cabc99e21e894',
  'words:19:b2828f12:f7024509f545785ce604950d9073a158db75237837b279cdc8a0e306b84d3353',
  'dated:9:576d36fb:fd60c459d03b66a8600f5c72ca868c83ad2708810fa3140b03abb35b3b91d931',
]);

/** The longest phrase, in words, that a `words` digest can stand for. */
const MAX_PHRASE_WORDS = 3;
const DIGEST_ENTRY = /^(words|path|dated):([1-9]\d{0,2}):([0-9a-f]{8}):([0-9a-f]{64})$/;
const WORD = /[a-z0-9]+/gi;
/**
 * A directory name followed by its separator, as any segment of a path: after the start of the text, a slash,
 * a backslash or any other character that is not part of a name (so a glob such as `**` followed by the name, a
 * Windows path and a path deep in a tree all count).
 */
const PATH_ROOT = /(?<![A-Za-z0-9_.-])([A-Za-z0-9_.-]+)[\\/]/g;
/** A word before a date, with "on" or "of" between them or nothing. */
const DATED = new RegExp(`\\b([a-z]+)\\s+(?:(?:on|of)\\s+)?\\(?(?:${DATE})\\b`, 'gi');
const DATED_PHRASE = /^([a-z]+)\s+(?:(?:on|of)\s+)?<date>$/i;

/**
 * @typedef {{ lengths: Set<number>, longest: number, quick: Set<number>, digests: Set<string> }} DigestSet
 * @typedef {{ words: DigestSet, path: DigestSet, dated: DigestSet, count: number }} PhraseDigests
 */

/**
 * @param {readonly string[]} entries
 * @returns {PhraseDigests}
 */
function parseDigests(entries) {
  /** @type {PhraseDigests} */
  const phrases = {
    words: { lengths: new Set(), longest: 0, quick: new Set(), digests: new Set() },
    path: { lengths: new Set(), longest: 0, quick: new Set(), digests: new Set() },
    dated: { lengths: new Set(), longest: 0, quick: new Set(), digests: new Set() },
    count: 0,
  };
  for (const entry of entries) addDigest(phrases, entry);
  return phrases;
}

/**
 * @param {PhraseDigests} phrases
 * @param {string} entry
 */
function addDigest(phrases, entry) {
  const match = DIGEST_ENTRY.exec(entry);
  if (match === null)
    throw new Error(
      `not a phrase digest entry: "${entry}" (expected <words|path|dated>:<length>:<fnv>:<sha256>)`,
    );
  const set = match[1] === 'path' ? phrases.path : match[1] === 'dated' ? phrases.dated : phrases.words;
  const length = Number(match[2]);
  set.lengths.add(length);
  set.longest = Math.max(set.longest, length);
  set.quick.add(Number.parseInt(match[3] ?? '', 16));
  set.digests.add(match[4] ?? '');
  phrases.count += 1;
}

const PHRASES = parseDigests(PHRASE_DIGESTS);

/** @param {string} gap the text between two words */
function normaliseGap(gap) {
  const kept = gap.replace(/[_-]/g, '');
  if (kept === '') return '';
  if (/^\s+$/.test(kept)) return ' ';
  return kept.replace(/\s+/g, '');
}

/**
 * Whether the last word of a phrase loses a plural "s": longer than three letters, ending in one "s".
 * @param {string} word
 */
function hasPlural(word) {
  const last = word.charCodeAt(word.length - 1) | 0x20;
  const before = word.charCodeAt(word.length - 2) | 0x20;
  return word.length > 3 && last === 0x73 && before !== 0x73;
}

/** @param {string} word lowercased */
function singular(word) {
  return hasPlural(word) ? word.slice(0, -1) : word;
}

/**
 * @param {string} text
 * @returns {Array<{ start: number, end: number, word: string }>}
 */
function wordsOf(text) {
  return Array.from(text.matchAll(WORD), (match) => ({
    start: match.index,
    end: match.index + match[0].length,
    word: match[0].toLowerCase(),
  }));
}

/**
 * The 32-bit FNV-1a hash of a text's UTF-16 code units.
 * @param {string} text
 * @returns {number}
 */
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** @param {string} key */
function sha256(key) {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * @param {string} key
 * @param {DigestSet} set
 * @returns {boolean}
 */
function isRefused(key, set) {
  return set.quick.has(fnv1a(key)) && set.digests.has(sha256(key));
}

/** The word offsets and normalised gaps of the text being searched, reused from call to call. */
const wordStarts = /** @type {number[]} */ ([]);
const wordEnds = /** @type {number[]} */ ([]);
const gaps = /** @type {string[]} */ ([]);

/**
 * The phrases of PHRASES in a text, in every form, in order; with `onlyFirst`, at most one. A candidate is
 * hashed only when its normalised length is the length of a refused phrase.
 * @param {string} text
 * @param {boolean} onlyFirst
 * @returns {Hit[]}
 */
function findPhrases(text, onlyFirst) {
  /** @type {Hit[]} */
  const hits = [];
  const { words: wordSet, path: pathSet, dated: datedSet } = PHRASES;
  if (wordSet.lengths.size > 0) {
    let count = 0;
    WORD.lastIndex = 0;
    for (let match = WORD.exec(text); match !== null; match = WORD.exec(text)) {
      wordStarts[count] = match.index;
      wordEnds[count] = match.index + match[0].length;
      count += 1;
    }
    for (let index = 1; index < count; index += 1) {
      const gap = text.slice(wordEnds[index - 1], wordStarts[index]);
      gaps[index] = gap === ' ' ? ' ' : normaliseGap(gap);
    }
    for (let index = 0; index < count && !(onlyFirst && hits.length > 0); index += 1) {
      const start = wordStarts[index] ?? 0;
      let length = 0;
      for (let last = index; last < count && last < index + MAX_PHRASE_WORDS; last += 1) {
        if (last > index) length += (gaps[last] ?? '').length;
        const word = text.slice(wordStarts[last], wordEnds[last]);
        const candidate = length + word.length - (hasPlural(word) ? 1 : 0);
        if (candidate > wordSet.longest) break;
        if (wordSet.lengths.has(candidate)) {
          let key = '';
          for (let part = index; part < last; part += 1)
            key += text.slice(wordStarts[part], wordEnds[part]).toLowerCase() + (gaps[part + 1] ?? '');
          if (isRefused(key + singular(word.toLowerCase()), wordSet)) {
            hits.push({ index: start, text: text.slice(start, wordEnds[last]) });
            break;
          }
        }
        length += word.length;
      }
    }
  }
  if (pathSet.lengths.size > 0 && text.includes('/')) {
    PATH_ROOT.lastIndex = 0;
    for (let match = PATH_ROOT.exec(text); match !== null; match = PATH_ROOT.exec(text)) {
      const name = match[1] ?? '';
      if (!pathSet.lengths.has(name.length + 1) || !isRefused(`${name.toLowerCase()}/`, pathSet)) continue;
      hits.push({ index: match.index + match[0].length - name.length - 1, text: `${name}/` });
    }
  }
  if (datedSet.lengths.size > 0 && /20\d\d/.test(text)) {
    DATED.lastIndex = 0;
    for (let match = DATED.exec(text); match !== null; match = DATED.exec(text)) {
      const word = match[1] ?? '';
      if (!datedSet.lengths.has(word.length) || !isRefused(word.toLowerCase(), datedSet)) continue;
      hits.push({ index: match.index, text: match[0] });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/**
 * The PHRASE_DIGESTS entry of a phrase, or undefined when it has no word or more than MAX_PHRASE_WORDS.
 * @param {string} phrase
 * @returns {string | undefined}
 */
function digestEntryOf(phrase) {
  const trimmed = phrase.trim();
  const directory = /^\/?(?:\.{1,2}\/)*([A-Za-z0-9_.-]+)\/$/.exec(trimmed);
  const dated = DATED_PHRASE.exec(trimmed);
  /** @type {[form: string, key: string] | undefined} */
  let normalised;
  if (directory !== null) normalised = ['path', `${(directory[1] ?? '').toLowerCase()}/`];
  else if (dated !== null) normalised = ['dated', (dated[1] ?? '').toLowerCase()];
  else {
    const words = wordsOf(trimmed);
    if (words.length === 0 || words.length > MAX_PHRASE_WORDS) return undefined;
    let key = '';
    words.forEach((current, index) => {
      const previous = words[index - 1];
      if (previous !== undefined) key += normaliseGap(trimmed.slice(previous.end, current.start));
      key += index === words.length - 1 ? singular(current.word) : current.word;
    });
    normalised = ['words', key];
  }
  const [form, key] = normalised;
  return `${form}:${String(key.length)}:${fnv1a(key).toString(16).padStart(8, '0')}:${sha256(key)}`;
}

/**
 * @param {{
 *   label: string,
 *   message: string,
 *   pattern: RegExp,
 *   secret?: boolean,
 *   binary: boolean,
 *   quick?: RegExp,
 * }} spec `quick`: a cheaper pattern every match of `pattern` also matches, tried first
 * @returns {Term}
 */
function regexTerm({ label, message, pattern, secret = false, binary, quick }) {
  const global = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);
  return {
    label,
    message,
    pattern,
    secret,
    binary,
    window: WRAP_WINDOW,
    first(text) {
      if (quick !== undefined && !quick.test(text)) return undefined;
      const match = pattern.exec(text);
      return match === null ? undefined : { index: match.index, text: match[0] };
    },
    find: (text) => Array.from(text.matchAll(global), (match) => ({ index: match.index, text: match[0] })),
  };
}

/**
 * Rule (e): terms that may not appear anywhere, matched per line and in paths, with no exemption.
 *
 * - Google's name with its company suffix: the project writes "Google" or "Google Cloud".
 * - Citations of a decision record (the abbreviation, alone or with a number, in any case, but never inside a
 *   base64 run such as an integrity hash or a data URI; the abbreviation spelled out, or a decision record
 *   with a number; a folder of them in a relative path, which starts after a space, a quote or a bracket)
 *   and a numbered rule of agents.md: a rule is cited by the heading of its section in agents.md, or stated.
 * - Build-record phrases: wording that tells how, when or by whom something was made, checked or decided,
 *   rather than what it is (BUILD_RECORD_PATTERNS and PHRASE_DIGESTS).
 * @type {readonly Term[]}
 */
const BANNED_TERMS = Object.freeze([
  regexTerm({
    label: "Google's name with its company suffix",
    pattern: new RegExp(['\\bGoogle', `${['L', 'LC'].join('')}\\b`].join('[\\s,]+'), 'i'),
    message:
      'write "Google" or "Google Cloud" without the company suffix (agents.md, Non-affiliation, brand and legal)',
    binary: true,
  }),
  regexTerm({
    label: DECISION_RECORD_LABEL,
    pattern: new RegExp(
      `(?<![A-Za-z0-9+/=_,-])${DECISION_RECORD}s?(?:[\\s_-]*\\d+|(?![A-Za-z0-9+/=_]))`,
      'i',
    ),
    message: STATE_THE_RULE,
    secret: true,
    binary: false,
  }),
  regexTerm({
    label: DECISION_RECORD_LABEL,
    pattern: new RegExp(
      `${['\\barchitecture', 'decision', 'records?\\b'].join('\\s+')}|\\bdecision\\s+records?\\s+(?:no\\.?\\s*|#)?\\d`,
      'i',
    ),
    message: STATE_THE_RULE,
    secret: true,
    binary: true,
  }),
  regexTerm({
    label: DECISION_RECORD_LABEL,
    pattern: new RegExp(`(?<=(?:^|[\\s(\\[<'"\`])(?:[\\w.-]+/)*)${DECISION_RECORD.toLowerCase()}s?/`, 'i'),
    quick: new RegExp(`${DECISION_RECORD}s?/`, 'i'),
    message: STATE_THE_RULE,
    secret: true,
    binary: false,
  }),
  regexTerm({
    label: 'a numbered rule of agents.md',
    pattern:
      /\bagents\.md\b[`'"]?(?:'s)?[,:]?\s+(?:[a-z]+\s+)?rules?\s+#?\d|\brules?\s+#?\d+\s+(?:of|in)\s+[`'"]?agents\.md\b/i,
    message: 'cite agents.md by the heading of the section that holds the rule ("agents.md, <heading>")',
    binary: true,
  }),
  ...BUILD_RECORD_PATTERNS.map((pattern) =>
    regexTerm({ label: BUILD_RECORD_LABEL, pattern, message: SAY_WHAT_IS, secret: true, binary: true }),
  ),
  {
    label: BUILD_RECORD_LABEL,
    message: SAY_WHAT_IS,
    secret: true,
    binary: true,
    get digests() {
      return PHRASES.count;
    },
    get window() {
      return Math.max(PHRASES.words.longest, PHRASES.path.longest, PHRASES.dated.longest + 24) + 1;
    },
    first: (text) => findPhrases(text, true)[0],
    find: (text) => findPhrases(text, false),
  },
]);

/**
 * Rule (f): ids of work items. Text says what a thing is or does; an id from a work plan means nothing to a
 * reader. A task id is the letter P, a number, a dot and a number; a phase is the word with a number; a
 * decision id is the letter D with up to three digits, not as part of a hex colour. The task and phase
 * patterns apply to every text file, the decision pattern to Markdown only (in code, such letters and digits
 * are too often something else). No pattern matches its own source text.
 */
const PLAN_IDS = Object.freeze([
  { label: 'a task id', pattern: /\bP\d+\.\d+\b/, markdownOnly: false },
  { label: 'a phase', pattern: /\bphase\s+\d+\b/i, markdownOnly: false },
  { label: 'a decision id', pattern: /(?<!#)\bD\d{1,3}\b/, markdownOnly: true },
]);

/**
 * Rule (g): the denied network-copyleft licence family. gcportrait is MIT, and the dependency deny list
 * refuses copyleft that reaches beyond its own files (agents.md, Licence and dependencies); this family's
 * names appear only where the deny list and verbatim licence texts need them, so that they cannot creep into
 * a header, a manifest, a footer or a document. Matched case-insensitively per line, in contents and in
 * paths; the short form only at the start of a word, so that a hash or an identifier that happens to contain
 * the letters does not match, and only in text (four letters occur by chance in binary data). Assembled at
 * run time, like the names above.
 */
const LICENCE_NAME_SHORT = ['A', 'GPL'].join('');
const LICENCE_NAME_LONG = ['GNU', ['Aff', 'ero'].join('')];
const LICENCE_NAME_TERMS = Object.freeze([
  { label: LICENCE_NAME_SHORT, pattern: new RegExp(`\\b${LICENCE_NAME_SHORT}`, 'i'), binary: false },
  {
    label: LICENCE_NAME_LONG.join(' '),
    pattern: new RegExp(LICENCE_NAME_LONG.join('\\s+'), 'i'),
    binary: true,
  },
]);

/** Files (root-relative) whose contents may name the family, with the reason. Paths never may. */
const LICENCE_NAME_EXEMPTIONS = Object.freeze([
  {
    test: (/** @type {string} */ p) => p === 'THIRD_PARTY.md',
    rule: 'THIRD_PARTY.md (the dependency deny list names it)',
  },
  {
    test: (/** @type {string} */ p) =>
      p === 'scripts/check-licenses.mjs' || p === 'scripts/check-licenses.test.ts',
    rule: 'scripts/check-licenses.mjs and its test (the deny list names the family it denies)',
  },
  {
    test: (/** @type {string} */ p) => p === 'scripts/licenses/MPL-2.0.txt',
    rule: 'scripts/licenses/MPL-2.0.txt (the verbatim MPL-2.0 text names it among its Secondary Licenses)',
  },
]);

/** Extensions read as Markdown by rule (f). */
const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown']);

/** Extensions of files that may not exist (rule b): Go, and Graphviz in both spellings. */
const BANNED_EXTENSIONS = new Set(['.go', '.dot', '.gv']);

/**
 * JavaScript and TypeScript files are checked for Gizmo graph queries (rule b): a call on the Gizmo graph
 * object `g` (`V`, `Vertex`, `M`, `Morphism`, `emit`, `Emit`), anywhere on a line, which is how such query
 * files are written (the call sits after an assignment or inside an `if`, never at line start). The
 * spelled-out forms are deliberately absent from this comment: the checker scans itself.
 */
const GIZMO_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const GIZMO_LINE = /\bg\.(?:V|Vertex|M|Morphism|emit|Emit)\(/;
const GIZMO_DESCRIPTION =
  'a call on the Gizmo graph object: g.V, g.Vertex, g.M, g.Morphism, g.emit or g.Emit';

/**
 * Rule (h) and the binary reading. A binary file is read through its printable runs of at least
 * BINARY_MIN_RUN characters (tabs, printable ASCII and the copyright sign): once as its bytes are, where a
 * NUL byte ends a run, once with its NUL bytes dropped, so that UTF-16 metadata reads as text, and, in a PNG
 * file, through its text chunks (see pngTexts). Only the terms marked `binary` are looked for there, every
 * one of them longer than such a run of chance.
 */
const BINARY_MIN_RUN = 6;
const PRINTABLE_RUN = new RegExp(`[\\t\\x20-\\x7e\\xa9]{${String(BINARY_MIN_RUN)},}`, 'g');
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const ENCODING_RULE = 'every text file is UTF-8 without a byte-order mark or NUL bytes (.editorconfig)';

/**
 * @typedef {{ relPath: string, line: number | undefined, rule: string, message: string }} Problem
 */

/**
 * 1-based line number of a character offset.
 * @param {string} text
 * @param {number} offset
 * @returns {number}
 */
function lineAt(text, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (text.charCodeAt(index) === 10) line += 1;
  return line;
}

/**
 * @param {string} relPath
 * @returns {boolean}
 */
function isForbiddenNameExempt(relPath) {
  return FORBIDDEN_NAME_EXEMPTIONS.some((exemption) => exemption.test(relPath));
}

/**
 * @param {string} relPath
 * @returns {boolean}
 */
function isLicenceNameExempt(relPath) {
  return LICENCE_NAME_EXEMPTIONS.some((exemption) => exemption.test(relPath));
}

/**
 * Rules (a), (e) and (g) on the path itself, so that a file or directory name cannot carry a refused string
 * either. Applies to binary files too.
 * @param {string} relPath
 * @param {Problem[]} problems
 */
function checkPath(relPath, problems) {
  for (const term of LICENCE_NAME_TERMS) {
    if (!term.pattern.test(relPath)) continue;
    problems.push({
      relPath,
      line: undefined,
      rule: 'licence-name',
      message: `path mentions "${term.label}"; gcportrait is MIT (agents.md, Licence and dependencies), and this family has no file here`,
    });
  }
  /** @type {Set<string>} */
  const labels = new Set();
  for (const term of BANNED_TERMS) {
    if (labels.has(term.label)) continue;
    const hit = term.first(relPath);
    if (hit === undefined) continue;
    labels.add(term.label);
    problems.push({
      relPath,
      line: undefined,
      rule: 'banned-term',
      message: `path mentions "${hit.text}" (${term.label}); ${term.message}`,
    });
  }
  if (isForbiddenNameExempt(relPath)) return;
  for (const term of FORBIDDEN_TERMS) {
    if (!term.pattern.test(relPath)) continue;
    problems.push({
      relPath,
      line: undefined,
      rule: 'forbidden-name',
      message: `path mentions "${term.label}"; ${NEVER_APPEARS}`,
    });
  }
}

/**
 * A comment or quote marker at the start of a line (`//`, `*`, `#`, `>`, `<!--`, `;`), dropped from the next
 * line before it is joined to the line above, so that a banned term broken across a line break in a comment
 * or a document is found as well as one on a single line.
 */
const CONTINUATION_MARKER = /^\s*(?:\/\/+|\*+(?!\/)|#+|>+|<!--|;+)?\s*/;

/**
 * At most `size` characters from one end of a line, without a word the cut splits.
 * @param {string} line
 * @param {number} size
 * @param {'start' | 'end'} side
 * @returns {string}
 */
function window(line, size, side) {
  if (line.length <= size) return line;
  /** @param {number} index */
  const inWord = (index) => {
    const code = line.charCodeAt(index) | 0x20;
    return (code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39);
  };
  if (side === 'end') {
    let start = line.length - size;
    if (inWord(start - 1)) while (start < line.length && inWord(start)) start += 1;
    return line.slice(start);
  }
  let end = size;
  if (inWord(end)) while (end > 0 && inWord(end - 1)) end -= 1;
  return line.slice(0, end);
}

/**
 * Rule (e) across a line break: the end of a line and the start of the next one (its comment marker dropped)
 * are joined by one space, and a banned term that starts on the first line and ends on the second is reported
 * at the line where it starts, unless a term of the same label was already reported on that line (one
 * finding per label and line). A term within one line is the per-line check's.
 * @param {string} relPath
 * @param {readonly string[]} lines
 * @param {Problem[]} problems
 * @param {Set<string>} reported `<label>:<line>` of the findings so far
 */
function checkWrappedTerms(relPath, lines, problems, reported) {
  for (let index = 0; index + 1 < lines.length; index += 1) {
    const end = (lines[index] ?? '').trimEnd();
    const start = (lines[index + 1] ?? '').replace(CONTINUATION_MARKER, '');
    if (end === '' || start === '') continue;
    /** @type {Map<number, { tail: string, joined: string }>} */
    const joins = new Map();
    for (const term of BANNED_TERMS) {
      const key = `${term.label}:${String(index + 1)}`;
      if (reported.has(key)) continue;
      let join = joins.get(term.window);
      if (join === undefined) {
        const cut = window(end, term.window, 'end');
        join = { tail: cut, joined: `${cut} ${window(start, term.window, 'start')}` };
        joins.set(term.window, join);
      }
      const { tail, joined } = join;
      if (term.first(joined) === undefined) continue;
      const hit = term
        .find(joined)
        .find((found) => found.index < tail.length && found.index + found.text.length > tail.length + 1);
      if (hit === undefined) continue;
      reported.add(key);
      problems.push({
        relPath,
        line: index + 1,
        rule: 'banned-term',
        message: `mentions "${hit.text}" across a line break (${term.label}); ${term.message}`,
      });
    }
  }
}

/**
 * Rules (a) and (e) on the contents: one finding of rule (e) per label and line.
 * @param {string} relPath
 * @param {readonly string[]} lines
 * @param {Problem[]} problems
 */
function checkTerms(relPath, lines, problems) {
  const exempt = isForbiddenNameExempt(relPath);
  /** @type {Set<string>} */
  const reported = new Set();
  lines.forEach((lineText, index) => {
    for (const term of BANNED_TERMS) {
      const key = `${term.label}:${String(index + 1)}`;
      if (reported.has(key)) continue;
      const hit = term.first(lineText);
      if (hit === undefined) continue;
      reported.add(key);
      problems.push({
        relPath,
        line: index + 1,
        rule: 'banned-term',
        message: `mentions "${hit.text}" (${term.label}); ${term.message}`,
      });
    }
    if (exempt) return;
    for (const term of FORBIDDEN_TERMS) {
      if (!term.pattern.test(lineText)) continue;
      problems.push({
        relPath,
        line: index + 1,
        rule: 'forbidden-name',
        message: `mentions "${term.label}"; ${NEVER_APPEARS}`,
      });
    }
  });
  checkWrappedTerms(relPath, lines, problems, reported);
}

/**
 * Rule (f): ids of work items.
 * @param {string} relPath
 * @param {readonly string[]} lines
 * @param {Problem[]} problems
 */
function checkPlanIds(relPath, lines, problems) {
  const markdown = MARKDOWN_EXTENSIONS.has(path.posix.extname(relPath).toLowerCase());
  const ids = PLAN_IDS.filter((id) => markdown || !id.markdownOnly);
  lines.forEach((lineText, index) => {
    for (const id of ids) {
      const match = id.pattern.exec(lineText);
      if (match === null) continue;
      problems.push({
        relPath,
        line: index + 1,
        rule: 'plan-id',
        message:
          `"${match[0]}" reads as ${id.label} of a work plan; say what the thing is or does ` +
          '(agents.md, Documentation)',
      });
    }
  });
}

/**
 * Rule (g): the denied family's names, outside its exemptions.
 * @param {string} relPath
 * @param {readonly string[]} lines
 * @param {Problem[]} problems
 */
function checkLicenceNames(relPath, lines, problems) {
  if (isLicenceNameExempt(relPath)) return;
  lines.forEach((lineText, index) => {
    for (const term of LICENCE_NAME_TERMS) {
      if (!term.pattern.test(lineText)) continue;
      problems.push({
        relPath,
        line: index + 1,
        rule: 'licence-name',
        message:
          `mentions "${term.label}"; gcportrait is MIT (agents.md, Licence and dependencies): this name belongs ` +
          'to the dependency deny list and the verbatim licence texts only',
      });
    }
  });
}

/**
 * Rules (a), (e), (f) and (g) on the text of a file.
 * @param {string} relPath
 * @param {string} text
 * @param {Problem[]} problems
 */
function checkText(relPath, text, problems) {
  const lines = splitLines(text);
  checkTerms(relPath, lines, problems);
  checkPlanIds(relPath, lines, problems);
  checkLicenceNames(relPath, lines, problems);
}

/**
 * Whether bytes are plain text: valid UTF-8 without a control character other than tab, line feed, form
 * feed and carriage return.
 * @param {Buffer} content
 * @returns {boolean}
 */
function isPlainText(content) {
  for (const byte of content) {
    if (byte === 0x7f || (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0c && byte !== 0x0d))
      return false;
  }
  try {
    UTF8.decode(content);
    return true;
  } catch {
    return false;
  }
}

/**
 * The byte order of UTF-16 text without a byte-order mark, told by its NUL bytes: the high byte of every
 * ASCII character is NUL, so they all sit at odd offsets (little-endian) or all at even ones (big-endian).
 * @param {Buffer} content
 * @returns {'le' | 'be' | undefined}
 */
function utf16ByteOrder(content) {
  const sample = content.subarray(0, 8192 - (Math.min(content.length, 8192) % 2));
  let even = 0;
  let odd = 0;
  sample.forEach((byte, index) => {
    if (byte !== 0) return;
    if (index % 2 === 0) even += 1;
    else odd += 1;
  });
  const enough = sample.length / 2 / 4;
  if (odd >= enough && even === 0) return 'le';
  if (even >= enough && odd === 0) return 'be';
  return undefined;
}

/**
 * @param {Buffer} content without a byte-order mark
 * @param {'le' | 'be'} order
 * @returns {string}
 */
function decodeUtf16(content, order) {
  const even = Buffer.from(content.subarray(0, content.length - (content.length % 2)));
  return (order === 'be' ? even.swap16() : even).toString('utf16le');
}

/**
 * A text file's text, its NUL bytes dropped, and what is wrong with its encoding (rule h), if anything.
 * @param {Buffer} content
 * @returns {{ text: string, problem: string | undefined }}
 */
function decodeText(content) {
  /** @type {(text: string) => string} */
  const clean = (text) => text.replaceAll('\u0000', '').replace(/^\uFEFF/, '');
  if (content[0] === 0xff && content[1] === 0xfe)
    return {
      text: clean(decodeUtf16(content.subarray(2), 'le')),
      problem: `is UTF-16 text; ${ENCODING_RULE}`,
    };
  if (content[0] === 0xfe && content[1] === 0xff)
    return {
      text: clean(decodeUtf16(content.subarray(2), 'be')),
      problem: `is UTF-16 text; ${ENCODING_RULE}`,
    };
  const withMark = content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf;
  const body = withMark ? content.subarray(3) : content;
  if (body.includes(0)) {
    const order = utf16ByteOrder(body);
    if (order !== undefined)
      return { text: clean(decodeUtf16(body, order)), problem: `is UTF-16 text; ${ENCODING_RULE}` };
    return {
      text: clean(body.toString('utf8')),
      problem:
        `holds NUL bytes; ${ENCODING_RULE}, and a binary format's extension belongs in BINARY_EXTENSIONS ` +
        '(scripts/lib/repo-files.mjs)',
    };
  }
  const text = body.toString('utf8');
  if (!isValidUtf8(body)) return { text, problem: `is not valid UTF-8; ${ENCODING_RULE}` };
  if (withMark) return { text, problem: `starts with a byte-order mark; ${ENCODING_RULE}` };
  return { text, problem: undefined };
}

/**
 * @param {Buffer} content
 * @returns {boolean}
 */
function isValidUtf8(content) {
  try {
    UTF8.decode(content);
    return true;
  } catch {
    return false;
  }
}

/**
 * The keywords and texts of a PNG file's text chunks (tEXt, zTXt, iTXt), the compressed ones inflated: a
 * chunk's checksum follows its text directly, and a compressed text is not readable in the bytes.
 * @param {Buffer} content
 * @returns {string[]}
 */
function pngTexts(content) {
  if (content.length < 8 || content.readUInt32BE(0) !== 0x89504e47) return [];
  /** @param {Buffer} data */
  const inflated = (data) => {
    try {
      return inflateSync(data).toString('utf8');
    } catch {
      return '';
    }
  };
  /** @type {string[]} */
  const texts = [];
  for (let offset = 8; offset + 12 <= content.length;) {
    const length = content.readUInt32BE(offset);
    const type = content.toString('latin1', offset + 4, offset + 8);
    const data = content.subarray(offset + 8, Math.min(content.length, offset + 8 + length));
    const keywordEnd = data.indexOf(0);
    const keyword = data.toString('latin1', 0, keywordEnd < 0 ? data.length : keywordEnd);
    if (type === 'tEXt') texts.push(keyword, data.toString('latin1', keywordEnd + 1));
    else if (type === 'zTXt') texts.push(keyword, inflated(data.subarray(keywordEnd + 2)));
    else if (type === 'iTXt') {
      const compressed = data[keywordEnd + 1] === 1;
      const languageEnd = data.indexOf(0, keywordEnd + 3);
      const translatedEnd = data.indexOf(0, languageEnd + 1);
      const text = data.subarray(translatedEnd + 1);
      texts.push(
        keyword,
        data.toString('utf8', languageEnd + 1, translatedEnd),
        compressed ? inflated(text) : text.toString('utf8'),
      );
    }
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  return texts;
}

/**
 * Rules (a), (e) and (g) on a binary file, through its printable runs: one finding per term (in rule e, per
 * label) and file.
 * @param {string} relPath
 * @param {Buffer} content
 * @param {Problem[]} problems
 */
function checkBinary(relPath, content, problems) {
  const bytes = content.toString('latin1');
  const runs = [bytes, bytes.replaceAll('\u0000', ''), ...pngTexts(content)].flatMap((view) =>
    Array.from(view.matchAll(PRINTABLE_RUN), (match) => match[0]),
  );
  if (runs.length === 0) return;
  const text = runs.join('\n');
  /** @param {string} found */
  const shown = (found) => found.replace(/[^\x20-\x7e]/g, '?');
  if (!isForbiddenNameExempt(relPath)) {
    for (const term of FORBIDDEN_TERMS) {
      if (!term.pattern.test(text)) continue;
      problems.push({
        relPath,
        line: undefined,
        rule: 'forbidden-name',
        message: `mentions "${term.label}" in its binary contents; ${NEVER_APPEARS}`,
      });
    }
  }
  /** @type {Set<string>} */
  const labels = new Set();
  for (const term of BANNED_TERMS) {
    if (!term.binary || labels.has(term.label)) continue;
    const hit = term.first(text);
    if (hit === undefined) continue;
    labels.add(term.label);
    problems.push({
      relPath,
      line: undefined,
      rule: 'banned-term',
      message: `mentions "${shown(hit.text)}" in its binary contents (${term.label}); ${term.message}`,
    });
  }
  if (isLicenceNameExempt(relPath)) return;
  for (const term of LICENCE_NAME_TERMS) {
    if (!term.binary || !term.pattern.test(text)) continue;
    problems.push({
      relPath,
      line: undefined,
      rule: 'licence-name',
      message: `mentions "${term.label}" in its binary contents; gcportrait is MIT (agents.md, Licence and dependencies)`,
    });
  }
}

/**
 * Rule (b).
 * @param {string} relPath
 * @param {string} text
 * @param {Problem[]} problems
 * @returns {boolean} whether the file type itself is banned (the file has to go, so no other rule applies)
 */
function checkBannedFiles(relPath, text, problems) {
  const extension = path.posix.extname(relPath).toLowerCase();
  if (BANNED_EXTENSIONS.has(extension)) {
    problems.push({
      relPath,
      line: undefined,
      rule: 'banned-file',
      message: `${extension} files are not allowed: no Go code, no Graphviz templates (agents.md, Licence and dependencies)`,
    });
    return true;
  }
  if (GIZMO_EXTENSIONS.has(extension) && GIZMO_LINE.test(text)) {
    problems.push({
      relPath,
      line: lineAt(text, text.search(GIZMO_LINE)),
      rule: 'banned-file',
      message: `looks like a Gizmo graph query (${GIZMO_DESCRIPTION}); not allowed (agents.md, Licence and dependencies)`,
    });
  }
  return false;
}

/**
 * Rule (d): symbolic links are reported, whatever they point at. A link can make another checkout or anything
 * outside the repository reachable from a path the other rules consider clean.
 * @param {string} relPath
 * @param {string} absPath
 * @param {Problem[]} problems
 */
function reportSymlink(relPath, absPath, problems) {
  /** @type {string} */
  let target;
  try {
    target = readlinkSync(absPath);
  } catch {
    target = '(unreadable)';
  }
  problems.push({
    relPath,
    line: undefined,
    rule: 'symlink',
    message: `symbolic link to "${target}"; links are not allowed in the tree (they can reach outside the repository)`,
  });
}

/**
 * Rule (c).
 * @param {string} relPath
 * @param {string} text
 * @param {string} licenseId
 * @param {Problem[]} problems
 * @returns {boolean} whether the file needed a header
 */
function checkHeader(relPath, text, licenseId, problems) {
  const style = requiredHeaderStyle(relPath);
  if (style === undefined) {
    if (!isHeaderExempt(relPath) && !isHeaderFree(relPath)) {
      problems.push({
        relPath,
        line: undefined,
        rule: 'spdx-header',
        message:
          'no SPDX header form is defined for this file type; add its comment style to ' +
          'HEADER_STYLE_BY_EXTENSION or HEADER_STYLE_BY_FILENAME in scripts/lib/repo-files.mjs, or, if the ' +
          'format cannot hold a comment, add it to HEADER_FREE_EXTENSIONS or HEADER_FREE_FILENAMES there',
      });
    }
    return false;
  }
  const expected = headerLine(style, licenseId);
  const found = findHeader(splitLines(text), relPath, style);
  if (found?.licenseId === licenseId) return true;
  problems.push({
    relPath,
    line: found === undefined ? undefined : found.index + 1,
    rule: 'spdx-header',
    message:
      found === undefined
        ? `missing SPDX header; add the line "${expected}" within the first ${String(HEADER_WINDOW)} lines`
        : `SPDX header names "${found.licenseId}", expected "${expected}"`,
  });
  return true;
}

/**
 * Runs every rule over the tree rooted at `root`.
 * @param {string} root
 * @returns {{ problems: Problem[], fileCount: number, headerCount: number, licenseId: string }}
 */
function checkTree(root) {
  const licenseId = readProjectLicenseId(root);
  /** @type {Problem[]} */
  const problems = [];
  let fileCount = 0;
  let headerCount = 0;
  for (const { absPath, relPath, isSymlink } of listRepoFiles(root)) {
    fileCount += 1;
    checkPath(relPath, problems);
    if (isSymlink) {
      reportSymlink(relPath, absPath, problems);
      continue;
    }
    const content = readFileSync(absPath);
    if (BINARY_EXTENSIONS.has(path.posix.extname(relPath).toLowerCase())) {
      if (isPlainText(content)) {
        problems.push({
          relPath,
          line: undefined,
          rule: 'encoding',
          message: 'holds plain text under a binary extension; give it the extension of its format',
        });
        checkText(relPath, content.toString('utf8'), problems);
      } else checkBinary(relPath, content, problems);
      continue;
    }
    const { text, problem } = decodeText(content);
    if (problem !== undefined)
      problems.push({ relPath, line: undefined, rule: 'encoding', message: problem });
    checkText(relPath, text, problems);
    if (checkBannedFiles(relPath, text, problems)) continue;
    if (checkHeader(relPath, text, licenseId, problems)) headerCount += 1;
  }
  return { problems, fileCount, headerCount, licenseId };
}

/**
 * Rule (e) for `--list-exempt`: a printed term with its pattern, a secret label once, with its count.
 * @returns {string[]}
 */
function describeBannedTerms() {
  /** @type {Map<string, { patterns: number, digests: number }>} */
  const secret = new Map();
  /** @type {string[]} */
  const lines = [];
  for (const term of BANNED_TERMS) {
    if (!term.secret) {
      lines.push(`      ${term.label}: ${String(term.pattern)}`);
      continue;
    }
    const counts = secret.get(term.label) ?? { patterns: 0, digests: 0 };
    if (!secret.has(term.label)) lines.push(term.label);
    if (term.pattern !== undefined) counts.patterns += 1;
    counts.digests += term.digests ?? 0;
    secret.set(term.label, counts);
  }
  /** @param {number} count @param {string} noun */
  const plural = (count, noun) => `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
  return lines.map((line) => {
    const counts = secret.get(line);
    if (counts === undefined) return line;
    const parts = [plural(counts.patterns, 'pattern')];
    if (counts.digests > 0) parts.push(plural(counts.digests, 'phrase digest'));
    return `      ${line} (${parts.join(' and ')}, not printed)`;
  });
}

/** @returns {string} */
function describeRules() {
  /** @type {Map<string, string[]>} */
  const headerForms = new Map();
  for (const [match, style] of [...HEADER_STYLE_BY_EXTENSION, ...HEADER_STYLE_BY_FILENAME]) {
    const line = headerLine(style, '<id>');
    headerForms.set(line, [...(headerForms.get(line) ?? []), match]);
  }
  return [
    'Provenance rules (scripts/check-provenance.mjs)',
    '',
    'Walked: every file git tracks, and every other file under the repository root, except',
    `  directories named: ${SKIPPED_DIR_NAMES.join(', ')}`,
    `  build output named ${SKIPPED_BUILD_DIR_NAMES.join(' or ')}: at the root, directly under a top-level directory or`,
    '    directly under a package in packages/ (as .gitignore ignores them; deeper ones are walked)',
    `  root paths: ${SKIPPED_ROOT_PATHS.map((p) => `${p}/`).join(', ')}`,
    '  local environment files: .env, .env.* (except .env.example)',
    `  git-ignored files: ${SKIPPED_FILE_PATTERNS.map((p) => p.rule).join(', ')}`,
    'Read: every file. A binary file, by its extension:',
    `  ${[...BINARY_EXTENSIONS].join(' ')}`,
    `  through its printable runs of ${String(BINARY_MIN_RUN)} or more characters, as its bytes are and with its NUL bytes`,
    "  dropped, and through a PNG's text chunks, inflated, for the terms of (a), (e) and (g) long enough not to",
    '  occur there by chance. Every other file as text: UTF-16 decoded, anything else as UTF-8, NUL bytes dropped.',
    '',
    '(a) forbidden-name: case-insensitive substring, per line, in file contents and in file/directory names:',
    `    ${String(FORBIDDEN_NAMES.length)} names (assembled at run time, not printed) and a Google copyright notice.`,
    '    The names match inside longer words and camelCase identifiers too, and with a hyphen or an underscore',
    '    between their halves. A copyright notice is any line with the word for copyright or the copyright sign',
    "    followed later on the line by Google's name. Binary files too.",
    `    not applied in: ${FORBIDDEN_NAME_EXEMPTIONS.map((e) => e.rule).join(', ')}`,
    `(b) banned-file: ${[...BANNED_EXTENSIONS].join(', ')} files, and ${[...GIZMO_EXTENSIONS].join('/')} files containing`,
    `    ${GIZMO_DESCRIPTION} (anywhere on a line)`,
    `(c) spdx-header: the exact line below within the first ${String(HEADER_WINDOW)} lines (Markdown/Astro: the first`,
    `    ${String(HEADER_WINDOW)} lines after a leading --- frontmatter block). <id> is the "license" field of the root`,
    '    package.json (MIT; scripts/set-license.mjs rewrites every header if it changes).',
    '    Files are matched by exact base name first (dotfiles, Dockerfile, CODEOWNERS), then by extension:',
    ...[...headerForms].map(([line, extensions]) => `      ${line}   ${extensions.join(' ')}`),
    '    header-exempt:',
    ...HEADER_EXEMPTIONS.map((e) => `      ${e.rule}`),
    `    header-free formats (cannot hold a comment, or are data or licence texts): ${[
      ...HEADER_FREE_EXTENSIONS,
      ...HEADER_FREE_FILENAMES,
    ].join(' ')}, and binary files.`,
    '    Any other text file fails: its type needs a header style or a header-free entry in',
    '    scripts/lib/repo-files.mjs first.',
    '(d) symlink: no symbolic links anywhere in the walked tree, whatever they point at',
    "(e) banned-term: per line and across a line break (the next line's comment marker dropped), in file",
    '    contents and in file/directory names, with no exemption ("since <date>" stays legal); in binary files',
    '    all but the citations of a decision record by abbreviation or folder:',
    ...describeBannedTerms(),
    `(f) plan-id: per line, ${PLAN_IDS.filter((id) => !id.markdownOnly)
      .map((id) => `${id.label} (${String(id.pattern)})`)
      .join(' and ')} in every text file,`,
    `    ${PLAN_IDS.filter((id) => id.markdownOnly)
      .map((id) => `${id.label} (${String(id.pattern)})`)
      .join(' and ')} in Markdown (${[...MARKDOWN_EXTENSIONS].join(' ')}), with no exemption`,
    '(g) licence-name: case-insensitive, per line, in file contents and in file/directory names:',
    `    ${LICENCE_NAME_TERMS.map((t) => `"${t.label}"`).join(', ')} (the first at the start of a word and in text only)`,
    '    contents allowed only in:',
    ...LICENCE_NAME_EXEMPTIONS.map((e) => `      ${e.rule}`),
    '    file and directory names: nowhere',
    `(h) encoding: ${ENCODING_RULE};`,
    '    a file with a binary extension holds that format, not plain text',
  ].join('\n');
}

/**
 * @param {readonly string[]} argv
 */
function parseCli(argv) {
  return parseArgs({
    args: [...argv],
    options: {
      root: { type: 'string' },
      'list-exempt': { type: 'boolean' },
      'digest-of': { type: 'string' },
      'also-refuse': { type: 'string', multiple: true },
    },
    strict: true,
  });
}

/**
 * @param {readonly string[]} argv
 * @returns {number} exit code
 */
function main(argv) {
  /** @type {ReturnType<typeof parseCli>} */
  let parsed;
  try {
    parsed = parseCli(argv);
    for (const entry of parsed.values['also-refuse'] ?? []) addDigest(PHRASES, entry);
  } catch (error) {
    console.error(`provenance: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  if (parsed.values['list-exempt'] === true) {
    console.log(describeRules());
    return 0;
  }
  const phrase = parsed.values['digest-of'];
  if (phrase !== undefined) {
    const entry = digestEntryOf(phrase);
    if (entry === undefined) {
      console.error(
        `provenance: --digest-of takes a phrase of 1 to ${String(MAX_PHRASE_WORDS)} words, a directory ("name/") or "<word> <date>"`,
      );
      return 2;
    }
    console.log(entry);
    return 0;
  }
  const root = path.resolve(parsed.values.root ?? fileURLToPath(new URL('..', import.meta.url)));
  const { problems, fileCount, headerCount, licenseId } = checkTree(root);
  if (problems.length === 0) {
    console.log(
      `provenance: OK. ${String(fileCount)} files scanned, ${String(headerCount)} SPDX headers ` +
        `(${licenseId}) verified; no forbidden names, banned terms or banned files.`,
    );
    return 0;
  }
  const files = new Set(problems.map((problem) => problem.relPath));
  console.error(
    `provenance: FAILED with ${String(problems.length)} problem(s) in ${String(files.size)} file(s):`,
  );
  for (const problem of problems) {
    const location =
      problem.line === undefined ? problem.relPath : `${problem.relPath}:${String(problem.line)}`;
    console.error(`  ${location}  [${problem.rule}] ${problem.message}`);
  }
  console.error('Run `node scripts/check-provenance.mjs --list-exempt` for the rules and exemptions.');
  return 1;
}

process.exitCode = main(process.argv.slice(2));
