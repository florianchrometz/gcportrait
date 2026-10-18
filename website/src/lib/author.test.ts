// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { authorSection, parseAuthor } from './author.js';

describe('docs/author.md', () => {
  it('parses the repository’s file: the maintainer, the personal website, https profiles only', () => {
    const author = authorSection();
    expect(author).not.toBeNull();
    expect(author?.name).toBe('Florian Chrometz');
    expect(author?.url).toBe('https://florian-chrometz.de');
    for (const link of author?.sameAs ?? []) expect(link.startsWith('https://')).toBe(true);
    expect(author?.html).not.toContain('<h1');
    expect(author?.description).toBeDefined();
  });

  it('leaves out profile links that are not https URLs and reports placeholders', () => {
    const author = parseAuthor(
      '---\nname: A Person\nurl: https://example.com\nsameAs:\n  - https://example.org/a\n  - "[LINKEDIN URL]"\n  - http://example.net\n---\n# About\n\nBio [BIO PARAGRAPH].\n',
    );
    expect(author.sameAs).toEqual(['https://example.org/a']);
    expect(author.placeholders).toEqual(['[LINKEDIN URL]', '[BIO PARAGRAPH]']);
    expect(author.heading).toBe('About');
  });

  it('refuses a file without a name or an https url', () => {
    expect(() => parseAuthor('---\nname: A Person\nurl: http://example.com\n---\n')).toThrow(/https url/);
    expect(() => parseAuthor('# No front matter\n')).toThrow(/name/);
  });
});
