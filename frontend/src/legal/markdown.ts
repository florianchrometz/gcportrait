// SPDX-License-Identifier: Apache-2.0
/**
 * A small Markdown reader for the instance's legal pages (legal/LegalPage.tsx). It turns text into a
 * tree of plain data that RenderMarkdown.tsx renders as React elements, so there is no HTML anywhere on the way: raw HTML
 * in the text shows as the characters it is made of, and a link is kept only when it is `http:`, `https:`, `mailto:`
 * or a path on this site. Written for texts an operator writes, not as a full CommonMark implementation:
 *
 * - blocks: ATX headings (`#` to `######`) and setext headings (a line of `=` or `-` under a paragraph),
 *   paragraphs, bullet lists (`-`, `*`, `+`) and ordered lists (`1.` or `1)`), each item one paragraph (an indented
 *   or lazy next line continues it), and thematic breaks (`---`, `***`, `___`);
 * - inline: `**strong**` and `__strong__`, `*emphasis*` and `_emphasis_` (not inside a word), `` `code` ``,
 *   `[text](url "title")`, autolinks `<https://…>` and `<name@example.com>`, backslash escapes, and hard line breaks
 *   (two spaces or a backslash at the end of a line); any other line break is a space, as in CommonMark.
 *
 * Anything else (block quotes, code blocks, tables, images, reference links) reads as text.
 */

export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'strong'; readonly children: readonly Inline[] }
  | { readonly kind: 'emphasis'; readonly children: readonly Inline[] }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'link'; readonly href: string; readonly children: readonly Inline[] }
  | { readonly kind: 'break' };

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type Block =
  | { readonly kind: 'heading'; readonly level: HeadingLevel; readonly children: readonly Inline[] }
  | { readonly kind: 'paragraph'; readonly children: readonly Inline[] }
  | {
      readonly kind: 'list';
      readonly ordered: boolean;
      readonly start: number;
      readonly items: readonly (readonly Inline[])[];
    }
  | { readonly kind: 'rule' };

const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
const RULE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const BULLET_ITEM = /^ {0,3}[-*+](?:[ \t]+(.*))?$/;
const ORDERED_ITEM = /^ {0,3}(\d{1,9})[.)](?:[ \t]+(.*))?$/;
const BLANK = /^[ \t]*$/;

/** The text of an ATX heading line without its optional closing run of `#`. */
function headingText(raw: string | undefined): string {
  const text = raw ?? '';
  if (/^#+$/.test(text)) return '';
  return text.replace(/[ \t]+#+$/, '');
}

type OpenList = { ordered: boolean; start: number; items: string[] };

/** Parses `source` into blocks. Pure; never throws. */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  // In an object, so that the closures below and the loop agree on its type (TypeScript narrows a plain `let`).
  const open: { list: OpenList | null } = { list: null };

  const closeParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join('\n').trim()) });
    paragraph = [];
  };
  const closeList = (): void => {
    const list = open.list;
    if (list === null) return;
    blocks.push({
      kind: 'list',
      ordered: list.ordered,
      start: list.start,
      items: list.items.map((item) => parseInline(item.trim())),
    });
    open.list = null;
  };
  const close = (): void => {
    closeParagraph();
    closeList();
  };

  for (const line of lines) {
    if (BLANK.test(line)) {
      close();
      continue;
    }
    const setext = paragraph.length > 0 ? SETEXT_UNDERLINE.exec(line) : null;
    if (setext !== null) {
      const level: HeadingLevel = setext[1]?.startsWith('=') === true ? 1 : 2;
      blocks.push({ kind: 'heading', level, children: parseInline(paragraph.join('\n').trim()) });
      paragraph = [];
      continue;
    }
    if (RULE.test(line)) {
      close();
      blocks.push({ kind: 'rule' });
      continue;
    }
    const heading = ATX_HEADING.exec(line);
    if (heading !== null) {
      close();
      const level = (heading[1]?.length ?? 1) as HeadingLevel;
      blocks.push({ kind: 'heading', level, children: parseInline(headingText(heading[2]).trim()) });
      continue;
    }
    const bullet = BULLET_ITEM.exec(line);
    const ordered = bullet === null ? ORDERED_ITEM.exec(line) : null;
    // An ordered list interrupts a paragraph only when it starts at 1 (CommonMark), so "2019. A year" stays text.
    const startsList =
      bullet !== null || (ordered !== null && (paragraph.length === 0 || ordered[1] === '1'));
    if (startsList) {
      closeParagraph();
      const isOrdered = bullet === null;
      const text = (bullet === null ? ordered?.[2] : bullet[1]) ?? '';
      const current = open.list;
      if (current !== null && current.ordered === isOrdered) {
        current.items.push(text);
      } else {
        closeList();
        open.list = { ordered: isOrdered, start: isOrdered ? Number(ordered?.[1] ?? '1') : 1, items: [text] };
      }
      continue;
    }
    const list = open.list;
    if (list !== null) {
      // An indented line, or a lazy one, continues the last item.
      const last = list.items.length - 1;
      list.items[last] = `${list.items[last] ?? ''}\n${line.trimStart()}`;
      continue;
    }
    paragraph.push(line.trimStart());
  }
  close();
  return blocks;
}

// --- Inline ------------------------------------------------------------------------------------------------

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
const ALPHANUMERIC = /[\p{L}\p{N}]/u;
const URL_AUTOLINK = /^<((?:https?|mailto):[^\s<>]*)>/i;
const EMAIL_AUTOLINK =
  /^<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)>/;

/**
 * The target a link may have on a legal page, or null: an absolute `http:` or `https:` URL, a `mailto:` address, or a
 * path on this site (`/privacy`, `#top`). Anything else (`javascript:`, `data:`, `//elsewhere`) is dropped, and its
 * text stays.
 */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (href === '') return null;
  if ((href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/\\')) || href.startsWith('#')) {
    return /[\s\\]/.test(href) ? null : href;
  }
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol === 'mailto:') return url.pathname === '' ? null : href;
  if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '') return url.href;
  return null;
}

/** The index just after the `]` that closes the `[` at `open`, or -1. Backslash escapes and code spans count. */
function closingBracket(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i];
    if (c === '\\') {
      i += 1;
    } else if (c === '`') {
      const end = codeSpanEnd(source, i);
      if (end > 0) i = end - 1;
    } else if (c === '[') {
      depth += 1;
    } else if (c === ']') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** `[text](destination "title")` at `start`: its text, its destination and the index after it, or null. */
function inlineLink(
  source: string,
  start: number,
): { readonly label: string; readonly destination: string; readonly end: number } | null {
  const afterLabel = closingBracket(source, start);
  if (afterLabel < 0 || source[afterLabel] !== '(') return null;
  const rest = source.slice(afterLabel + 1);
  const match = /^[ \t\n]*(<[^<>\n]*>|[^\s()<>]*)(?:[ \t\n]+("[^"]*"|'[^']*'|\([^()]*\)))?[ \t\n]*\)/.exec(
    rest,
  );
  if (match === null) return null;
  const rawDestination = match[1] ?? '';
  const destination =
    rawDestination.startsWith('<') && rawDestination.endsWith('>')
      ? rawDestination.slice(1, -1)
      : rawDestination;
  return {
    label: source.slice(start + 1, afterLabel - 1),
    destination: destination.replace(/\\([!-/:-@[-`{-~])/g, '$1'),
    end: afterLabel + 1 + match[0].length,
  };
}

/** The index after the code span that opens with the backtick run at `start`, or -1 when nothing closes it. */
function codeSpanEnd(source: string, start: number): number {
  let run = 0;
  while (source[start + run] === '`') run += 1;
  let i = start + run;
  while (i < source.length) {
    const next = source.indexOf('`', i);
    if (next < 0) return -1;
    let length = 0;
    while (source[next + length] === '`') length += 1;
    if (length === run) return next + length;
    i = next + length;
  }
  return -1;
}

function codeSpanText(source: string, start: number, end: number): string {
  let run = 0;
  while (source[start + run] === '`') run += 1;
  const inner = source.slice(start + run, end - run).replace(/\n/g, ' ');
  return inner.length >= 2 && inner.startsWith(' ') && inner.endsWith(' ') && inner.trim() !== ''
    ? inner.slice(1, -1)
    : inner;
}

const isSpace = (c: string | undefined): boolean => c === undefined || /\s/.test(c);
const isAlphanumeric = (c: string | undefined): boolean => c !== undefined && ALPHANUMERIC.test(c);

/**
 * The emphasis that opens with `delimiter` (`*`, `**`, `_` or `__`) at `start`: the index of its closing delimiter,
 * or -1. An opener must be followed, a closer preceded, by a non-space character; `_` never opens or closes inside a
 * word (`snake_case_name` stays text). Code spans and escaped characters are skipped.
 */
function emphasisClose(source: string, start: number, delimiter: string): number {
  const char = delimiter[0];
  const afterOpen = start + delimiter.length;
  if (isSpace(source[afterOpen])) return -1;
  if (char === '_' && isAlphanumeric(source[start - 1])) return -1;
  for (let i = afterOpen + 1; i < source.length; i += 1) {
    const c = source[i];
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (c === '`') {
      const end = codeSpanEnd(source, i);
      if (end > 0) i = end - 1;
      continue;
    }
    if (!source.startsWith(delimiter, i)) continue;
    // A closer of `*` must not be part of a longer run that a `**` opener would want.
    if (delimiter.length === 1 && source[i + 1] === char) {
      i += 1;
      continue;
    }
    if (isSpace(source[i - 1])) continue;
    if (char === '_' && isAlphanumeric(source[i + delimiter.length])) continue;
    return i;
  }
  return -1;
}

/** The strong or emphasised span that opens at `start` (`**`/`__` first, then `*`/`_`), or null. */
function emphasisAt(source: string, start: number): { readonly node: Inline; readonly end: number } | null {
  const char = source.charAt(start);
  for (const delimiter of source[start + 1] === char ? [char + char, char] : [char]) {
    const close = emphasisClose(source, start, delimiter);
    if (close < 0) continue;
    const children = parseInline(source.slice(start + delimiter.length, close));
    return {
      node: delimiter.length === 2 ? { kind: 'strong', children } : { kind: 'emphasis', children },
      end: close + delimiter.length,
    };
  }
  return null;
}

/** Parses inline Markdown into nodes. Pure; never throws. */
export function parseInline(source: string): Inline[] {
  const nodes: Inline[] = [];
  let text = '';
  const flush = (): void => {
    if (text !== '') nodes.push({ kind: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < source.length) {
    const c = source.charAt(i);
    if (c === '\\') {
      const next = source[i + 1];
      if (next === '\n') {
        flush();
        nodes.push({ kind: 'break' });
        i += 2;
        while (source[i] === ' ' || source[i] === '\t') i += 1;
        continue;
      }
      if (next !== undefined && ASCII_PUNCTUATION.test(next)) {
        text += next;
        i += 2;
        continue;
      }
      text += c;
      i += 1;
      continue;
    }
    if (c === '\n') {
      const hard = / {2,}$/.test(text);
      text = text.replace(/[ \t]+$/, '');
      if (hard) {
        flush();
        nodes.push({ kind: 'break' });
      } else {
        text += ' ';
      }
      i += 1;
      while (source[i] === ' ' || source[i] === '\t') i += 1;
      continue;
    }
    if (c === '`') {
      const end = codeSpanEnd(source, i);
      if (end > 0) {
        flush();
        nodes.push({ kind: 'code', text: codeSpanText(source, i, end) });
        i = end;
      } else {
        let run = 0;
        while (source[i + run] === '`') run += 1;
        text += source.slice(i, i + run);
        i += run;
      }
      continue;
    }
    if (c === '<') {
      const rest = source.slice(i);
      const url = URL_AUTOLINK.exec(rest);
      const email = url === null ? EMAIL_AUTOLINK.exec(rest) : null;
      const target = url?.[1] ?? (email?.[1] === undefined ? undefined : `mailto:${email[1]}`);
      const href = target === undefined ? null : safeHref(target);
      const label = url?.[1] ?? email?.[1];
      const length = (url ?? email)?.[0].length ?? 0;
      if (href !== null && label !== undefined) {
        flush();
        nodes.push({ kind: 'link', href, children: [{ kind: 'text', text: label }] });
        i += length;
        continue;
      }
    }
    if (c === '[') {
      const link = inlineLink(source, i);
      if (link !== null) {
        flush();
        const children = parseInline(link.label);
        const href = safeHref(link.destination);
        if (href === null) nodes.push(...children);
        else nodes.push({ kind: 'link', href, children });
        i = link.end;
        continue;
      }
    }
    if (c === '*' || c === '_') {
      const emphasis = emphasisAt(source, i);
      if (emphasis !== null) {
        flush();
        nodes.push(emphasis.node);
        i = emphasis.end;
      } else {
        // A run that opens nothing stays text, whole (so its characters cannot open something later either).
        let run = 0;
        while (source[i + run] === c) run += 1;
        text += source.slice(i, i + run);
        i += run;
      }
      continue;
    }
    text += c;
    i += 1;
  }
  flush();
  return nodes;
}
