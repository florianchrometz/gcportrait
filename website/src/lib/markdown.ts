// SPDX-License-Identifier: MIT
/**
 * Markdown to HTML for the website, at build time: the guides under docs/, the changesets and the author section are
 * rendered from their one source in the repository, never copied.
 *
 * GitHub-flavoured Markdown (tables, autolinks, strikethrough) through unified (remark → rehype). Raw HTML in the
 * source is dropped, never passed through (the SPDX comment line, any `<details>`), so a guide cannot inject elements
 * into the site, and a link keeps its target only for http, https, mailto or no scheme at all (a path, an anchor): a
 * `javascript:`, `data:` or any other link becomes its plain text (`safeHref`). Headings get GitHub's ids (rehype-slug,
 * github-slugger), so `self-host.md#custom-domain` works on GitHub and on the site alike. Links are rewritten for the
 * site (`rewriteHref`): a guide that is a page of the site links to that page, anything else in the repository to its
 * file on GitHub; a link to the demo (/demo/, the app) opens in a new tab and says so to assistive technology, as every
 * demo link of the site does (src/components/DemoLink.astro). Images from elsewhere are never loaded (the site is
 * self-contained): an external image becomes its alt text, a repository image the asset the caller resolves, or its alt
 * text linked to the file. What may scroll sideways is keyboard-focusable (WCAG 2.1.1): a code block is, a table is
 * wrapped in a focusable box; an empty header cell (a table's corner) becomes a data cell, and a table cell that holds
 * a command keeps a readable width (`cell-command`).
 *
 * Fillable commands (`fillable`, the docs pages; src/lib/fillable.ts): each registered `YOUR_…` token in a code block
 * or in inline code becomes `<span class="var" data-var="YOUR_…">YOUR_…</span>`, which the page's script turns into
 * a field, and each code block is wrapped with a bar for its Copy button (hidden until the script shows it; without
 * JavaScript the bar is not shown at all). The first code block with fields carries a one-line hint above its bar
 * (FIELD_HINT). Inline code that is nothing but one token names the variable in a sentence ("the commands show
 * `YOUR_EMAIL`") and stays text. A token the registry (COMMAND_VARIABLES, @gcportrait/model) does not list stays text
 * too and is reported in `unknownTokens`; `pnpm website:check` fails on it. A command written in a page itself (the
 * landing page) goes through the same functions: `renderCommandBlock` and `renderInlineCode`.
 */
import path from 'node:path';

import { VARIABLE_NAME_PATTERN, commandVariable, splitVariableTokens } from '@gcportrait/model';
import type { Element, ElementContent, Root, RootContent, Text } from 'hast';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

import { NEW_TAB_NOTE, NON_AFFILIATION_LONG, isDemoHref, repositoryFileUrl } from '../site.js';
import { unfilledNote } from './fillable.js';

export type Heading = { readonly depth: 2 | 3; readonly id: string; readonly text: string };

export type RenderedMarkdown = {
  /** The HTML of the body (without the first `#` heading when `dropTitle` is set). */
  readonly html: string;
  /** The text of the first level-1 heading, if any. */
  readonly title: string | undefined;
  /** The level-2 and level-3 headings with their ids, in order (a table of contents). */
  readonly headings: readonly Heading[];
  /** The text of the first paragraph that is not the non-affiliation statement, for a description. */
  readonly lead: string | undefined;
  /** The variables the page's fields stand for, in the order they first appear (only with `fillable`). */
  readonly variables: readonly string[];
  /** The code blocks (`<pre>`), each with a Copy button with `fillable`. */
  readonly codeBlocks: number;
  /** `YOUR_…` tokens in the code that the registry does not list, left as text (only with `fillable`). */
  readonly unknownTokens: readonly string[];
};

export type RenderOptions = {
  /** The source file, relative to the repository root (`docs/self-host.md`): relative links resolve from it. */
  readonly sourcePath: string;
  /** Repository files that are pages of the site: `docs/self-host.md` → `/docs/self-host/`. */
  readonly pages?: ReadonlyMap<string, string>;
  /** The site URL of a repository image (`docs/media/x.png`), or undefined when the site does not carry it. */
  readonly resolveImage?: (repoPath: string) => string | undefined;
  /** Whether a repository path is a directory (a GitHub `tree` link rather than `blob`). */
  readonly isDirectory?: (repoPath: string) => boolean;
  /** Leave the first level-1 heading out of `html` (the page renders it itself). */
  readonly dropTitle?: boolean;
  /** Fields for the variables in the code and a Copy button per code block (the docs pages; see above). */
  readonly fillable?: boolean;
};

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** The schemes a link of the site may use; anything else (`javascript:`, `data:`, `file:`, …) loses its target. */
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto']);

/**
 * The href itself when a link may keep it: no scheme (a path, an anchor, `//host`) or one of SAFE_SCHEMES; otherwise
 * undefined. Browsers ignore tabs, newlines and other control characters inside a scheme (`java\tscript:`), so the
 * check does as well.
 */
export function safeHref(href: string): string | undefined {
  let compact = '';
  for (let index = 0; index < href.length; index += 1) {
    const code = href.charCodeAt(index);
    if (code > 0x20 && code !== 0x7f) compact += href.charAt(index);
  }
  const scheme = /^([^:/?#]*):/.exec(compact);
  if (scheme === null) return href;
  return SAFE_SCHEMES.has((scheme[1] ?? '').toLowerCase()) ? href : undefined;
}

/** Inline code longer than this may wrap (a path, a URL); shorter code stays on one line. */
const LONG_CODE = 32;

/** Whether `element` holds a command: long inline code with a space (`gcloud projects add-iam-policy-binding …`). */
function holdsCommand(element: Element): boolean {
  return element.children.some((child) => {
    if (!isElement(child)) return false;
    if (child.tagName === 'code') {
      const code = textOf(child);
      return code.length > LONG_CODE && /\s/.test(code.trim());
    }
    return holdsCommand(child);
  });
}

/**
 * The site's href for a link written in `sourcePath`: same-page anchors and external links stay; a repository
 * file that is a page of the site becomes that page (with the anchor); any other repository file its GitHub URL.
 */
export function rewriteHref(
  href: string,
  sourcePath: string,
  pages: ReadonlyMap<string, string> = new Map(),
  isDirectory: (repoPath: string) => boolean = () => false,
): string {
  if (href === '' || href.startsWith('#') || href.startsWith('//') || SCHEME.test(href)) return href;
  const hashAt = href.indexOf('#');
  const hash = hashAt === -1 ? '' : href.slice(hashAt);
  const pathPart = (hashAt === -1 ? href : href.slice(0, hashAt)).replace(/\?.*$/, '');
  const resolved = path.posix.normalize(
    pathPart.startsWith('/') ? pathPart.slice(1) : path.posix.join(path.posix.dirname(sourcePath), pathPart),
  );
  const target = resolved.replace(/^(\.\.\/)+/, '').replace(/\/$/, '');
  if (target === '.' || target === '') return `${repositoryFileUrl('', 'tree').replace(/\/$/, '')}${hash}`;
  const page = pages.get(target);
  if (page !== undefined) return `${page}${hash}`;
  const kind = pathPart.endsWith('/') || isDirectory(target) ? 'tree' : 'blob';
  return `${repositoryFileUrl(target, kind)}${hash}`;
}

/** The text content of a hast node. */
export function textOf(node: Root | RootContent): string {
  if (node.type === 'text') return node.value;
  if ('children' in node) return node.children.map((child) => textOf(child)).join('');
  return '';
}

function isElement(node: RootContent | ElementContent, tagName?: string): node is Element {
  return node.type === 'element' && (tagName === undefined || node.tagName === tagName);
}

function text(value: string): Text {
  return { type: 'text', value };
}

/**
 * Calls `visit` on every element below `parent`, depth first. `visit` may replace the element by returning another
 * one (which may wrap it); the walk then continues into the original element's children, never into the
 * replacement, so a wrapper is not visited again.
 */
function mapElements(parent: Root | Element, visit: (element: Element) => ElementContent | undefined): void {
  const children = parent.children as (RootContent | ElementContent)[];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child === undefined || !isElement(child)) continue;
    const replacement = visit(child);
    if (replacement !== undefined) children[index] = replacement;
    mapElements(child, visit);
  }
}

function normalisedText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

type Collected = {
  title?: string;
  lead?: string;
  headings: Heading[];
  variables: string[];
  codeBlocks: number;
  unknownTokens: string[];
  /** Whether a code block already carries the hint (the first one with fields does). */
  hinted?: boolean;
};

/** The hint at the top of a page's first code block with fields. */
export const FIELD_HINT = 'Edit a highlighted value in any command; every command on this page follows.';

function addOnce(list: string[], item: string): void {
  if (!list.includes(item)) list.push(item);
}

/** `value` with each registered token as a field (`span.var`); an unregistered one stays text and is collected. */
function withFields(value: string, collected: Collected): ElementContent[] {
  return splitVariableTokens(value).map((part): ElementContent => {
    if (typeof part === 'string') return text(part);
    if (commandVariable(part.token) === undefined) {
      addOnce(collected.unknownTokens, part.token);
      return text(part.token);
    }
    addOnce(collected.variables, part.token);
    return {
      type: 'element',
      tagName: 'span',
      properties: { className: ['var'], dataVar: part.token },
      children: [text(part.token)],
    };
  });
}

/** The registered variables in `value`, each once. */
function registeredTokens(value: string): string[] {
  const names: string[] = [];
  for (const part of splitVariableTokens(value)) {
    if (typeof part !== 'string' && commandVariable(part.token) !== undefined) addOnce(names, part.token);
  }
  return names;
}

/** A copy icon (two sheets), for the Copy button; decoration only. */
const COPY_ICON: Element = {
  type: 'element',
  tagName: 'svg',
  properties: {
    viewBox: '0 0 24 24',
    width: 16,
    height: 16,
    ariaHidden: 'true',
    focusable: 'false',
    className: ['code-copy-icon'],
  },
  children: [
    {
      type: 'element',
      tagName: 'path',
      properties: {
        d: 'M9 9h10v12H9zM5 15V3h10',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: '2',
        strokeLinejoin: 'round',
      },
      children: [],
    },
  ],
};

/** The edit mark the fields carry (a pencil, drawn by global.css), here in front of the hint; decoration only. */
const HINT: Element = {
  type: 'element',
  tagName: 'p',
  properties: { className: ['code-hint'], dataVarJs: '' },
  children: [
    {
      type: 'element',
      tagName: 'span',
      properties: { className: ['var-mark'], ariaHidden: 'true' },
      children: [],
    },
    text(FIELD_HINT),
  ],
};

/**
 * A code block in its box, under a bar with the Copy button and the note of how many values are still to fill (the
 * bar is shown only with JavaScript, the button once the script runs); with `hint`, the hint line above the bar.
 */
function codeBlock(pre: Element, note: string, hint = false): Element {
  return {
    type: 'element',
    tagName: 'div',
    properties: { className: ['code-block'], dataCodeBlock: '' },
    children: [
      ...(hint ? [structuredClone(HINT)] : []),
      {
        type: 'element',
        tagName: 'div',
        properties: { className: ['code-bar'], dataVarJs: '' },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['code-note'], id: note, dataCodeNote: '' },
            children: [text(unfilledNote(registeredTokens(textOf(pre)).length))],
          },
          {
            type: 'element',
            tagName: 'button',
            properties: {
              type: 'button',
              className: ['code-copy'],
              dataCodeCopy: '',
              ariaDescribedBy: [note],
              hidden: true,
            },
            children: [
              structuredClone(COPY_ICON),
              {
                type: 'element',
                tagName: 'span',
                properties: { dataCopyLabel: '' },
                children: [text('Copy')],
              },
            ],
          },
        ],
      },
      pre,
    ],
  };
}

/** The rehype plugin that does the site-specific rewriting; it also fills `collected`. */
function siteRewrites(options: RenderOptions, collected: Collected) {
  return () =>
    (tree: Root): void => {
      // The first level-1 heading is the page title.
      const titleIndex = tree.children.findIndex((node) => isElement(node, 'h1'));
      const titleNode = tree.children[titleIndex];
      if (titleNode !== undefined) {
        collected.title = normalisedText(textOf(titleNode));
        if (options.dropTitle === true) tree.children.splice(titleIndex, 1);
      }
      const longForm = normalisedText(NON_AFFILIATION_LONG);
      for (const node of tree.children) {
        if (!isElement(node, 'p')) continue;
        const lead = normalisedText(textOf(node));
        if (lead === '' || lead === longForm) continue;
        collected.lead = lead;
        break;
      }

      const insidePre = new WeakSet<Element>();
      mapElements(tree, (element) => {
        if (element.tagName === 'h2' || element.tagName === 'h3') {
          const id = element.properties.id;
          if (typeof id === 'string') {
            collected.headings.push({
              depth: element.tagName === 'h2' ? 2 : 3,
              id,
              text: normalisedText(textOf(element)),
            });
          }
          return undefined;
        }
        if (element.tagName === 'a') {
          const href = element.properties.href;
          if (typeof href === 'string') {
            const safe = safeHref(href);
            if (safe === undefined) {
              // A `javascript:`, `data:` or other link: its text stays, the target goes.
              return { type: 'element', tagName: 'span', properties: {}, children: element.children };
            }
            const rewritten = rewriteHref(safe, options.sourcePath, options.pages, options.isDirectory);
            element.properties.href = rewritten;
            if (isDemoHref(rewritten)) {
              // The demo is the app, with no way back to the site: a new tab, said for assistive technology too.
              element.properties.target = '_blank';
              element.properties.rel = ['noopener'];
              element.children.push({
                type: 'element',
                tagName: 'span',
                properties: { className: ['visually-hidden'] },
                children: [text(NEW_TAB_NOTE)],
              });
            }
          }
          return undefined;
        }
        if (element.tagName === 'img') {
          const src = typeof element.properties.src === 'string' ? element.properties.src : '';
          const alt = typeof element.properties.alt === 'string' ? element.properties.alt : '';
          if (src === '' || src.startsWith('//') || SCHEME.test(src)) {
            // Never load an image from another host: its alt text stands in (a button image keeps its link).
            return {
              type: 'element',
              tagName: 'span',
              properties: { className: ['md-image-alt'] },
              children: [text(alt)],
            };
          }
          const repoPath = path.posix.normalize(
            path.posix.join(path.posix.dirname(options.sourcePath), src.replace(/[?#].*$/, '')),
          );
          const resolved = options.resolveImage?.(repoPath);
          if (resolved !== undefined) {
            element.properties.src = resolved;
            element.properties.loading = 'lazy';
            element.properties.decoding = 'async';
            return undefined;
          }
          return {
            type: 'element',
            tagName: 'a',
            properties: { href: repositoryFileUrl(repoPath) },
            children: [text(alt === '' ? repoPath : alt)],
          };
        }
        if (element.tagName === 'code') {
          const inline = !insidePre.has(element);
          const code = textOf(element);
          // Short inline code stays on one line ("--build" never splits at its hyphens); long code may wrap.
          if (inline && code.length > LONG_CODE) element.properties.className = ['code-long'];
          if (options.fillable === true) {
            if (inline && VARIABLE_NAME_PATTERN.test(code.trim())) {
              // A variable named in a sentence, not a value to fill in here.
              if (commandVariable(code.trim()) === undefined) addOnce(collected.unknownTokens, code.trim());
            } else {
              element.children = element.children.flatMap((child) =>
                child.type === 'text' ? withFields(child.value, collected) : [child],
              );
            }
          }
          return undefined;
        }
        if (element.tagName === 'pre') {
          // A code block scrolls sideways when a line is long: focusable, so the keyboard can scroll it too.
          element.properties.tabIndex = 0;
          for (const child of element.children) if (isElement(child, 'code')) insidePre.add(child);
          collected.codeBlocks += 1;
          if (options.fillable !== true) return undefined;
          const hint = collected.hinted !== true && registeredTokens(textOf(element)).length > 0;
          if (hint) collected.hinted = true;
          return codeBlock(element, `code-${String(collected.codeBlocks)}-note`, hint);
        }
        if (element.tagName === 'th' && normalisedText(textOf(element)) === '') {
          // An empty header cell (a table's corner, an unnamed column) heads nothing: it is a data cell.
          element.tagName = 'td';
          return undefined;
        }
        if (element.tagName === 'td' && holdsCommand(element)) {
          // A command in a table keeps a readable width instead of breaking every few characters.
          element.properties.className = ['cell-command'];
          return undefined;
        }
        if (element.tagName === 'table') {
          // Wide tables scroll on their own; the wrapper is focusable so the keyboard can scroll it too.
          return {
            type: 'element',
            tagName: 'div',
            properties: { className: ['table-scroll'], tabIndex: 0 },
            children: [element],
          };
        }
        return undefined;
      });
    };
}

/** Renders Markdown for the site (see the module comment). */
export function renderMarkdown(source: string, options: RenderOptions): RenderedMarkdown {
  const collected: Collected = { headings: [], variables: [], codeBlocks: 0, unknownTokens: [] };
  const file = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(siteRewrites(options, collected))
    .use(rehypeStringify)
    .processSync(source);
  return {
    html: String(file),
    title: collected.title,
    headings: collected.headings,
    lead: collected.lead,
    variables: collected.variables,
    codeBlocks: collected.codeBlocks,
    unknownTokens: collected.unknownTokens,
  };
}

/** A command written in a page itself, with fields: its HTML and what the docs pages collect of it. */
export type RenderedCommand = {
  readonly html: string;
  /** The variables of its fields, in the order they first appear. */
  readonly variables: readonly string[];
  /** `YOUR_…` tokens the registry does not list, left as text. */
  readonly unknownTokens: readonly string[];
};

export type CommandBlockOptions = {
  /** Unique on the page: the block's note is `<id>-note`. */
  readonly id: string;
  /** The code block's accessible name (`aria-label`). */
  readonly label: string;
  /** Wrap long lines instead of scrolling sideways (`pre.wrap`, global.css). */
  readonly wrap?: boolean;
  /** Carry the hint line (the page's first code block with fields). */
  readonly hint?: boolean;
};

const toHtml = (node: Element): string =>
  unified()
    .use(rehypeStringify)
    .stringify({ type: 'root', children: [node] });

/**
 * A code block written in a page itself (the landing page's commands), rendered as a guide's code block is with
 * `fillable`: its registered tokens as fields, in its box under the Copy bar, focusable because it may scroll.
 */
export function renderCommandBlock(code: string, options: CommandBlockOptions): RenderedCommand {
  const collected: Collected = { headings: [], variables: [], codeBlocks: 0, unknownTokens: [] };
  const pre: Element = {
    type: 'element',
    tagName: 'pre',
    properties: {
      tabIndex: 0,
      ariaLabel: options.label,
      ...(options.wrap === true ? { className: ['wrap'] } : {}),
    },
    children: [{ type: 'element', tagName: 'code', properties: {}, children: withFields(code, collected) }],
  };
  const hint = options.hint === true && collected.variables.length > 0;
  return {
    html: toHtml(codeBlock(pre, `${options.id}-note`, hint)),
    variables: collected.variables,
    unknownTokens: collected.unknownTokens,
  };
}

/** Inline code written in a page itself, rendered as a guide's inline code is with `fillable`. */
export function renderInlineCode(code: string): RenderedCommand {
  const collected: Collected = { headings: [], variables: [], codeBlocks: 0, unknownTokens: [] };
  // A variable named in a sentence, not a value to fill in here (as in a guide).
  const sentence = VARIABLE_NAME_PATTERN.test(code.trim());
  if (sentence && commandVariable(code.trim()) === undefined) addOnce(collected.unknownTokens, code.trim());
  const element: Element = {
    type: 'element',
    tagName: 'code',
    properties: code.length > LONG_CODE ? { className: ['code-long'] } : {},
    children: sentence ? [text(code)] : withFields(code, collected),
  };
  return { html: toHtml(element), variables: collected.variables, unknownTokens: collected.unknownTokens };
}

/** A plain-text excerpt of at most `max` characters, cut at a word, for a meta description. */
export function excerpt(value: string, max = 160): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.(-]+$/, '')}…`;
}
