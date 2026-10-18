// SPDX-License-Identifier: MIT
/**
 * The website's page views (docs/website.md, "Analytics"), the parts without a DOM: whether a build sends them, whether
 * a page may, what it sends, and the visitor's session identifier. The page's script is src/lib/analytics-page.ts.
 *
 * - **The build.** `WEBSITE_ANALYTICS=1` switches the analytics on and `WEBSITE_ANALYTICS=0` off; unset, they are on in
 *   a deploying build only (`WEBSITE_STRICT=1`, which the site's build workflow, website.yml, sets when it
 *   deploys) and off everywhere else: `pnpm website:dev`, local builds, pull-request builds, the tests. A fork
 *   switches them off with the repository variable `WEBSITE_ANALYTICS` set to 0, which both callers pass to the
 *   build. A build with them off carries none of the code: astro.config.ts defines `__WEBSITE_ANALYTICS__`, and the
 *   layout's script calls the page module only under it, so the bundler leaves the module and the SDK out.
 * - **The page.** It sends only from the site's own host (SITE_HOST: never a local preview, a check in a browser or a
 *   fork's host) and never when the browser asks not to be tracked: Do Not Track (`navigator.doNotTrack` "1", or the
 *   older `window.doNotTrack` and `navigator.msDoNotTrack`) or Global Privacy Control (`navigator.globalPrivacyControl`).
 * - **What it sends.** One `pageView` signal per page load with the path the page declares for itself (no query, no
 *   fragment; the 404 page reports `/404.html`, never the address typed); and, when the
 *   visitor follows a link to the demo or to the repository, one `Outbound.demo` or `Outbound.repository` signal with
 *   the path of the page it was on. Nothing else: no address of another page, no query or fragment, nothing typed.
 * - **The identifier.** TelemetryDeck's SDK needs one for the user (it sends it hashed, SHA-256) and one for the
 *   session. The site has no accounts, so both are random values made for the browser tab's session and kept in its
 *   sessionStorage under `gcportrait.analytics` (`{"user":"<32 hex>","session":"<32 hex>"}`); sessionStorage ends with
 *   the tab. No cookie, nothing in localStorage. Where sessionStorage is blocked, each page load makes new values.
 */
import { DEMO_URL, SITE_HOST } from '../site.js';

/** The sessionStorage key of the session's random identifiers. */
export const ANALYTICS_SESSION_KEY = 'gcportrait.analytics';

/** The signals a page sends: its view, and a followed link to the demo or the repository. */
export const SIGNALS = {
  pageView: 'pageView',
  demo: 'Outbound.demo',
  repository: 'Outbound.repository',
} as const;
export type SignalType = (typeof SIGNALS)[keyof typeof SIGNALS];

/**
 * Whether a build sends page views (see the module comment): `WEBSITE_ANALYTICS` 1/true/on or 0/false/off, else on only
 * in a deploying build (`WEBSITE_STRICT` 1 or true). Any other value fails the build rather than guess.
 */
export function analyticsEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = env.WEBSITE_ANALYTICS?.trim().toLowerCase() ?? '';
  if (value === '') return env.WEBSITE_STRICT === '1' || env.WEBSITE_STRICT === 'true';
  if (['1', 'true', 'on'].includes(value)) return true;
  if (['0', 'false', 'off'].includes(value)) return false;
  throw new Error(
    `WEBSITE_ANALYTICS is "${env.WEBSITE_ANALYTICS ?? ''}": 1 (on) or 0 (off), or unset (on in a deploying build only)`,
  );
}

/** What a browser says about tracking: Do Not Track (current and older spellings) and Global Privacy Control. */
export type TrackingPreferences = {
  readonly doNotTrack?: unknown;
  readonly msDoNotTrack?: unknown;
  readonly windowDoNotTrack?: unknown;
  readonly globalPrivacyControl?: unknown;
};

/** Whether the browser asks not to be tracked: Do Not Track set ("1", or "yes" in old Firefox), or GPC on. */
export function trackingRefused(preferences: TrackingPreferences): boolean {
  const dnt = [preferences.doNotTrack, preferences.msDoNotTrack, preferences.windowDoNotTrack].some(
    (value) => value === '1' || value === 'yes' || value === 1,
  );
  return dnt || preferences.globalPrivacyControl === true;
}

/** Whether a page at this host may send: the site's own host only. */
export function isSiteHost(hostname: string): boolean {
  return hostname.toLowerCase() === SITE_HOST;
}

/** The path of a page's address, without its query and fragment ("/docs/?a=1#b" → "/docs/"); "/" when unreadable. */
export function pagePath(href: string): string {
  try {
    return new URL(href).pathname;
  } catch {
    return '/';
  }
}

/**
 * The signal a followed link calls for, or undefined: `Outbound.demo` for the demo (DEMO_URL and below on the page's
 * own origin), `Outbound.repository` for the repository (`repository`, the header's link to it, and any address below
 * it: its releases, its files). `page` is the address of the page the link is on.
 */
export function outboundSignal(
  href: string,
  page: string,
  repository: string | undefined,
): SignalType | undefined {
  let url: URL;
  let base: URL;
  try {
    base = new URL(page);
    url = new URL(href, base);
  } catch {
    return undefined;
  }
  if (url.origin === base.origin) {
    return url.pathname.startsWith(DEMO_URL) || url.pathname === DEMO_URL.replace(/\/$/, '')
      ? SIGNALS.demo
      : undefined;
  }
  if (repository === undefined || repository === '') return undefined;
  const root = repository.replace(/\/+$/, '');
  const target = `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  return target === root || target.startsWith(`${root}/`) ? SIGNALS.repository : undefined;
}

/** The session's random identifiers: the user's (sent hashed) and the session's. */
export type SessionIdentity = { readonly user: string; readonly session: string };
/** What the identifiers need of the tab's sessionStorage. */
export type SessionStore = Pick<Storage, 'getItem' | 'setItem'>;

const RANDOM_ID = /^[0-9a-f]{32}$/;

/** A random identifier: 16 bytes from `fill` (crypto.getRandomValues), as 32 hexadecimal digits. */
export function randomId(fill: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array): string {
  return [...fill(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The tab's identifiers: the ones kept under ANALYTICS_SESSION_KEY in `storage()` (the tab's sessionStorage), or new
 * ones from `newId`, kept there for the next page of the tab. Where the storage cannot be read or written (blocked,
 * full), the new ones serve this page only. Never throws.
 */
export function sessionIdentity(
  storage: () => SessionStore | undefined,
  newId: () => string,
): SessionIdentity {
  let store: SessionStore | undefined;
  try {
    store = storage();
    const kept: unknown = JSON.parse(store?.getItem(ANALYTICS_SESSION_KEY) ?? 'null');
    if (typeof kept === 'object' && kept !== null && 'user' in kept && 'session' in kept) {
      const { user, session } = kept;
      if (
        typeof user === 'string' &&
        typeof session === 'string' &&
        RANDOM_ID.test(user) &&
        RANDOM_ID.test(session)
      )
        return { user, session };
    }
  } catch {
    // Unreadable or blocked: new identifiers below.
  }
  const identity = { user: newId(), session: newId() };
  try {
    store?.setItem(ANALYTICS_SESSION_KEY, JSON.stringify(identity));
  } catch {
    // Not kept (blocked or full): this page's identifiers only.
  }
  return identity;
}
