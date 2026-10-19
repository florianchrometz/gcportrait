// SPDX-License-Identifier: Apache-2.0
import { createRequire } from 'node:module';
import path from 'node:path';

import { REPO } from './temp-tree.js';

const require = createRequire(import.meta.url);
const branding = require(path.join(REPO, 'frontend', 'src', 'branding.ts')) as Record<string, string>;

/**
 * A string constant of frontend/src/branding.ts, the one source of the non-affiliation wording,
 * loaded directly from the source file.
 */
export function brandingConstant(name: string): string {
  const value = branding[name];
  if (value === undefined) throw new Error(`frontend/src/branding.ts declares no ${name}`);
  return value;
}
