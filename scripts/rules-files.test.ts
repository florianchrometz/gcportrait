// SPDX-License-Identifier: MIT
/**
 * The rules files and the citations of them (AGENTS.md, How this file works): every citation of a rules file
 * in a file git tracks names a heading, a principle or an anchor that exists; every rules file is AGENTS.md in
 * those capitals, at the root or one folder down; every folder file opens with the sentence that names the
 * root. The parser's own cases build the name of the file at run time, so that this file's fixed strings are
 * not read as citations of the tree.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SKIPPED_DIR_NAMES } from './lib/repo-files.mjs';
import {
  FOLDER_FILE_OPENING,
  RULES_FILE,
  citationProblems,
  citationsOf,
  findCitations,
  githubSlug,
  openingProblems,
  opensWithRootSentence,
  readHeadings,
  rulesFiles,
  rulesFolders,
  type Heading,
} from './lib/rules-files.mjs';
import { REPO, createTempTree, type TempTree } from './testing/temp-tree.js';

/** The rules file's name, assembled. */
const FILE = ['AGENTS', 'md'].join('.');

const ROOT_RULES = [
  '<!-- SPDX-License-Identifier: MIT -->',
  '',
  '# The rules',
  '',
  '## How this file works',
  '',
  '## Data',
  '',
  '## Data and graph semantics',
  '',
  '## Security and privacy',
  '',
  'The two principles:',
  '',
  '1. **One.**',
  '2. **Two.**',
  '',
  '### Tokens',
  '',
  '### The service-account gate',
  '',
  '1. The caller.',
  '2. The list.',
  '3. The memo.',
  '',
  '### OAuth scopes',
  '',
  '## Product rules',
  '',
  '```',
  '## Not a heading',
  '```',
  '',
  '## Product rules',
  '',
].join('\n');

const FOLDER_RULES = [
  '<!-- SPDX-License-Identifier: MIT -->',
  '',
  '# The frontend',
  '',
  FOLDER_FILE_OPENING,
  '',
  '## Phones, tablets and desktops',
  '',
  '### The touch model',
  '',
].join('\n');

const RULES = new Map<string, readonly Heading[]>([
  [FILE, readHeadings(ROOT_RULES)],
  [`frontend/${FILE}`, readHeadings(FOLDER_RULES)],
]);
const headingsOf = (file: string) => RULES.get(file);

/** What the parser reads in a text of a file: the headings, principles and anchors, and every problem. */
function cite(text: string, from = 'backend/src/server.ts') {
  return findCitations(text, from, headingsOf).map((citation) => ({
    file: citation.file,
    line: citation.line,
    headings: citation.headings,
    principles: citation.principles,
    anchor: citation.anchor,
    problems: citation.problems,
  }));
}

describe('the citations of the rules files in the tree', () => {
  it('name a heading, a principle and an anchor of the rules file they name, everywhere', () => {
    const citations = citationsOf(REPO);
    const problems = citationProblems(citations);
    expect(problems, problems.join('\n')).toEqual([]);
    // The parser reads the tree's citations at all: hundreds of files cite the rules by heading.
    expect(new Set(citations.map((citation) => citation.from)).size).toBeGreaterThan(100);
  });
});

describe('the headings of a rules file', () => {
  it('are its ## and ### headings outside fenced code, with their anchors, sections and numbered lists', () => {
    const headings = readHeadings(ROOT_RULES);
    expect(headings.map((heading) => [heading.level, heading.text, heading.slug])).toEqual([
      [2, 'How this file works', 'how-this-file-works'],
      [2, 'Data', 'data'],
      [2, 'Data and graph semantics', 'data-and-graph-semantics'],
      [2, 'Security and privacy', 'security-and-privacy'],
      [3, 'Tokens', 'tokens'],
      [3, 'The service-account gate', 'the-service-account-gate'],
      [3, 'OAuth scopes', 'oauth-scopes'],
      [2, 'Product rules', 'product-rules'],
      [2, 'Product rules', 'product-rules-1'],
    ]);
    const byText = (text: string) => headings.find((heading) => heading.text === text);
    expect(byText('Security and privacy')?.numbered).toEqual([1, 2]);
    expect(byText('The service-account gate')?.numbered).toEqual([1, 2, 3]);
    expect(byText('The service-account gate')?.parent).toBe('Security and privacy');
    expect(byText('Tokens')?.numbered).toEqual([]);
    expect(byText('Data')?.line).toBe(7);
  });

  it('take the anchors GitHub gives them', () => {
    expect(githubSlug('Non-affiliation, brand and legal')).toBe('non-affiliation-brand-and-legal');
    expect(githubSlug('Quality gates, testing and CI')).toBe('quality-gates-testing-and-ci');
    expect(githubSlug('"As of", never "live"')).toBe('as-of-never-live');
    expect(githubSlug('Snake_case and a dot.')).toBe('snake_case-and-a-dot');
  });
});

describe('a citation', () => {
  it('names a heading after a comma, the longest the text starts with', () => {
    expect(cite(`// The cache (${FILE}, Security and privacy).`)).toEqual([
      {
        file: FILE,
        line: 1,
        headings: ['Security and privacy'],
        principles: [],
        anchor: undefined,
        problems: [],
      },
    ]);
    expect(cite(`(${FILE}, Data and graph semantics)`)[0]?.headings).toEqual(['Data and graph semantics']);
    expect(cite(`(${FILE}, Data)`)[0]?.headings).toEqual(['Data']);
    expect(cite(`\`${FILE}\`, Product rules`)[0]?.headings).toEqual(['Product rules']);
  });

  it('is prose when a lower-case word follows the comma, and when nothing that names a heading follows', () => {
    expect(cite(`${FILE}, which applies here too.`)).toEqual([]);
    expect(cite(`Read ${FILE} and the skills; ${FILE} is the one name.`)).toEqual([]);
    expect(cite(`\`${FILE}\`, \`README.md\` and \`CHANGELOG.md\``)).toEqual([]);
  });

  it('is none in an import line', () => {
    expect(cite(`"@./${FILE}\\n\\n" and @${FILE}`)).toEqual([]);
    expect(cite(`CLAUDE.md with \`@${FILE}\`, FOLDER/CLAUDE.md with \`@./${FILE}\`, Product rules`)).toEqual(
      [],
    );
  });

  it('names a quoted heading, or a parenthesised list of them', () => {
    expect(cite(`(ui/screen.ts, ${FILE} "Product rules": the layouts)`)[0]?.headings).toEqual([
      'Product rules',
    ]);
    expect(cite(`${FILE} ("Tokens", "OAuth scopes" and "Product rules")`)[0]?.headings).toEqual([
      'Tokens',
      'OAuth scopes',
      'Product rules',
    ]);
    expect(cite(`${FILE}, “Security and privacy”, “Tokens”`)[0]?.headings).toEqual([
      'Security and privacy',
      'Tokens',
    ]);
  });

  it('names a subsection after its section, and more headings after a comma, "and" or a semicolon', () => {
    expect(cite(`(${FILE}, Security and privacy, The service-account gate)`)[0]?.headings).toEqual([
      'Security and privacy',
      'The service-account gate',
    ]);
    expect(cite(`(${FILE}, Data, and Product rules; Tokens)`)[0]?.headings).toEqual([
      'Data',
      'Product rules',
      'Tokens',
    ]);
    // After "and" or a semicolon an upper-case word may start prose; after a comma it names a heading.
    expect(cite(`(${FILE}, Tokens and Google's terms)`)[0]).toMatchObject({
      headings: ['Tokens'],
      problems: [],
    });
    expect(cite(`(${FILE}, Tokens; Google's terms)`)[0]).toMatchObject({
      headings: ['Tokens'],
      problems: [],
    });
    expect(cite(`(${FILE}, Tokens, Google's terms)`)[0]?.problems).toEqual([`names no heading of ${FILE}`]);
    expect(cite(`(${FILE}, Product rules, Tokens)`)[0]?.problems).toEqual([
      'names "Tokens" after "Product rules", but it is a subsection of "Security and privacy"',
    ]);
  });

  it('names a principle of the numbered list of the section it names', () => {
    expect(cite(`(${FILE}, Security and privacy, principle 2)`)[0]).toMatchObject({
      headings: ['Security and privacy'],
      principles: [2],
      problems: [],
    });
    expect(cite(`(${FILE}, Security and privacy, principles 1 and 2 and Tokens)`)[0]).toMatchObject({
      headings: ['Security and privacy', 'Tokens'],
      principles: [1, 2],
      problems: [],
    });
    expect(cite(`(${FILE}, Security and privacy, The service-account gate; principle 2)`)[0]).toMatchObject({
      principles: [2],
      problems: [],
    });
    expect(cite(`(${FILE}, Security and privacy, principle 3)`)[0]?.problems).toEqual([
      `names principle 3, which "Security and privacy" of ${FILE} does not number`,
    ]);
    expect(cite(`(${FILE}, Product rules, principle 1)`)[0]?.problems).toEqual([
      `names principle 1, which "Product rules" of ${FILE} does not number`,
    ]);
  });

  it('reads whole when a comment or a paragraph wraps it, and tells the line it starts on', () => {
    const text = [
      '/**',
      ' * The gate',
      ` * (${FILE}, Security and`,
      ' * privacy, principle',
      ' * 2).',
      ' */',
    ];
    expect(cite(text.join('\n'))).toMatchObject([
      { line: 3, headings: ['Security and privacy'], principles: [2], problems: [] },
    ]);
    const markdown = ['A rule', `([${FILE}](../${FILE}),`, '"Security and privacy").'];
    expect(cite(markdown.join('\n'), 'docs/modes.md')).toMatchObject([
      { line: 2, headings: ['Security and privacy'], problems: [] },
    ]);
  });

  it('fails on a heading, a file or a principle that does not exist', () => {
    expect(cite(`(${FILE}, No such heading)`)[0]?.problems).toEqual([`names no heading of ${FILE}`]);
    expect(cite(`(${FILE}, Datasets)`)[0]?.problems).toEqual([`names no heading of ${FILE}`]);
    expect(cite(`(${FILE} "Product")`)[0]?.problems).toEqual([`names no heading of ${FILE}`]);
    expect(cite(`(backend/${FILE}, The service-account gate)`)[0]?.problems).toEqual([
      `names backend/${FILE}, which is no rules file of the tree`,
    ]);
  });

  it('names a folder file by its path from the root, and the root file without one', () => {
    expect(cite(`(frontend/${FILE}, Phones, tablets and desktops, The touch model)`)[0]).toMatchObject({
      file: `frontend/${FILE}`,
      headings: ['Phones, tablets and desktops', 'The touch model'],
      problems: [],
    });
    expect(cite(`(${FILE}, Phones, tablets and desktops)`, 'frontend/src/App.tsx')[0]?.problems).toEqual([
      `names no heading of ${FILE}`,
    ]);
    // A placeholder or a URL is no citation.
    expect(cite(`\`<folder>/${FILE}, <heading>\` and https://example.com/blob/main/${FILE}#tokens`)).toEqual(
      [],
    );
  });

  it('as a Markdown link, names the file in its text and links the same file, its anchor a citation too', () => {
    expect(cite(`[${FILE}](../${FILE}), "Tokens"`, 'docs/faq.md')).toMatchObject([
      { file: FILE, headings: ['Tokens'], problems: [] },
    ]);
    expect(cite(`[frontend/${FILE}](../frontend/${FILE}), "The touch model"`, 'docs/faq.md')).toMatchObject([
      { file: `frontend/${FILE}`, headings: ['The touch model'], problems: [] },
    ]);
    expect(cite(`[${FILE}](../../${FILE}#security-and-privacy)`, 'packages/model/README.md')).toMatchObject([
      { anchor: 'security-and-privacy', problems: [] },
    ]);
    expect(cite(`[${FILE}](../frontend/${FILE}), "Tokens"`, 'docs/faq.md')[0]?.problems).toEqual([
      `links frontend/${FILE}, but its text names ${FILE}`,
    ]);
    expect(cite(`[${FILE}](../${FILE}#no-such-heading)`, 'docs/faq.md')[0]?.problems).toEqual([
      `links #no-such-heading, which is no heading of ${FILE}`,
    ]);
    expect(cite(`[the rules](../${FILE}#product-rules-1)`, 'docs/faq.md')).toMatchObject([
      { anchor: 'product-rules-1', problems: [] },
    ]);
    expect(cite(`[the rules](../../${FILE}#tokens)`, 'docs/faq.md')[0]?.problems).toEqual([
      `links ../${FILE}#tokens, but ../${FILE} is no rules file of the tree`,
    ]);
  });

  it('as an anchor in text, names a heading of the file, read from the root', () => {
    expect(cite(`expect(rewriteHref('../${FILE}#oauth-scopes', 'docs/faq.md'))`)).toMatchObject([
      { file: FILE, anchor: 'oauth-scopes', problems: [] },
    ]);
    expect(cite(`See ${FILE}#scopes.`)[0]?.problems).toEqual([
      `links #scopes, which is no heading of ${FILE}`,
    ]);
  });

  it('in a rules file, links its own headings by anchor', () => {
    const own = cite('See [Tokens](#tokens) and [the gate](#the-gate).', FILE);
    expect(own.map((citation) => [citation.anchor, citation.problems])).toEqual([
      ['tokens', []],
      ['the-gate', [`links #the-gate, which is no heading of ${FILE}`]],
    ]);
  });
});

describe('the rules files of a checkout', () => {
  let tree: TempTree;

  beforeEach(() => {
    tree = createTempTree('rules-files');
  });

  afterEach(() => {
    tree.remove();
  });

  it('are the root AGENTS.md and the AGENTS.md of each top-level folder, nothing deeper or skipped', () => {
    tree.write(FILE, ROOT_RULES);
    tree.write(`frontend/${FILE}`, FOLDER_RULES);
    tree.write(`.github/${FILE}`, FOLDER_RULES);
    tree.write(`packages/model/${FILE}`, FOLDER_RULES);
    tree.write(`node_modules/${FILE}`, FOLDER_RULES);
    tree.write('docs/notes.md', '# Notes\n');
    expect(rulesFolders(tree.root)).toEqual(['.github', 'frontend']);
    expect(rulesFiles(tree.root)).toEqual([FILE, `.github/${FILE}`, `frontend/${FILE}`]);
  });

  it('open, in a folder, with the sentence that names the root', () => {
    tree.write(FILE, ROOT_RULES);
    tree.write(`frontend/${FILE}`, FOLDER_RULES);
    tree.write(
      `backend/${FILE}`,
      FOLDER_RULES.replace(FOLDER_FILE_OPENING, 'These are the rules of the backend.'),
    );
    expect(opensWithRootSentence(FOLDER_RULES)).toBe(true);
    expect(opensWithRootSentence(`# Title\n\n${FOLDER_FILE_OPENING} More.\n`)).toBe(true);
    expect(opensWithRootSentence(`# Title\n\nFirst.\n${FOLDER_FILE_OPENING}\n`)).toBe(false);
    expect(openingProblems(tree.root)).toEqual([
      `backend/${FILE}: the first paragraph after its title does not open with "${FOLDER_FILE_OPENING}"`,
    ]);
  });
});

describe('the repository’s rules files', () => {
  it('are each named AGENTS.md, the name the tools read, in that case on disk and in git, one folder deep at most', () => {
    const onDisk = (relDir: string) =>
      readdirSync(path.join(REPO, relDir)).filter((name) => name.toLowerCase() === RULES_FILE.toLowerCase());
    expect(onDisk('')).toEqual([RULES_FILE]);
    for (const entry of readdirSync(REPO, { withFileTypes: true })) {
      if (!entry.isDirectory() || SKIPPED_DIR_NAMES.includes(entry.name)) continue;
      for (const name of onDisk(entry.name))
        expect(`${entry.name}/${name}`).toBe(`${entry.name}/${RULES_FILE}`);
    }
    const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' });
    if (tracked.status !== 0) return; // not a git checkout (an unpacked archive): the names on disk are all there is
    const rules = tracked.stdout
      .split('\0')
      .filter((file) => path.posix.basename(file).toLowerCase() === RULES_FILE.toLowerCase());
    expect(
      rules.filter((file) => path.posix.basename(file) !== RULES_FILE),
      'git tracks a rules file under another case; on a case-insensitive file system rename it with `git mv -f`',
    ).toEqual([]);
    expect(
      rules.filter((file) => file.split('/').length > 2),
      'a rules file lies at the root or directly in a top-level folder (AGENTS.md, How this file works)',
    ).toEqual([]);
    expect(rules).toContain(RULES_FILE);
  });

  it('open, in each folder, with the sentence that names the root', () => {
    expect(openingProblems(REPO)).toEqual([]);
  });
});
