// SPDX-License-Identifier: MIT
import { createHash } from 'node:crypto';

/**
 * The security headers of every response (AGENTS.md, Security and privacy; docs/security.md §6): the Content
 * Security Policy, Cross-Origin-Opener-Policy and -Embedder-Policy, and Permissions-Policy. server.ts sends
 * them with @fastify/helmet (which adds HSTS, nosniff, X-Frame-Options, Referrer-Policy and
 * Cross-Origin-Resource-Policy).
 *
 * Scripts and styles load only from the backend's own origin, plus Google Identity Services' client script
 * (Google sign-in), which the SPA loads only when a person presses "Sign in with Google". The one inline
 * script the SPA ships (the theme bootstrap in frontend/index.html, which must run before first paint) is
 * allowed by its SHA-256 hash, computed from the exact index.html being served, so no 'unsafe-inline' is ever
 * needed. Fonts are self-hosted. The browser may talk to the backend, to Google's OAuth host (tokeninfo,
 * revoke) and to GIS's own endpoints; it never calls Cloud Asset Inventory, Resource Manager or Cloud Storage
 * itself (the backend does, through its upstream allowlist, upstream/allowlist.ts), so those hosts are not in
 * `connect-src`.
 */

/**
 * The Google origin the SPA itself talks to: `oauth2.googleapis.com`, for tokeninfo (frontend/src/auth/
 * tokeninfo.ts: whose token it is, and for which client) and for revoking a token on sign-out (GIS's
 * `google.accounts.oauth2.revoke`). The other three upstream hosts (upstream/allowlist.ts) are the backend's
 * alone, so they stay out of `connect-src`.
 */
export const BROWSER_GOOGLE_ORIGINS = ['https://oauth2.googleapis.com'] as const;

/**
 * Google Identity Services' token client. `script-src` allows exactly its client script (a source with a
 * path matches that path only). `connect-src` allows its endpoints under `/gsi/` (a trailing slash matches the
 * path prefix), which the script may call (its log and status endpoints). Revoking a token on sign-out goes to
 * `oauth2.googleapis.com/revoke` ({@link BROWSER_GOOGLE_ORIGINS}). Sign-in itself happens in a window of
 * Google's (accounts.google.com), not in a frame, so `frame-src` stays closed. The script also tries to add a
 * stylesheet for Google's sign-in button, which the policy refuses on purpose: the token client draws nothing
 * on the page.
 */
export const GIS_SCRIPT_SOURCE = 'https://accounts.google.com/gsi/client';
export const GIS_CONNECT_SOURCE = 'https://accounts.google.com/gsi/';

/**
 * Cross-Origin-Opener-Policy: `same-origin-allow-popups`, not `same-origin`. The GIS token client opens
 * Google's sign-in in a window of its own, which hands the token back to this page through `postMessage` to
 * its opener, and watches whether the person closed it. Under `same-origin` the browser cuts a cross-origin
 * window opened from this page off from it (no opener, and the handle reads as closed at once), so sign-in could
 * never finish. `same-origin-allow-popups` keeps that link for windows this page opens and still isolates the
 * page from any cross-origin page that opens *it*.
 */
export const OPENER_POLICY = 'same-origin-allow-popups';

/**
 * A demo-only instance offers no sign-in, so nothing needs a window of Google's: it sends the strict pair,
 * `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, which makes the page
 * cross-origin isolated (its own browsing context group and process; nothing cross-origin may be embedded). The
 * app loads nothing from another origin there (its CSP allows none), so it needs nothing from them either.
 *
 * With sign-in the opener policy must stay {@link OPENER_POLICY}, and an embedder policy alone isolates nothing:
 * it would only refuse cross-origin subresources without a `Cross-Origin-Resource-Policy`, which the CSP already
 * refuses except for GIS's script (served with `cross-origin-resource-policy: cross-origin`). So that mode sends
 * no embedder policy, and nothing about sign-in depends on one (docs/security.md, "COOP, COEP, CORP").
 */
export const DEMO_OPENER_POLICY = 'same-origin';
export const DEMO_EMBEDDER_POLICY = 'require-corp';

/** The cross-origin isolation headers for an instance: the strict pair in demo-only mode, the opener policy only otherwise. */
export function crossOriginPolicies(demoOnly: boolean): {
  readonly opener: 'same-origin' | 'same-origin-allow-popups';
  readonly embedder: 'require-corp' | null;
} {
  return demoOnly
    ? { opener: DEMO_OPENER_POLICY, embedder: DEMO_EMBEDDER_POLICY }
    : { opener: OPENER_POLICY, embedder: null };
}

/**
 * Permissions-Policy: the app uses none of the browser's device, sensor or media features, so every one that
 * Chromium recognises is switched off for the page and anything it might ever embed. One stays on for the page's
 * own origin: `clipboard-write`, for the copy buttons (a link, a name, a command, an exported PNG). Only features
 * Chromium knows are listed, as an unknown name costs a console warning on every page load; Firefox and Safari
 * ignore the header.
 */
export const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=()',
  'bluetooth=()',
  'camera=()',
  'clipboard-read=()',
  'clipboard-write=(self)',
  'display-capture=()',
  'encrypted-media=()',
  'fullscreen=()',
  'geolocation=()',
  'gyroscope=()',
  'hid=()',
  'idle-detection=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'picture-in-picture=()',
  'screen-wake-lock=()',
  'serial=()',
  'usb=()',
  'xr-spatial-tracking=()',
].join(', ');

const INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const SRC_ATTRIBUTE = /(?:^|\s)src\s*=/i;

/** CSP source expressions (`'sha256-…'`) for every inline `<script>` in an HTML document, in document order. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const match of html.matchAll(INLINE_SCRIPT)) {
    const attributes = match[1] ?? '';
    const body = match[2] ?? '';
    if (SRC_ATTRIBUTE.test(attributes)) continue;
    hashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  return hashes;
}

export type CspDirectives = Readonly<Record<string, readonly string[]>>;

/**
 * The CSP directives, given the hashes of the inline scripts in the served index.html. `google: false` (demo-only
 * mode: no sign-in, nothing read from Google) leaves Google's sign-in script and OAuth host out, so the page
 * may load scripts from and talk to its own origin only.
 */
export function cspDirectives(
  inlineScriptSources: readonly string[],
  { google = true }: { readonly google?: boolean } = {},
): CspDirectives {
  return {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'script-src': ["'self'", ...inlineScriptSources, ...(google ? [GIS_SCRIPT_SOURCE] : [])],
    'script-src-attr': ["'none'"],
    'style-src': ["'self'"],
    'img-src': ["'self'", 'data:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", ...(google ? [...BROWSER_GOOGLE_ORIGINS, GIS_CONNECT_SOURCE] : [])],
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
  };
}
