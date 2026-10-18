// SPDX-License-Identifier: Apache-2.0
/**
 * The property tests' seed and number of runs, one rule for every package whose test setup applies it to
 * fast-check (`fast-check-seed.ts` in the catalog, ingest, this package, the graph, the layout and the
 * frontend):
 *
 * - **`FC_SEED`, when set, is the seed** of every property (an integer), so a reported failure replays.
 * - **On CI it is `CI_PROPERTY_SEED` otherwise** (`onCi`): the blocking runs draw the same inputs on every push,
 *   so a property fails there only for a change to the code or to its inputs, never for a seed drawn by chance;
 *   wider random exploration runs where it only reports (the layout's `explore`, in CI's `layout-budget` job).
 * - **Anywhere else no seed is fixed**: fast-check draws a fresh one for every property, as properties are
 *   meant to, and prints it with a failure.
 * - **`FC_RUNS`, when set, replaces the number of runs** of every property that asks `propertyRuns` for it
 *   (the layout's exploration runs each 1 000 times).
 *
 * Like the budget rule (budget.ts) the helpers reach the process through `globalThis`, since this package has
 * no Node types.
 */
import { onCi } from './budget.js';

/** The seed of the property tests on CI when `FC_SEED` names none. */
export const CI_PROPERTY_SEED = 42;

/** The environment the rule reads. */
type Environment = Readonly<Record<string, string | undefined>>;

function processEnvironment(): Environment {
  return (globalThis as { process?: { env: Environment } }).process?.env ?? {};
}

/** A variable's value as an integer (a positive one with `positive`); undefined when it is unset or empty. */
function integerOf(env: Environment, name: string, positive: boolean): number | undefined {
  const text = env[name];
  if (text === undefined || text.trim() === '') return undefined;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || (positive && value < 1)) {
    throw new Error(`${name} must be ${positive ? 'a positive integer' : 'an integer'}, not "${text}"`);
  }
  return value;
}

/**
 * The seed fast-check is given for every property: `FC_SEED`, else `CI_PROPERTY_SEED` on CI (`ci`, by default
 * `onCi()`), else undefined (fast-check draws one). Throws on an `FC_SEED` that is not an integer.
 */
export function propertySeed(env: Environment = processEnvironment(), ci = onCi()): number | undefined {
  return integerOf(env, 'FC_SEED', false) ?? (ci ? CI_PROPERTY_SEED : undefined);
}

/** A property's number of runs: `runs`, or `FC_RUNS` when set (a positive integer). */
export function propertyRuns(runs: number, env: Environment = processEnvironment()): number {
  return integerOf(env, 'FC_RUNS', true) ?? runs;
}
