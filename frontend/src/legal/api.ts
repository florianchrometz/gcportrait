// SPDX-License-Identifier: MIT
import type { LegalTexts } from '@gcportrait/model';

import { isLegalUrl, type LegalPages } from '../api/config';
import { isRecord } from '../guards';

export type { LegalTexts } from '@gcportrait/model';

/**
 * Client for GET /api/legal: the Markdown of the instance's Impressum and privacy notice, as the backend
 * read it from LEGAL_DIR or LEGAL_BUNDLE (backend/src/legal.ts). Asked only on /impressum and /privacy, and only when
 * /api/config's `legal` names the page. Anything unexpected counts as "unavailable".
 */

export const LEGAL_PAGES = ['impressum', 'privacy'] as const;
export type LegalPageId = (typeof LEGAL_PAGES)[number];

/**
 * Where a legal page is: `served`, its text at /impressum or /privacy (the instance's LEGAL_DIR or LEGAL_BUNDLE); or
 * `linked`, a page published elsewhere at `url` (LEGAL_IMPRESSUM_URL or LEGAL_PRIVACY_URL, or the static demo's build
 * settings; an https URL, anything else links nothing).
 */
export type LegalTarget =
  { readonly kind: 'served' } | { readonly kind: 'linked'; readonly url: string; readonly host: string };

/** Where the configuration puts a legal page, or null when the instance publishes none. */
export function legalTarget(pages: LegalPages, id: LegalPageId): LegalTarget | null {
  if (pages[id]) return { kind: 'served' };
  const url = id === 'impressum' ? pages.impressumUrl : pages.privacyUrl;
  return isLegalUrl(url) ? { kind: 'linked', url, host: new URL(url).hostname } : null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** The answer's contract is the model's `LegalTextsSchema`; api/config.test.ts holds this guard to it. */
export function isLegalTexts(value: unknown): value is LegalTexts {
  return isRecord(value) && isNullableString(value.impressum) && isNullableString(value.privacy);
}

/** Fetches /api/legal. Resolves to null when the backend is unreachable or answers unexpectedly. */
export async function fetchLegalTexts(signal?: AbortSignal): Promise<LegalTexts | null> {
  try {
    const response = await fetch('/api/legal', {
      headers: { accept: 'application/json' },
      signal: signal ?? null,
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return isLegalTexts(body) ? body : null;
  } catch {
    return null;
  }
}
