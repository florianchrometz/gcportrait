// SPDX-License-Identifier: MIT
/**
 * The non-affiliation statement outside the app (AGENTS.md, Non-affiliation, brand and legal): every copy the
 * tooling, the image, the release, the infra scripts and the docs keep of the long form is
 * frontend/src/branding.ts's, word for word. The app pins the wording itself (frontend/src/App.test.tsx); the
 * website checks its own copy (website/src/site.test.ts).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { NON_AFFILIATION_LONG as RELEASE_NOTES_LONG_FORM } from './release-notes.mjs';
import { brandingConstant } from './testing/branding.js';
import { REPO } from './testing/temp-tree.js';
import { NON_AFFILIATION_LONG as NOTICES_LONG_FORM } from './third-party-notices.mjs';

const read = (relPath: string): string => readFileSync(path.join(REPO, relPath), 'utf8');
/** A document's text with its line breaks and indentation as single spaces. */
const prose = (relPath: string): string => read(relPath).replace(/\s+/g, ' ');

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
    copy: 'the image description label of the release workflow',
    text: () =>
      /org\.opencontainers\.image\.description=(.+)$/m.exec(read('.github/workflows/release.yml'))?.[1],
  },
  { copy: 'the release notes (scripts/release-notes.mjs)', text: () => RELEASE_NOTES_LONG_FORM },
  {
    copy: 'the close of the infra scripts’ --help (infra/common.sh)',
    text: () => /^NON_AFFILIATION_LONG="([^"]+)"$/m.exec(read('infra/common.sh'))?.[1],
  },
  {
    copy: 'the close of the installer’s --help (infra/install.sh, which runs before common.sh is downloaded)',
    text: () => /^NON_AFFILIATION_LONG="([^"]+)"$/m.exec(read('infra/install.sh'))?.[1],
  },
  { copy: 'the third-party notices (scripts/third-party-notices.mjs)', text: () => NOTICES_LONG_FORM },
];

/** The documents that quote the long form in their prose. */
const LONG_FORM_DOCUMENTS = [
  { copy: 'the Cloud Shell tutorial (a footnote of its first step)', file: 'docs/cloudshell-tutorial.md' },
  { copy: 'the docs index (docs/README.md)', file: 'docs/README.md' },
  { copy: 'the website’s README (website/README.md)', file: 'website/README.md' },
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
    it('is the app’s, word for word', () => {
      expect(prose(file)).toContain(LONG_FORM);
    });
  });
}

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
