// SPDX-License-Identifier: MIT
/**
 * Stage 3: packing (skill gcp-diagram-layout §1, §4 and §9).
 * Bottom-up: the children of a zone are already sized when the zone is packed, and the zone's size follows
 * from its packed children.
 *
 * Shape. A container's children form two blocks, each in sibling order:
 * - the card block on top: a grid of `cardColumns` columns filled row by row; each column is as wide as its
 *   widest card and every card in it takes that width; a row is one card high, so cards share a baseline;
 * - the zone block below it: open zones, chips and empty zones in rows, `zoneRows[i]` zones in row `i`, each
 *   row left-aligned and as tall as its tallest cell. A cell is one zone, or a stack: consecutive
 *   zones one above the other, left-aligned, standing beside a single zone at least as tall in its row
 *   (`zoneStacks[i]` gives the zones per cell of row `i`; absent when every cell is one zone). The cells of a
 *   row share its top edge.
 * An `Arrangement` ({ cardColumns, zoneRows, zoneStacks? }) fixes the shape; positions follow from it and the
 * gaps.
 *
 * Candidates. Every card column count (1 … number of cards) combined with every zone row split of two
 * families: `k` cells per row (k = 1 … number of cells), and rows filled up to a width budget, each row taking
 * cells while they fit. The budgets are the card grids' widths, the widest zone's width and the width of every
 * run of consecutive cells side by side, which covers every split with full rows (rule 1); above
 * `RUN_BUDGET_LIMIT` zones, where the Scene builder bundles siblings anyway, only the runs starting at the
 * first zone give budgets. The cells are the zones themselves (plain rows), and, for 3 to `STACK_LIMIT` zones,
 * the greedy stacks under every distinct zone height as the limit (`cellGroupings`).
 *
 * Choice among the plain rows. A candidate's children box (gaps included, padding and header not) has an
 * aspect, width / height.
 * 1. Full rows (skill §1, "a tidy grid"): no row but the last of its block has room for the next child within
 *    the box's width (for the card grid: one more column would not fit); neither block leaves a row short
 *    while the other makes the box wider, so less than one child's width stays empty at a row's end. This
 *    rules out a wide card strip above a narrow, tall stack of zones, and a card column with room for another
 *    beside it above wide rows of zones (skill §9, "huge empty zones").
 * 2. Orientation (skill §1, "wider than tall"): only candidates on the target's side of 1 compete (aspect ≥ 1
 *    for a target ≥ 1), unless there are none.
 * 3. Frame: the smallest frame area wins. A box whose aspect is within `tolerance` (20 %, the packing band)
 *    of the target counts as on target and is its own frame, so inside the band the most compact arrangement
 *    wins. Any other box is framed to the target's aspect: it pays for the empty strip that would make it
 *    look like the target. So the packer leaves the band only when every arrangement inside it takes more
 *    area than one outside it after that penalty, and it takes an arrangement inside the band only when that
 *    box is no larger than every other tidy arrangement's frame (skill §9, "huge empty zones"). For grids of
 *    equal boxes, whose area hardly depends on the column count, this is skill §4's rule: the grid closest to
 *    the target, the closeness measured in area.
 * 4. Near ties: among the candidates whose frame is within `NEAR_TIE` (2 %) of the smallest,
 *    one whose rows do not hold more zones further down (not inverted) ranks first, then one with fewer rows.
 * Ties: closer to the target (|aspect − target|), then fewer rows (skill §4), then fewer card columns, then the
 * zone split listed first.
 *
 * Stacks. An arrangement with stacks replaces the plain one only when its box fits inside the plain
 * one's (no wider, no taller) with a smaller frame: a stack fills the height a tall sibling gives its row and
 * never makes its own container larger (its new shape may lead the parent to another arrangement, chosen for
 * a smaller frame, not a smaller area). Among those the smallest frame wins (ties as above, then fewer stacked
 * zones).
 */
import type { LayoutNode } from './normalise.js';
import type { Arrangement, GapWidening } from './types.js';

export interface Gaps {
  /** Between horizontally adjacent children. */
  readonly horizontal: number;
  /** Between rows, between the card block and the zone block, and between the zones of a stack. */
  readonly vertical: number;
}

/** What a container's packing aims for. */
export interface PackTarget {
  /** Target aspect (width / height) of the children box. */
  readonly aspect: number;
  /** Relative deviation from the target inside which every aspect counts as on target (0.2). */
  readonly tolerance: number;
}

/**
 * How zone rows may be built (skill §4). `stacks`: a zone row may set consecutive zones one above the other
 * in a stack (a cell) no taller than one of the container's zones, so short siblings fill the height a tall
 * one gives the row. The default is on; off is plain rows only, kept for the packing measurement
 * (`scripts/measure.ts --packing`).
 */
export interface PackPolicy {
  readonly stacks: boolean;
  /**
   * Measurement only (skill §9's "pack zones in rows by height"): before packing, a container's
   * zones are reordered tallest first (stable), giving up skill §4's sibling order. Never set by the layout.
   */
  readonly byHeight?: boolean;
}

export const DEFAULT_PACK_POLICY: PackPolicy = Object.freeze({ stacks: true });

/** Above this many zones in a container, row budgets come only from the runs starting at its first zone. */
export const RUN_BUDGET_LIMIT = 120;

/** Above this many zones in a container, zones are not stacked (large flat sets are chips of one height). */
export const STACK_LIMIT = 24;

/**
 * Near ties (skill §4): among the arrangements whose frame is within this share of the smallest, one
 * whose rows are not inverted (no zone row holds fewer zones than a later one) is preferred, then one with
 * fewer rows.
 */
export const NEAR_TIE = 0.02;

export interface PackResult {
  readonly arrangement: Arrangement;
  /** The children box: the packed children's bounding box, relative to the content origin. */
  readonly width: number;
  readonly height: number;
}

interface Box {
  readonly width: number;
  readonly height: number;
}

interface CardGrid {
  readonly columns: number;
  readonly rows: number;
  readonly colWidths: readonly number[];
  readonly width: number;
  readonly height: number;
}

interface ZoneSplit {
  /** Cells (stacks of zones; one zone each without stacking) per row. */
  readonly rows: readonly number[];
  readonly width: number;
  readonly height: number;
  /**
   * The narrowest box width at which some row (not the last) would also hold the next cell: the rows are
   * full at every box width below it. Infinity for a single row.
   */
  readonly overflow: number;
}

const NO_CARDS: CardGrid = { columns: 0, rows: 0, colWidths: [], width: 0, height: 0 };
const NO_ZONES: ZoneSplit = { rows: [], width: 0, height: 0, overflow: Infinity };

/** The card grid with `columns` columns: each column as wide as its widest card, each row one card high. */
function cardGrid(cards: readonly LayoutNode[], columns: number, gaps: Gaps): CardGrid {
  const colWidths = new Array<number>(columns).fill(0);
  const rows = Math.ceil(cards.length / columns);
  let height = 0;
  for (let row = 0; row < rows; row += 1) {
    let rowHeight = 0;
    for (let column = 0; column < columns; column += 1) {
      const card = cards[row * columns + column];
      if (card === undefined) break;
      colWidths[column] = Math.max(colWidths[column] ?? 0, card.width);
      rowHeight = Math.max(rowHeight, card.height);
    }
    height += rowHeight + (row > 0 ? gaps.vertical : 0);
  }
  const width = colWidths.reduce((sum, w) => sum + w, 0) + (columns - 1) * gaps.horizontal;
  return { columns, rows, colWidths, width, height };
}

/** The zone block for a row split of cells: each row as wide as its cells and gaps, as tall as its tallest. */
function zoneSplit(cells: readonly Box[], rows: readonly number[], gaps: Gaps): ZoneSplit {
  let width = 0;
  let height = 0;
  let overflow = Infinity;
  let index = 0;
  rows.forEach((length, row) => {
    let rowWidth = 0;
    let rowHeight = 0;
    for (let i = 0; i < length; i += 1) {
      const cell = cells[index + i];
      if (cell === undefined) break;
      rowWidth += cell.width + (i > 0 ? gaps.horizontal : 0);
      rowHeight = Math.max(rowHeight, cell.height);
    }
    index += length;
    const next = cells[index];
    if (next !== undefined) overflow = Math.min(overflow, rowWidth + gaps.horizontal + next.width);
    width = Math.max(width, rowWidth);
    height += rowHeight + (row > 0 ? gaps.vertical : 0);
  });
  return { rows, width, height, overflow };
}

/** `k` cells per row: [k, k, …, the rest]. */
function rowsOfLength(count: number, k: number): number[] {
  const rows: number[] = [];
  for (let left = count; left > 0; left -= k) rows.push(Math.min(k, left));
  return rows;
}

/** Rows filled up to `budget` px: a row takes the next cell while it fits, and always at least one cell. */
function rowsWithin(cells: readonly Box[], budget: number, gaps: Gaps): number[] {
  const rows: number[] = [];
  let length = 0;
  let width = 0;
  for (const cell of cells) {
    const next = length === 0 ? cell.width : width + gaps.horizontal + cell.width;
    if (length > 0 && next > budget) {
      rows.push(length);
      length = 1;
      width = cell.width;
    } else {
      length += 1;
      width = next;
    }
  }
  if (length > 0) rows.push(length);
  return rows;
}

function sameRows(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Every row split of `cells` the packer considers, in a fixed order: `k` per row, then by width budget.
 * `widths` are extra budgets: the card grids' widths, so that the zone rows can fill the card block's width.
 */
function zoneSplits(cells: readonly Box[], gaps: Gaps, widths: readonly number[]): ZoneSplit[] {
  if (cells.length === 0) return [NO_ZONES];
  const splits: ZoneSplit[] = [];
  const seen = new Set<string>();
  const add = (rows: readonly number[]): void => {
    const key = rows.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    splits.push(zoneSplit(cells, rows, gaps));
  };
  for (let k = 1; k <= cells.length; k += 1) add(rowsOfLength(cells.length, k));
  const budgets: number[] = [...widths];
  const starts = cells.length > RUN_BUDGET_LIMIT ? 1 : cells.length;
  for (let start = 0; start < starts; start += 1) {
    let width = 0;
    for (let end = start; end < cells.length; end += 1) {
      width += (cells[end]?.width ?? 0) + (end > start ? gaps.horizontal : 0);
      budgets.push(width);
    }
  }
  budgets.sort((a, b) => a - b);
  let previous: readonly number[] = [];
  budgets.forEach((budget, index) => {
    if (index > 0 && budget === budgets[index - 1]) return;
    const rows = rowsWithin(cells, budget, gaps);
    if (sameRows(rows, previous)) return;
    previous = rows;
    add(rows);
  });
  return splits;
}

/** A stack of consecutive zones: its zone count and box (as wide as its widest zone, its zones one above the other). */
interface Cell extends Box {
  readonly zones: number;
}

/** Zones as cells of one zone each. */
function singleCells(zones: readonly Box[]): Cell[] {
  return zones.map((zone) => ({ zones: 1, width: zone.width, height: zone.height }));
}

/**
 * Consecutive zones stacked while the stack stays no taller than `limit`: a zone starts a new stack when it
 * would make the current one taller (a zone taller than the limit stands alone).
 */
function stackedCells(zones: readonly Box[], limit: number, gaps: Gaps): Cell[] {
  const cells: Cell[] = [];
  let count = 0;
  let width = 0;
  let height = 0;
  for (const zone of zones) {
    if (count > 0 && height + gaps.vertical + zone.height <= limit) {
      count += 1;
      width = Math.max(width, zone.width);
      height += gaps.vertical + zone.height;
    } else {
      if (count > 0) cells.push({ zones: count, width, height });
      count = 1;
      width = zone.width;
      height = zone.height;
    }
  }
  if (count > 0) cells.push({ zones: count, width, height });
  return cells;
}

/**
 * The ways to group `zones` into cells: one zone per cell, then (with stacking) the greedy stacks under every
 * distinct zone height as the limit that stacks at least two zones, each grouping once.
 */
function cellGroupings(zones: readonly LayoutNode[], gaps: Gaps, policy: PackPolicy): Cell[][] {
  const groupings: Cell[][] = [singleCells(zones)];
  if (!policy.stacks || zones.length < 3 || zones.length > STACK_LIMIT) return groupings;
  const seen = new Set<string>([zones.map(() => '1').join(',')]);
  const limits = [...new Set(zones.map((zone) => zone.height))].sort((a, b) => a - b);
  for (const limit of limits) {
    const cells = stackedCells(zones, limit, gaps);
    const key = cells.map((cell) => String(cell.zones)).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    groupings.push(cells);
  }
  return groupings;
}

function cardGrids(cards: readonly LayoutNode[], gaps: Gaps): CardGrid[] {
  if (cards.length === 0) return [NO_CARDS];
  return cards.map((_, index) => cardGrid(cards, index + 1, gaps));
}

/** Whether `aspect` lies on the same side of 1 as `target` (both wider than tall, or both not). */
function sameOrientation(aspect: number, target: number): boolean {
  return target >= 1 ? aspect >= 1 : aspect <= 1;
}

/** The children box of a card grid above a zone split. */
function boxWidth(grid: CardGrid, split: ZoneSplit): number {
  return Math.max(grid.width, split.width);
}

function boxHeight(grid: CardGrid, split: ZoneSplit, gaps: Gaps): number {
  const between = grid.height > 0 && split.height > 0 ? gaps.vertical : 0;
  return grid.height + between + split.height;
}

/**
 * Full rows: no row but the last of its block has room for the next child within the box width. `wider` is
 * the card grid with one more column (undefined when every card is in one row).
 */
function filled(grid: CardGrid, wider: CardGrid | undefined, split: ZoneSplit): boolean {
  const width = Math.max(grid.width, split.width);
  return (wider === undefined || wider.width > width) && split.overflow > width;
}

/** The keys a candidate is ranked by (see the module comment). */
export interface RankKeys {
  /** The box's frame area (`frameArea`). */
  readonly frame: number;
  /** |aspect − target|. */
  readonly deviation: number;
  /** Card rows plus zone rows. */
  readonly rows: number;
  readonly cardColumns: number;
  /** Zones set in a stack with others (0 without stacking). */
  readonly stacked?: number;
  /** Some zone row holds fewer zones than a later one (an inverted, ragged grid). */
  readonly inverted?: boolean;
}

interface Candidate extends RankKeys {
  readonly grid: CardGrid;
  readonly split: ZoneSplit;
  readonly cells: readonly Cell[];
}

/**
 * A box's frame (module comment, rule 3): the box itself when its aspect is within the tolerance band around
 * the target; otherwise the smallest rectangle of the target's aspect around it, the box widened (too tall)
 * or heightened (too wide) by the empty strip it would need to look like the target.
 */
export function frameArea(width: number, height: number, target: PackTarget): number {
  const aspect = width / height;
  if (Math.abs(aspect - target.aspect) <= target.tolerance * target.aspect) return width * height;
  return aspect < target.aspect ? height * height * target.aspect : (width * width) / target.aspect;
}

/**
 * True when `a` ranks strictly before `b`: smaller frame, then closer to the target, fewer rows (skill §4),
 * fewer card columns, fewer stacked zones. On a full tie neither does, and the candidate met first stays.
 */
export function ranksBefore(a: RankKeys, b: RankKeys): boolean {
  if (a.frame !== b.frame) return a.frame < b.frame;
  if (a.deviation !== b.deviation) return a.deviation < b.deviation;
  if (a.rows !== b.rows) return a.rows < b.rows;
  if (a.cardColumns !== b.cardColumns) return a.cardColumns < b.cardColumns;
  return (a.stacked ?? 0) < (b.stacked ?? 0);
}

/**
 * Among near ties (frames within `NEAR_TIE` of the smallest), a candidate whose rows are not inverted ranks
 * first, then one with fewer rows (a lone short last row, such as a loose project under the folders, costs a
 * band across the whole box); otherwise `ranksBefore`.
 */
export function nearTieRanksBefore(a: RankKeys, b: RankKeys, smallest: number): boolean {
  const near = (keys: RankKeys): boolean => keys.frame <= smallest * (1 + NEAR_TIE);
  if (near(a) && near(b)) {
    if ((a.inverted ?? false) !== (b.inverted ?? false)) return b.inverted ?? false;
    if (a.rows !== b.rows) return a.rows < b.rows;
  }
  if (near(a) !== near(b)) return near(a);
  return ranksBefore(a, b);
}

/**
 * Whether every stack stands beside a single zone at least as tall in its own row (a stack fills the height a
 * taller sibling gives the row; alone, as the row's tallest, or beside other stacks only, it would be rows in
 * disguise).
 */
function besideTaller(cells: readonly Cell[], rows: readonly number[]): boolean {
  let index = 0;
  for (const length of rows) {
    const row = cells.slice(index, index + length);
    index += length;
    for (const cell of row) {
      if (cell.zones === 1) continue;
      if (!row.some((other) => other.zones === 1 && other.height >= cell.height)) return false;
    }
  }
  return true;
}

/** Zones per zone row, from cells per row. */
function zonesPerRow(cells: readonly Cell[], rows: readonly number[]): number[] {
  const result: number[] = [];
  let index = 0;
  for (const length of rows) {
    let zones = 0;
    for (let i = 0; i < length; i += 1) zones += cells[index + i]?.zones ?? 0;
    result.push(zones);
    index += length;
  }
  return result;
}

/** Whether some zone row holds fewer zones than a later one. */
function isInverted(perRow: readonly number[]): boolean {
  let least = Infinity;
  for (const zones of perRow) {
    if (zones > least) return true;
    least = Math.min(least, zones);
  }
  return false;
}

/** The arrangement of a candidate: card columns, zones per row and, when any cell stacks zones, the stacks. */
function arrangementOf(grid: CardGrid, cells: readonly Cell[], rows: readonly number[]): Arrangement {
  const zoneRows = zonesPerRow(cells, rows);
  if (cells.every((cell) => cell.zones === 1)) return { cardColumns: grid.columns, zoneRows };
  const zoneStacks: number[][] = [];
  let index = 0;
  for (const length of rows) {
    zoneStacks.push(cells.slice(index, index + length).map((cell) => cell.zones));
    index += length;
  }
  return { cardColumns: grid.columns, zoneRows, zoneStacks };
}

/**
 * Chooses the arrangement of `cards` and `zones` (both sized, in sibling order) by the rules in the module
 * comment. Returns `undefined` when there are no children.
 */
export function chooseArrangement(
  cards: readonly LayoutNode[],
  zones: readonly LayoutNode[],
  target: PackTarget,
  gaps: Gaps,
  policy: PackPolicy = DEFAULT_PACK_POLICY,
): PackResult | undefined {
  if (cards.length === 0 && zones.length === 0) return undefined;
  const grids = cardGrids(cards, gaps);
  const extraBudgets = [...grids.map((grid) => grid.width), Math.max(0, ...zones.map((zone) => zone.width))];
  const groupings = cellGroupings(zones, gaps, policy).map((cells) => ({
    cells,
    splits: zones.length === 0 ? [NO_ZONES] : zoneSplits(cells, gaps, extraBudgets),
    stacked: cells.reduce((sum, cell) => sum + (cell.zones > 1 ? cell.zones : 0), 0),
  }));

  // Plain rows first (skill §4): oriented candidates only, when any is.
  const plain = groupings[0] as (typeof groupings)[number];
  let oriented = false;
  for (const [index, grid] of grids.entries()) {
    for (const split of plain.splits) {
      if (!filled(grid, grids[index + 1], split)) continue;
      if (sameOrientation(boxWidth(grid, split) / boxHeight(grid, split, gaps), target.aspect))
        oriented = true;
    }
  }
  const candidateOf = (
    grid: CardGrid,
    split: ZoneSplit,
    cells: readonly Cell[],
    stacked: number,
  ): Candidate => {
    const width = boxWidth(grid, split);
    const height = boxHeight(grid, split, gaps);
    return {
      grid,
      split,
      cells,
      frame: frameArea(width, height, target),
      deviation: Math.abs(width / height - target.aspect),
      rows: grid.rows + split.rows.length,
      cardColumns: grid.columns,
      stacked,
      inverted: isInverted(zonesPerRow(cells, split.rows)),
    };
  };
  const plainCandidates: Candidate[] = [];
  let smallest = Infinity;
  for (const [index, grid] of grids.entries()) {
    for (const split of plain.splits) {
      if (!filled(grid, grids[index + 1], split)) continue;
      if (oriented && !sameOrientation(boxWidth(grid, split) / boxHeight(grid, split, gaps), target.aspect))
        continue;
      const candidate = candidateOf(grid, split, plain.cells, 0);
      smallest = Math.min(smallest, candidate.frame);
      plainCandidates.push(candidate);
    }
  }
  let best: Candidate | undefined;
  for (const candidate of plainCandidates) {
    if (best === undefined || nearTieRanksBefore(candidate, best, smallest)) best = candidate;
  }
  // Stacks (skill §4): an arrangement with stacked zones replaces the plain one only when its box fits inside
  // the plain one's (no wider, no taller) and its frame is smaller, so a stack never makes its own container
  // larger (its parent, choosing by frame, may then take a larger box).
  if (best !== undefined) {
    const bestWidth = boxWidth(best.grid, best.split);
    const bestHeight = boxHeight(best.grid, best.split, gaps);
    let stackedBest: Candidate | undefined;
    for (const { cells, splits, stacked } of groupings.slice(1)) {
      for (const [index, grid] of grids.entries()) {
        for (const split of splits) {
          if (!filled(grid, grids[index + 1], split) || !besideTaller(cells, split.rows)) continue;
          if (boxWidth(grid, split) > bestWidth || boxHeight(grid, split, gaps) > bestHeight) continue;
          const candidate = candidateOf(grid, split, cells, stacked);
          if (candidate.frame >= best.frame) continue;
          if (stackedBest === undefined || ranksBefore(candidate, stackedBest)) stackedBest = candidate;
        }
      }
    }
    if (stackedBest !== undefined) best = stackedBest;
  }
  /* v8 ignore next -- a candidate with full rows always exists (see zoneSplits) */
  if (best === undefined) return undefined;
  return {
    arrangement: arrangementOf(best.grid, best.cells, best.split.rows),
    width: boxWidth(best.grid, best.split),
    height: boxHeight(best.grid, best.split, gaps),
  };
}

/**
 * Why `arrangement` cannot pack `cards` cards and `zones` zones, or `undefined` when it can: the card grid
 * has between 1 and `cards` columns (0 without cards), the zone rows are positive whole numbers adding up
 * to `zones`, and the stacks (if any) split each row's zones into positive whole numbers.
 */
export function arrangementProblem(
  arrangement: Arrangement,
  cards: number,
  zones: number,
): string | undefined {
  const { cardColumns, zoneRows, zoneStacks } = arrangement;
  const columnsOk =
    Number.isInteger(cardColumns) &&
    (cards === 0 ? cardColumns === 0 : cardColumns >= 1 && cardColumns <= cards);
  if (!columnsOk) {
    return `cardColumns ${String(cardColumns)} does not fit ${String(cards)} card(s)`;
  }
  const rowsOk =
    zoneRows.every((length) => Number.isInteger(length) && length >= 1) &&
    zoneRows.reduce((sum, length) => sum + length, 0) === zones;
  if (!rowsOk) return `zoneRows [${zoneRows.join(', ')}] do not split ${String(zones)} zone(s)`;
  if (zoneStacks !== undefined) {
    const stacksOk =
      zoneStacks.length === zoneRows.length &&
      zoneStacks.every(
        (cells, row) =>
          cells.length >= 1 &&
          cells.every((count) => Number.isInteger(count) && count >= 1) &&
          cells.reduce((sum, count) => sum + count, 0) === zoneRows[row],
      );
    if (!stacksOk) {
      return `zoneStacks ${JSON.stringify(zoneStacks)} do not split the zone rows [${zoneRows.join(', ')}]`;
    }
  }
  return undefined;
}

/** The cells of an arrangement's zone block: per row, the zone count of each cell. */
export function cellsOf(arrangement: Arrangement): number[][] {
  const { zoneRows, zoneStacks } = arrangement;
  return zoneRows.map((count, row) => [...(zoneStacks?.[row] ?? new Array<number>(count).fill(1))]);
}

/**
 * Packs `children` (already sized, in sibling order): chooses their arrangement (or uses `pinned`, which the
 * caller has checked with `arrangementProblem`), sets each child's position relative to the container's
 * content origin and returns the arrangement and the children box. `extra` widens single gaps (the router's
 * per-gap widening, meant with a pinned arrangement); the choice ignores it, the positions and the box include
 * it.
 */
export function packChildren(
  children: readonly LayoutNode[],
  target: PackTarget,
  gaps: Gaps,
  pinned?: Arrangement,
  extra?: GapWidening,
  policy: PackPolicy = DEFAULT_PACK_POLICY,
): PackResult {
  const cards = children.filter((child) => child.role === 'card');
  const zones = children.filter((child) => child.role !== 'card');
  let arrangement: Arrangement | undefined;
  if (pinned !== undefined) {
    arrangement = {
      cardColumns: cards.length === 0 ? 0 : pinned.cardColumns,
      zoneRows: zones.length === 0 ? [] : [...pinned.zoneRows],
      ...(pinned.zoneStacks === undefined || zones.length === 0
        ? {}
        : { zoneStacks: pinned.zoneStacks.map((cells) => [...cells]) }),
    };
  } else {
    arrangement = chooseArrangement(cards, zones, target, gaps, policy)?.arrangement;
  }
  if (arrangement === undefined)
    return { arrangement: { cardColumns: 0, zoneRows: [] }, width: 0, height: 0 };

  const rowExtra = (k: number): number => extra?.rows?.[k] ?? 0;
  let width = 0;
  let height = 0;
  let cardBlockHeight = 0;
  let cardRows = 0;
  if (cards.length > 0) {
    const grid = cardGrid(cards, arrangement.cardColumns, gaps);
    const columnX: number[] = [];
    let x = 0;
    grid.colWidths.forEach((columnWidth, column) => {
      columnX.push(x);
      x += columnWidth + gaps.horizontal + (extra?.cardColumns?.[column] ?? 0);
    });
    let y = 0;
    for (let start = 0; start < cards.length; start += grid.columns) {
      let rowHeight = 0;
      cards.slice(start, start + grid.columns).forEach((card, column) => {
        card.x = columnX[column] ?? 0;
        card.y = y;
        card.width = grid.colWidths[column] ?? card.width;
        rowHeight = Math.max(rowHeight, card.height);
        width = Math.max(width, card.x + card.width);
      });
      cardBlockHeight = y + rowHeight;
      y += rowHeight + gaps.vertical + rowExtra(cardRows);
      cardRows += 1;
    }
    height = cardBlockHeight;
  }

  let y = cardBlockHeight > 0 ? cardBlockHeight + gaps.vertical + rowExtra(cardRows - 1) : 0;
  let index = 0;
  cellsOf(arrangement).forEach((cells, row) => {
    let x = 0;
    let rowHeight = 0;
    cells.forEach((count, cell) => {
      const stack = zones.slice(index, index + count);
      index += count;
      let cellY = y;
      let cellWidth = 0;
      stack.forEach((zone, k) => {
        zone.x = x;
        zone.y = cellY;
        cellY += zone.height + gaps.vertical + (extra?.stacks?.[row]?.[cell]?.[k] ?? 0);
        cellWidth = Math.max(cellWidth, zone.width);
        rowHeight = Math.max(rowHeight, zone.y + zone.height - y);
        width = Math.max(width, zone.x + zone.width);
        height = Math.max(height, zone.y + zone.height);
      });
      x += cellWidth + gaps.horizontal + (extra?.zoneColumns?.[row]?.[cell] ?? 0);
    });
    y += rowHeight + gaps.vertical + rowExtra(cardRows + row);
  });
  return { arrangement, width, height };
}
