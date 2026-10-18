// SPDX-License-Identifier: Apache-2.0
/**
 * The non-affiliation statement outside the app (AGENTS.md, Non-affiliation, brand and legal): every copy the
 * tooling, the image, the release, the infra scripts and the docs keep of the long form is
 * frontend/src/branding.ts's, word for word. The app pins the wording itself (frontend/src/App.test.tsx); the
 * website checks its own copy (website/src/site.test.ts).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { brandingConstant } from './testing/branding.js';
import { REPO } from './testing/temp-tree.js';

const read = (relPath: string): string => readFileSync(path.join(REPO, relPath), 'utf8');
/** A document's text with its line breaks, blockquote markers and indentation as single spaces. */
const prose = (relPath: string): string =>
  read(relPath)
    .replace(/^\s*>\s*/gm, '')
    .replace(/\s+/g, ' ');

const LONG_FORM = brandingConstant('NON_AFFILIATION_LONG');

describe('the app’s wording, as the tooling reads it', () => {
  it('is the whole long form, naming no one', () => {
    expect(LONG_FORM).toMatch(/^gcportrait renders .* icon usage terms\.$/);
    expect(LONG_FORM).toContain('It is an independent open-source project and is not affiliated with');
    expect(LONG_FORM).not.toMatch(/side project|Chrometz/);
  });
});

/** A copy of the wording: where it is kept, and its text as the tooling reads it there. */
type Copy = { readonly copy: string; readonly text: () => string | undefined };

/** The copies of the long form that hold nothing else. */
const LONG_FORM_COPIES: readonly Copy[] = [
  {
    copy: 'the image description label in infra/Dockerfile',
    text: () => /org\.opencontainers\.image\.description="([^"]+)"/.exec(read('infra/Dockerfile'))?.[1],
  },
  {
    copy: 'the close of the infra scripts’ --help (infra/common.sh)',
    text: () => /^NON_AFFILIATION_LONG="([^"]+)"$/m.exec(read('infra/common.sh'))?.[1],
  },
  {
    copy: 'the close of the installer’s --help (infra/install.sh, which runs before common.sh is downloaded)',
    text: () => /^NON_AFFILIATION_LONG="([^"]+)"$/m.exec(read('infra/install.sh'))?.[1],
  },
];

/** The 15 canonical documents that carry the long form. */
const LONG_FORM_DOCUMENTS: readonly { readonly copy: string; readonly file: string }[] = [
  { copy: 'the root README (README.md)', file: 'README.md' },
  { copy: 'the third-party material register (THIRD_PARTY.md)', file: 'THIRD_PARTY.md' },
  { copy: 'the brand licence (brand/LICENSE.md)', file: 'brand/LICENSE.md' },
  { copy: 'the docs index (docs/README.md)', file: 'docs/README.md' },
  { copy: 'the website author section (docs/author.md)', file: 'docs/author.md' },
  { copy: 'the Cloud Shell tutorial (docs/cloudshell-tutorial.md)', file: 'docs/cloudshell-tutorial.md' },
  { copy: 'the legal fact sheets index (docs/legal/README.md)', file: 'docs/legal/README.md' },
  { copy: 'the security policy (docs/security.md)', file: 'docs/security.md' },
  { copy: 'the threat model (docs/threat-model.md)', file: 'docs/threat-model.md' },
  { copy: 'the website architecture doc (docs/website.md)', file: 'docs/website.md' },
  { copy: 'the infrastructure README (infra/README.md)', file: 'infra/README.md' },
  { copy: 'the icons package README (packages/icons/README.md)', file: 'packages/icons/README.md' },
  { copy: 'the render package README (packages/render/README.md)', file: 'packages/render/README.md' },
  { copy: 'the render CLI README (packages/render-cli/README.md)', file: 'packages/render-cli/README.md' },
  { copy: 'the website README (website/README.md)', file: 'website/README.md' },
];

// Loops rather than describe.each: its `$copy` would cut the names at 40 characters.
for (const { copy, text } of LONG_FORM_COPIES) {
  describe(`the long form in ${copy}`, () => {
    it('is the app’s, word for word', () => {
      expect(text()).toBe(LONG_FORM);
    });
  });
}

for (const { copy, file } of LONG_FORM_DOCUMENTS) {
  describe(`the long form in ${copy}`, () => {
    it('appears exactly once, word for word', () => {
      expect(prose(file).split(LONG_FORM)).toHaveLength(2);
    });
  });
}

/** Recursively collect all *.md files in the repository, relative to REPO. */
const allMarkdownFiles = (dir: string = REPO): string[] => {
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.claude') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...allMarkdownFiles(full));
    } else if (entry.name.endsWith('.md')) {
      result.push(path.relative(REPO, full));
    }
  }
  return result;
};

describe('all other markdown files in the repository', () => {
  const canonicalSet = new Set<string>(LONG_FORM_DOCUMENTS.map((d) => d.file));
  // AGENTS.md defines the rule and quotes the statement; CHANGELOG.md records past release notes.
  const excluded = new Set<string>(['AGENTS.md', 'CHANGELOG.md']);
  const otherFiles = allMarkdownFiles().filter((f) => !canonicalSet.has(f) && !excluded.has(f));

  it('carry no copy of the long-form non-affiliation statement', () => {
    expect(otherFiles.length).toBeGreaterThan(0);
    for (const file of otherFiles) {
      expect(prose(file), `${file} should not contain the long form`).not.toContain(LONG_FORM);
    }
  });
});

describe('the long form in the README, the box under "Not affiliated with Google"', () => {
  it('is the app’s, word for word', () => {
    const box = /## Not affiliated with Google\n\n((?:>.*\n)+)/.exec(read('README.md'))?.[1] ?? '';
    expect(
      box
        .replace(/^> ?/gm, '')
        .replace(/\[!IMPORTANT\]/, '')
        .replace(/\s+/g, ' ')
        .trim(),
    ).toBe(LONG_FORM);
  });
});

describe('the long form as the closing paragraph of docs/author.md (the website’s author section)', () => {
  it('is the app’s, word for word, and the last thing the section says', () => {
    expect(prose('docs/author.md').trim().endsWith(LONG_FORM)).toBe(true);
  });
});

const BRAND_SENTENCE =
  'They identify this project and may not be used to present other software or services as gcportrait or as endorsed by it; forks must use their own name and icon.';

const BRAND_SENTENCE_FILES = [
  'brand/LICENSE.md',
  'LICENSE',
  'README.md',
  'THIRD_PARTY.md',
  'AGENTS.md',
  'website/src/pages/licence.astro',
];

describe('the brand sentence in brand/LICENSE.md and its mirrors', () => {
  for (const file of BRAND_SENTENCE_FILES) {
    it(`is word for word in ${file}`, () => {
      expect(prose(file)).toContain(BRAND_SENTENCE);
    });
  }
});
