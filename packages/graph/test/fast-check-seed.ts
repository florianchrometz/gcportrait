// SPDX-License-Identifier: MIT
/**
 * Gives fast-check the property tests' seed by the rule of `@gcportrait/model/testing` (`propertySeed`):
 * `FC_SEED` when set, so that a failure replays and two coverage runs draw the same random inputs and reach the
 * same branches (`FC_SEED=42 pnpm --filter @gcportrait/graph exec vitest run --coverage`); on CI a fixed seed,
 * so the blocking run draws the same inputs on every push; anywhere else none, and every run draws a fresh
 * seed, as the properties are meant to.
 */
import { propertySeed } from '@gcportrait/model/testing';
import fc from 'fast-check';

const seed = propertySeed();
if (seed !== undefined) fc.configureGlobal({ ...fc.readConfigureGlobal(), seed });
