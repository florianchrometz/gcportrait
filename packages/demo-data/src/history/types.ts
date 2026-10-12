// SPDX-License-Identifier: MIT
/** The public shape of a demo organisation's 35-day history. */
import type { Asset, DemoSize, Tick } from '@gcportrait/model';

/** One change between two consecutive ticks. */
export type Mutation =
  | { readonly kind: 'add'; readonly asset: Asset }
  | { readonly kind: 'remove'; readonly name: string; readonly assetType: string }
  | {
      readonly kind: 'change';
      /** The asset as it is after the change (new `updateTime`). */
      readonly asset: Asset;
      /** Dotted paths inside `data` that changed. */
      readonly fields: readonly string[];
    };

export interface HistoryTick {
  /** The UTC day, `YYYY-MM-DD`. */
  readonly tick: Tick;
  /** `<tick>T00:00:00Z`: the CAI read time of this tick. */
  readonly readTime: string;
  /** What happened since the previous tick (during the day before `tick`); empty for the first tick. */
  readonly mutations: readonly Mutation[];
}

export interface DemoHistory {
  readonly size: DemoSize;
  readonly seed: number;
  /** The last tick. */
  readonly today: Tick;
  /** The organisation at the first tick, sorted by name. */
  readonly base: readonly Asset[];
  /** 35 ticks, oldest first; the last one is `today`. */
  readonly ticks: readonly HistoryTick[];
}

/** One state of a demo organisation: the assets at one tick. */
export interface DemoOrganization {
  readonly size: DemoSize;
  readonly seed: number;
  readonly tick: Tick;
  readonly readTime: string;
  /** Sorted by name. */
  readonly assets: readonly Asset[];
}
