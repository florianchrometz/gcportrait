// SPDX-License-Identifier: Apache-2.0
/**
 * The drawer's words: direction arrows and what they say to assistive technology, the short explanation of
 * each kind of dangling reference, and the "What changed" section's lines. The relation kinds' own
 * wording is the legend's (`relationLabel`, from the model's relation table), so the drawer and the legend name a
 * kind alike.
 */
import type { ChangeStatus, DanglingEntry, RelationDirection } from './types';

/** The arrow drawn before a relation's target, seen from the selected node. */
export const DIRECTION_ARROWS: Readonly<Record<RelationDirection, string>> = {
  out: '→',
  in: '←',
  both: '↔',
};

/** What the arrow says to assistive technology ("to subnet-a", "from web-fr", "with vpc-b"). */
export const DIRECTION_WORDS: Readonly<Record<RelationDirection, string>> = {
  out: 'to',
  in: 'from',
  both: 'with',
};

/** Why a reference names nothing in the snapshot, in a sentence. */
export function danglingExplanation(entry: DanglingEntry): string {
  switch (entry.reason) {
    case 'outside-project':
      return `Project ${entry.project ?? ''} is not in this snapshot: a public project (images, licences), a Google-managed tenant project, or a project outside the scope.`;
    case 'missing':
      return 'No asset with this name is in the snapshot: it is outside the scope, was not exported, or no longer exists.';
    case 'identity':
      return 'No service account in the snapshot has this e-mail: a Google-managed service agent, or an account of a project outside the scope.';
    case 'unreadable':
      return 'The catalog could not read this value as a resource name, so it matches no asset.';
  }
}

/** The status line when a jump's target is not drawn in the view, whatever opens. */
export function notDrawnText(label: string): string {
  return `${label} is not drawn in this view: the lens, a filter, the focus or the drill-in leaves it out.`;
}

/**
 * The "What changed" section's first line: how the node itself changed, with the day compared with
 * (`since`: "since 2026-09-07", or "compared with 2026-09-09" when the view stepped back to an earlier day).
 */
export function changeStatusText(status: ChangeStatus, since: string): string {
  switch (status) {
    case 'added':
      return `Added ${since}.`;
    case 'removed':
      return `Removed ${since}: it is not in this day’s data.`;
    case 'changed':
      return `Changed ${since}: its update time moved.`;
    case 'unchanged':
      return `Not changed itself ${since}.`;
  }
}

/** The heading of a list of what changed inside a container ("Added inside"). */
export const INSIDE_HEADINGS: Readonly<Record<'added' | 'removed' | 'changed', string>> = {
  added: 'Added inside',
  removed: 'Removed inside',
  changed: 'Changed inside',
};

/** The status line when a jump goes to a removed node the view draws no ghost of. */
export function noGhostText(label: string, since: string): string {
  return `${label} was removed ${since}; this view draws no ghost of it (it was inside a collapsed zone or left out).`;
}

/** The note for a selected node that is not in the day's data because it was removed (a ghost's). */
export function removedNodeNote(since: string): string {
  return `Not an asset of this day: it was removed ${since}. “What changed” shows it as it was.`;
}
