// SPDX-License-Identifier: MIT
// @ts-check
/**
 * The static demo (AGENTS.md, Modes and hosting): the app built in demo-only mode for a static host, the
 * maintainer's demo at https://gcportrait.app/demo/ on GitHub Pages. Shared by the frontend's build
 * (frontend/vite.config.ts, which writes the bundle when VITE_STATIC_DEMO=1) and the root command that runs
 * it (scripts/static-demo.mjs, `pnpm demo:static`). Plain ESM, Node built-ins only.
 *
 * **Routes on a static host.** The app routes by path (`/diagram`, `/settings`, …; the URL hash is the diagram's view,
 * so hash routing is not an option), and a static host has no rewrite to the app's index.html. So the build writes a
 * copy of index.html for every route, `diagram.html`, `snapshots.html` and so on next to `index.html`: GitHub Pages
 * serves `/demo/diagram` from `demo/diagram.html` without a redirect, so a reload or a shared link on any route boots
 * the app there, the view's hash included. GitHub Pages serves only the site's own `/404.html` for a missing file (a
 * `404.html` in a folder is never used), so an unknown address under the base gets the website's 404 page.
 *
 * **Content Security Policy.** A static host sends no headers, so the policy travels in the page, as
 * `<meta http-equiv="Content-Security-Policy">`, first thing after `<meta charset>`, so it governs everything the page
 * loads. It is the backend's demo-only policy (backend/src/security.ts, `cspDirectives(hashes, { google: false })`)
 * without what a `<meta>` cannot carry (`frame-ancestors`, `report-uri`, `report-to`, `sandbox`, which browsers ignore
 * there); scripts/static-demo.test.ts compares the two. The theme bootstrap, the one inline script, is allowed by its
 * SHA-256 hash, computed from the very page written, as the backend computes it from the page it serves. The backend's
 * `Referrer-Policy: no-referrer` goes along as `<meta name="referrer">`. What has no `<meta>` form at all is left to the
 * host: `frame-ancestors` and X-Frame-Options, Cross-Origin-Opener- and -Embedder-Policy, Permissions-Policy and
 * nosniff.
 */
import { createHash } from 'node:crypto';

/** Where the static demo is served by default: the maintainer's site, https://gcportrait.app/demo/. */
export const DEFAULT_BASE = '/demo/';

/**
 * The app's routes (frontend/src/App.tsx) other than its start page: each gets a copy of index.html named after it.
 * scripts/static-demo.test.ts fails while this list and App.tsx's routes differ.
 */
export const STATIC_DEMO_ROUTES = Object.freeze([
  'diagram',
  'snapshots',
  'permissions',
  'settings',
  'impressum',
  'privacy',
]);

/** Directives a policy in a `<meta>` element cannot carry (CSP Level 3, §3.3): browsers ignore them there. */
export const META_UNSUPPORTED_DIRECTIVES = Object.freeze([
  'frame-ancestors',
  'report-uri',
  'report-to',
  'sandbox',
]);

/**
 * The backend's Referrer-Policy (helmet's `no-referrer`, backend/src/server.ts), which a `<meta name="referrer">` can
 * carry: the static demo sends no address of its own along with any request or link.
 */
export const REFERRER_POLICY = 'no-referrer';

const INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const SRC_ATTRIBUTE = /(?:^|\s)src\s*=/i;

/**
 * CSP source expressions (`'sha256-…'`) for every inline `<script>` in an HTML document, in document order: the
 * backend's `inlineScriptHashes` (backend/src/security.ts), which the test compares this with.
 * @param {string} html
 * @returns {string[]}
 */
export function inlineScriptHashes(html) {
  /** @type {string[]} */
  const hashes = [];
  for (const match of html.matchAll(INLINE_SCRIPT)) {
    const attributes = match[1] ?? '';
    const body = match[2] ?? '';
    if (SRC_ATTRIBUTE.test(attributes)) continue;
    hashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  return hashes;
}

/**
 * The static demo's directives: the backend's demo-only policy (no Google host anywhere) without the directives a
 * `<meta>` cannot carry, given the hashes of the page's inline scripts.
 * @param {readonly string[]} inlineScriptSources
 * @returns {Record<string, string[]>}
 */
export function staticDemoDirectives(inlineScriptSources) {
  return {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'script-src': ["'self'", ...inlineScriptSources],
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
}

/**
 * A policy's text: `name value value; name value`.
 * @param {Readonly<Record<string, readonly string[]>>} directives
 * @returns {string}
 */
export function policyText(directives) {
  return Object.entries(directives)
    .map(([name, values]) => [name, ...values].join(' '))
    .join('; ');
}

/** The `<meta http-equiv="Content-Security-Policy">` elements of a page, as their content attribute. */
const CSP_META = /<meta\b[^>]*\bhttp-equiv\s*=\s*["']?Content-Security-Policy["']?[^>]*>/gi;

/**
 * The page with its Content Security Policy as a `<meta>` element right after `<meta charset>` (or, without one, first
 * in `<head>`), so that it governs every script, stylesheet and image after it, followed by the referrer policy
 * ({@link REFERRER_POLICY}). The hashes are the page's own.
 * @param {string} html
 * @returns {string}
 */
export function withContentSecurityPolicy(html) {
  if (policyMetas(html).length > 0) throw new Error('the page already has a Content Security Policy <meta>');
  const policy = policyText(staticDemoDirectives(inlineScriptHashes(html)));
  const csp = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
  const referrer = `<meta name="referrer" content="${REFERRER_POLICY}" />`;
  const charset = /<meta\s+charset\s*=\s*["']?[\w-]+["']?\s*\/?>/i.exec(html);
  if (charset !== null) {
    const at = charset.index + charset[0].length;
    const indent = /\n([ \t]*)$/.exec(html.slice(0, charset.index))?.[1] ?? '';
    return `${html.slice(0, at)}\n${indent}${csp}\n${indent}${referrer}${html.slice(at)}`;
  }
  const head = /<head\b[^>]*>/i.exec(html);
  if (head === null) throw new Error('the page has no <head>');
  const at = head.index + head[0].length;
  return `${html.slice(0, at)}\n${csp}\n${referrer}${html.slice(at)}`;
}

/**
 * The content of every Content Security Policy `<meta>` of a page, in order.
 * @param {string} html
 * @returns {string[]}
 */
export function policyMetas(html) {
  return [...html.matchAll(CSP_META)].map(
    (match) =>
      /\bcontent\s*=\s*"([^"]*)"/i.exec(match[0])?.[1] ??
      /\bcontent\s*=\s*'([^']*)'/i.exec(match[0])?.[1] ??
      '',
  );
}
