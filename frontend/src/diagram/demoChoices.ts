// SPDX-License-Identifier: Apache-2.0
/**
 * The demo organisations the app offers: the snapshot menu and the empty canvas list them, beside the
 * stored snapshots.
 */
import {
  encodeViewSpec,
  type DemoSize,
  type SnapshotRef,
  type ViewSpec,
  type ViewSpecInput,
} from '@gcportrait/model';

export const DEMO_CHOICES: ReadonlyArray<{ readonly size: DemoSize; readonly label: string }> = [
  { size: 'S', label: 'Demo organisation S (small)' },
  { size: 'M', label: 'Demo organisation M (medium)' },
  { size: 'L', label: 'Demo organisation L (large)' },
];

/**
 * The view of another snapshot: the lens and the detail level are kept; everything tied to the previous
 * snapshot (tick, root, focus, filters, flips, selection, highlight) is not.
 */
export function snapshotView(ref: SnapshotRef, current: ViewSpec): ViewSpecInput {
  return { snapshot: ref, lens: current.lens, detail: current.detail };
}

/** The hash of a view of a demo organisation (without the `#`), as `snapshotView` makes it. */
export function demoViewHash(size: DemoSize, current: ViewSpec): string {
  return encodeViewSpec(snapshotView(`demo:${size}`, current));
}
