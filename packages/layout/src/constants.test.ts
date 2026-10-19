// SPDX-License-Identifier: Apache-2.0
/**
 * The tuning constants the rules files, the skills and the README state as numbers, pinned in one place so
 * a change is deliberate and lands with its documentation. The behaviour tests use the constants by name;
 * this table holds their values.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { RoutingSchema, SizingSchema, type Routing, type Sizing } from '@gcportrait/model';
import { DEFAULT_ROUTING, DEFAULT_SIZING } from './constants.js';
import type { Routing as PublicRouting, Sizing as PublicSizing } from './index.js';
import { LayoutInputError } from './errors.js';
import { resolveOptions } from './layout.js';
import { MEMO_CAPACITY } from './memo.js';
import { NEAR_TIE } from './pack.js';
import { HUG_DISTANCE, OVERSHOOT_LIMIT } from './testing/quality.js';
import { thrownBy } from './testing/errors.js';

describe('model sizing and routing contracts', () => {
  it('preserves public types, defaults and resolved values through JSON', () => {
    expectTypeOf<PublicSizing>().toEqualTypeOf<Sizing>();
    expectTypeOf<PublicRouting>().toEqualTypeOf<Routing>();
    const defaults = resolveOptions();
    const overridden = resolveOptions({
      sizing: { cardHeight: 44.5, gapHorizontal: 0, shallowHeaderMaxDepth: 1.5 },
      routing: { lanePitch: 0.5, wideningRounds: 1.5, oneRoundWork: 5, singlePassWork: 1, hugFactor: 0 },
    });
    for (const sizing of [DEFAULT_SIZING, defaults.sizing, overridden.sizing]) {
      expect(SizingSchema.parse(sizing)).toEqual(sizing);
      expect(JSON.stringify(SizingSchema.parse(sizing))).toBe(JSON.stringify(sizing));
      expect(SizingSchema.parse(JSON.parse(JSON.stringify(sizing)))).toEqual(sizing);
    }
    for (const routing of [DEFAULT_ROUTING, defaults.routing, overridden.routing]) {
      expect(RoutingSchema.parse(routing)).toEqual(routing);
      expect(JSON.stringify(RoutingSchema.parse(routing))).toBe(JSON.stringify(routing));
      expect(RoutingSchema.parse(JSON.parse(JSON.stringify(routing)))).toEqual(routing);
    }
    expect(defaults.sizing).toEqual(DEFAULT_SIZING);
    expect(defaults.routing).toEqual(DEFAULT_ROUTING);
    expect(overridden.sizing).toEqual({
      ...DEFAULT_SIZING,
      cardHeight: 44.5,
      gapHorizontal: 0,
      shallowHeaderMaxDepth: 1.5,
    });
    expect(overridden.routing).toEqual({
      ...DEFAULT_ROUTING,
      lanePitch: 0.5,
      wideningRounds: 1.5,
      oneRoundWork: 5,
      singlePassWork: 1,
      hugFactor: 0,
    });
  });

  it.each([
    [{ gapHorizontal: -0.5 }, 'sizing.gapHorizontal'],
    [{ cardHeight: 0 }, 'sizing.cardHeight'],
    [{ cardMinWidth: 300 }, 'sizing.cardMinWidth'],
    [{ chipMinWidth: 300 }, 'sizing.chipMinWidth'],
  ] as const)('leaves sizing policy to resolveOptions for %j', (override, field) => {
    const sizing = { ...DEFAULT_SIZING, ...override };
    expect(SizingSchema.parse(sizing)).toEqual(sizing);
    const error = thrownBy(() => resolveOptions({ sizing: override }), LayoutInputError);
    expect(error.code).toBe('invalid-option');
    expect(error.ids).toContain(field);
  });

  it.each([
    [{ laneCost: -0.5 }, 'routing.laneCost'],
    [{ lanePitch: 0 }, 'routing.lanePitch'],
    [{ portSpacing: 0 }, 'routing.portSpacing'],
    [{ fallbackGrid: 0 }, 'routing.fallbackGrid'],
  ] as const)('leaves routing policy to resolveOptions for %j', (override, field) => {
    const routing = { ...DEFAULT_ROUTING, ...override };
    expect(RoutingSchema.parse(routing)).toEqual(routing);
    const error = thrownBy(() => resolveOptions({ routing: override }), LayoutInputError);
    expect(error.code).toBe('invalid-option');
    expect(error.ids).toContain(field);
  });
});

describe('documented constants', () => {
  it.each([
    ['NEAR_TIE (skill gcp-diagram-layout §4: near ties within 2 %)', NEAR_TIE, 0.02],
    [
      'DEFAULT_ROUTING.singlePassWork (skill gcp-diagram-layout §5: 420 000 settled states)',
      DEFAULT_ROUTING.singlePassWork,
      420_000,
    ],
    [
      'DEFAULT_ROUTING.oneRoundWork (skill gcp-diagram-layout §5: 340 000 settled states)',
      DEFAULT_ROUTING.oneRoundWork,
      340_000,
    ],
    ['MEMO_CAPACITY (README "Worker": the last eight Layouts)', MEMO_CAPACITY, 8],
    [
      'DEFAULT_SIZING.zoneTitleMaxWidth (skill gcp-diagram-layout §3: 660 px, 3 × the widest card)',
      DEFAULT_SIZING.zoneTitleMaxWidth,
      3 * DEFAULT_SIZING.cardMaxWidth,
    ],
    ['HUG_DISTANCE (src/testing/quality.ts: a segment within 20 px of a border hugs it)', HUG_DISTANCE, 20],
    ['OVERSHOOT_LIMIT (README: routes more than 1 000 px past both ends)', OVERSHOOT_LIMIT, 1000],
  ])('%s', (_name, value, documented) => {
    expect(value).toBe(documented);
  });
});
