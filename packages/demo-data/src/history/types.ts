// SPDX-License-Identifier: MIT
/**
 * The public shape of a demo organisation's 35-day history. Its schemas are in `@gcportrait/model`, so the
 * history is declared once; `DemoOrganization` is the shape of one replayed day.
 */
import type { Asset, DemoSize, Tick } from '@gcportrait/model';

export type { DemoHistory, HistoryTick, Mutation } from '@gcportrait/model';

/** One state of a demo organisation: the assets at one tick. */
export interface DemoOrganization {
  readonly size: DemoSize;
  readonly seed: number;
  readonly tick: Tick;
  readonly readTime: string;
  /** Sorted by name. */
  readonly assets: readonly Asset[];
}
