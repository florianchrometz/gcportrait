// SPDX-License-Identifier: MIT
/**
 * Gives fast-check the property tests' seed and number of runs by the rule of `@gcportrait/model/testing`
 * (`propertySeed`, `propertyRuns`; `FC_RUNS`, when set, is the number of runs of a property that names none):
 * `FC_SEED` when set, so that a failure replays and two coverage runs draw the same random inputs and reach the
 * same branches (`FC_SEED=42 pnpm --filter @gcportrait/graph exec vitest run --coverage`); on CI a fixed seed,
 * so the blocking run draws the same inputs on every push; anywhere else none, and every run draws a fresh
 * seed, as the properties are meant to.
 */
import { propertyRuns, propertySeed } from '@gcportrait/model/testing';
import fc from 'fast-check';

/** fast-check's own number of runs for a property that names none. */
const FAST_CHECK_RUNS = 100;

const seed = propertySeed();
const numRuns = propertyRuns(FAST_CHECK_RUNS);
fc.configureGlobal({ ...fc.readConfigureGlobal(), numRuns, ...(seed === undefined ? {} : { seed }) });
