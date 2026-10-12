// SPDX-License-Identifier: MIT
/**
 * What choosing a search result does (skill gcp-diagram-style §6 "Search hit"): the decision table.
 * Pure: the facts about the node in the current view come in (locate.ts works them out in the data worker,
 * with the scene builder), the decision goes out.
 *
 * | The node in the current view | Decision |
 * |---|---|
 * | drawn as itself | jump: select it, glide 200 ms to centre, pulse |
 * | inside collapsed zones (a chip shows it) | expand: flip those zones open (flips in the hash), then jump |
 * | not drawn, outside the drill-in root or the focus | offer "drill in to <its container>" |
 * | not drawn, its type not in the lens | offer "include <type>" or "switch to the Everything lens" |
 * | not drawn, its type hidden by default (role `hidden`) | offer "include <type>" or the Everything lens |
 * | not drawn, its type's hidden-by-default rule matched it | offer the Everything lens (only `showHidden` draws those) |
 * | not drawn, its type excluded by the filters | offer "include <type>" (it also lifts the exclusion) |
 * | several of these at once | each offer combines the steps (drill in and switch lens) |
 * | filters set (regions, projects, folders, depth, hide switches, identities off) | each offer again with "clear the filters" after it; alone when nothing else is the cause |
 * | none of these | unavailable: say so, change nothing |
 *
 * An offer is a candidate until the data worker has built its view and found the node in it (locate.ts drops
 * the others, and a "clear the filters" variant whose offer already works without it).
 */

/** One part of a view change that brings a node into the view. */
export type RevealStep = 'drill-in' | 'everything-lens' | 'include-type' | 'clear-filters';

export interface RevealFacts {
  /** How the current view shows the node: as itself, inside a chip, or not at all. */
  readonly shown: 'self' | 'chip' | 'absent';
  /** For `chip`: flipping the zones around it open shows it as itself. */
  readonly expandable: boolean;
  /** The view is drilled into a container that does not hold the node (or into the node itself). */
  readonly outsideRoot: boolean;
  /** A focus view applies and the node is not part of it. */
  readonly outsideFocus: boolean;
  /** The lens (or the `includeTypes` filter) lists its type, does not, or `excludeTypes` removes it. */
  readonly lens: 'listed' | 'unlisted' | 'excluded';
  /** Hidden in this lens: its type's role is `hidden`, or the type's `hiddenWhen` rule matched it. */
  readonly hidden: 'no' | 'role' | 'when';
  /** Filters that can remove it are set (regions, projects, folders, depth, the hide switches, identities off). */
  readonly filtered: boolean;
}

export type RevealDecision =
  | { readonly kind: 'jump' }
  | { readonly kind: 'expand' }
  /** Candidate view changes, best first, each a list of steps applied in order. */
  | { readonly kind: 'offer'; readonly candidates: readonly (readonly RevealStep[])[] }
  | { readonly kind: 'unavailable' };

/** The ways to get the node's type drawn, best first; `[[]]` when its type is not why it is missing. */
function typeAlternatives(facts: RevealFacts): RevealStep[][] {
  if (facts.lens === 'excluded') {
    return [facts.hidden === 'when' ? ['include-type', 'everything-lens'] : ['include-type']];
  }
  if (facts.hidden === 'when') return [['everything-lens']];
  if (facts.hidden === 'role') return [['include-type'], ['everything-lens']];
  if (facts.lens === 'unlisted') return [['everything-lens'], ['include-type']];
  return [[]];
}

export function decideReveal(facts: RevealFacts): RevealDecision {
  if (facts.shown === 'self') return { kind: 'jump' };
  if (facts.shown === 'chip' && facts.expandable) return { kind: 'expand' };
  // A chip that flips cannot open (never expected) is drilled into, like a node outside the root.
  const scope: RevealStep[] =
    facts.outsideRoot || facts.outsideFocus || facts.shown === 'chip' ? ['drill-in'] : [];
  const primary = typeAlternatives(facts)
    .map((steps) => [...scope, ...steps])
    .filter((steps) => steps.length > 0);
  const cleared: RevealStep[][] = !facts.filtered
    ? []
    : primary.length === 0
      ? [['clear-filters']]
      : primary.map((steps) => [...steps, 'clear-filters']);
  const candidates = [...primary, ...cleared];
  return candidates.length === 0 ? { kind: 'unavailable' } : { kind: 'offer', candidates };
}
