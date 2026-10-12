// SPDX-License-Identifier: MIT
/**
 * Stage 4: gutters (skill gcp-diagram-layout §5). After packing, every container
 * (the canvas and every open zone) has
 *
 * - an inner ring: the centre-line of its padding (for the canvas, of its margin), below the header;
 * - horizontal gutters: the centre-lines of the gaps between its rows (card rows, the gap between the card
 *   block and the zone block, zone rows), each from ring side to ring side;
 * - vertical gutters: the centre-lines of the gaps between the columns of its card block (from the ring top
 *   down to the gutter below the card block) and between neighbouring zones of a zone row (from the gutter
 *   above the row to the one below it).
 *
 * Nested zones' gutters connect to their parent's through the padding ring: a zone's horizontal gutters
 * (its ring's top and bottom sides and its row gutters) run on out of the zone, through its padding and its
 * border, to the parent's vertical gutter on either side of the zone; its vertical gutters that reach its ring
 * bottom (the ring's sides, and the column gutters of its last row) run on down to the parent's gutter below
 * the zone's row. Never up: above a zone is its header. Where nothing stands beside the zone (the first or
 * last zone of its row) the line keeps going straight, through the parent's padding and border, as far as the
 * parent's own lines reach on that side; the same downwards for a zone in its parent's last row. So a route
 * leaves a deeply nested zone in one straight run instead of a staircase of bends per level. Every piece runs
 * through free space (padding, gaps, the room beside a short zone or a short row), so a route along these
 * lines never crosses a card, a chip, an empty zone or a header.
 *
 * Each line remembers the width of the free strip around it (the gap or the padding it is the centre-line
 * of: lanes must stay inside it) and the container and gap it came from, so that the widening pass knows which
 * gap to widen. Collinear lines that touch or overlap are merged (the strip is the narrowest of
 * them), so a route running straight on from one container's gutter into a neighbour's needs no lane change;
 * the merged line keeps its pieces, so a route still uses only the stretches of the containers it crosses.
 */
import type { LayoutNode } from './normalise.js';
import { cellsOf } from './pack.js';
import type { Arrangement, Insets, Rect, Side } from './types.js';

/**
 * Which gap of its container a gutter piece is the centre-line of, as the widening pass addresses it
 * (`GutterWidening.ringSides` and `GutterWidening.gaps`): one side of the padding ring, the gap below row `index` (card rows
 * first, then zone rows), the gap after card column `index`, or the gap after zone `index` of zone row `row`.
 */
export type GapRef =
  | { readonly kind: 'ring'; readonly side: Side }
  | { readonly kind: 'row'; readonly index: number }
  | { readonly kind: 'card-column'; readonly index: number }
  | { readonly kind: 'zone-column'; readonly row: number; readonly index: number }
  | { readonly kind: 'stack'; readonly row: number; readonly cell: number; readonly index: number }
  | { readonly kind: 'port'; readonly key: string };

export interface GutterLine {
  readonly horizontal: boolean;
  /** The fixed coordinate: y of a horizontal line, x of a vertical one. */
  readonly c: number;
  /** The span along the line (x for a horizontal line, y for a vertical one), a ≤ b. */
  a: number;
  b: number;
  /** Width of the free strip centred on the line, which lanes must stay in. */
  strip: number;
  /**
   * The lines merged into this one, each with its span, its container (0 is the canvas), its own strip and
   * its gap: a route may use a stretch of the line only where a piece of a container it has to cross covers
   * it, and the widening pass widens the pieces' gaps.
   */
  pieces: GutterPiece[];
}

export interface GutterPiece {
  readonly a: number;
  readonly b: number;
  readonly owner: number;
  readonly strip: number;
  readonly gap: GapRef;
  /**
   * The stretches of the piece that run along a border inside a padding band (ADR 0027): a ring side between
   * its zone's corners (beyond them it is the line's extension, crossing a gap or running through free
   * space), or the canvas's margin. A route along them reads as a doubled border or an underline, so the
   * router charges their length more (`Routing.hugFactor`, at most `Routing.hugCap` more over one side; the
   * margin `Routing.marginFactor`). A gap's line, between two children, beside one or beside none, costs its
   * length: a gap with a child on one side only runs through the same free space as the lines parallel to it
   * there (a shorter neighbour's ring side running on down), and charging it more sent routes the long way
   * round through those lines and the canvas margin (ADR 0027). Absent when the piece has none.
   */
  readonly hugSpans?: readonly (readonly [number, number])[];
  /** Set on the canvas's ring (its margin): its hugging stretches cost `Routing.marginFactor`. */
  readonly margin?: boolean;
  /**
   * Set on a port line's pieces (src/portlines.ts): only this holder (an edge, or a hub bundle) may run along
   * the line.
   */
  readonly holder?: number;
}

/** A container: the canvas (index 0) or an open zone. */
export interface Container {
  readonly index: number;
  /** The zone; null for the canvas. */
  readonly node: LayoutNode | null;
  /** The containing container's index; -1 for the canvas. */
  readonly parent: number;
  /** The padding on each side (for the canvas: its margins). */
  readonly pads: Insets;
  readonly ringLeft: number;
  readonly ringRight: number;
  readonly ringTop: number;
  readonly ringBottom: number;
}

/** What `buildGutters` needs of a placed Scene. */
export interface PlacedTree {
  /** Every node, pre-order, with absolute positions. */
  readonly order: readonly LayoutNode[];
  readonly roots: readonly LayoutNode[];
  readonly arrangements: ReadonlyMap<LayoutNode, Arrangement>;
  readonly canvasArrangement: Arrangement;
  readonly bounds: Rect;
  /** The canvas margins (with any reserved ring). */
  readonly margins: Insets;
}

export interface Gutters {
  /** Merged lines, horizontal ones first, then by coordinate and start. */
  readonly lines: readonly GutterLine[];
  readonly containers: readonly Container[];
  /** Per node (by `LayoutNode.index`): the container it opens (open zones), else -1. */
  readonly containerOf: Int32Array;
  /** Per node: the container it sits in (0: the canvas). */
  readonly parentOf: Int32Array;
  /**
   * Per node, four coordinates of the parent's gutters around it (index × 4 + 0…3): the vertical line on its
   * left and on its right (x), the horizontal line above and below it (y).
   */
  readonly around: Float64Array;
  /** The line with this orientation and coordinate whose span holds `t`; -1 if there is none. */
  find(horizontal: boolean, c: number, t: number): number;
  /**
   * Whether a line with this orientation runs alongside the span a…b at coordinate c closer than its own
   * strip's half plus `clearance` (its lanes could come that close), by more than a point.
   */
  alongside(horizontal: boolean, c: number, a: number, b: number, clearance: number): boolean;
}

/** A stretch along a line: from, to. */
type Span = readonly [number, number];

export const LEFT = 0;
export const RIGHT = 1;
export const ABOVE = 2;
export const BELOW = 3;

const SPAN_EPSILON = 1e-6;

function keyOf(horizontal: boolean, c: number): string {
  return `${horizontal ? 'h' : 'v'}${String(c)}`;
}

/** The gutter lines of a placed Scene. */
export function buildGutters(tree: PlacedTree): Gutters {
  const count = tree.order.length;
  const containerOf = new Int32Array(count).fill(-1);
  const parentOf = new Int32Array(count);
  const around = new Float64Array(count * 4);
  // Per open zone: how far its horizontal lines reach left and right, and its vertical lines down.
  const reach = new Float64Array(count * 3);
  const containers: Container[] = [];
  const raw: GutterLine[] = [];

  /**
   * Adds a line of one gutter piece. `hug`: the stretches along it that run along its zone's border inside the
   * padding band (a ring side between the zone's corners); `margin`: the line is the canvas's ring.
   */
  const line = (
    horizontal: boolean,
    c: number,
    a: number,
    b: number,
    strip: number,
    owner: number,
    gap: GapRef,
    hug: readonly Span[] = [],
    margin = false,
  ): void => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const width = Math.max(0, strip);
    const clipped = hug
      .map(([from, to]): Span => [Math.max(lo, from), Math.min(hi, to)])
      .filter(([from, to]) => to - from > SPAN_EPSILON);
    raw.push({
      horizontal,
      c,
      a: lo,
      b: hi,
      strip: width,
      pieces: [
        {
          a: lo,
          b: hi,
          owner,
          strip: width,
          gap,
          ...(clipped.length > 0 ? { hugSpans: clipped } : {}),
          ...(margin ? { margin: true } : {}),
        },
      ],
    });
  };

  /**
   * Adds a container's lines and records, for each child, the container's gutters around it. `hSpan` is how far
   * its horizontal lines run (out to the parent's gutters beside it), `vBottom` how far down its vertical lines
   * that reach its ring bottom run.
   */
  const addContainer = (
    node: LayoutNode | null,
    parent: number,
    box: Rect,
    header: number,
    pads: Insets,
    children: readonly LayoutNode[],
    arrangement: Arrangement,
    hSpan: readonly [number, number] | null,
    vBottom: number | null,
  ): void => {
    const index = containers.length;
    if (node !== null) containerOf[node.index] = index;
    const ringLeft = box.x + pads.left / 2;
    const ringRight = box.x + box.width - pads.right / 2;
    const ringTop = box.y + header + pads.top / 2;
    const ringBottom = box.y + box.height - pads.bottom / 2;
    containers.push({ index, node, parent, pads, ringLeft, ringRight, ringTop, ringBottom });
    const [h0, h1] = hSpan ?? [ringLeft, ringRight];
    const down = vBottom ?? ringBottom;

    // A ring side hugs its zone's border between the zone's corners; beyond them it is the line's extension.
    // The canvas's ring is its margin.
    const across: Span[] = [[box.x, box.x + box.width]];
    const along: Span[] = [[box.y, box.y + box.height]];
    const margin = node === null;
    line(true, ringTop, h0, h1, pads.top, index, { kind: 'ring', side: 'top' }, across, margin);
    line(true, ringBottom, h0, h1, pads.bottom, index, { kind: 'ring', side: 'bottom' }, across, margin);
    line(false, ringLeft, ringTop, down, pads.left, index, { kind: 'ring', side: 'left' }, along, margin);
    line(false, ringRight, ringTop, down, pads.right, index, { kind: 'ring', side: 'right' }, along, margin);

    const cards = children.filter((child) => child.role === 'card');
    const zones = children.filter((child) => child.role !== 'card');
    for (const child of children) parentOf[child.index] = index;
    const setAround = (
      child: LayoutNode,
      left: number,
      right: number,
      above: number,
      below: number,
    ): void => {
      around[child.index * 4 + LEFT] = left;
      around[child.index * 4 + RIGHT] = right;
      around[child.index * 4 + ABOVE] = above;
      around[child.index * 4 + BELOW] = below;
    };

    // The zone block's rows (needed first: the card block's lower gutter is the gap above them), each as its
    // cells: one zone, or a stack of zones one above the other (ADR 0026).
    const zoneRows: LayoutNode[][] = [];
    const rowCells: LayoutNode[][][] = [];
    let next = 0;
    for (const cellCounts of cellsOf(arrangement)) {
      const cells: LayoutNode[][] = [];
      for (const count of cellCounts) {
        cells.push(zones.slice(next, next + count));
        next += count;
      }
      rowCells.push(cells);
      zoneRows.push(cells.flat());
    }
    const rowTop = (row: readonly LayoutNode[]): number => Math.min(...row.map((z) => z.y));
    const rowBottom = (row: readonly LayoutNode[]): number => Math.max(...row.map((z) => z.y + z.height));

    let cardBlockBelow = ringBottom;
    if (cards.length > 0) {
      const columns = Math.max(1, arrangement.cardColumns);
      const rows = Math.ceil(cards.length / columns);
      const colLeft: number[] = [];
      const colRight: number[] = [];
      for (let column = 0; column < columns; column += 1) {
        const first = cards[column] as LayoutNode;
        colLeft.push(first.x);
        colRight.push(first.x + first.width);
      }
      const rowTops: number[] = [];
      const rowBottoms: number[] = [];
      for (let row = 0; row < rows; row += 1) {
        const inRow = cards.slice(row * columns, row * columns + columns);
        rowTops.push(rowTop(inRow));
        rowBottoms.push(rowBottom(inRow));
      }
      const colGaps: number[] = [];
      for (let column = 0; column + 1 < columns; column += 1) {
        colGaps.push(((colRight[column] as number) + (colLeft[column + 1] as number)) / 2);
      }
      const rowGaps: number[] = [];
      for (let row = 0; row + 1 < rows; row += 1) {
        const top = rowBottoms[row] as number;
        const bottom = rowTops[row + 1] as number;
        rowGaps.push((top + bottom) / 2);
        line(true, (top + bottom) / 2, h0, h1, bottom - top, index, { kind: 'row', index: row });
      }
      const firstZoneRow = zoneRows[0];
      if (firstZoneRow !== undefined) {
        const top = rowBottoms[rows - 1] as number;
        const bottom = rowTop(firstZoneRow);
        cardBlockBelow = (top + bottom) / 2;
        line(true, cardBlockBelow, h0, h1, bottom - top, index, { kind: 'row', index: rows - 1 });
      }
      const columnsDown = firstZoneRow === undefined ? down : cardBlockBelow;
      colGaps.forEach((x, column) => {
        const strip = (colLeft[column + 1] as number) - (colRight[column] as number);
        line(false, x, ringTop, columnsDown, strip, index, { kind: 'card-column', index: column });
      });
      cards.forEach((child, i) => {
        const row = Math.floor(i / columns);
        const column = i % columns;
        setAround(
          child,
          column === 0 ? ringLeft : (colGaps[column - 1] as number),
          column === columns - 1 ? ringRight : (colGaps[column] as number),
          row === 0 ? ringTop : (rowGaps[row - 1] as number),
          row === rows - 1 ? cardBlockBelow : (rowGaps[row] as number),
        );
      });
    }

    const zoneRowGaps: number[] = [];
    const cardRows = cards.length === 0 ? 0 : Math.ceil(cards.length / Math.max(1, arrangement.cardColumns));
    zoneRows.forEach((row, r) => {
      const following = zoneRows[r + 1];
      if (following === undefined) return;
      const top = rowBottom(row);
      const bottom = rowTop(following);
      zoneRowGaps.push((top + bottom) / 2);
      line(true, (top + bottom) / 2, h0, h1, bottom - top, index, { kind: 'row', index: cardRows + r });
    });
    const ownReach = node === null ? undefined : node.index * 3;
    rowCells.forEach((cells, r) => {
      const above = r === 0 ? (cards.length > 0 ? cardBlockBelow : ringTop) : (zoneRowGaps[r - 1] as number);
      const last = r === rowCells.length - 1;
      const below = last ? ringBottom : (zoneRowGaps[r] as number);
      const cellLeft = (cell: readonly LayoutNode[]): number => Math.min(...cell.map((z) => z.x));
      const cellRight = (cell: readonly LayoutNode[]): number => Math.max(...cell.map((z) => z.x + z.width));
      const gaps: number[] = [];
      cells.forEach((cell, i) => {
        const neighbour = cells[i + 1];
        if (neighbour === undefined) return;
        const x = (cellRight(cell) + cellLeft(neighbour)) / 2;
        gaps.push(x);
        const strip = cellLeft(neighbour) - cellRight(cell);
        line(false, x, above, last ? down : below, strip, index, { kind: 'zone-column', row: r, index: i });
      });
      cells.forEach((cell, i) => {
        const left = i === 0 ? ringLeft : (gaps[i - 1] as number);
        const right = i === cells.length - 1 ? ringRight : (gaps[i] as number);
        // The gaps between the zones of a stack: horizontal lines across the cell, running on out like a row
        // gap where the cell is the first or last of its row.
        const stackGaps: number[] = [];
        cell.forEach((zone, k) => {
          const lower = cell[k + 1];
          if (lower === undefined) return;
          const y = (zone.y + zone.height + lower.y) / 2;
          stackGaps.push(y);
          line(
            true,
            y,
            i === 0 ? h0 : left,
            i === cells.length - 1 ? h1 : right,
            lower.y - (zone.y + zone.height),
            index,
            { kind: 'stack', row: r, cell: i, index: k },
          );
        });
        cell.forEach((zone, k) => {
          const zoneAbove = k === 0 ? above : (stackGaps[k - 1] as number);
          const lowest = k === cell.length - 1;
          const zoneBelow = lowest ? below : (stackGaps[k] as number);
          setAround(zone, left, right, zoneAbove, zoneBelow);
          const at = zone.index * 3;
          reach[at] = i === 0 && ownReach !== undefined ? (reach[ownReach] as number) : left;
          reach[at + 1] =
            i === cells.length - 1 && ownReach !== undefined ? (reach[ownReach + 1] as number) : right;
          reach[at + 2] =
            last && lowest && ownReach !== undefined ? (reach[ownReach + 2] as number) : zoneBelow;
        });
      });
    });
  };

  addContainer(null, -1, tree.bounds, 0, tree.margins, tree.roots, tree.canvasArrangement, null, null);
  for (const node of tree.order) {
    if (node.role !== 'zone') continue;
    const at = node.index * 3;
    addContainer(
      node,
      parentOf[node.index] as number,
      node,
      node.headerHeight,
      {
        top: node.padding + node.extra.top,
        right: node.padding + node.extra.right,
        bottom: node.padding + node.extra.bottom,
        left: node.padding + node.extra.left,
      },
      node.children,
      tree.arrangements.get(node) as Arrangement,
      [reach[at] as number, reach[at + 1] as number],
      reach[at + 2] as number,
    );
  }

  // Merge collinear lines that touch or overlap.
  const groups = new Map<string, GutterLine[]>();
  for (const entry of raw) {
    const key = keyOf(entry.horizontal, entry.c);
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [entry]);
    else list.push(entry);
  }
  const lines: GutterLine[] = [];
  for (const list of groups.values()) {
    list.sort((p, q) => p.a - q.a || p.b - q.b);
    let current: GutterLine | undefined;
    for (const entry of list) {
      if (current !== undefined && entry.a <= current.b + SPAN_EPSILON) {
        current.b = Math.max(current.b, entry.b);
        current.strip = Math.min(current.strip, entry.strip);
        current.pieces.push(...entry.pieces);
      } else {
        current = { ...entry, pieces: [...entry.pieces] };
        lines.push(current);
      }
    }
  }
  lines.sort((p, q) => Number(q.horizontal) - Number(p.horizontal) || p.c - q.c || p.a - q.a);

  const index = new Map<string, number[]>();
  lines.forEach((entry, i) => {
    const key = keyOf(entry.horizontal, entry.c);
    const list = index.get(key);
    if (list === undefined) index.set(key, [i]);
    else list.push(i);
  });
  const find = (horizontal: boolean, c: number, t: number): number => {
    for (const i of index.get(keyOf(horizontal, c)) ?? []) {
      const entry = lines[i] as GutterLine;
      if (t >= entry.a - SPAN_EPSILON && t <= entry.b + SPAN_EPSILON) return i;
    }
    return -1;
  };

  // Lines by orientation, sorted by coordinate (they are: horizontal ones first), and the widest strip.
  const firstVertical = lines.findIndex((entry) => !entry.horizontal);
  const split = firstVertical < 0 ? lines.length : firstVertical;
  const widestStrip = Math.max(0, ...lines.map((entry) => entry.strip));
  const alongside = (horizontal: boolean, c: number, a: number, b: number, clearance: number): boolean => {
    const from = horizontal ? 0 : split;
    const to = horizontal ? split : lines.length;
    const reach = widestStrip / 2 + clearance;
    let lo = from;
    let hi = to;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((lines[mid] as GutterLine).c < c - reach) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < to; i += 1) {
      const entry = lines[i] as GutterLine;
      if (entry.c > c + reach) break;
      if (Math.abs(entry.c - c) >= entry.strip / 2 + clearance) continue;
      if (Math.min(b, entry.b) - Math.max(a, entry.a) > SPAN_EPSILON) return true;
    }
    return false;
  };

  return { lines, containers, containerOf, parentOf, around, find, alongside };
}
