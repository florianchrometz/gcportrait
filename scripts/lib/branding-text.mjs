// SPDX-License-Identifier: Apache-2.0
// @ts-check
/**
 * Loads branding strings from frontend/src/branding.ts across scripts tooling.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Loads the long-form non-affiliation statement (AGENTS.md, Non-affiliation, brand and legal)
 * directly from frontend/src/branding.ts.
 * @param {string} [root] repository root directory
 * @returns {string}
 */
export function loadNonAffiliationLong(root = DEFAULT_ROOT) {
  const require = createRequire(import.meta.url);
  /** @type {unknown} */
  const branding = require(path.join(root, 'frontend', 'src', 'branding.ts'));
  const record =
    typeof branding === 'object' && branding !== null
      ? /** @type {Record<string, unknown>} */ (branding)
      : {};
  if (typeof record.NON_AFFILIATION_LONG === 'string') {
    return record.NON_AFFILIATION_LONG;
  }
  throw new Error('frontend/src/branding.ts exports no NON_AFFILIATION_LONG string.');
}

export const NON_AFFILIATION_LONG = loadNonAffiliationLong();
