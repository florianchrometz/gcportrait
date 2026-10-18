// SPDX-License-Identifier: Apache-2.0
/**
 * The test setup (vitest.config.ts) that gives fast-check the property tests' seed and number of runs by the
 * rule of seed.ts (`propertySeed`, `propertyRuns`): `FC_SEED` when set, so that a failure replays; on CI a
 * fixed seed, so the blocking unit run draws the same inputs on every push; anywhere else none, and every run
 * draws a fresh seed, as the properties are meant to. `FC_RUNS`, when set, is the number of runs of a
 * property that names none of its own. fast-check prints the seed and the path of a failure. Not exported:
 * only the test run loads it.
 */
import fc from 'fast-check';
import { propertyRuns, propertySeed } from './seed.js';

/** fast-check's own number of runs for a property that names none. */
const FAST_CHECK_RUNS = 100;

const seed = propertySeed();
const numRuns = propertyRuns(FAST_CHECK_RUNS);
fc.configureGlobal({ ...fc.readConfigureGlobal(), numRuns, ...(seed === undefined ? {} : { seed }) });
