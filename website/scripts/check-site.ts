// SPDX-License-Identifier: MIT
/**
 * `pnpm website:check`: checks the built site (website/dist) for what every page must have and what no page may do
 * (docs/website.md). Run after `pnpm website:build`. Exit code 0 when clean, 1 with every problem listed.
 *
 * Every page: a unique title and description (50 to 170 characters), the canonical URL on https://gcportrait.app (the
 * 404 page instead: noindex and no canonical URL), OpenGraph and Twitter card tags with a 1200×630 image and its alt
 * text, valid JSON-LD and never an Organization (nothing may read as Google's, ADR 0018), `lang`, one level-1 heading,
 * alt text on every image, nothing loaded from another host (self-hosted fonts and media only), the footer notice in
 * the footer (ADR 0018: "Not affiliated with Google / Google Cloud. gcportrait is an independent open-source project
 * by", the maintainer's name linked to their website, and a full stop), the footer's links to the Impressum and the
 * privacy notice on the maintainer's website (src/site.ts, LEGAL_LINKS: each once, `rel="noopener"`, named as an
 * external site for assistive technology), the header's one link to the repository (the repository widget: same tab,
 * named "gcportrait on GitHub", followed by ": version …, N stars, N forks" when the build knew them, and
 * `data-repository` naming that repository), no text run into a link or code without a space, every code block either
 * keyboard-focusable (`tabindex="0"`: it may scroll sideways, WCAG 2.1.1) or wrapping its lines (`class="wrap"`), and
 * every internal link and anchor resolving to a built page.
 *
 * Resources from another host are refused wherever HTML or CSS names them: script, link (stylesheet, font preload,
 * preconnect), img and source (src and every srcset candidate), video, audio, track, iframe, embed, object, SVG
 * image and use; and in CSS (every stylesheet of the build, every <style> block and style attribute), any address on
 * another host, so url(), @import, image-set() and @font-face src.
 *
 * Scripts (every inline script of a page and every script file of the build) connect to nothing but the site itself,
 * the requests of the header's repository widget (docs/website.md, "GitHub repository widget") and, in a build with
 * analytics on, the page views sent to TelemetryDeck's ingestion host (docs/website.md, "Analytics"): each `fetch(`
 * names its address as a literal, either a path of the site or `https://api.github.com/repos/…` with exactly one
 * `credentials: 'omit'` at the top level of the options written out in the call (no spread, no computed key), or
 * TelemetryDeck's `https://nom.telemetrydeck.com/…` (ANALYTICS_PREFIX) as a POST; the one exception is the SDK's own
 * request, `fetch(target, { method: 'POST', … })`, whose address is the instance's target: accepted once, in the one
 * script that names the ingestion address, as a POST with no credentials but 'omit'. No script names an address on any
 * other host (XML namespaces aside), and none uses XMLHttpRequest, WebSocket, EventSource, sendBeacon or
 * importScripts. A build that sends page views ships the SDK's licence (licenses/telemetrydeck-sdk-LICENSE.txt).
 *
 * Phones, as far as the HTML shows it (scripts/mobile.ts checks the rendered pages in a browser): one viewport meta
 * tag, `width=device-width, initial-scale=1`, that leaves zooming alone; every table in its own keyboard-focusable
 * `.table-scroll` box (a wide table scrolls there, never the page); no inline width over 320 pixels; and a stylesheet
 * that keeps images and videos within their box (`img, video { max-width: 100% }`; their width and height
 * attributes then only set the aspect ratio).
 *
 * Fillable commands (docs/website.md, "Fillable commands"): every `YOUR_…` token in a page's code is a variable of
 * COMMAND_VARIABLES (@gcportrait/model); on a page with fields (the docs pages, the landing page), no token in a code
 * block is left as plain text, and the Variables panel lists exactly the variables of the page's fields; on a docs page
 * and on a page with fields every code block has its Copy button.
 *
 * Sample exports (docs/website.md, "Sample exports"): every link of the exports section (`a[data-export]`, on the
 * landing page and /exports/) points at a file of the build itself, a PNG, an SVG or a draw.io file; a download link
 * has its `download` name; no SVG it offers carries an affiliation line, in its title block, its <title>, its <desc> or
 * anywhere else (ADR 0018 as placed on 2026-10-11: the statement is in the footer and the long form, never in a
 * drawing), and none loads anything from elsewhere; every draw.io file reads as diagrams.net reads it (compressed),
 * with no affiliation line in its labels and no address but Google Fonts' stylesheet its labels name for the user's
 * diagrams.net; every "Open in diagrams.net" link (`drawio-open`) is `https://app.diagrams.net/?url=` with the public
 * address of a draw.io file of the build on https://gcportrait.app, opens a new tab (`rel="noopener"`) and says so in
 * its name; and /exports/ offers at least one PNG, one SVG, one draw.io file and one diagrams.net link of each theme.
 * diagrams.net's host is a link target only: like every other host, the page rules refuse it as a resource; a link to
 * it may go anywhere there, but one that opens a file (`?url=`) is an export's checked "Open in diagrams.net" link.
 *
 * The installer (docs/website.md, "The installer"): /install.sh is infra/install.sh byte for byte (the build copies it;
 * website/public/ holds no copy), the content type it is served with is one `curl … | bash` and a browser both take
 * (text/x-shellscript or text/plain; GitHub Pages sends application/x-sh for `.sh`, scripts/serve.ts CONTENT_TYPES,
 * which is accepted as what Pages will send), the sitemap does not list it and robots.txt keeps it out of search
 * results.
 *
 * The site: the sitemap lists exactly the pages built, robots.txt names it, the CNAME holds gcportrait.app, the font
 * licences ship next to the fonts, the landing page carries the SoftwareApplication and Person data and the long-form
 * non-affiliation statement in its author section only (ADR 0018: footers and long-form texts; no other section of it
 * carries the statement), and no page is an Impressum or a privacy notice of its own (those are the maintainer's
 * website's: /impressum/ and /privacy/ are not built).
 *
 * Scroll-driven animations: no `animation` shorthand in the build's CSS (its stylesheets and every page's <style>)
 * names a scroll or view timeline (`scroll(…)`, `view(…)`). Browsers drop such a declaration, and the CSS minifier
 * writes one where a rule sets the shorthand and `animation-timeline` together, so these animations are written as
 * longhands (animation-name, animation-timing-function, animation-fill-mode, animation-duration, animation-timeline,
 * animation-range).
 *
 * The mark (brand/README.md): favicon.svg is brand/icon.svg as it is, every page links it as its icon, every page's
 * logo (`<svg class="logo">`, src/components/Logo.astro) draws the same shapes in the same colours in both themes
 * (src/lib/brand.ts), and a stylesheet applies the logo's dark colours.
 *
 * The demo (src/site.ts DEMO_URL, /demo/; ADR 0034) is the app, not a page of the site, so the page rules above leave
 * it out (it is desktop-only, has its own title and no footer of the site's); the sitemap lists its entry page only.
 * Instead (checkDemo): /demo/index.html and a byte-for-byte copy of it for each of the app's routes; no file of it
 * naming TelemetryDeck or the site's analytics app id (the demo is the app's build, which sends no analytics); exactly one
 * Content Security Policy `<meta>`, before anything the page loads, that is the backend's demo-only policy without what
 * a `<meta>` cannot carry: 'self' only, no host at all (so no Google sign-in script), and the hash of each of the
 * page's inline scripts; the backend's referrer policy, `no-referrer`, as a `<meta>`; everything the page loads under
 * /demo/ and in the build; the favicon, brand/icon.svg as it is; no file of the demo naming a Google sign-in host; the
 * footer's Impressum, privacy notice and source repository built into its script; the licence files. Every "Try the
 * demo" and "Open the demo" link of the site points at /demo/, no link at a demo host, and every link to the demo,
 * wherever it is (a page, a guide, the header, the footer), opens it in a new tab (`target="_blank"`, `rel="noopener"`)
 * and says so in its name (" (opens in a new tab)", visually hidden): the demo is the app, with no way back to the
 * site.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

import { commandVariable, variableTokens } from '@gcportrait/model';

import {
  DEMO_URL,
  EXPORT_DISCLAIMER,
  FOOTER_NOTICE,
  LEGAL_LINKS,
  LICENSE_URL,
  MAINTAINER_NAME,
  MAINTAINER_URL,
  NEW_TAB_NOTE,
  NON_AFFILIATION_LONG,
  PRODUCT_NAME,
  REPOSITORY_URL,
  SITE_HOST,
  SITE_URL,
  TELEMETRYDECK_APP_ID,
  isDemoHref,
} from '../src/site.js';
import {
  BRAND_ICON,
  drawingDifferences,
  drawingOfLogo,
  drawingOfSvg,
  type Drawing,
} from '../src/lib/brand.js';
import { repositorySlug } from '../src/lib/github.js';
import { CONTENT_TYPES } from './serve.js';

export type Page = { readonly path: string; readonly html: string };

/** The decoded value of every `name="value"` attribute of the tags matching `tag` (e.g. `meta`). */
function tags(html: string, tag: string): Record<string, string>[] {
  const found: Record<string, string>[] = [];
  for (const match of html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'gi'))) {
    const attributes: Record<string, string> = {};
    for (const attribute of (match[1] ?? '').matchAll(
      /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g,
    )) {
      const name = (attribute[1] ?? '').toLowerCase();
      attributes[name] = decode(attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
    }
    found.push(attributes);
  }
  return found;
}

function decode(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&');
}

function textContent(html: string): string {
  return decode(html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function meta(html: string, key: 'name' | 'property', value: string): string | undefined {
  return tags(html, 'meta').find((attributes) => attributes[key] === value)?.content;
}

/** The narrowest phone the site is made for, in CSS pixels. */
export const NARROWEST = 320;

/** The phone rules a page's HTML can show: the viewport meta tag, tables in scroll boxes, no wide inline widths. */
function checkPhone(html: string, where: (message: string) => void): void {
  const viewports = tags(html, 'meta').filter((attributes) => attributes.name === 'viewport');
  if (viewports.length !== 1) where(`${String(viewports.length)} viewport meta tags (one)`);
  for (const viewport of viewports) {
    const content = (viewport.content ?? '').replace(/\s+/g, '').toLowerCase();
    const settings = new Map(
      content.split(',').map((part): [string, string] => {
        const [key = '', value = ''] = part.split('=');
        return [key, value];
      }),
    );
    if (settings.get('width') !== 'device-width' || settings.get('initial-scale') !== '1') {
      where(`the viewport meta tag says "${content}", not width=device-width, initial-scale=1`);
    }
    if (settings.has('user-scalable') || settings.has('maximum-scale')) {
      where(`the viewport meta tag limits zooming ("${content}")`);
    }
  }
  const tables = html.match(/<table\b/gi)?.length ?? 0;
  const boxes = [...html.matchAll(/<div\b([^>]*)>\s*<table\b/gi)]
    .map((match) => match[1] ?? '')
    .filter((attributes) => /\bclass="[^"]*\btable-scroll\b/.test(attributes));
  if (boxes.length < tables) {
    where(
      `${String(tables - boxes.length)} table(s) not in a .table-scroll box (they would push the page sideways)`,
    );
  }
  if (boxes.some((attributes) => !/\btabindex="0"/.test(attributes))) {
    where('a .table-scroll box is not keyboard-focusable (tabindex="0")');
  }
  for (const style of tags(html, '[a-z][a-z0-9-]*').map((attributes) => attributes.style ?? '')) {
    for (const declaration of style.matchAll(/(?:^|;)\s*((?:min-)?width)\s*:\s*([\d.]+)(px|r?em)\b/gi)) {
      const pixels = Number(declaration[2]) * (declaration[3] === 'px' ? 1 : 16);
      if (pixels > NARROWEST) {
        where(
          `an inline ${declaration[1] ?? ''} of ${declaration[2] ?? ''}${declaration[3] ?? ''}, wider than a ${String(NARROWEST)}-pixel phone`,
        );
      }
    }
  }
}

/**
 * Whether a stylesheet keeps images and videos within their box: a top-level rule (not one inside @media or another
 * at-rule) whose selectors include img and video, with max-width: 100%.
 */
export function keepsMediaInBox(css: string): boolean {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0;
  let prelude = '';
  let body = '';
  for (const char of text) {
    if (char === '{') {
      depth += 1;
      if (depth === 1) body = '';
      else body += char;
    } else if (char === '}') {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        const selectors = prelude.split(',').map((selector) => selector.trim());
        if (
          !prelude.trim().startsWith('@') &&
          selectors.includes('img') &&
          selectors.includes('video') &&
          /(?:^|;)\s*max-width\s*:\s*100%/.test(body)
        ) {
          return true;
        }
        prelude = '';
      } else body += char;
    } else if (depth === 0) {
      prelude += char;
    } else {
      body += char;
    }
  }
  return false;
}

/** The text of an HTML fragment: its tags dropped, its entities decoded, its spacing kept. */
function fragmentText(html: string): string {
  return decode(html.replace(/<[^>]+>/g, ''));
}

/** A field the build made of a token: `<span class="var" data-var="YOUR_X">YOUR_X</span>`. */
const FIELD = /<span\b[^>]*\bdata-var="([^"]*)"[^>]*>([^<]*)<\/span>/g;

/** The fillable-command rules of one page (see the module comment). */
export function checkVariables(page: Page, where: (message: string) => void): void {
  const { html } = page;
  const unknown = new Set<string>();
  for (const match of html.matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/gi)) {
    for (const token of variableTokens(fragmentText(match[1] ?? ''))) {
      if (commandVariable(token) === undefined) unknown.add(token);
    }
  }
  for (const token of unknown) {
    where(`its code names ${token}, which is not a variable of COMMAND_VARIABLES (@gcportrait/model)`);
  }
  const fields = new Set<string>();
  for (const match of html.matchAll(FIELD)) {
    const name = decode(match[1] ?? '');
    fields.add(name);
    if (decode(match[2] ?? '') !== name)
      where(`the field of ${name} shows "${match[2] ?? ''}", not its token`);
  }
  const rows = new Set(tags(html, 'li').flatMap((attributes) => attributes['data-var-row'] ?? []));
  if (fields.size > 0 || rows.size > 0) {
    const missing = [...fields].filter((name) => !rows.has(name));
    const extra = [...rows].filter((name) => !fields.has(name));
    if (missing.length > 0)
      where(`the Variables panel lacks ${missing.join(', ')}, which its fields stand for`);
    if (extra.length > 0) where(`the Variables panel lists ${extra.join(', ')}, which no field stands for`);
    for (const match of html.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi)) {
      const plain = variableTokens(fragmentText((match[1] ?? '').replace(FIELD, '')));
      if (plain.length > 0) where(`a code block shows ${plain.join(', ')} as text, not as a field`);
    }
  }
  if (/^\/docs\/[^/]+\/$/.test(page.path) || fields.size > 0) {
    const blocks = html.match(/<pre\b/gi)?.length ?? 0;
    const buttons = tags(html, 'button').filter((attributes) => 'data-code-copy' in attributes).length;
    if (buttons !== blocks) where(`${String(blocks)} code blocks, ${String(buttons)} Copy buttons`);
  }
}

/** The addresses on another host a script may ask: the repository widget's (src/lib/star-count.ts). */
export const ALLOWED_FETCH_PREFIX = 'https://api.github.com/repos/';
/**
 * TelemetryDeck's ingestion host, the one other host a script may send to: the website's page views, in a build with
 * analytics on (src/lib/analytics-page.ts through @telemetrydeck/sdk, whose target is TELEMETRYDECK_TARGET in
 * src/site.ts; docs/website.md, "Analytics"). Allowed by name, so that another host (an update of the SDK, a changed
 * target) fails the check instead of slipping through.
 */
export const ANALYTICS_PREFIX = 'https://nom.telemetrydeck.com/';
/** The licence the build writes next to the fonts' when it bundles the SDK (astro.config.ts). */
export const ANALYTICS_LICENCE = 'telemetrydeck-sdk-LICENSE.txt';
/** Addresses a script may name without asking them: XML namespaces (an SVG made by a script). */
const NAMESPACE_PREFIX = 'http://www.w3.org/';
const QUOTES = new Set(['"', "'", '`']);

/**
 * The index just past the string or template literal that opens at `start` (its quote), and its head: its text up to
 * its end or its first `${…}`. A template's `${…}` may hold literals of its own.
 */
function literalAt(source: string, start: number): { end: number; head: string } {
  const quote = source[start] ?? '';
  let head: string | undefined;
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === quote) {
      return { end: index + 1, head: head ?? source.slice(start + 1, index) };
    }
    if (quote === '`' && char === '$' && source[index + 1] === '{') {
      head ??= source.slice(start + 1, index);
      index = skipUntil(source, index + 2, '}');
      continue;
    }
    index += 1;
  }
  return { end: source.length, head: head ?? source.slice(start + 1) };
}

/** The index just past the `close` that ends the bracket opened before `from`, skipping literals and inner brackets. */
function skipUntil(source: string, from: number, close: ')' | '}' | ']'): number {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const expected: string[] = [close];
  let index = from;
  while (index < source.length && expected.length > 0) {
    const char = source[index] ?? '';
    if (QUOTES.has(char)) {
      index = literalAt(source, index).end;
      continue;
    }
    const closing = pairs[char];
    if (closing !== undefined) expected.push(closing);
    else if (char === expected[expected.length - 1]) expected.pop();
    index += 1;
  }
  return index;
}

/**
 * The top-level entries of the options object a fetch call writes out after its address (`from`: just past the address
 * literal), as each key with the values it is given (a value that is one plain literal as its text, without quotes;
 * anything else as written). Undefined when no object literal follows the address, or when an entry's key cannot be
 * read (a spread or a computed key, either of which could set `credentials`).
 */
function fetchOptions(source: string, from: number): Map<string, string[]> | undefined {
  const open = /^\s*,\s*\{/.exec(source.slice(from));
  if (open === null) return undefined;
  const literals: string[] = [];
  const entries: string[] = [];
  const closers: Record<string, ')' | '}' | ']'> = { '(': ')', '{': '}', '[': ']' };
  let entry = '';
  let index = from + open[0].length;
  while (index < source.length) {
    const char = source[index] ?? '';
    if (QUOTES.has(char)) {
      const { end } = literalAt(source, index);
      // A literal stands in the entry as \uE000n\uE000; a template with a ${…} is never a plain value.
      const text = source.slice(index + 1, end - 1);
      literals.push(char === '`' && text.includes('${') ? '\uE002' : text);
      entry += `\uE000${String(literals.length - 1)}\uE000`;
      index = end;
      continue;
    }
    const closer = closers[char];
    if (closer !== undefined) {
      entry += '\uE001'; // a nested bracket: an object, an array, a call, a computed key
      index = skipUntil(source, index + 1, closer);
      continue;
    }
    if (char === ',' || char === '}') {
      entries.push(entry.trim());
      entry = '';
      if (char === '}') break;
    } else entry += char;
    index += 1;
  }
  const literalText = (text: string): string | undefined => {
    const match = /^\uE000(\d+)\uE000$/.exec(text);
    return match === null ? undefined : literals[Number(match[1])];
  };
  const options = new Map<string, string[]>();
  for (const text of entries) {
    if (text === '') continue;
    if (text.startsWith('...') || text.startsWith('\uE001')) return undefined;
    const colon = text.indexOf(':');
    const rawKey = (colon < 0 ? text.replace(/\uE001[\s\S]*$/, '') : text.slice(0, colon)).trim();
    const key = literalText(rawKey) ?? rawKey;
    const rawValue = colon < 0 ? text : text.slice(colon + 1).trim();
    options.set(key, [...(options.get(key) ?? []), literalText(rawValue) ?? rawValue]);
  }
  return options;
}

/** Whether an address in an attribute is on another host: `//host…` or a scheme (data: aside: it loads nothing). */
function isOtherHost(address: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(address) || /^(?:https?|ftp):/i.test(address);
}

/**
 * The addresses on another host in CSS (a stylesheet, a <style> block, a style attribute), comments aside: whatever
 * `url(…)`, `@import`, `image-set(…)` or `src:` would load, found as any `scheme://…` or a quoted or bracketed `//…`.
 * data: URLs load nothing and are skipped; XML namespaces (`http://www.w3.org/…`) are names, not loads.
 */
export function cssAddresses(css: string): string[] {
  const found: string[] = [];
  const text = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // A data: URL loads nothing, and its base64 may hold "//".
    .replace(/url\(\s*(?:"data:[^"]*"|'data:[^']*'|data:[^)]*)\s*\)/gi, 'url()');
  for (const match of text.matchAll(/(?:\b[a-z][a-z0-9+.-]*:)?\/\/[^\s"'()\\;,]+/gi)) {
    const address = match[0];
    const before = text[match.index - 1] ?? '';
    if (!address.includes(':') && !['"', "'", '('].includes(before)) continue;
    if (address.startsWith(NAMESPACE_PREFIX)) continue;
    found.push(address);
  }
  return found;
}

/**
 * The `animation` shorthands in CSS that name a scroll or view timeline (`animation: x linear both scroll(root)`), as
 * written, comments aside. The shorthand takes no timeline, so browsers drop the whole declaration: the minifier makes
 * one from `animation` and `animation-timeline` set in the same rule, which is why such animations use the longhands.
 */
export function timelineShorthands(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/(?<![\w-])animation\s*:([^;{}]*)/gi)]
    .filter((match) => /\b(?:scroll|view)\(/i.test(match[1] ?? ''))
    .map((match) => match[0].trim());
}

/**
 * Whether a fetch's options (fetchOptions) make it a page view's request: written out, `method` 'POST', and no
 * `credentials` but 'omit' (the default, 'same-origin', sends no cookie to another host).
 */
function isAnalyticsPost(options: Map<string, string[]> | undefined): boolean {
  if (options === undefined) return false;
  const method = options.get('method');
  const credentials = options.get('credentials');
  return (
    method?.length === 1 &&
    method[0] === 'POST' &&
    (credentials === undefined || (credentials.length === 1 && credentials[0] === 'omit'))
  );
}

/** What a script (its source, as the build wrote it) may not do: see "Scripts" in the module comment. */
export function scriptConnectionProblems(source: string): string[] {
  const problems: string[] = [];
  for (const match of source.matchAll(
    /\b(XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\b/g,
  )) {
    problems.push(
      `a script uses ${match[1] ?? ''} (the only requests allowed to another host are a fetch of ${ALLOWED_FETCH_PREFIX}… and the page views' POST to ${ANALYTICS_PREFIX}…)`,
    );
  }
  // The SDK's own request may name its address by a variable, once, in the script that names the ingestion address.
  const namesAnalytics = source.includes(ANALYTICS_PREFIX);
  let sdkRequests = 0;
  for (const match of source.matchAll(/\bfetch\s*\(\s*/g)) {
    const at = match.index + match[0].length;
    const end = skipUntil(source, at, ')');
    const call = source.slice(match.index, end);
    if (!QUOTES.has(source[at] ?? '')) {
      const variable = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/.exec(source.slice(at))?.[0];
      if (
        namesAnalytics &&
        variable !== undefined &&
        isAnalyticsPost(fetchOptions(source, at + variable.length)) &&
        sdkRequests === 0
      ) {
        sdkRequests += 1;
        continue;
      }
      problems.push(`a script fetches an address it does not write out: ${call.slice(0, 80)}`);
      continue;
    }
    const { head, end: addressEnd } = literalAt(source, at);
    if (head.startsWith(ALLOWED_FETCH_PREFIX)) {
      // Exactly one `credentials`, at the top level of the options written out in the call, set to 'omit'.
      const credentials = fetchOptions(source, addressEnd)?.get('credentials');
      if (credentials?.length !== 1 || credentials[0] !== 'omit')
        problems.push(`a script fetches ${head}… without credentials: 'omit'`);
    } else if (head.startsWith(ANALYTICS_PREFIX)) {
      if (!isAnalyticsPost(fetchOptions(source, addressEnd)))
        problems.push(`a script fetches ${head.slice(0, 80)} other than as a POST without credentials`);
    } else if (!head.startsWith('/') || head.startsWith('//')) {
      problems.push(`a script fetches from another host: ${head.slice(0, 80)}`);
    }
  }
  for (const match of source.matchAll(/(?:\b[a-z][a-z0-9+.-]*:)?\/\/[^\s"'`\\/$)]+/gi)) {
    const address = match[0];
    const quoted = QUOTES.has(source[match.index - 1] ?? '');
    if (!address.includes(':') && !quoted) continue; // a "//" in code or a regular expression, not an address
    const rest = source.slice(match.index);
    if (
      rest.startsWith(ALLOWED_FETCH_PREFIX) ||
      rest.startsWith(ANALYTICS_PREFIX) ||
      rest.startsWith(NAMESPACE_PREFIX)
    )
      continue;
    problems.push(`a script names another host: ${address}`);
  }
  return problems;
}

/**
 * The footer's links to the Impressum and the privacy notice on the maintainer's website (src/site.ts, LEGAL_LINKS):
 * each exactly once, in the footer, with `rel="noopener"`, its label first and its name saying it leads to an external
 * site (the footer's visually hidden "(external site, …)").
 */
export function checkLegalLinks(html: string, where: (message: string) => void): void {
  const footer = /<footer\b[\s\S]*<\/footer>/i.exec(html)?.[0] ?? '';
  const anchors = [...footer.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((match) => ({
    attributes: tags(`<a${match[1] ?? ''}>`, 'a')[0] ?? {},
    text: textContent(match[2] ?? ''),
  }));
  for (const link of LEGAL_LINKS) {
    const found = anchors.filter((anchor) => anchor.attributes.href === link.href);
    if (found.length !== 1)
      where(`${String(found.length)} footer links to the ${link.label} at ${link.href} (one)`);
    for (const anchor of found) {
      if (!(anchor.attributes.rel ?? '').split(/\s+/).includes('noopener'))
        where(`the footer's ${link.label} link has no rel="noopener"`);
      if (!anchor.text.startsWith(link.label))
        where(`the footer's ${link.label} link reads "${anchor.text}"`);
      if (!/\bexternal\b/i.test(anchor.text))
        where(`the footer's ${link.label} link is not named as an external site ("${anchor.text}")`);
    }
  }
}

/** What a link to the demo reads like (its name may end with the new-tab note). */
const DEMO_LINK_TEXT = /^(?:Try|Open) the demo(?: \(opens in a new tab\))?$/;

/**
 * Every "Try the demo" and "Open the demo" link points at the demo, /demo/; no link goes to a demo host; and every link
 * to the demo (resolved against `pageUrl`, the page's address) opens a new tab, `rel="noopener"`, its name ending with
 * the new-tab note.
 */
export function checkDemoLinks(
  html: string,
  where: (message: string) => void,
  pageUrl: string = SITE_URL,
): void {
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attributes = tags(`<a${match[1] ?? ''}>`, 'a')[0] ?? {};
    const href = attributes.href ?? '';
    const text = textContent(match[2] ?? '');
    const name = `the "${text}" link to ${href}`;
    if (DEMO_LINK_TEXT.test(text) && href !== DEMO_URL)
      where(`the "${text}" link goes to ${href || 'nowhere'}, not ${DEMO_URL}`);
    if (/^(?:https?:)?\/\/demo\./i.test(href)) where(`a link to a demo host: ${href}`);
    if (href === '' || !isDemoHref(href, pageUrl)) continue;
    if (attributes.target !== '_blank') where(`${name} does not open a new tab (target="_blank")`);
    if (!(attributes.rel ?? '').split(/\s+/).includes('noopener')) where(`${name} has no rel="noopener"`);
    if (!text.endsWith(NEW_TAB_NOTE.trim()))
      where(`${name} does not say it opens a new tab ("${NEW_TAB_NOTE.trim()}", visually hidden)`);
  }
}

/**
 * The footer notice (ADR 0018) in the footer: its text up to the maintainer's name, the name as a link to their
 * website, and a full stop.
 */
export function checkFooterNotice(html: string, where: (message: string) => void): void {
  const footer = /<footer\b[\s\S]*<\/footer>/i.exec(html)?.[0] ?? '';
  // The text as read: tags dropped without a space, so the name's link runs into its full stop as on the page.
  const text = fragmentText(footer.replace(/<script\b[\s\S]*?<\/script>/gi, '')).replace(/\s+/g, ' ');
  if (!text.includes(`${FOOTER_NOTICE}.`)) {
    where(`the footer lacks the footer notice "${FOOTER_NOTICE}."`);
    return;
  }
  const named = [...footer.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].some(
    (match) =>
      tags(`<a${match[1] ?? ''}>`, 'a')[0]?.href === MAINTAINER_URL &&
      textContent(match[2] ?? '') === MAINTAINER_NAME,
  );
  if (!named) where(`the footer notice does not link ${MAINTAINER_NAME} to ${MAINTAINER_URL}`);
}

/**
 * The landing page's long-form statement (ADR 0018): in its author section (the section labelled by #author, from
 * docs/author.md's closing paragraph) and in no other section of the page; the footer carries the footer notice.
 */
export function checkLandingStatement(html: string, where: (message: string) => void): void {
  const body = html.replace(/<footer\b[\s\S]*<\/footer>/i, '');
  const author = /<section\b[^>]*aria-labelledby="author"[^>]*>[\s\S]*?<\/section>/i.exec(body)?.[0] ?? '';
  const elsewhere = textContent(body.replace(author, '')).split(NON_AFFILIATION_LONG).length - 1;
  if (elsewhere > 0)
    where(
      `the non-affiliation long form appears ${String(elsewhere)} time(s) outside the author section (the footers and the author section only)`,
    );
  if (author !== '' && !textContent(author).includes(NON_AFFILIATION_LONG))
    where("the author section lacks the long-form statement (docs/author.md's closing paragraph)");
}

/**
 * The app's routes besides its start page (frontend/src/App.tsx; scripts/lib/static-demo.mjs, STATIC_DEMO_ROUTES): the
 * static demo has a copy of its index.html for each, so a static host serves the app at every route.
 */
export const DEMO_ROUTES = [
  'diagram',
  'snapshots',
  'permissions',
  'settings',
  'impressum',
  'privacy',
] as const;

/** Google's sign-in hosts (its script, its endpoints, tokeninfo): never in the static demo. */
export const SIGN_IN_HOSTS = ['accounts.google.com', 'oauth2.googleapis.com'] as const;

/**
 * The static demo's policy (scripts/lib/static-demo.mjs, staticDemoDirectives): the backend's demo-only policy without
 * `frame-ancestors`, which a `<meta>` cannot carry; `script-src` also lists the hash of each inline script.
 */
export const DEMO_POLICY: Readonly<Record<string, readonly string[]>> = {
  'default-src': ["'self'"],
  'base-uri': ["'self'"],
  'script-src': ["'self'"],
  'script-src-attr': ["'none'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'worker-src': ["'self'"],
  'manifest-src': ["'self'"],
  'object-src': ["'none'"],
  'form-action': ["'self'"],
};

/** The `'sha256-…'` source of each inline script of a page, as the backend's CSP lists them. */
export function inlineScriptSources(html: string): string[] {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter((match) => !/(?:^|\s)src\s*=/i.test(match[1] ?? ''))
    .map(
      (match) =>
        `'sha256-${createHash('sha256')
          .update(match[2] ?? '', 'utf8')
          .digest('base64')}'`,
    );
}

/** The demo's files: their paths below /demo/ ("index.html", "assets/x.js") and a reader (undefined: no such file). */
export type DemoFiles = {
  readonly files: readonly string[];
  readonly read: (file: string) => string | undefined;
};

/** The static demo's rules (see the module comment); `brandSource` is brand/icon.svg's text. */
export function checkDemo(demo: DemoFiles, brandSource: string | undefined): string[] {
  const problems: string[] = [];
  const where = (message: string): void => {
    problems.push(`${DEMO_URL}: ${message}`);
  };
  const index = demo.read('index.html');
  if (index === undefined) {
    where('no static demo (index.html; the build runs `pnpm demo:static`, astro.config.ts)');
    return problems;
  }
  for (const route of DEMO_ROUTES) {
    const copy = demo.read(`${route}.html`);
    if (copy === undefined) where(`no ${route}.html (the ${route} route's copy of index.html)`);
    else if (copy !== index) where(`${route}.html is not a copy of index.html`);
  }
  const metas = tags(index, 'meta').filter(
    (attributes) => (attributes['http-equiv'] ?? '').toLowerCase() === 'content-security-policy',
  );
  if (metas.length !== 1) where(`${String(metas.length)} Content Security Policy <meta> elements (one)`);
  for (const meta of metas) {
    const policy: Record<string, string[]> = {};
    for (const part of (meta.content ?? '').split(';')) {
      const [name = '', ...values] = part.trim().split(/\s+/);
      if (name !== '' && !(name.toLowerCase() in policy)) policy[name.toLowerCase()] = values;
    }
    const expected: Record<string, readonly string[]> = {
      ...DEMO_POLICY,
      'script-src': [...(DEMO_POLICY['script-src'] ?? []), ...inlineScriptSources(index)],
    };
    for (const [name, values] of Object.entries(expected)) {
      const actual = policy[name];
      if (actual === undefined) where(`the policy has no ${name}`);
      else if (actual.join(' ') !== values.join(' '))
        where(`the policy's ${name} is "${actual.join(' ')}", not "${values.join(' ')}"`);
    }
    for (const name of Object.keys(policy)) {
      if (!(name in expected)) where(`the policy has ${name}, which the demo-only policy does not`);
    }
  }
  const referrers = tags(index, 'meta').filter((attributes) => attributes.name === 'referrer');
  if (referrers.length !== 1 || referrers[0]?.content !== 'no-referrer')
    where('no <meta name="referrer" content="no-referrer"> (the backend\'s Referrer-Policy)');
  const policyAt = index.search(/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy/i);
  const loadAt = index.search(/<script\b|<link\b|<style\b|<img\b/i);
  if (policyAt >= 0 && loadAt >= 0 && loadAt < policyAt)
    where('the page loads or runs something before its policy <meta>');
  const loads = [
    ...tags(index, 'script').flatMap((attributes) => attributes.src ?? []),
    ...tags(index, 'link').flatMap((attributes) => attributes.href ?? []),
    ...tags(index, 'img').flatMap((attributes) => attributes.src ?? []),
  ];
  for (const address of loads) {
    if (isOtherHost(address)) where(`loads from another host: ${address}`);
    else if (!address.startsWith(DEMO_URL)) where(`loads ${address}, outside ${DEMO_URL}`);
    else if (demo.read(decodeURIComponent(address.slice(DEMO_URL.length))) === undefined)
      where(`loads ${address}, which the build does not have`);
  }
  const icons = tags(index, 'link').filter((attributes) =>
    (attributes.rel ?? '').split(/\s+/).includes('icon'),
  );
  if (icons.length !== 1 || icons[0]?.href !== `${DEMO_URL}favicon.svg`)
    where(`${String(icons.length)} icon links (one, to ${DEMO_URL}favicon.svg)`);
  const favicon = demo.read('favicon.svg');
  if (favicon === undefined) where('no favicon.svg');
  else if (brandSource !== undefined && favicon !== brandSource)
    where(`favicon.svg is not ${BRAND_ICON} as it is`);
  // The route copies are index.html (checked above), so their text is not searched again.
  const copies = new Set<string>(DEMO_ROUTES.map((route) => `${route}.html`));
  // The demo is the app, and a self-hosted instance never phones home: no file of it carries the site's analytics.
  for (const file of demo.files.filter(
    (name) => /\.(?:html|js|mjs|css|json|txt|svg|webmanifest|map)$/.test(name) && !copies.has(name),
  )) {
    const text = demo.read(file) ?? '';
    if (/telemetrydeck/i.test(text) || text.includes(TELEMETRYDECK_APP_ID))
      where(`${file} names TelemetryDeck (the demo is the app, which sends no analytics)`);
  }
  const code = demo.files.filter((file) => /\.(?:html|js|css)$/.test(file) && !copies.has(file));
  for (const file of code) {
    const text = demo.read(file) ?? '';
    for (const host of SIGN_IN_HOSTS) if (text.includes(host)) where(`${file} names ${host}`);
    if (file.endsWith('.css'))
      for (const address of cssAddresses(text)) where(`${file} loads from another host: ${address}`);
  }
  const scripts = code.filter((file) => file.endsWith('.js')).map((file) => demo.read(file) ?? '');
  for (const href of [...LEGAL_LINKS.map((link) => link.href), REPOSITORY_URL]) {
    if (!scripts.some((script) => script.includes(href)))
      where(`no script of the demo carries ${href} for its footer`);
  }
  for (const licence of ['gcportrait-LICENSE.txt', 'THIRD_PARTY_NOTICES.txt']) {
    if (demo.read(`licenses/${licence}`) === undefined) where(`licenses/${licence} is missing`);
  }
  return problems;
}

/** The problems of one page (`path` is its URL path, "/docs/" or "/404.html"). */
export function checkPage(page: Page): string[] {
  const problems: string[] = [];
  const { html } = page;
  const where = (message: string): void => {
    problems.push(`${page.path}: ${message}`);
  };
  if (!/<html lang="en"/.test(html)) where('<html> has no lang="en"');
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
  if (title === undefined || title.trim() === '') where('no <title>');
  const description = meta(html, 'name', 'description');
  if (description === undefined) where('no meta description');
  else if (description.length < 50 || description.length > 170) {
    where(`the meta description has ${String(description.length)} characters (50 to 170)`);
  }
  const notFound = page.path === '/404.html';
  const canonical = tags(html, 'link').find((attributes) => attributes.rel === 'canonical')?.href;
  if (notFound) {
    // Served for every unknown address: never indexed, and no canonical URL of its own.
    if (meta(html, 'name', 'robots') !== 'noindex') where('the 404 page is not marked noindex');
    if (canonical !== undefined) where(`the 404 page names a canonical URL (${canonical})`);
  } else if (canonical !== `${SITE_URL}${page.path}`) {
    where(`canonical is ${canonical ?? 'missing'}, not ${SITE_URL}${page.path}`);
  }
  for (const property of [
    'og:title',
    'og:description',
    'og:type',
    'og:site_name',
    ...(notFound ? [] : ['og:url']),
  ]) {
    if (meta(html, 'property', property) === undefined) where(`no ${property}`);
  }
  if (meta(html, 'name', 'twitter:card') === undefined) where('no twitter:card');
  if (!notFound) {
    const image = meta(html, 'property', 'og:image');
    if (image === undefined || !image.startsWith(`${SITE_URL}/`)) where(`og:image is ${image ?? 'missing'}`);
    if (
      meta(html, 'property', 'og:image:width') !== '1200' ||
      meta(html, 'property', 'og:image:height') !== '630'
    ) {
      where('og:image is not 1200×630');
    }
    if ((meta(html, 'property', 'og:image:alt') ?? '') === '') where('no og:image:alt');
    if (meta(html, 'name', 'twitter:card') !== 'summary_large_image')
      where('twitter:card is not summary_large_image');
  }
  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const data: unknown = JSON.parse(match[1] ?? '');
      if (JSON.stringify(data).includes('"Organization"')) where('JSON-LD names an Organization');
    } catch {
      where('a JSON-LD block does not parse');
    }
  }
  const h1 = html.match(/<h1\b/g)?.length ?? 0;
  if (h1 !== 1) where(`${String(h1)} level-1 headings`);
  for (const image of tags(html, 'img')) {
    if (image['aria-hidden'] === 'true') continue;
    if (image.alt === undefined) where(`an image without alt: ${image.src ?? '?'}`);
    if (image.width === undefined || image.height === undefined)
      where(`an image without width and height: ${image.src ?? '?'}`);
  }
  for (const [tag, attribute] of [
    ['script', 'src'],
    ['link', 'href'],
    ['link', 'imagesrcset'],
    ['img', 'src'],
    ['img', 'srcset'],
    ['source', 'src'],
    ['source', 'srcset'],
    ['video', 'src'],
    ['video', 'poster'],
    ['video', 'data-light'],
    ['video', 'data-dark'],
    ['video', 'data-gif-light'],
    ['video', 'data-gif-dark'],
    ['audio', 'src'],
    ['track', 'src'],
    ['iframe', 'src'],
    ['frame', 'src'],
    ['embed', 'src'],
    ['object', 'data'],
    ['image', 'href'],
    ['image', 'xlink:href'],
    ['use', 'href'],
    ['use', 'xlink:href'],
    ['input', 'src'],
  ] as const) {
    for (const attributes of tags(html, tag)) {
      const value = attributes[attribute];
      if (value === undefined) continue;
      if (tag === 'link' && attributes.rel === 'canonical') continue;
      // A srcset lists candidates, "address width-or-density", separated by commas.
      const addresses = attribute.endsWith('srcset')
        ? value.split(',').map((candidate) => candidate.trim().split(/\s+/)[0] ?? '')
        : [value.trim()];
      for (const address of addresses.filter(isOtherHost))
        where(`<${tag} ${attribute}> loads from another host: ${address}`);
    }
  }
  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const address of cssAddresses(match[1] ?? ''))
      where(`a <style> loads from another host: ${address}`);
  }
  for (const match of html.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    for (const address of cssAddresses(decode(match[1] ?? match[2] ?? '')))
      where(`a style attribute loads from another host: ${address}`);
  }
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\btype\s*=\s*["']?application\/ld\+json/i.test(match[1] ?? '')) continue;
    for (const problem of scriptConnectionProblems(match[2] ?? '')) where(problem);
  }
  for (const block of tags(html, 'pre')) {
    if (block.tabindex !== '0' && !(block.class ?? '').split(/\s+/).includes('wrap'))
      where(
        'a code block that may scroll sideways is not keyboard-focusable (tabindex="0", or class="wrap")',
      );
  }
  checkPhone(html, where);
  checkVariables(page, where);
  checkFooterNotice(html, where);
  if (page.path === '/') checkLandingStatement(html, where);
  checkLegalLinks(html, where);
  checkDemoLinks(html, where, `${SITE_URL}${page.path}`);
  const github = tags(html, 'a').filter((anchor) =>
    (anchor.class ?? '').split(/\s+/).includes('header-github'),
  );
  if (github.length !== 1) where(`${String(github.length)} GitHub links in the header (one)`);
  for (const anchor of github) {
    if (anchor.href !== REPOSITORY_URL) where(`the header's GitHub link goes to ${anchor.href ?? 'nowhere'}`);
    if (!(anchor['aria-label'] ?? '').startsWith(`${PRODUCT_NAME} on GitHub`))
      where(`the header's GitHub link is named "${anchor['aria-label'] ?? ''}"`);
    if (anchor.target !== undefined) where("the header's GitHub link opens another tab or window");
    if (anchor['data-repository'] !== repositorySlug(REPOSITORY_URL))
      where(
        `the header's GitHub link has data-repository="${anchor['data-repository'] ?? ''}", not the repository's ${repositorySlug(REPOSITORY_URL) ?? '(none)'}`,
      );
  }
  const prose = html.replace(/<pre\b[\s\S]*?<\/pre>/gi, '');
  for (const glued of prose.matchAll(
    /[A-Za-z.,;:)]<(?:a|code|strong|em) |<\/(?:a|code|strong|em)>[A-Za-z(]/g,
  )) {
    where(
      `text runs into an element without a space: …${prose.slice(Math.max(0, glued.index - 30), glued.index + 20)}…`,
    );
  }
  return problems;
}

/**
 * Whether a text states an affiliation: the short line (EXPORT_DISCLAIMER) itself, or any sentence that says
 * "affiliated with … Google" (the long form, an older short form).
 */
export function statesAffiliation(text: string): boolean {
  return text.includes(EXPORT_DISCLAIMER) || /\baffiliated with\b[^.]*\bGoogle\b/i.test(text);
}

/**
 * What an exported SVG the site offers must not say or do: no affiliation line in its title block (any <text> of the
 * drawing), its <title>, its <desc> or anywhere else in the file (ADR 0018 as placed on 2026-10-11; the <desc> keeps
 * neutral metadata only), and nothing loaded from elsewhere.
 */
export function exportSvgProblems(text: string): string[] {
  const problems: string[] = [];
  const lines = [...text.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((match) => decode(match[1] ?? ''));
  for (const line of lines.filter(statesAffiliation))
    problems.push(`its title block carries the affiliation line "${line}"`);
  if (statesAffiliation(decode(/<title>([^<]*)<\/title>/.exec(text)?.[1] ?? '')))
    problems.push('its <title> states an affiliation');
  if (statesAffiliation(decode(/<desc>([^<]*)<\/desc>/.exec(text)?.[1] ?? '')))
    problems.push('its <desc> states an affiliation');
  if (problems.length === 0 && statesAffiliation(decode(text)))
    problems.push('it states an affiliation outside its title block, <title> and <desc>');
  if (/(?:href|src)\s*=\s*"(?:https?:)?\/\//i.test(text) || /url\(\s*['"]?(?:https?:)?\/\//i.test(text))
    problems.push('it loads something from another host');
  return problems;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** diagrams.net: a sample's draw.io file opens there from its public address (`?url=`); a link target, never a resource. */
export const DIAGRAMS_NET_OPEN = 'https://app.diagrams.net/?url=';
const DIAGRAMS_NET_HOST = 'app.diagrams.net';
/** The stylesheet a draw.io file's labels name in `fontSource`, which the user's diagrams.net loads. */
const FONT_SOURCE_PREFIX = 'https://fonts.googleapis.com/css2?';

/**
 * What a draw.io file the site offers must not be or say: unreadable as diagrams.net reads it (one diagram, its model
 * compressed: base64 of the raw-deflated, URI-encoded XML), an affiliation line in a label (ADR 0018), a script, or an
 * address other than the fonts' stylesheet (its icons are embedded).
 */
export function exportDrawioProblems(text: string): string[] {
  const diagrams = [...text.matchAll(/<diagram\b[^>]*>([\s\S]*?)<\/diagram>/g)];
  if (!text.startsWith('<mxfile') || diagrams.length !== 1) return ['not a draw.io file with one diagram'];
  const body = (diagrams[0]?.[1] ?? '').trim();
  if (body.startsWith('<')) return ['its diagram is plain XML, not compressed as diagrams.net saves it'];
  let model: string;
  try {
    model = decodeURIComponent(inflateRawSync(Buffer.from(body, 'base64')).toString('latin1'));
  } catch {
    return ['its diagram does not inflate as diagrams.net reads it'];
  }
  if (!model.startsWith('<mxGraphModel')) return ['its diagram holds no <mxGraphModel>'];
  const problems: string[] = [];
  const decoded = decode(model);
  if (statesAffiliation(decoded.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')))
    problems.push('a label states an affiliation');
  if (/<script\b/i.test(decoded)) problems.push('it holds a script');
  const styles = [...model.matchAll(/\sstyle="([^"]*)"/g)].map((match) => {
    const style = decode(match[1] ?? '');
    try {
      return decodeURIComponent(style);
    } catch {
      return style;
    }
  });
  const other = [...`${decoded}\n${styles.join('\n')}`.matchAll(/https?:\/\/[^\s"';)<>]+/gi)]
    .map((match) => match[0])
    .find((address) => !address.startsWith(FONT_SOURCE_PREFIX));
  if (other !== undefined) problems.push(`it names another address: ${other.slice(0, 80)}`);
  return problems;
}

/**
 * The path on this site of the draw.io file a diagrams.net link opens (`https://app.diagrams.net/?url=` and the file's
 * address on https://gcportrait.app, URL-encoded), or null for any other link.
 */
export function diagramsNetFile(href: string): string | null {
  if (!href.startsWith(DIAGRAMS_NET_OPEN)) return null;
  const encoded = href.slice(DIAGRAMS_NET_OPEN.length);
  if (encoded === '' || /[&#?/:]/.test(encoded)) return null;
  let target: URL;
  try {
    target = new URL(decodeURIComponent(encoded));
  } catch {
    return null;
  }
  if (target.origin !== SITE_URL || target.search !== '' || target.hash !== '') return null;
  return target.pathname.endsWith('.drawio') ? target.pathname : null;
}

/**
 * The sample exports' links across the pages (see the module comment). `readFile` gives a built file's bytes by its
 * URL path, undefined when the build has no such file.
 */
export function checkExports(
  pages: readonly Page[],
  readFile: (urlPath: string) => Buffer | undefined,
): string[] {
  const problems: string[] = [];
  const checked = new Map<string, string[]>();
  const contentProblems = (file: string, extension: string): string[] => {
    let found = checked.get(file);
    if (found === undefined) {
      const data = readFile(file);
      found =
        data === undefined
          ? ['not in the build']
          : extension === '.png'
            ? data.subarray(0, 8).equals(PNG_SIGNATURE)
              ? []
              : ['not a PNG']
            : extension === '.drawio'
              ? exportDrawioProblems(data.toString('utf8'))
              : exportSvgProblems(data.toString('utf8'));
      checked.set(file, found);
    }
    return found;
  };
  for (const page of pages) {
    for (const match of page.html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const anchor = tags(`<a${match[1] ?? ''}>`, 'a')[0] ?? {};
      const href = anchor.href ?? '';
      const kind = anchor['data-export'];
      let host: string;
      try {
        host = new URL(href, SITE_URL).host;
      } catch {
        host = '';
      }
      if (host === DIAGRAMS_NET_HOST && /[?&]url=/.test(href) && kind !== 'drawio-open')
        problems.push(
          `${page.path}: a link that opens a file in diagrams.net outside the exports' "Open in diagrams.net" links: ${href}`,
        );
      if (kind === undefined) continue;
      const where = (message: string): void => {
        problems.push(`${page.path}: export link ${href || '(no href)'} (${kind}): ${message}`);
      };
      if (!['png', 'svg', 'svg-open', 'drawio', 'drawio-open'].includes(kind)) {
        where('not a known kind (png, svg, svg-open, drawio, drawio-open)');
        continue;
      }
      if (kind === 'drawio-open') {
        const file = diagramsNetFile(href);
        if (file === null) {
          where(`not ${DIAGRAMS_NET_OPEN} with the address of a draw.io file on ${SITE_URL}`);
          continue;
        }
        if (anchor.target !== '_blank') where('does not open a new tab (target="_blank")');
        if (!(anchor.rel ?? '').split(/\s+/).includes('noopener')) where('has no rel="noopener"');
        if (!textContent(match[2] ?? '').endsWith(NEW_TAB_NOTE.trim()))
          where(`does not say it opens a new tab ("${NEW_TAB_NOTE.trim()}", visually hidden)`);
        if ('download' in anchor) where('downloads the file instead of opening it in diagrams.net');
        for (const problem of contentProblems(file, '.drawio')) where(problem);
        continue;
      }
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href) || !href.startsWith('/')) {
        where('not a file of the site itself');
        continue;
      }
      const extension = kind === 'png' ? '.png' : kind === 'drawio' ? '.drawio' : '.svg';
      if (!href.endsWith(extension)) where(`not a ${extension} file`);
      if (kind === 'svg-open' && 'download' in anchor) where('downloads the SVG instead of opening it');
      if (kind !== 'svg-open' && !(anchor.download ?? '').endsWith(extension))
        where(`has no download name ending in ${extension}`);
      for (const problem of contentProblems(href, extension)) where(problem);
    }
  }
  const exportsPage = pages.find((page) => page.path === '/exports/');
  if (exportsPage === undefined) problems.push('/exports/: the sample exports page was not built');
  else {
    const links = tags(exportsPage.html, 'a').filter((anchor) => anchor['data-export'] !== undefined);
    for (const theme of ['light', 'dark']) {
      for (const kind of ['png', 'svg', 'drawio']) {
        const offered = links.some(
          (anchor) => anchor['data-export'] === kind && (anchor.download ?? '').includes(`-${theme}.`),
        );
        if (!offered)
          problems.push(
            `/exports/: no ${kind === 'drawio' ? 'draw.io file' : kind.toUpperCase()} of the ${theme} theme to download`,
          );
      }
      const opens = links.some(
        (anchor) =>
          anchor['data-export'] === 'drawio-open' &&
          (diagramsNetFile(anchor.href ?? '') ?? '').includes(`-${theme}.`),
      );
      if (!opens) problems.push(`/exports/: no "Open in diagrams.net" link of the ${theme} theme`);
    }
  }
  return problems;
}

/**
 * The mark across the build (see the module comment): `favicon` and `source` are the texts of dist/favicon.svg and
 * brand/icon.svg (undefined when missing), `css` every stylesheet of the build and every <style> of its pages.
 */
export function checkBrand(
  pages: readonly Page[],
  favicon: string | undefined,
  source: string | undefined,
  css: string,
): string[] {
  const problems: string[] = [];
  if (source === undefined) return [`${BRAND_ICON} is missing`];
  if (favicon === undefined) problems.push(`favicon.svg is missing (the build copies ${BRAND_ICON})`);
  else if (favicon !== source) problems.push(`favicon.svg is not ${BRAND_ICON} as it is`);
  let expected: Drawing;
  try {
    expected = drawingOfSvg(source);
  } catch (error) {
    problems.push(`${BRAND_ICON}: ${error instanceof Error ? error.message : String(error)}`);
    return problems;
  }
  for (const page of pages) {
    const icons = tags(page.html, 'link').filter((attributes) =>
      (attributes.rel ?? '').split(/\s+/).includes('icon'),
    );
    if (icons.length !== 1 || icons[0]?.href !== '/favicon.svg')
      problems.push(`${page.path}: ${String(icons.length)} icon links (one, to /favicon.svg)`);
    const logos = [...page.html.matchAll(/<svg\b([^>]*)>[\s\S]*?<\/svg>/gi)].filter((match) =>
      (tags(`<svg${match[1] ?? ''}>`, 'svg')[0]?.class ?? '').split(/\s+/).includes('logo'),
    );
    if (logos.length === 0) problems.push(`${page.path}: no logo (<svg class="logo">)`);
    for (const logo of logos) {
      let differences: string[];
      try {
        differences = drawingDifferences(expected, drawingOfLogo(logo[0]));
      } catch (error) {
        differences = [error instanceof Error ? error.message : String(error)];
      }
      if (differences.length > 0)
        problems.push(`${page.path}: the logo is not the favicon's drawing: ${differences.join('; ')}`);
    }
  }
  const dark = [...css.matchAll(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{([^@]*)/gi)].some(
    (match) =>
      [...(match[1] ?? '').matchAll(/\.logo-shape\b[^{}]*\{([^}]*)\}/g)].some((rule) => {
        const body = (rule[1] ?? '').replace(/\s+/g, '');
        return [
          'fill:var(--dark-fill)',
          'stroke:var(--dark-stroke)',
          'stroke-width:var(--dark-stroke-width)',
        ].every((declaration) => body.includes(declaration));
      }),
  );
  if (!dark)
    problems.push(
      'no stylesheet gives the logo its dark colours (.logo-shape under prefers-color-scheme: dark)',
    );
  return problems;
}

/** Where the site serves the installer, and its source in the repository (website/astro.config.ts copies it). */
export const INSTALLER_PATH = '/install.sh';
export const INSTALLER_SOURCE = 'infra/install.sh';

/**
 * The content types the installer may be served with: a shell script's (text/x-shellscript), plain text, and
 * application/x-sh, which GitHub Pages sends for a `.sh` file. curl takes any of them; a browser shows the first two
 * and offers the third as a download.
 */
export const INSTALLER_TYPES: readonly string[] = ['text/x-shellscript', 'text/plain', 'application/x-sh'];

/**
 * The installer as built (`served`, dist/install.sh) against its source (`source`, infra/install.sh), the content type
 * the host sends for it (`type`, by its extension), and robots.txt and the sitemap: every problem, or none.
 */
export function checkInstaller(
  served: Buffer | undefined,
  source: Buffer | undefined,
  type: string | undefined,
  robots: string,
  sitemap: string,
): string[] {
  const problems: string[] = [];
  const where = INSTALLER_PATH.slice(1);
  if (source === undefined) problems.push(`${INSTALLER_SOURCE} is missing`);
  if (served === undefined) problems.push(`${where} is missing (the build copies ${INSTALLER_SOURCE})`);
  else if (source !== undefined && !served.equals(source))
    problems.push(`${where} is not ${INSTALLER_SOURCE} byte for byte`);
  const mediaType = (type ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!INSTALLER_TYPES.includes(mediaType))
    problems.push(
      `${where} would be served as ${mediaType === '' ? 'no known type' : mediaType}, not as one of ${INSTALLER_TYPES.join(', ')}`,
    );
  if (!/^Disallow: \/install\.sh$/m.test(robots))
    problems.push(`robots.txt does not keep ${INSTALLER_PATH} out (Disallow)`);
  if (sitemap.includes(`${SITE_URL}${INSTALLER_PATH}<`))
    problems.push(`sitemap.xml lists ${INSTALLER_PATH}, which is no page`);
  return problems;
}

/** The URL path of a built HTML file ("docs/index.html" → "/docs/"). */
export function urlPathOf(file: string): string {
  const posix = file.split(path.sep).join('/');
  if (posix === 'index.html') return '/';
  if (posix.endsWith('/index.html')) return `/${posix.slice(0, -'index.html'.length)}`;
  return `/${posix}`;
}

function filesEndingIn(extension: string, dir: string, base = dir): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) return filesEndingIn(extension, file, base);
      return name.endsWith(extension) ? [path.relative(base, file)] : [];
    });
}

function htmlFiles(dir: string): string[] {
  return filesEndingIn('.html', dir);
}

/** The ids on a page, for anchors. */
function idsOf(html: string): Set<string> {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => decode(match[1] ?? '')));
}

/** Internal links and anchors that do not resolve, across the pages of a built site. */
export function checkLinks(pages: readonly Page[], exists: (urlPath: string) => boolean): string[] {
  const byPath = new Map(pages.map((page) => [page.path, page]));
  const problems: string[] = [];
  for (const page of pages) {
    for (const anchor of tags(page.html, 'a')) {
      const href = anchor.href;
      if (href === undefined || href === '' || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) continue;
      const [target = '', hash] = href.split('#');
      const targetPath = target === '' ? page.path : new URL(target, `${SITE_URL}${page.path}`).pathname;
      const targetPage = byPath.get(targetPath);
      if (targetPage === undefined && !exists(targetPath)) {
        problems.push(`${page.path}: a link to ${href} that does not resolve`);
        continue;
      }
      if (
        hash !== undefined &&
        hash !== '' &&
        targetPage !== undefined &&
        !idsOf(targetPage.html).has(decodeURIComponent(hash))
      ) {
        problems.push(`${page.path}: a link to ${href} whose anchor is not on the page`);
      }
    }
  }
  return problems;
}

/** The repository's root, above this package. */
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** brand/icon.svg, the mark's one source, at the repository root. */
const BRAND_SOURCE = path.join(REPOSITORY_ROOT, BRAND_ICON);

/** The whole site in `dist`; `brandSource` is the mark's source file (brand/icon.svg). */
/** Whether a built file (its path relative to dist) belongs to the demo below DEMO_URL. */
function inDemo(file: string): boolean {
  return `/${file.split(path.sep).join('/')}`.startsWith(DEMO_URL);
}

export function checkSite(dist: string, brandSource = BRAND_SOURCE): string[] {
  const problems: string[] = [];
  // The site's own pages; the demo's (the app's index.html and its copies) have their own rules (checkDemo).
  const pages = htmlFiles(dist)
    .filter((file) => !inDemo(file))
    .map((file) => ({
      path: urlPathOf(file),
      html: readFileSync(path.join(dist, file), 'utf8'),
    }));
  for (const page of pages) problems.push(...checkPage(page));
  for (const page of pages) {
    if (/^\/(?:impressum|privacy)(?:\/|\.html$)/.test(page.path))
      problems.push(
        `${page.path}: the site has no legal page of its own (the footer links the maintainer's website)`,
      );
  }

  const titles = new Map<string, string>();
  const descriptions = new Map<string, string>();
  for (const page of pages) {
    const title = /<title>([^<]*)<\/title>/.exec(page.html)?.[1] ?? '';
    const description = meta(page.html, 'name', 'description') ?? '';
    const sameTitle = titles.get(title);
    if (sameTitle !== undefined) problems.push(`${page.path}: the same title as ${sameTitle}`);
    titles.set(title, page.path);
    const sameDescription = descriptions.get(description);
    if (sameDescription !== undefined)
      problems.push(`${page.path}: the same description as ${sameDescription}`);
    descriptions.set(description, page.path);
  }

  problems.push(
    ...checkLinks(pages, (urlPath) => {
      const file = path.join(dist, decodeURIComponent(urlPath));
      return existsSync(file) && (statSync(file).isFile() || existsSync(path.join(file, 'index.html')));
    }),
  );
  problems.push(
    ...checkExports(pages, (urlPath) => {
      const file = path.join(dist, decodeURIComponent(urlPath));
      return existsSync(file) && statSync(file).isFile() ? readFileSync(file) : undefined;
    }),
  );

  const sitemapFile = path.join(dist, 'sitemap.xml');
  const sitemap = existsSync(sitemapFile) ? readFileSync(sitemapFile, 'utf8') : '';
  const listed = new Set(
    [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => decode(match[1] ?? '')),
  );
  const demoDir = path.join(dist, DEMO_URL.replace(/^\/|\/$/g, ''));
  const built = new Set([
    ...pages.filter((page) => page.path !== '/404.html').map((page) => `${SITE_URL}${page.path}`),
    // The demo's entry page; its other routes are states of the same app, not pages to list.
    ...(existsSync(path.join(demoDir, 'index.html')) ? [`${SITE_URL}${DEMO_URL}`] : []),
  ]);
  for (const url of built) if (!listed.has(url)) problems.push(`sitemap.xml: ${url} is not listed`);
  for (const url of listed) if (!built.has(url)) problems.push(`sitemap.xml: ${url} is listed but not built`);
  const robots = existsSync(path.join(dist, 'robots.txt'))
    ? readFileSync(path.join(dist, 'robots.txt'), 'utf8')
    : '';
  if (!robots.includes(`Sitemap: ${SITE_URL}/sitemap.xml`))
    problems.push('robots.txt does not name the sitemap');
  const cname = existsSync(path.join(dist, 'CNAME'))
    ? readFileSync(path.join(dist, 'CNAME'), 'utf8').trim()
    : '';
  if (cname !== SITE_HOST) problems.push(`CNAME is "${cname}", not ${SITE_HOST}`);
  const bytes = (file: string): Buffer | undefined =>
    existsSync(file) && statSync(file).isFile() ? readFileSync(file) : undefined;
  problems.push(
    ...checkInstaller(
      bytes(path.join(dist, INSTALLER_PATH.slice(1))),
      bytes(path.join(REPOSITORY_ROOT, INSTALLER_SOURCE)),
      CONTENT_TYPES[path.extname(INSTALLER_PATH)],
      robots,
      sitemap,
    ),
  );
  for (const licence of ['roboto-LICENSE.txt', 'roboto-mono-LICENSE.txt', 'gcportrait-LICENSE.txt']) {
    if (!existsSync(path.join(dist, 'licenses', licence))) problems.push(`licenses/${licence} is missing`);
  }
  // The site's scripts; the demo's are the app's, under its own policy (checkDemo).
  let sendsPageViews = false;
  for (const file of filesEndingIn('.js', dist).filter((name) => !inDemo(name))) {
    const source = readFileSync(path.join(dist, file), 'utf8');
    sendsPageViews ||= source.includes(ANALYTICS_PREFIX);
    for (const problem of scriptConnectionProblems(source))
      problems.push(`${file.split(path.sep).join('/')}: ${problem}`);
  }
  if (sendsPageViews && !existsSync(path.join(dist, 'licenses', ANALYTICS_LICENCE)))
    problems.push(`licenses/${ANALYTICS_LICENCE} is missing (a script carries TelemetryDeck's SDK)`);
  const stylesheets = filesEndingIn('.css', dist)
    .filter((file) => !inDemo(file))
    .map((file) => ({
      file: file.split(path.sep).join('/'),
      text: readFileSync(path.join(dist, file), 'utf8'),
    }));
  for (const { file, text } of stylesheets) {
    for (const address of cssAddresses(text)) problems.push(`${file}: loads from another host: ${address}`);
    for (const declaration of timelineShorthands(text))
      problems.push(
        `${file}: a scroll timeline in an animation shorthand, which browsers drop: ${declaration}`,
      );
  }
  const css = stylesheets.map((stylesheet) => stylesheet.text).join('\n');
  if (!keepsMediaInBox(css)) {
    problems.push('no stylesheet keeps images and videos within their box (img, video { max-width: 100% })');
  }
  const pageStyles = pages.flatMap((page) =>
    [...page.html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1] ?? ''),
  );
  for (const page of pages) {
    for (const match of page.html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
      for (const declaration of timelineShorthands(match[1] ?? ''))
        problems.push(
          `${page.path}: a scroll timeline in an animation shorthand, which browsers drop: ${declaration}`,
        );
    }
  }
  const read = (file: string): string | undefined =>
    existsSync(file) && statSync(file).isFile() ? readFileSync(file, 'utf8') : undefined;
  problems.push(
    ...checkBrand(
      pages,
      read(path.join(dist, 'favicon.svg')),
      read(brandSource),
      [css, ...pageStyles].join('\n'),
    ),
  );
  problems.push(
    ...checkDemo(
      {
        files: existsSync(demoDir)
          ? filesEndingIn('', demoDir).map((file) => file.split(path.sep).join('/'))
          : [],
        read: (file) => read(path.join(demoDir, file)),
      },
      read(brandSource),
    ),
  );
  const home = pages.find((page) => page.path === '/');
  if (home === undefined) problems.push('no landing page');
  else {
    const jsonLd = [...home.html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
      (match) => match[1] ?? '',
    );
    if (!jsonLd.some((text) => text.includes('"SoftwareApplication"') && text.includes(LICENSE_URL))) {
      problems.push(`/: no SoftwareApplication JSON-LD with the MIT licence (${LICENSE_URL})`);
    }
    if (!jsonLd.some((text) => text.includes('"Person"')))
      problems.push('/: no Person JSON-LD (docs/author.md)');
  }
  return problems;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = path.resolve(
    process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist'),
  );
  if (!existsSync(path.join(dist, 'index.html'))) {
    console.error(`website:check: no built site in ${dist}; run \`pnpm website:build\` first`);
    process.exit(1);
  }
  const problems = checkSite(dist);
  const count = htmlFiles(dist).filter((file) => !inDemo(file)).length;
  if (problems.length > 0) {
    console.error(`website:check: ${String(problems.length)} problem(s) in ${String(count)} pages:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(
    `website:check: ${String(count)} pages OK (metadata, links, anchors, sitemap, the installer at ${INSTALLER_PATH}, self-hosted resources, scripts asking no other host but the repository widget's and TelemetryDeck's for page views, focusable code blocks, the header's GitHub link, the footer notice and the long form in the author section only, the footer's legal links and no legal page of its own, the favicon and the logo from brand/icon.svg, viewport and phone widths, command variables and Copy buttons, sample exports; the demo at ${DEMO_URL}: its pages, policy, favicon and links, no analytics in it, every link to it opening a new tab).`,
  );
}
