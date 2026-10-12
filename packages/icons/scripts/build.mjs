#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// @ts-check
/**
 * Writes src/generated/icons.ts from mapping.json, manifest.json, vendored/ and own/ (lib/icon-module.mjs).
 * The module is committed (README "Generated module"): run this after `scripts/vendor.mjs` or after editing an
 * own drawing or mapping.json. Deterministic: the same inputs give the same bytes.
 *
 * Usage: node scripts/build.mjs [--check]
 *   --check   write nothing; exit 1 when the committed module differs from what the inputs produce
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { MODULE_PATH, renderIconModule } from './lib/icon-module.mjs';

/**
 * @param {readonly string[]} argv
 * @returns {Promise<number>}
 */
async function main(argv) {
  /** @type {boolean} */
  let check;
  try {
    check = parseArgs({
      args: [...argv],
      options: { check: { type: 'boolean', default: false } },
      strict: true,
    }).values.check;
  } catch (error) {
    process.stderr.write(`icons build: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  const text = await renderIconModule();
  const current = existsSync(MODULE_PATH) ? readFileSync(MODULE_PATH, 'utf8') : undefined;
  const relative = path.relative(process.cwd(), MODULE_PATH);
  if (check) {
    if (current === text) {
      process.stdout.write(`icons build: ${relative} is up to date.\n`);
      return 0;
    }
    process.stderr.write(
      `icons build: ${relative} is stale; run \`pnpm --filter @gcportrait/icons build\`.\n`,
    );
    return 1;
  }
  if (current === text) {
    process.stdout.write(`icons build: ${relative} unchanged.\n`);
    return 0;
  }
  mkdirSync(path.dirname(MODULE_PATH), { recursive: true });
  writeFileSync(MODULE_PATH, text);
  process.stdout.write(`icons build: wrote ${relative}.\n`);
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
