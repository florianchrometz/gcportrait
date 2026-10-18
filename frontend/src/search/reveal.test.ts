// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * The fallback decision table of a chosen search result (reveal.ts): every row, and the order of the offers.
 */
import { describe, expect, it } from 'vitest';

import { decideReveal, type RevealDecision, type RevealFacts } from './reveal';

/** A node the view leaves out for no reason yet (each row sets its own). */
const ABSENT: RevealFacts = {
  shown: 'absent',
  expandable: false,
  outsideRoot: false,
  outsideFocus: false,
  lens: 'listed',
  hidden: 'no',
  filtered: false,
};

const rows: readonly [string, Partial<RevealFacts>, RevealDecision][] = [
  ['drawn as itself → jump', { shown: 'self' }, { kind: 'jump' }],
  [
    'drawn as itself wins over every other fact',
    { shown: 'self', outsideRoot: true, lens: 'unlisted', filtered: true },
    { kind: 'jump' },
  ],
  ['inside chips that open → expand', { shown: 'chip', expandable: true }, { kind: 'expand' }],
  [
    'inside a chip that does not open → drill in',
    { shown: 'chip', expandable: false },
    { kind: 'offer', candidates: [['drill-in']] },
  ],
  ['outside the root → drill in', { outsideRoot: true }, { kind: 'offer', candidates: [['drill-in']] }],
  ['outside the focus → drill in', { outsideFocus: true }, { kind: 'offer', candidates: [['drill-in']] }],
  [
    'type not in the lens → Everything lens, or include the type',
    { lens: 'unlisted' },
    { kind: 'offer', candidates: [['everything-lens'], ['include-type']] },
  ],
  [
    'hidden-role type → include the type, or the Everything lens',
    { hidden: 'role' },
    { kind: 'offer', candidates: [['include-type'], ['everything-lens']] },
  ],
  [
    'hidden by its type rule → only the Everything lens (showHidden)',
    { hidden: 'when' },
    { kind: 'offer', candidates: [['everything-lens']] },
  ],
  [
    'type excluded by the filters → include the type (lifts the exclusion)',
    { lens: 'excluded' },
    { kind: 'offer', candidates: [['include-type']] },
  ],
  [
    'type excluded and hidden by its rule → include it and switch lens',
    { lens: 'excluded', hidden: 'when' },
    { kind: 'offer', candidates: [['include-type', 'everything-lens']] },
  ],
  [
    'outside the root and not in the lens → combined offers, drill-in first',
    { outsideRoot: true, lens: 'unlisted' },
    {
      kind: 'offer',
      candidates: [
        ['drill-in', 'everything-lens'],
        ['drill-in', 'include-type'],
      ],
    },
  ],
  [
    'only filters → clear the filters',
    { filtered: true },
    { kind: 'offer', candidates: [['clear-filters']] },
  ],
  [
    'filters with another cause → each offer again with the filters cleared, after the plain ones',
    { outsideFocus: true, filtered: true },
    { kind: 'offer', candidates: [['drill-in'], ['drill-in', 'clear-filters']] },
  ],
  [
    'hidden role under filters → four candidates in order',
    { hidden: 'role', filtered: true },
    {
      kind: 'offer',
      candidates: [
        ['include-type'],
        ['everything-lens'],
        ['include-type', 'clear-filters'],
        ['everything-lens', 'clear-filters'],
      ],
    },
  ],
  ['no cause at all → unavailable', {}, { kind: 'unavailable' }],
];

describe('decideReveal (the fallback decision table)', () => {
  it.each(rows)('%s', (_name, facts, decision) => {
    expect(decideReveal({ ...ABSENT, ...facts })).toEqual(decision);
  });

  it('never offers an empty change', () => {
    const lens = ['listed', 'unlisted', 'excluded'] as const;
    const hidden = ['no', 'role', 'when'] as const;
    for (const outsideRoot of [false, true]) {
      for (const outsideFocus of [false, true]) {
        for (const filtered of [false, true]) {
          for (const l of lens) {
            for (const h of hidden) {
              const decision = decideReveal({
                ...ABSENT,
                outsideRoot,
                outsideFocus,
                filtered,
                lens: l,
                hidden: h,
              });
              if (decision.kind !== 'offer') continue;
              for (const steps of decision.candidates) expect(steps.length).toBeGreaterThan(0);
              expect(new Set(decision.candidates.map((steps) => steps.join('+'))).size).toBe(
                decision.candidates.length,
              );
            }
          }
        }
      }
    }
  });
});
