// SPDX-License-Identifier: MIT
// @ts-check
/**
 * The rules files of the repository and the citations of them (AGENTS.md, How this file works): the root
 * AGENTS.md and one AGENTS.md per top-level folder that has rules of its own, their `##` and `###` headings
 * and numbered lists, and a parser that finds a citation of a rules file in any text. scripts/rules-files.test.ts
 * holds every citation of the tree to a heading that exists, and scripts/agents-setup.mjs writes a pointer for
 * each folder file. Plain ESM, Node built-ins only.
 *
 * A citation names a rules file by its path from the repository root (none for the root's), then the heading
 * of a section: after a comma (`AGENTS.md, Tokens`), after a quote (`AGENTS.md "Product rules"`), in a
 * parenthesised list of quoted headings (`AGENTS.md ("Tokens" and "OAuth scopes")`), or as a GitHub anchor
 * (`AGENTS.md#tokens`). A Markdown link names the file in its text and links it by a relative href, which must
 * lead to the same file, and its anchor counts as a citation. After a heading come more: a subsection of it, a
 * `principle N` of its numbered list, or another heading after a comma, "and" or a semicolon. A comma that is
 * followed by a lower-case word is prose, not a citation. Lines are read as one text, the comment markers at
 * their starts dropped, so that a citation wrapped across lines of a comment or a paragraph reads whole.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  BINARY_EXTENSIONS,
  SKIPPED_BUILD_DIR_NAMES,
  SKIPPED_DIR_NAMES,
  SKIPPED_ROOT_PATHS,
  listRepoFiles,
} from './repo-files.mjs';

/** The name of every rules file, in the capitals the tools look for. */
export const RULES_FILE = 'AGENTS.md';

/** The sentence every folder file opens with, after its SPDX line and its title. */
export const FOLDER_FILE_OPENING = 'These rules add to the root AGENTS.md, which applies here too.';

/**
 * @typedef {{
 *   level: 2 | 3,
 *   text: string,
 *   slug: string,
 *   line: number,
 *   parent: string | undefined,
 *   numbered: readonly number[],
 * }} Heading
 * @typedef {(file: string) => readonly Heading[] | undefined} HeadingsOf
 * @typedef {{
 *   from: string,
 *   line: number,
 *   file: string,
 *   excerpt: string,
 *   headings: readonly string[],
 *   principles: readonly number[],
 *   anchor: string | undefined,
 *   problems: readonly string[],
 * }} Citation
 */

/**
 * Whether a folder at the root is one that never holds a rules file: VCS data, installed dependencies, the
 * assistants' own folders, build output (scripts/lib/repo-files.mjs).
 * @param {string} name
 * @returns {boolean}
 */
function isSkippedFolder(name) {
  return (
    SKIPPED_DIR_NAMES.includes(name) ||
    SKIPPED_ROOT_PATHS.includes(name) ||
    SKIPPED_BUILD_DIR_NAMES.includes(name)
  );
}

/**
 * Whether a directory lists a file named exactly AGENTS.md (an existence check would accept another case on a
 * case-insensitive file system).
 * @param {string} absDir
 * @returns {boolean}
 */
function holdsRulesFile(absDir) {
  try {
    return readdirSync(absDir, { withFileTypes: true }).some(
      (entry) => entry.name === RULES_FILE && entry.isFile(),
    );
  } catch {
    return false;
  }
}

/**
 * The top-level folders of a checkout that hold a rules file of their own, sorted.
 * @param {string} root
 * @returns {string[]}
 */
export function rulesFolders(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !isSkippedFolder(entry.name))
    .map((entry) => entry.name)
    .filter((name) => holdsRulesFile(path.join(root, name)))
    .sort();
}

/**
 * The rules files of a checkout as root-relative POSIX paths: the root's AGENTS.md first, then each folder's.
 * @param {string} root
 * @returns {string[]}
 */
export function rulesFiles(root) {
  return [
    ...(holdsRulesFile(root) ? [RULES_FILE] : []),
    ...rulesFolders(root).map((folder) => `${folder}/${RULES_FILE}`),
  ];
}

/**
 * The anchor GitHub gives a heading: lower case, without punctuation but hyphens and underscores, its spaces as
 * hyphens. A second heading of the same text gets `-1`, a third `-2` (readHeadings counts them).
 * @param {string} text
 * @returns {string}
 */
export function githubSlug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

/**
 * The `##` and `###` headings of a rules file, outside fenced code, with each one's anchor, the section a `###`
 * belongs to, and the numbers of the ordered list in its own text (the principles of "Security and privacy").
 * @param {string} text
 * @returns {Heading[]}
 */
export function readHeadings(text) {
  /** @type {Heading[]} */
  const headings = [];
  /** @type {number[][]} */
  const lists = [];
  /** @type {Map<string, number>} */
  const slugs = new Map();
  /** @type {string | undefined} */
  let section;
  /** @type {string | undefined} */
  let fence;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const fenceMark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fenceMark !== undefined) {
      if (fence === undefined) fence = fenceMark;
      else if (fenceMark.startsWith(fence)) fence = undefined;
      return;
    }
    if (fence !== undefined) return;
    const heading = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (heading !== null) {
      const marks = heading[1] ?? '';
      const name = (heading[2] ?? '').replace(/`/g, '');
      if (marks.length !== 2 && marks.length !== 3) {
        lists.push([]); // a heading of another level ends the list of the one before
        if (marks.length < 2) section = undefined;
        return;
      }
      const base = githubSlug(name);
      const seen = slugs.get(base) ?? 0;
      slugs.set(base, seen + 1);
      /** @type {number[]} */
      const numbered = [];
      lists.push(numbered);
      if (marks.length === 2) section = name;
      headings.push({
        level: marks.length === 2 ? 2 : 3,
        text: name,
        slug: seen === 0 ? base : `${base}-${String(seen)}`,
        line: index + 1,
        parent: marks.length === 3 ? section : undefined,
        numbered,
      });
      return;
    }
    const item = /^(\d+)\.[ \t]/.exec(line);
    const list = lists.at(-1);
    if (item !== null && list !== undefined) list.push(Number(item[1]));
  });
  return headings;
}

/** A comment marker that may open a line (`//`, ` * `, `#`, `<!--`, `>`), with the indentation around it. */
const LINE_LEAD = /^\s*(?:\/\/+|\*+|#+(?=\s)|<!--|>+)?\s*/;

/**
 * A mention of a rules file: an optional path of folders, then AGENTS.md, never inside a longer name, a URL or
 * a path with a placeholder (`<folder>/AGENTS.md`).
 */
const MENTION = /(?<![\w./-])((?:[\w.-]+\/)*)AGENTS\.md(?![\w-])/g;

/** An opening quote around a heading, and a closing one. */
const OPEN_QUOTE = /^["“]?/;
/** What may stand between two headings of one citation: a closing quote, then a comma, "and" or a semicolon. */
const SEPARATOR = /^["”]?(?:,[ ]*(?:and[ ]+)?|[ ]+and[ ]+|;[ ]*)/;
/** A numbered item of the heading before: `principle 4`, `principles 1 and 2`. */
const PRINCIPLE = /^principles?[ ]+(\d+(?:(?:,[ ]*(?:and[ ]+)?|[ ]+and[ ]+|[ ]+or[ ]+)\d+)*)/;
/** The longest stretch of text a citation reads after its file. */
const WINDOW = 400;

/**
 * The text as one line, each source line's leading comment marker and indentation dropped, with a function
 * that tells the line of a position in it.
 * @param {string} text
 * @returns {{ flat: string, lineAt: (position: number) => number }}
 */
function flatten(text) {
  /** @type {number[]} */
  const starts = [];
  let flat = '';
  for (const line of text.split(/\r?\n/)) {
    starts.push(flat.length);
    flat += `${line.replace(LINE_LEAD, '')} `;
  }
  /** @param {number} position */
  const lineAt = (position) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((starts[middle] ?? 0) <= position) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
  return { flat, lineAt };
}

/**
 * The root-relative path a citation names: a link's href from the citing file's folder (`href`), or a path
 * in text from the root, its leading `./` and `../` dropped (a test's string that holds an href, say).
 * @param {string} written
 * @param {string} fromDir the citing file's folder, root-relative
 * @param {boolean} href
 * @returns {string}
 */
function resolvePath(written, fromDir, href) {
  if (href)
    return path.posix.normalize(
      written.startsWith('/') ? written.slice(1) : path.posix.join(fromDir, written),
    );
  return path.posix.normalize(written.replace(/^(?:\.{1,2}\/)+/, ''));
}

/**
 * The heading a text starts with: the longest one not followed by a lower-case letter.
 * @param {string} text
 * @param {readonly Heading[]} headings
 * @returns {Heading | undefined}
 */
function headingAtStart(text, headings) {
  /** @type {Heading | undefined} */
  let best;
  for (const heading of headings) {
    if (!text.startsWith(heading.text) || /^\p{Ll}/u.test(text.slice(heading.text.length))) continue;
    if (best === undefined || heading.text.length > best.text.length) best = heading;
  }
  return best;
}

/**
 * Reads the headings a citation names after its file, from `rest` (the text after the file's name and link).
 * @param {string} rest
 * @param {string} file the rules file the citation names
 * @param {readonly Heading[] | undefined} headings its headings, undefined when it is no rules file
 * @returns {{ headings: Heading[], principles: number[], problems: string[], cited: boolean }}
 */
function readHeadingList(rest, file, headings) {
  /** @type {Heading[]} */
  const found = [];
  /** @type {number[]} */
  const principles = [];
  /** @type {string[]} */
  const problems = [];
  const text = rest.slice(0, WINDOW).replace(/\s+/g, ' ');
  /** @type {string | undefined} */
  let cursor;
  // Whether the text after the file must name a heading: after a comma or a quote, an upper-case word is one.
  let strict = false;
  const list = /^ ?\( ?(?=["“])/.exec(text);
  const comma = /^, ?/.exec(text);
  const quote = /^ (?=["“])/.exec(text);
  const word = /^ (?=\p{Lu})/u.exec(text);
  if (list !== null) {
    cursor = text.slice(list[0].length);
    strict = true;
  } else if (comma !== null) {
    cursor = text.slice(comma[0].length);
    strict = /^(?:["“]|\p{Lu})/u.test(cursor);
  } else if (quote !== null) {
    cursor = text.slice(quote[0].length);
    strict = true;
  } else if (word !== null) {
    cursor = text.slice(word[0].length);
  }
  if (cursor === undefined || (!strict && headings === undefined)) {
    return { headings: found, principles, problems, cited: false };
  }
  if (headings === undefined) {
    problems.push(`names ${file}, which is no rules file of the tree`);
    return { headings: found, principles, problems, cited: true };
  }
  while (cursor !== undefined) {
    const opening = OPEN_QUOTE.exec(cursor)?.[0] ?? '';
    const item = cursor.slice(opening.length);
    const principle = found.length > 0 && opening === '' ? PRINCIPLE.exec(item) : null;
    if (principle !== null) {
      // A principle is one of the numbered list of the section the citation names, its subsection aside.
      const last = found.at(-1);
      const sectionName = last?.level === 3 ? last.parent : last?.text;
      const section = headings.find((heading) => heading.level === 2 && heading.text === sectionName);
      for (const number of (principle[1] ?? '').split(/\D+/).map(Number)) {
        principles.push(number);
        if (section?.numbered.includes(number) !== true) {
          problems.push(
            `names principle ${String(number)}, which "${sectionName ?? ''}" of ${file} does not number`,
          );
        }
      }
      cursor = item.slice(principle[0].length);
    } else {
      if (opening === '' && !/^\p{Lu}/u.test(item)) break;
      const heading = headingAtStart(item, headings);
      if (heading === undefined) {
        if (strict || opening !== '') problems.push(`names no heading of ${file}`);
        break;
      }
      const before = found.at(-1);
      if (heading.level === 3 && before?.level === 2 && heading.parent !== before.text) {
        problems.push(
          `names "${heading.text}" after "${before.text}", but it is a subsection of "${heading.parent ?? ''}"`,
        );
      }
      found.push(heading);
      cursor = item.slice(heading.text.length);
    }
    // After a comma, an upper-case word names another heading; after "and" or a semicolon it may be prose.
    const separator = SEPARATOR.exec(cursor);
    strict = separator?.[0].includes(',') === true;
    cursor = separator === null ? undefined : cursor.slice(separator[0].length);
  }
  return { headings: found, principles, problems, cited: found.length > 0 || problems.length > 0 };
}

/**
 * Every citation of a rules file in a text, each with what it names and what is wrong with it.
 * @param {string} text the file's content
 * @param {string} relPath the citing file, root-relative POSIX
 * @param {HeadingsOf} headingsOf the headings of a rules file (root-relative), undefined for any other path
 * @returns {Citation[]}
 */
export function findCitations(text, relPath, headingsOf) {
  /** @type {Citation[]} */
  const citations = [];
  if (!text.includes(RULES_FILE) && headingsOf(relPath) === undefined) return citations;
  const { flat, lineAt } = flatten(text);
  const fromDir = path.posix.dirname(relPath);
  /**
   * @param {number} position
   * @param {string} file
   * @param {{ headings?: readonly Heading[], principles?: readonly number[], anchor?: string, problems: readonly string[] }} found
   */
  const add = (position, file, found) => {
    citations.push({
      from: relPath,
      line: lineAt(position),
      file,
      excerpt: flat
        .slice(position, position + 100)
        .replace(/\s+/g, ' ')
        .trim(),
      headings: (found.headings ?? []).map((heading) => heading.text),
      principles: found.principles ?? [],
      anchor: found.anchor,
      problems: found.problems,
    });
  };
  /**
   * @param {string} file
   * @param {string} anchor
   * @returns {string[]}
   */
  const anchorProblems = (file, anchor) => {
    const headings = headingsOf(file);
    if (headings === undefined) return [`links ${file}#${anchor}, but ${file} is no rules file of the tree`];
    return headings.some((heading) => heading.slug === anchor)
      ? []
      : [`links #${anchor}, which is no heading of ${file}`];
  };

  // A rules file's links to its own headings.
  if (headingsOf(relPath) !== undefined) {
    for (const match of flat.matchAll(/\]\(#([^)\s]+)\)/g)) {
      const anchor = match[1] ?? '';
      add(match.index, relPath, { anchor, problems: anchorProblems(relPath, anchor) });
    }
  }

  for (const match of flat.matchAll(MENTION)) {
    const start = match.index;
    const end = start + match[0].length;
    const written = match[0];
    const before = flat.slice(Math.max(0, start - 2), start);
    let rest = flat.slice(end, end + WINDOW);
    /** @type {string} */
    let file;
    /** @type {string | undefined} */
    let anchor;
    /** @type {string[]} */
    const problems = [];
    if (before === '](' || flat.slice(Math.max(0, start - 3), start) === '](<') {
      // The href of a link: the citation of a link whose text names the file was read with that text.
      if (/AGENTS\.md`?$/.test(flat.slice(0, before === '](' ? start - 2 : start - 3))) continue;
      file = resolvePath(written, fromDir, true);
      const hash = /^#([^)\s>]*)>?\)/.exec(rest);
      if (hash !== null) {
        anchor = hash[1] ?? '';
        rest = rest.slice(hash[0].length);
      } else {
        rest = rest.replace(/^>?\)/, '');
      }
    } else {
      file = resolvePath(written, fromDir, false);
      rest = rest.replace(/^`/, '');
      const link = /^\]\(<?([^)\s>]*)>?\)/.exec(rest);
      if (link !== null) {
        const href = link[1] ?? '';
        const [hrefPath = '', hrefAnchor] = href.split('#');
        if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && hrefPath !== '') {
          const target = resolvePath(hrefPath, fromDir, true);
          if (target !== file) problems.push(`links ${target}, but its text names ${file}`);
        }
        anchor = hrefAnchor;
        rest = rest.slice(link[0].length);
      } else {
        const hash = /^#([\w-]+)/.exec(rest);
        if (hash !== null) {
          anchor = hash[1] ?? '';
          rest = rest.slice(hash[0].length);
        }
      }
    }
    if (anchor !== undefined) problems.push(...anchorProblems(file, anchor));
    const list = readHeadingList(rest, file, headingsOf(file));
    if (!list.cited && anchor === undefined && problems.length === 0) continue;
    add(start, file, {
      headings: list.headings,
      principles: list.principles,
      ...(anchor === undefined ? {} : { anchor }),
      problems: [...problems, ...list.problems],
    });
  }
  return citations;
}

/**
 * The files git tracks in a checkout, or every file the tooling walks when it is none (an unpacked archive).
 * @param {string} root
 * @returns {string[]}
 */
export function trackedFiles(root) {
  if (existsSync(path.join(root, '.git'))) {
    try {
      return execFileSync('git', ['ls-files', '-z'], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .split('\0')
        .filter((relPath) => relPath !== '');
    } catch {
      // not a work tree git can read: walk it instead
    }
  }
  return listRepoFiles(root)
    .filter((file) => !file.isSymlink)
    .map((file) => file.relPath);
}

/**
 * Every citation of a rules file in the text files of a checkout, with each one's problems.
 * @param {string} root
 * @param {readonly string[]} [files] root-relative paths to read; every file git tracks by default
 * @returns {Citation[]}
 */
export function citationsOf(root, files = trackedFiles(root)) {
  /** @type {Map<string, readonly Heading[]>} */
  const rules = new Map(
    rulesFiles(root).map((file) => [file, readHeadings(readFileSync(path.join(root, file), 'utf8'))]),
  );
  /** @type {HeadingsOf} */
  const headingsOf = (file) => rules.get(file);
  /** @type {Citation[]} */
  const citations = [];
  for (const relPath of files) {
    if (BINARY_EXTENSIONS.has(path.posix.extname(relPath).toLowerCase())) continue;
    /** @type {string} */
    let text;
    try {
      text = readFileSync(path.join(root, relPath), 'utf8');
    } catch {
      continue; // deleted in the work tree, or a folder (a submodule)
    }
    if (text.includes('\0')) continue;
    citations.push(...findCitations(text, relPath, headingsOf));
  }
  return citations;
}

/**
 * The problems of a list of citations, one line each: the citing file and line, what is wrong, and the text.
 * @param {readonly Citation[]} citations
 * @returns {string[]}
 */
export function citationProblems(citations) {
  return citations.flatMap((citation) =>
    citation.problems.map(
      (problem) => `${citation.from}:${String(citation.line)}: ${problem}: ${citation.excerpt}`,
    ),
  );
}

/**
 * Whether a folder file opens with FOLDER_FILE_OPENING: its first paragraph after the SPDX line and the title.
 * @param {string} text
 * @returns {boolean}
 */
export function opensWithRootSentence(text) {
  const lines = text.split(/\r?\n/);
  let index = 0;
  /** @param {RegExp} pattern */
  const skip = (pattern) => {
    while (index < lines.length && pattern.test(lines[index] ?? '')) index += 1;
  };
  skip(/^\s*$/);
  skip(/^<!--.*-->\s*$/);
  skip(/^\s*$/);
  skip(/^# /);
  skip(/^\s*$/);
  return lines.slice(index).join(' ').startsWith(FOLDER_FILE_OPENING);
}

/**
 * The folder files of a checkout that do not open with FOLDER_FILE_OPENING, one problem each.
 * @param {string} root
 * @returns {string[]}
 */
export function openingProblems(root) {
  return rulesFolders(root)
    .map((folder) => `${folder}/${RULES_FILE}`)
    .filter((file) => !opensWithRootSentence(readFileSync(path.join(root, file), 'utf8')))
    .map(
      (file) => `${file}: the first paragraph after its title does not open with "${FOLDER_FILE_OPENING}"`,
    );
}
