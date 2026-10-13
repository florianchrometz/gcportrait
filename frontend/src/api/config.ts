// SPDX-License-Identifier: MIT

/**
 * Client for the backend's public configuration (GET /api/config, docs/api.md). Never
 * called in demo mode, nor in the static demo, whose configuration is built in (api/staticConfig.ts). The response is
 * validated before use; anything unexpected counts as "unavailable". auth/AuthProvider.tsx fetches it once per page
 * into the app store (`connect.backend`), where the Connect page reads the backend status and the shell footer its
 * `sourceUrl` and legal pages.
 */

export type PublicConfig = {
  readonly oauthClientId: string | null;
  readonly saMode: boolean;
  /**
   * Whether service-account mode's gate also refuses a scope the account can see on its own (the backend's
   * SA_MODE_STRICT_EXPOSURE). Absent, it counts as off.
   */
  readonly saStrictExposure?: boolean;
  readonly backendServiceAccount: string | null;
  readonly version: string;
  /** Where the source of the running version is published (the footer's "Source (MIT)" link; the backend's SOURCE_URL). */
  readonly sourceUrl: string;
  /**
   * Who runs this instance, "Hosted by NAME." (the backend's HOSTED_BY), or null when it names nobody. The Connect
   * page shows it next to "Sign in with Google" (`hostedByLine`); absent, it shows nothing.
   */
  readonly hostedBy?: string | null;
  readonly demo: boolean;
  /**
   * Demo-only mode (the backend's DEMO_ONLY): no sign-in, nothing read from Google Cloud; the Connect page
   * offers the demo organisations only (demoOnly.ts). Absent, it counts as off.
   */
  readonly demoOnly?: boolean;
  /**
   * Which legal pages the instance publishes: the booleans say which texts it serves (the backend's LEGAL_DIR or
   * LEGAL_BUNDLE), which /impressum and /privacy read from GET /api/legal (legal/); `impressumUrl` and `privacyUrl` the
   * addresses of pages it links instead (the backend's LEGAL_IMPRESSUM_URL and LEGAL_PRIVACY_URL; the static demo's
   * build settings, api/staticConfig.ts). The footer links either kind. Absent: none.
   */
  readonly legal?: LegalPages;
};

/**
 * Whether the instance publishes an Impressum and a privacy notice as texts of its own, and where it links pages
 * published elsewhere (null or absent: it links none). A page is one or the
 * other (the backend refuses both).
 */
export type LegalPages = {
  readonly impressum: boolean;
  readonly privacy: boolean;
  readonly impressumUrl?: string | null;
  readonly privacyUrl?: string | null;
};

/**
 * Whether a value can be a linked legal page's address: an absolute https URL with a host and no user name or
 * password, as the backend accepts for LEGAL_IMPRESSUM_URL and LEGAL_PRIVACY_URL (never `javascript:` or the like).
 */
export function isLegalUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

/** A linked page's address as the configuration may carry it; the footer links only an {@link isLegalUrl} one. */
function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function isLegalPages(value: unknown): value is LegalPages {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.impressum === 'boolean' &&
    typeof record.privacy === 'boolean' &&
    isOptionalString(record.impressumUrl) &&
    isOptionalString(record.privacyUrl)
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function isPublicConfig(value: unknown): value is PublicConfig {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    isNullableString(record.oauthClientId) &&
    typeof record.saMode === 'boolean' &&
    (record.saStrictExposure === undefined || typeof record.saStrictExposure === 'boolean') &&
    isNullableString(record.backendServiceAccount) &&
    typeof record.version === 'string' &&
    typeof record.sourceUrl === 'string' &&
    (record.hostedBy === undefined || isNullableString(record.hostedBy)) &&
    typeof record.demo === 'boolean' &&
    (record.demoOnly === undefined || typeof record.demoOnly === 'boolean') &&
    (record.legal === undefined || isLegalPages(record.legal))
  );
}

/** Fetches /api/config. Resolves to null when the backend is unreachable or answers unexpectedly. */
export async function fetchPublicConfig(signal?: AbortSignal): Promise<PublicConfig | null> {
  try {
    const response = await fetch('/api/config', {
      headers: { accept: 'application/json' },
      signal: signal ?? null,
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return isPublicConfig(body) ? body : null;
  } catch {
    return null;
  }
}
