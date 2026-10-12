// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { REPO } from './temp-tree.js';

/**
 * A string constant of frontend/src/branding.ts, the one source of the non-affiliation wording (ADR 0018), read from
 * the file (the tooling does not import the app): `export const NAME = ...;` with its string literals joined. Throws
 * when the file declares no such constant, so a renamed constant fails the test instead of comparing with ''.
 */
export function brandingConstant(name: string): string {
  const source = readFileSync(path.join(REPO, 'frontend', 'src', 'branding.ts'), 'utf8');
  const declaration = new RegExp(`export const ${name}\\s*=([^;]+);`).exec(source)?.[1];
  if (declaration === undefined) throw new Error(`frontend/src/branding.ts declares no ${name}`);
  return [...declaration.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2] ?? '').join('');
}
