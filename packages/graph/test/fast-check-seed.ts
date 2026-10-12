// SPDX-License-Identifier: MIT
/**
 * Pins fast-check's seed when `FC_SEED` is set, so that two coverage runs draw the same random inputs and reach
 * the same branches: `FC_SEED=42 pnpm --filter @gcportrait/graph exec vitest run --coverage`. Without it every
 * run draws a fresh seed, as the properties are meant to.
 */
import fc from 'fast-check';

const seed = process.env['FC_SEED'];
if (seed !== undefined && seed !== '') {
  const value = Number(seed);
  if (!Number.isSafeInteger(value)) throw new Error(`FC_SEED must be an integer, not "${seed}"`);
  fc.configureGlobal({ seed: value });
}
