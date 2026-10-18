// SPDX-License-Identifier: MIT

/**
 * Client for the backend's public configuration (GET /api/config, docs/api.md). Never
 * called in a demo build, whose configuration is built in (api/demoConfig.ts). The response is
 * validated before use; anything unexpected counts as "unavailable". auth/AuthProvider.tsx fetches it once per page
 * into the app store (`connect.backend`), where the Connect page reads the backend status and the shell footer its
 * `sourceUrl` and legal pages.
 */

/**
 * The answer's contract is declared once, in @gcportrait/model (`PublicConfigSchema`, every field always sent);
 * the types come from it erased, so no zod reaches the UI thread, and `isPublicConfig` below checks an answer by
 * hand, held to the schema by config.test.ts. `legal` says which legal pages the instance serves (/impressum and
 * /privacy read their text from GET /api/legal, legal/) and which it links elsewhere (`impressumUrl`,
 * `privacyUrl`; a demo build's settings, api/demoConfig.ts); the footer links either kind.
 */
export type { LegalPages, PublicConfig } from '@gcportrait/model';
import type { LegalPages, PublicConfig, RenderLimits } from '@gcportrait/model';

import { isRecord } from '../guards';

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

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** A linked page's address may be any string here; the footer links only an {@link isLegalUrl} one. */
function isLegalPages(value: unknown): value is LegalPages {
  return (
    isRecord(value) &&
    typeof value.impressum === 'boolean' &&
    typeof value.privacy === 'boolean' &&
    isNullableString(value.impressumUrl) &&
    isNullableString(value.privacyUrl)
  );
}

function isRenderLimits(value: unknown): value is RenderLimits {
  return (
    isRecord(value) &&
    Number.isInteger(value.maxAssets) &&
    Number.isInteger(value.maxPixels) &&
    Number.isInteger(value.maxBodyBytes) &&
    Number.isInteger(value.timeoutMs)
  );
}

export function isPublicConfig(value: unknown): value is PublicConfig {
  return (
    isRecord(value) &&
    isNullableString(value.oauthClientId) &&
    typeof value.saMode === 'boolean' &&
    typeof value.saStrictExposure === 'boolean' &&
    isNullableString(value.backendServiceAccount) &&
    typeof value.version === 'string' &&
    typeof value.sourceUrl === 'string' &&
    isNullableString(value.hostedBy) &&
    value.demo === false &&
    typeof value.demoOnly === 'boolean' &&
    isLegalPages(value.legal) &&
    (value.render === null || isRenderLimits(value.render))
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
