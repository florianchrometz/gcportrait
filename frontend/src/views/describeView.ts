// SPDX-License-Identifier: MIT
/**
 * One line that says what a view shows, for the saved-view list and a new saved view's suggested name: its
 * snapshot, lens, detail level, focus, drill-in root and how many filters are on. Pure.
 */
import { decodeViewSpec, type LensId, type SnapshotRef, type ViewSpec } from '@gcportrait/model';

import { activeFilterCount } from './filterForm';
import { FOCUS_KINDS, focusValue } from './focusForm';

export interface ViewWords {
  /** A snapshot's name ("Demo organisation M (medium)"); the ref when unknown. */
  readonly snapshot: (ref: SnapshotRef) => string;
  /** A lens's title ("Load balancing"). */
  readonly lens: (id: LensId) => string;
  /** A drill-in root's name ("Production"); its id's last segment when absent or unknown. */
  readonly root?: (id: string) => string | undefined;
}

function lastSegment(id: string): string {
  return id.slice(id.lastIndexOf('/') + 1);
}

/** The parts of a view worth naming, each a few words. */
export function viewParts(spec: ViewSpec, words: ViewWords): string[] {
  const parts = [
    spec.snapshot === '' ? 'no snapshot' : words.snapshot(spec.snapshot),
    `${words.lens(spec.lens)} lens`,
  ];
  if (spec.detail !== 'auto') parts.push(`${spec.detail} detail`);
  if (spec.focus !== undefined) {
    const kind = FOCUS_KINDS.find((entry) => entry.value === spec.focus?.kind)?.label ?? spec.focus.kind;
    const value = focusValue(spec.focus);
    parts.push(`focus ${kind.toLowerCase()}${value === null ? '' : ` ${lastSegment(value)}`}`);
  }
  if (spec.root !== undefined) parts.push(`in ${words.root?.(spec.root) ?? lastSegment(spec.root)}`);
  const filters = activeFilterCount(spec.filters);
  if (filters > 0) parts.push(`${String(filters)} filter${filters === 1 ? '' : 's'}`);
  if (spec.tick !== undefined) parts.push(`on ${spec.tick}`);
  return parts;
}

/** A saved view's summary line from its hash. */
export function describeViewHash(hash: string, words: ViewWords): string {
  return viewParts(decodeViewSpec(hash), words).join(' · ');
}

/** A name to suggest for saving the view: its lens, focus and root, without the snapshot. */
export function suggestViewName(spec: ViewSpec, words: ViewWords): string {
  return viewParts(spec, words).slice(1).join(' · ');
}
