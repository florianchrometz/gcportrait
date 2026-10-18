// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';

/**
 * Browser-facing header values and CSP construction, installed by server.ts directly.
 * Policy: backend/AGENTS.md, Hardening; docs/security.md, "Browser-facing headers". Inline-script
 * hashes come from the exact served index.html so the theme bootstrap needs no unsafe-inline source.
 */

/**
 * Browser OAuth origin for tokeninfo and sign-out revocation. Other API hosts belong to the backend
 * upstream allowlist, not the browser's connect-src (docs/security.md, "Browser-facing headers").
 */
export const BROWSER_GOOGLE_ORIGINS = ['https://oauth2.googleapis.com'] as const;

/**
 * GIS sources: a script-src path matches that file only; a trailing slash on connect-src matches
 * its path prefix. Revocation uses {@link BROWSER_GOOGLE_ORIGINS}, and sign-in uses a popup, not a
 * frame. GIS's attempted button stylesheet is deliberately refused: the token client draws no button.
 */
export const GIS_SCRIPT_SOURCE = 'https://accounts.google.com/gsi/client';
export const GIS_CONNECT_SOURCE = 'https://accounts.google.com/gsi/';

/**
 * Keep GIS's popup opener and closed-state tracking for postMessage; same-origin would sever that
 * link. This policy preserves windows opened by the app but still isolates a cross-origin page that
 * opens the app (docs/security.md, "Browser-facing headers").
 */
export const OPENER_POLICY = 'same-origin-allow-popups';

/**
 * Demo-only CSP needs no cross-origin resources, so the strict pair can isolate it. With sign-in,
 * {@link OPENER_POLICY} is required; COEP alone would isolate nothing and would only reject resources
 * without CORP. CSP already excludes them except GIS's script, which supplies CORP cross-origin
 * (docs/security.md, "Browser-facing headers").
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

/** Serialises CSP directives into a Content-Security-Policy header value. */
export function serializeCsp(directives: CspDirectives): string {
  return Object.entries(directives)
    .map(([name, sources]) => (sources.length > 0 ? `${name} ${sources.join(' ')}` : name))
    .join('; ');
}

/**
 * All browser hardening headers for an instance: CSP, cross-origin policies, HSTS,
 * referrer policy, frameguard, permissions policy, and browser defaults.
 */
export function securityHeaders(
  config: { readonly demoOnly: boolean },
  spa?: { readonly scriptHashes: readonly string[] } | null,
): Record<string, string> {
  const crossOrigin = crossOriginPolicies(config.demoOnly);
  const directives = cspDirectives(spa?.scriptHashes ?? [], { google: !config.demoOnly });

  const headers: Record<string, string> = {
    'content-security-policy': serializeCsp(directives),
    'cross-origin-opener-policy': crossOrigin.opener,
    'cross-origin-resource-policy': 'same-origin',
    'origin-agent-cluster': '?1',
    'referrer-policy': 'no-referrer',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'x-dns-prefetch-control': 'off',
    'x-download-options': 'noopen',
    'x-frame-options': 'DENY',
    'x-permitted-cross-domain-policies': 'none',
    'x-xss-protection': '0',
    'permissions-policy': PERMISSIONS_POLICY,
  };

  if (crossOrigin.embedder !== null) {
    headers['cross-origin-embedder-policy'] = crossOrigin.embedder;
  }

  return headers;
}
