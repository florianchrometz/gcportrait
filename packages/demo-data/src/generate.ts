// SPDX-License-Identifier: MIT
/**
 * Entry points: an organisation's 35-day history and today's organisation. The state at any tick
 * (`snapshotAt`) is history/replay.ts's, which imports none of the generator, so code that only replays a stored
 * history (the app's snapshot worker) bundles none of it.
 */
import type { DemoSize, Tick } from '@gcportrait/model';
import { OrgBuilder } from './builder/builder.js';
import { DEFAULT_SEED, DEMO_TODAY, HISTORY_TICKS } from './constants.js';
import { DAY_MS, formatTick, parseTick } from './core/time.js';
import { LAST_TICK, planHistory } from './history/plan.js';
import { snapshotAt } from './history/replay.js';
import type { DemoHistory, DemoOrganization } from './history/types.js';
import { buildOrganization } from './topology/organization.js';
import { SIZE_PROFILES } from './topology/profiles.js';

export interface GenerateOptions {
  readonly size: DemoSize;
  /** Defaults to {@link DEFAULT_SEED}. */
  readonly seed?: number;
  /** The last tick, `YYYY-MM-DD`; defaults to {@link DEMO_TODAY}. */
  readonly today?: Tick;
}

/**
 * The history of a demo organisation: its assets at the first tick (`today` minus 34 days) and, for each of
 * the 35 ticks, what changed since the previous one. Same arguments, same output, byte for byte.
 */
export function historyFor(
  size: DemoSize,
  seed: number = DEFAULT_SEED,
  today: Tick = DEMO_TODAY,
): DemoHistory {
  const todayMs = parseTick(today);
  const windowStart = todayMs - LAST_TICK * DAY_MS;
  const profile = SIZE_PROFILES[size];
  const builder = new OrgBuilder(seed, windowStart);
  buildOrganization(builder, profile);
  const replayed = planHistory(builder.finish(), profile.history, windowStart, seed);
  const ticks = replayed.mutations.map((mutations, index) => {
    const tick = formatTick(windowStart + index * DAY_MS);
    return { tick, readTime: `${tick}T00:00:00Z`, mutations };
  });
  if (ticks.length !== HISTORY_TICKS) throw new Error('the history must have 35 ticks');
  return { size, seed, today, base: replayed.base, ticks };
}

/** Today's demo organisation (the last tick of its history). */
export function generateOrganization(options: GenerateOptions): DemoOrganization {
  return snapshotAt(historyFor(options.size, options.seed, options.today), LAST_TICK);
}
