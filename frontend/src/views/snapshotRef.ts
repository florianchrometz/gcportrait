// SPDX-License-Identifier: Apache-2.0
/**
 * A `snapshot=` value the URL hash holds but the codec rejected: the codec turns any malformed value into
 * "no snapshot" (`@gcportrait/model`, decodeViewSpec never throws), so the diagram page asks here whether the
 * link named one, to say so instead of "Nothing to draw yet". Pure.
 */
import { decodeViewSpec } from '@gcportrait/model';

/** The rejected `snapshot` value of `hash` (without `#`), or null when it names none or a valid one. */
export function rejectedSnapshotRef(hash: string): string | null {
  if (decodeViewSpec(hash).snapshot !== '') return null;
  const field = hash
    .split('&')
    .find((part) => part.startsWith('snapshot='))
    ?.slice('snapshot='.length);
  if (field === undefined || field === '') return null;
  try {
    return decodeURIComponent(field);
  } catch {
    return field;
  }
}
