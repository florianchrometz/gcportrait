// SPDX-License-Identifier: MIT

/**
 * The app's link to its own source (agents.md, Product rules). gcportrait is licensed under the MIT License, which
 * asks nothing of an instance's operator here; the link is a courtesy to the people who use an instance: it says
 * where the source of the version they use is published, and under which licence. The shell footer shows it on every
 * route as "Source (MIT)" (shell/SourceLink.tsx). Its target is `sourceUrl` from GET /api/config (the backend's
 * SOURCE_URL) in live mode, and the build-time VITE_SOURCE_URL in demo mode, where there is no backend; both fall
 * back to DEFAULT_SOURCE_URL, so an unmodified copy links to the project's repository.
 */

/** The footer link's text, naming the licence. */
export const SOURCE_LINK_TEXT = 'Source (MIT)';

/**
 * The project's repository: the same default as SOURCE_URL in backend/src/config.ts. A fork changes both, and the
 * tests that pin them (docs/contributing.md, Releases).
 */
export const DEFAULT_SOURCE_URL = 'https://github.com/florianchrometz/gcportrait';

/** Whether a value can be the link's target: an absolute http(s) URL (never `javascript:` or the like). */
export function isSourceUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname !== '';
  } catch {
    return false;
  }
}

/** The build-time source URL (VITE_SOURCE_URL), or the default when it is unset, blank or not an http(s) URL. */
export function readSourceUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  return isSourceUrl(trimmed) ? trimmed : DEFAULT_SOURCE_URL;
}
