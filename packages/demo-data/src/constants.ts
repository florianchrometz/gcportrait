// SPDX-License-Identifier: MIT
/** Public constants of the demo organisations. */
import type { DemoSize } from '@gcportrait/model';

export const DEMO_SIZES: readonly DemoSize[] = ['S', 'M', 'L', 'XL'];

/** The seed the fixtures and the app's demo mode use. */
export const DEFAULT_SEED = 1;

/** The last tick of the committed fixtures (a fixed date). The app may pass the real date instead. */
export const DEMO_TODAY = '2026-10-08';

/** Today and the 34 days before it. */
export const HISTORY_TICKS = 35;

/**
 * Each demo organisation's number: one per size, so the timelines of two sizes are two scopes and an export of
 * demo M is an extra tick of demo M's timeline only, not of S's, L's or XL's.
 * Synthetic, below 100000000000; S keeps the number all sizes shared before.
 */
export const DEMO_ORGANIZATION_IDS: Readonly<Record<DemoSize, string>> = Object.freeze({
  S: '30000000001',
  M: '30000000002',
  L: '30000000003',
  XL: '30000000004',
});

export { ORGANIZATION_DOMAIN as DEMO_ORGANIZATION_DOMAIN } from './topology/kit.js';
