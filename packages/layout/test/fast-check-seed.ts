// SPDX-License-Identifier: MIT
/**
 * Gives fast-check the property tests' seed by the rule of `@gcportrait/model/testing` (`propertySeed`):
 * `FC_SEED` when set, so that a failure replays; on CI a fixed seed, so the blocking `unit (layout)` leg draws
 * the same inputs on every push; anywhere else none, and every run draws a fresh seed, as the properties are
 * meant to. fast-check prints the seed and the path of a failure. `pnpm --filter @gcportrait/layout explore`
 * runs the random properties 1 000 times each (`FC_RUNS`, `propertyRuns`).
 */
import { propertySeed } from '@gcportrait/model/testing';
import fc from 'fast-check';

const seed = propertySeed();
if (seed !== undefined) fc.configureGlobal({ ...fc.readConfigureGlobal(), seed });
