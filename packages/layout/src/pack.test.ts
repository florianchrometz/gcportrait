// SPDX-License-Identifier: MIT
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SIZING } from './constants.js';
import type { LayoutNode } from './normalise.js';
import {
  NEAR_TIE,
  STACK_LIMIT,
  arrangementProblem,
  cellsOf,
  chooseArrangement,
  nearTieRanksBefore,
  frameArea,
  packChildren,
  ranksBefore,
  type Gaps,
  type PackTarget,
} from './pack.js';
import { layoutNode } from './testing/nodes.js';
import { arrangements, frameArea as oracleFrameArea, type Child } from './testing/oracle.js';
import type { RectRole } from './types.js';

function node(id: string, role: RectRole, width: number, height: number): LayoutNode {
  return layoutNode({ id, role, width, height, index: -1 });
}

const NO_GAPS: Gaps = { horizontal: 0, vertical: 0 };
/** The gaps a layout packs with, which are also the oracle's (src/testing/oracle.ts). */
const GAPS: Gaps = { horizontal: DEFAULT_SIZING.gapHorizontal, vertical: DEFAULT_SIZING.gapVertical };
const TARGET: PackTarget = { aspect: 1.6, tolerance: 0.2 };
const cards = (n: number, width = 100, height = 100): LayoutNode[] =>
  Array.from({ length: n }, (_, i) => node(`c${String(i)}`, 'card', width, height));
const chips = (n: number): LayoutNode[] =>
  Array.from({ length: n }, (_, i) => node(`z${String(i)}`, 'chip', 148, 44));

/** A box's frame, by the oracle (src/testing/oracle.ts), independently of src/pack.ts. */
const frameOf = (width: number, height: number, target: PackTarget): number =>
  oracleFrameArea(width, height, target.aspect, target.tolerance);

/**
 * The smallest frame over every tidy arrangement of 44 px cards and zones, by the oracle (which packs with
 * `DEFAULT_SIZING`'s gaps, as `GAPS` does): every card column count × every split of the zones into rows, those with
 * full rows, and of them the ones oriented like the target when any is.
 */
function bruteForceFrame(
  cardWidths: readonly number[],
  zones: readonly { width: number; height: number }[],
  target: PackTarget,
): number {
  const children: Child[] = [
    ...cardWidths.map((width) => ({ width, height: 44, card: true })),
    ...zones.map((zone) => ({ ...zone, card: false })),
  ];
  const tidy = arrangements(children).filter((arrangement) => arrangement.full);
  const sameSide = (o: { width: number; height: number }): boolean =>
    target.aspect >= 1 ? o.width >= o.height : o.width <= o.height;
  const pool = tidy.some(sameSide) ? tidy.filter(sameSide) : tidy;
  return Math.min(...pool.map((o) => frameOf(o.width, o.height, target)));
}

describe('chooseArrangement', () => {
  it('returns nothing for no children', () => {
    expect(chooseArrangement([], [], TARGET, GAPS)).toBeUndefined();
  });

  it('picks the grid inside the tolerance band, the most compact there', () => {
    // 12 squares: 3 columns 0.75, 4 columns 1.33, 5 columns (5, 5, 2) 1.67, 6 columns 3. Both 4 and 5 columns
    // are inside [1.28, 1.92]; 4 columns (400 × 300) is more compact than 5 (500 × 300).
    expect(chooseArrangement(cards(12), [], TARGET, NO_GAPS)).toEqual({
      arrangement: { cardColumns: 4, zoneRows: [] },
      width: 400,
      height: 300,
    });
    // With a target of 3 only 6 columns (600 × 200) is inside the band.
    expect(chooseArrangement(cards(12), [], { aspect: 3, tolerance: 0.2 }, NO_GAPS)?.arrangement).toEqual({
      cardColumns: 6,
      zoneRows: [],
    });
  });

  it('counts gaps and column widths in the aspect', () => {
    const items = [
      node('a', 'card', 220, 44),
      node('b', 'card', 148, 44),
      node('c', 'card', 148, 44),
      node('d', 'card', 148, 44),
      node('e', 'card', 148, 44),
      node('f', 'card', 148, 44),
    ];
    // 2 columns: (220 + 24 + 148) × (3 × 44 + 2 × 20) = 392 × 172 (2.28); 3 columns: 564 × 108 (5.2).
    expect(chooseArrangement(items, [], TARGET, GAPS)).toMatchObject({ width: 392, height: 172 });
  });

  it('keeps small sets of wide boxes wider than tall (skill §1) instead of stacking them', () => {
    // Four chips: a column is 148 × 236 (0.63), a 2 × 2 grid 320 × 108 (2.96). Neither reaches the band; the
    // column is taller than wide, so the 2 × 2 grid wins.
    expect(chooseArrangement([], chips(4), TARGET, GAPS)?.arrangement.zoneRows).toEqual([2, 2]);
    // Three chips: 2 + 1 (320 × 108) rather than a column (0.86) or one long row (492 × 44, a larger frame).
    expect(chooseArrangement([], chips(3), TARGET, GAPS)?.arrangement.zoneRows).toEqual([2, 1]);
    // Two chips: a column of two is already wider than tall (148 × 108, 1.37, inside the band).
    expect(chooseArrangement([], chips(2), TARGET, GAPS)?.arrangement.zoneRows).toEqual([1, 1]);
  });

  it('stacks tall boxes side by side when no arrangement is wider than tall', () => {
    const tall = [node('a', 'zone', 100, 400), node('b', 'zone', 100, 400)];
    // Side by side 224 × 400 (0.56) beats a stack of 100 × 820 (0.12): neither is oriented, both compete.
    expect(chooseArrangement([], tall, TARGET, GAPS)?.arrangement.zoneRows).toEqual([2]);
  });

  it('fills every row: no wide card strip above a narrow stack of zones (skill §9)', () => {
    // 15 cards and 8 small zones. A 7-column card strip above the zones stacked in one column averages to
    // 1.6 but leaves most of the box empty; full rows make the zones fill the card block's width.
    const zones = Array.from({ length: 8 }, (_, i) => node(`z${String(i)}`, 'empty', 180, 44));
    const result = chooseArrangement(cards(15, 200, 44), zones, TARGET, GAPS);
    expect(result).toBeDefined();
    const { cardColumns, zoneRows } = result?.arrangement ?? { cardColumns: 0, zoneRows: [] };
    const cardWidth = cardColumns * 200 + (cardColumns - 1) * 24;
    // Every zone row but the last is full at the box width.
    for (const length of zoneRows.slice(0, -1)) {
      expect(length * 180 + length * 24 + 180).toBeGreaterThan(Math.max(cardWidth, result?.width ?? 0));
    }
    expect(zoneRows.length).toBeLessThanOrEqual(3);
  });

  it('fills every row: a card column is added whenever it fits within the box', () => {
    const zones = (): LayoutNode[] =>
      Array.from({ length: 3 }, (_, i) => node(`e${String(i)}`, 'empty', 187, 44));
    // Three cards and three empty zones, all 150 wide: two cards over two zones per row (324 × 236, 1.37).
    // One card column over zone rows of two would leave room for a second column (324 ≤ 324), and two
    // card columns over a stack of zones would leave room for a second zone in each row: neither is full.
    const equal = Array.from({ length: 3 }, (_, i) => node(`e${String(i)}`, 'empty', 150, 44));
    expect(chooseArrangement(cards(3, 150, 44), equal, TARGET, GAPS)).toEqual({
      arrangement: { cardColumns: 2, zoneRows: [2, 1] },
      width: 324,
      height: 236,
    });
    // Cards of 193: two columns need 410, more than the 398 the zone rows take, so one column is full; it is
    // inside the band (398 × 236, 1.69) where two columns are not (410 × 172, 2.38).
    expect(chooseArrangement(cards(2, 193, 44), zones(), TARGET, GAPS)).toEqual({
      arrangement: { cardColumns: 1, zoneRows: [2, 1] },
      width: 398,
      height: 236,
    });
  });

  it('leaves the band when no tidy arrangement reaches it, with the smallest frame', () => {
    // Three cards over one empty zone (wide boxes): no tidy arrangement reaches [1.28, 1.92]; two card columns
    // over the zone (464 × 172, 2.70) needs the smallest frame of the target's aspect.
    const result = chooseArrangement(cards(3, 220, 44), [node('e', 'empty', 220, 44)], TARGET, GAPS);
    expect(result).toEqual({ arrangement: { cardColumns: 2, zoneRows: [1] }, width: 464, height: 172 });
  });

  it('finds the best tidy arrangement among every card column count and every split of the zones', () => {
    // Brute force: every card column count × every composition of the zones into consecutive rows, keeping
    // those with full rows and (when any is) wider than tall; the packer must reach the smallest frame.
    const size = fc.record({
      width: fc.integer({ min: 40, max: 400 }),
      height: fc.integer({ min: 20, max: 300 }),
    });
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 148, max: 220 }), { maxLength: 6 }),
        fc.array(size, { maxLength: 8 }),
        fc.double({ min: 0.6, max: 3, noNaN: true }),
        (cardWidths, zoneSizes, aspect) => {
          fc.pre(cardWidths.length + zoneSizes.length > 0);
          const cardNodes = cardWidths.map((width, i) => node(`c${String(i)}`, 'card', width, 44));
          const zoneNodes = zoneSizes.map((z, i) => node(`z${String(i)}`, 'zone', z.width, z.height));
          const target = { aspect, tolerance: 0.2 };
          const plain = chooseArrangement(cardNodes, zoneNodes, target, GAPS, { stacks: false });
          const best = bruteForceFrame(cardWidths, zoneSizes, target);
          expect(plain).toBeDefined();
          // Within the near-tie margin of the smallest frame, and at it unless that one is an inverted grid.
          // (Among near ties a grid that does not grow downwards, then one with fewer rows, ranks first.)
          const frame = frameOf(plain?.width ?? 0, plain?.height ?? 1, target);
          expect(frame).toBeLessThanOrEqual(best * (1 + NEAR_TIE) + 1e-6);
          // Stacks only ever take a box inside the plain one's, with a smaller frame.
          const stacked = chooseArrangement(cardNodes, zoneNodes, target, GAPS);
          expect(stacked?.width).toBeLessThanOrEqual(plain?.width ?? 0);
          expect(stacked?.height).toBeLessThanOrEqual(plain?.height ?? 0);
          expect(frameOf(stacked?.width ?? 0, stacked?.height ?? 1, target)).toBeLessThanOrEqual(
            frame + 1e-6,
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it('packs above the run-budget limit too', () => {
    const many = Array.from({ length: 130 }, (_, i) => node(`z${String(i)}`, 'chip', 148, 44));
    const result = chooseArrangement([], many, TARGET, GAPS);
    expect(result?.arrangement.zoneRows.reduce((a, b) => a + b, 0)).toBe(130);
    expect((result?.width ?? 0) / (result?.height ?? 1)).toBeGreaterThan(1.28);
  });
});

describe('stacks', () => {
  // A tall zone and two short ones after it: plain rows leave a band of empty space beside the short ones;
  // stacking the two short ones beside the tall one fits in the plain arrangement's box with a smaller frame.
  const tall = (): LayoutNode[] => [
    node('t', 'zone', 300, 300),
    node('a', 'zone', 200, 100),
    node('b', 'zone', 200, 100),
  ];

  it('stacks consecutive short zones beside a taller one when the box fits inside the plain one', () => {
    const plain = chooseArrangement([], tall(), TARGET, GAPS, { stacks: false });
    expect(plain).toEqual({ arrangement: { cardColumns: 0, zoneRows: [2, 1] }, width: 524, height: 420 });
    const stacked = chooseArrangement([], tall(), TARGET, GAPS);
    expect(stacked).toEqual({
      arrangement: { cardColumns: 0, zoneRows: [3], zoneStacks: [[1, 2]] },
      width: 524,
      height: 300,
    });
  });

  it('places a stack left-aligned, one zone above the other, and widens its gaps when asked', () => {
    const items = tall();
    const result = packChildren(items, TARGET, GAPS, undefined, { stacks: [[[], [6]]], zoneColumns: [[4]] });
    expect(items.map((item) => [item.id, item.x, item.y])).toEqual([
      ['t', 0, 0],
      ['a', 328, 0],
      ['b', 328, 126],
    ]);
    expect(result).toMatchObject({ width: 528, height: 300 });
    expect(cellsOf(result.arrangement)).toEqual([[1, 2]]);
  });

  it('never stacks a zone that would stand alone or be the tallest in its row', () => {
    // Two short zones under one tall one: as a row of one stack they would only be rows in disguise.
    const items = [node('a', 'zone', 200, 100), node('b', 'zone', 200, 100), node('c', 'zone', 200, 100)];
    expect(chooseArrangement([], items, TARGET, GAPS)?.arrangement.zoneStacks).toBeUndefined();
  });

  it('stacks nothing in a container with more than STACK_LIMIT zones', () => {
    const many = [node('t', 'zone', 300, 300), ...chips(STACK_LIMIT)];
    expect(chooseArrangement([], many, TARGET, GAPS)?.arrangement.zoneStacks).toBeUndefined();
  });
});

describe('near ties', () => {
  it('prefers rows that do not grow downwards when the frames differ by less than 2 %', () => {
    // [1, 2] frames 0.6 % smaller than [2, 1] only because the first chip is 1 px wider.
    const items = [node('a', 'chip', 150, 44), node('b', 'chip', 148, 44), node('c', 'chip', 149, 44)];
    expect(chooseArrangement([], items, TARGET, GAPS)?.arrangement.zoneRows).toEqual([2, 1]);
  });

  it('keeps the smaller frame when the difference is larger', () => {
    // [1, 2] is 9 % smaller: the first zone is much wider than the other two together.
    const items = [node('a', 'zone', 400, 44), node('b', 'zone', 160, 44), node('c', 'zone', 160, 44)];
    expect(chooseArrangement([], items, TARGET, GAPS)?.arrangement.zoneRows).toEqual([1, 2]);
  });

  it('ranks near ties by inversion first, then as before', () => {
    const base = { frame: 100, deviation: 0.5, rows: 2, cardColumns: 0 };
    expect(
      nearTieRanksBefore({ ...base, frame: 101, inverted: false }, { ...base, inverted: true }, 100),
    ).toBe(true);
    expect(
      nearTieRanksBefore({ ...base, frame: 103, inverted: false }, { ...base, inverted: true }, 100),
    ).toBe(false);
  });
});

describe('frameArea', () => {
  it('is the box inside the band and the target-shaped rectangle around it outside', () => {
    expect(frameArea(160, 100, TARGET)).toBe(16000);
    expect(frameArea(190, 100, TARGET)).toBe(19000); // 1.9: inside [1.28, 1.92]
    expect(frameArea(200, 100, TARGET)).toBe(200 * 125); // too wide: heightened to 200 / 1.6
    expect(frameArea(100, 100, TARGET)).toBe(160 * 100); // too tall: widened to 160
  });
});

describe('ranksBefore', () => {
  const base = { frame: 100, deviation: 0.5, rows: 3, cardColumns: 2 };
  it('ranks by frame, then closeness to the target, then fewer rows, then fewer card columns', () => {
    expect(ranksBefore({ ...base, frame: 99, deviation: 9 }, base)).toBe(true);
    expect(ranksBefore({ ...base, deviation: 0.4, rows: 9 }, base)).toBe(true);
    expect(ranksBefore({ ...base, rows: 2, cardColumns: 9 }, base)).toBe(true);
    expect(ranksBefore({ ...base, cardColumns: 1 }, base)).toBe(true);
    expect(ranksBefore({ ...base, cardColumns: 3 }, base)).toBe(false);
    expect(ranksBefore({ ...base, rows: 4, cardColumns: 1 }, base)).toBe(false);
  });

  it('keeps the first of two equal candidates', () => {
    expect(ranksBefore(base, { ...base })).toBe(false);
  });
});

describe('packChildren', () => {
  it('places cards in a grid with equal widths per column and a shared baseline per row', () => {
    const items = [
      node('a', 'card', 200, 44),
      node('b', 'card', 150, 44),
      node('c', 'card', 160, 44),
      node('d', 'card', 180, 44),
      node('e', 'card', 148, 44),
    ];
    const result = packChildren(items, TARGET, GAPS, { cardColumns: 2, zoneRows: [] });
    expect(items.map((item) => [item.id, item.x, item.y, item.width])).toEqual([
      ['a', 0, 0, 200],
      ['b', 224, 0, 180],
      ['c', 0, 64, 200],
      ['d', 224, 64, 180],
      ['e', 0, 128, 200],
    ]);
    expect(result).toEqual({ arrangement: { cardColumns: 2, zoneRows: [] }, width: 404, height: 172 });
  });

  it('puts zones in rows below the cards, each row left-aligned with the zones sharing its top', () => {
    const items = [
      node('z1', 'zone', 300, 200),
      node('z2', 'chip', 148, 44),
      node('z3', 'zone', 260, 120),
      node('k1', 'card', 150, 44),
      node('k2', 'card', 150, 44),
    ];
    const result = packChildren(items, TARGET, GAPS);
    const at = (id: string): LayoutNode | undefined => items.find((item) => item.id === id);
    expect(at('k1')).toMatchObject({ x: 0, y: 0 });
    expect(at('k2')?.y).toBe(0);
    expect(at('z1')).toMatchObject({ x: 0, y: 44 + 20 });
    expect(at('z2')?.y).toBe(at('z1')?.y);
    expect(result.arrangement.zoneRows.reduce((a, b) => a + b, 0)).toBe(3);
    // The children box is the boxes' bounding box.
    const right = Math.max(...items.map((item) => item.x + item.width));
    const bottom = Math.max(...items.map((item) => item.y + item.height));
    expect([result.width, result.height]).toEqual([right, bottom]);
  });

  it('packs zones alone from the top', () => {
    const items = [node('z1', 'zone', 300, 200), node('z2', 'zone', 300, 100)];
    packChildren(items, { aspect: 3, tolerance: 0.2 }, GAPS);
    expect(items.map((item) => [item.x, item.y])).toEqual([
      [0, 0],
      [324, 0],
    ]);
  });

  it('follows a pinned arrangement, whatever the target', () => {
    const items = [...cards(3, 100, 44), ...chips(3)];
    const result = packChildren(items, TARGET, GAPS, { cardColumns: 1, zoneRows: [1, 2] });
    expect(result.arrangement).toEqual({ cardColumns: 1, zoneRows: [1, 2] });
    expect(items.map((item) => [item.x, item.y])).toEqual([
      [0, 0],
      [0, 64],
      [0, 128],
      [0, 192],
      [0, 256],
      [172, 256],
    ]);
    expect(result).toMatchObject({ width: 320, height: 300 });
  });

  it('returns an empty box for no children', () => {
    expect(packChildren([], TARGET, GAPS)).toEqual({
      arrangement: { cardColumns: 0, zoneRows: [] },
      width: 0,
      height: 0,
    });
  });
});

describe('arrangementProblem', () => {
  it('accepts arrangements that fit the children', () => {
    expect(arrangementProblem({ cardColumns: 2, zoneRows: [2, 1] }, 5, 3)).toBeUndefined();
    expect(arrangementProblem({ cardColumns: 0, zoneRows: [] }, 0, 0)).toBeUndefined();
  });

  it.each([
    [{ cardColumns: 0, zoneRows: [] }, 2, 0, 'cardColumns'],
    [{ cardColumns: 3, zoneRows: [] }, 2, 0, 'cardColumns'],
    [{ cardColumns: 1.5, zoneRows: [] }, 2, 0, 'cardColumns'],
    [{ cardColumns: 1, zoneRows: [] }, 0, 0, 'cardColumns'],
    [{ cardColumns: 0, zoneRows: [2] }, 0, 3, 'zoneRows'],
    [{ cardColumns: 0, zoneRows: [0, 3] }, 0, 3, 'zoneRows'],
    [{ cardColumns: 0, zoneRows: [1.5, 1.5] }, 0, 3, 'zoneRows'],
  ])('refuses %j for %i cards and %i zones', (arrangement, cardCount, zoneCount, field) => {
    expect(arrangementProblem(arrangement, cardCount, zoneCount)).toContain(field);
  });

  it('checks the stacks: one list per zone row, positive whole counts adding up to the row', () => {
    expect(arrangementProblem({ cardColumns: 0, zoneRows: [3], zoneStacks: [[1, 2]] }, 0, 3)).toBeUndefined();
    for (const zoneStacks of [[[1, 1]], [[3], [1]], [[0, 3]], [[1.5, 1.5]], [[]]]) {
      expect(arrangementProblem({ cardColumns: 0, zoneRows: [3], zoneStacks }, 0, 3)).toContain('zoneStacks');
    }
  });
});
