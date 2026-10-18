// SPDX-License-Identifier: Apache-2.0
/**
 * The search's words on screen: group headings, a result's second line, the result count, and why a node is
 * not in the view and what each offer does (the reveal dialog). Pure.
 */
import type { MatchField, RevealContext, SearchHit, SearchKind } from './protocol';
import type { RevealFacts, RevealStep } from './reveal';

/** The group headings, by kind. */
export const KIND_LABELS: Readonly<Record<SearchKind, string>> = {
  folder: 'Folders',
  project: 'Projects',
  network: 'Networks',
  container: 'Containers',
  resource: 'Resources',
};

const MATCH_PREFIX: Readonly<Partial<Record<MatchField, string>>> = {
  ip: 'IP ',
  domain: '',
  displayName: 'display name ',
  name: 'name ',
  ancestor: 'in ',
};

/** A result's second line: type, project, what matched when it is not the label, and "hidden by default". */
export function hitDescription(hit: SearchHit): string {
  const parts = [hit.typeName];
  if (hit.project !== undefined) parts.push(hit.project);
  const prefix = hit.match === undefined ? undefined : MATCH_PREFIX[hit.match.field];
  if (hit.match !== undefined && prefix !== undefined && hit.match.value !== hit.label) {
    parts.push(`${prefix}${hit.match.value}`);
  }
  if (hit.hidden) parts.push('hidden by default');
  return parts.join(' · ');
}

/** The status line: how many nodes matched, and how many of them are listed. */
export function resultCount(total: number, listed: number): string {
  if (total === 0) return 'No results';
  const count = total === 1 ? '1 result' : `${String(total)} results`;
  return listed < total ? `${count}, the first ${String(listed)} listed` : count;
}

/** Why a node is not in the view, one sentence per fact. */
export function revealReasons(facts: RevealFacts, context: RevealContext): string[] {
  const reasons: string[] = [];
  if (facts.outsideRoot) {
    reasons.push(
      context.root === undefined
        ? 'It is outside the container this view is drilled into.'
        : `It is outside ${context.root}, the container this view is drilled into.`,
    );
  }
  if (facts.outsideFocus) reasons.push('It is not part of the focus view.');
  if (facts.lens === 'unlisted') {
    reasons.push(`The ${context.lensTitle} lens does not draw the type ${context.typeName}.`);
  }
  if (facts.lens === 'excluded') reasons.push(`The filters exclude the type ${context.typeName}.`);
  if (facts.hidden === 'role') reasons.push(`The type ${context.typeName} is hidden by default.`);
  if (facts.hidden === 'when') {
    reasons.push('It is hidden by default; only a lens that shows hidden types draws it.');
  }
  if (facts.filtered) reasons.push('The filters may leave it out.');
  if (facts.shown === 'chip') reasons.push('The collapsed zone around it cannot be opened in this view.');
  if (reasons.length === 0) reasons.push('This view leaves it out.');
  return reasons;
}

function stepPhrase(step: RevealStep, context: RevealContext): string {
  switch (step) {
    case 'drill-in':
      return context.drillTarget === undefined
        ? 'show the whole organisation'
        : `show details of ${context.drillTarget}`;
    case 'everything-lens':
      return `switch to the ${context.everythingTitle} lens`;
    case 'include-type':
      return `include the type ${context.typeName}`;
    case 'clear-filters':
      return 'clear the filters';
  }
}

/** An offer's button text: its steps in order ("Show details of demo-web-1 and switch to the Everything lens"). */
export function offerLabel(steps: readonly RevealStep[], context: RevealContext): string {
  const phrases = steps.map((step) => stepPhrase(step, context));
  const last = phrases.at(-1) ?? '';
  const text = phrases.length <= 1 ? last : `${phrases.slice(0, -1).join(', ')} and ${last}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
