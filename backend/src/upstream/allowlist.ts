// SPDX-License-Identifier: Apache-2.0
/**
 * The upstream host allowlist (AGENTS.md, Security and privacy, principle 3; docs/security.md §1): the
 * backend calls Google on the caller's behalf only at these four hosts, over HTTPS, on the default port, so
 * it can never be used as an open proxy. Every upstream request goes through {@link allowedUpstreamUrl}
 * before it is sent. (The SPA's own CSP is narrower: the browser talks only to the OAuth host,
 * `BROWSER_GOOGLE_ORIGINS` in ../security.ts.)
 */

/** The four Google API origins: Cloud Asset Inventory, Resource Manager, Cloud Storage and OAuth (tokeninfo). */
export const UPSTREAM_ORIGINS = [
  'https://cloudasset.googleapis.com',
  'https://cloudresourcemanager.googleapis.com',
  'https://storage.googleapis.com',
  'https://oauth2.googleapis.com',
] as const;

/** `cloudasset`, `cloudresourcemanager`, `storage` and `oauth2` on googleapis.com. */
export const UPSTREAM_HOSTS: ReadonlySet<string> = new Set(
  UPSTREAM_ORIGINS.map((origin) => new URL(origin).host),
);

/** A URL outside the allowlist: a bug in the caller, never something a request body can cause. */
export class UpstreamHostError extends Error {
  override readonly name = 'UpstreamHostError';
}

/** The URL, parsed, when it is an `https://` URL on an allowed host with no port or credentials; else throws. */
export function allowedUpstreamUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UpstreamHostError('The upstream URL is not a URL.');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.port !== '' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    !UPSTREAM_HOSTS.has(parsed.hostname)
  ) {
    throw new UpstreamHostError(`The backend does not call ${parsed.protocol}//${parsed.host}.`);
  }
  return parsed;
}
