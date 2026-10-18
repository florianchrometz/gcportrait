// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { parseInline, parseMarkdown, safeHref, type Inline } from './markdown';

const text = (value: string): Inline => ({ kind: 'text', text: value });

describe('parseMarkdown: blocks', () => {
  it('reads ATX and setext headings, paragraphs and rules', () => {
    expect(
      parseMarkdown(
        '# Impressum #\n\nExample Operator\nExample Street 1\n\nKontakt\n-------\n\n***\n\nSetext one\n===\n###### Six',
      ),
    ).toEqual([
      { kind: 'heading', level: 1, children: [text('Impressum')] },
      { kind: 'paragraph', children: [text('Example Operator Example Street 1')] },
      { kind: 'heading', level: 2, children: [text('Kontakt')] },
      { kind: 'rule' },
      { kind: 'heading', level: 1, children: [text('Setext one')] },
      { kind: 'heading', level: 6, children: [text('Six')] },
    ]);
  });

  it('reads bullet and ordered lists with continuation lines, and keeps "2019. A year" as text', () => {
    expect(parseMarkdown('- one\n  more of one\n* two\n\n3. three\n4) four\n\nIn\n2019. A year')).toEqual([
      { kind: 'list', ordered: false, start: 1, items: [[text('one more of one')], [text('two')]] },
      { kind: 'list', ordered: true, start: 3, items: [[text('three')], [text('four')]] },
      { kind: 'paragraph', children: [text('In 2019. A year')] },
    ]);
  });

  it('handles CRLF, blank and whitespace-only input', () => {
    expect(parseMarkdown('a\r\nb\r\n\r\nc')).toEqual([
      { kind: 'paragraph', children: [text('a b')] },
      { kind: 'paragraph', children: [text('c')] },
    ]);
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('  \n\t\n')).toEqual([]);
  });

  it('keeps raw HTML as text, in blocks and inline', () => {
    expect(
      parseMarkdown('<script>alert(1)</script>\n\n<b>bold</b> and <img src=x onerror=alert(1)>'),
    ).toEqual([
      { kind: 'paragraph', children: [text('<script>alert(1)</script>')] },
      { kind: 'paragraph', children: [text('<b>bold</b> and <img src=x onerror=alert(1)>')] },
    ]);
  });
});

describe('parseInline', () => {
  it('reads strong, emphasis and code, but not underscores inside a word', () => {
    expect(parseInline('**Verantwortlich:** *Example* `code` __b__ _i_ snake_case_name')).toEqual([
      { kind: 'strong', children: [text('Verantwortlich:')] },
      text(' '),
      { kind: 'emphasis', children: [text('Example')] },
      text(' '),
      { kind: 'code', text: 'code' },
      text(' '),
      { kind: 'strong', children: [text('b')] },
      text(' '),
      { kind: 'emphasis', children: [text('i')] },
      text(' snake_case_name'),
    ]);
    expect(parseInline('2 * 3 * 4 and ** loose')).toEqual([text('2 * 3 * 4 and ** loose')]);
    expect(parseInline('*a **b** c*')).toEqual([
      {
        kind: 'emphasis',
        children: [text('a '), { kind: 'strong', children: [text('b')] }, text(' c')],
      },
    ]);
  });

  it('reads hard line breaks (two spaces or a backslash) and turns other line breaks into spaces', () => {
    expect(parseInline('Example Operator  \nExample Street 1\\\n12345 Example City\nGermany')).toEqual([
      text('Example Operator'),
      { kind: 'break' },
      text('Example Street 1'),
      { kind: 'break' },
      text('12345 Example City Germany'),
    ]);
  });

  it('reads links and autolinks, and drops the link of an unsafe target but keeps its text', () => {
    expect(
      parseInline(
        '[site](https://example.com/a "Title") <https://example.org> <mail@example.com> [mail](mailto:mail@example.com) [here](/privacy)',
      ),
    ).toEqual([
      { kind: 'link', href: 'https://example.com/a', children: [text('site')] },
      text(' '),
      { kind: 'link', href: 'https://example.org/', children: [text('https://example.org')] },
      text(' '),
      { kind: 'link', href: 'mailto:mail@example.com', children: [text('mail@example.com')] },
      text(' '),
      { kind: 'link', href: 'mailto:mail@example.com', children: [text('mail')] },
      text(' '),
      { kind: 'link', href: '/privacy', children: [text('here')] },
    ]);
    expect(
      parseInline('[click](javascript:alert%281%29) [data](data:text/html,x) <javascript:alert(1)>'),
    ).toEqual([text('click'), text(' '), text('data'), text(' <javascript:alert(1)>')]);
    // Parentheses inside a destination are not read (a subset of CommonMark): the whole thing stays text.
    expect(parseInline('[x](javascript:alert(1))')).toEqual([text('[x](javascript:alert(1))')]);
    expect(parseInline('[**bold** link](https://example.com)')).toEqual([
      {
        kind: 'link',
        href: 'https://example.com/',
        children: [{ kind: 'strong', children: [text('bold')] }, text(' link')],
      },
    ]);
  });

  it('honours backslash escapes and leaves unmatched brackets and backticks alone', () => {
    expect(parseInline('\\*not emphasis\\* \\[x\\] a\\b `open [x] (y)')).toEqual([
      text('*not emphasis* [x] a\\b `open [x] (y)'),
    ]);
  });
});

describe('safeHref', () => {
  it('allows http(s), mailto and paths on this site only', () => {
    expect(safeHref('https://example.com')).toBe('https://example.com/');
    expect(safeHref('http://example.com/x?y=1#z')).toBe('http://example.com/x?y=1#z');
    expect(safeHref('mailto:a@example.com')).toBe('mailto:a@example.com');
    expect(safeHref('/impressum')).toBe('/impressum');
    expect(safeHref('#contact')).toBe('#contact');
    for (const refused of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<b>x</b>',
      'vbscript:x',
      '//evil.example.com',
      '/\\evil.example.com',
      'file:///etc/passwd',
      'mailto:',
      'example.com',
      '',
    ]) {
      expect(safeHref(refused), refused).toBeNull();
    }
  });
});
