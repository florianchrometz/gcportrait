// SPDX-License-Identifier: MIT
/**
 * Where the routed edges already run, in absolute coordinates (skill gcp-diagram-layout §1: "parallel arrows in
 * the same gap are spaced in lanes, never overlapping"; §8 "lanes spaced"). Lanes are numbered per gutter line,
 * but what a reader sees is geometry: an elbow reaches into the crossing gutter by that gutter's lane offset,
 * past the end of its own line, where the lines that end on the same gutter from the other side, or a port's
 * stub, may run at the same coordinate. So before a run takes a lane, the router asks this index whether the
 * segment the lane would draw (the run itself, the elbow's reach into the crossing gutter, a stub) comes closer
 * than `clearance` (the lane pitch) to a parallel segment of another holder (another edge, or another bundle)
 * alongside it. Two stubs (the short segments from a port across to its gutter) only need `stubClearance`
 * (half the port spacing): ports on two rects facing each other across a gutter sit on slot grids shifted by
 * half a port spacing, so their stubs can be no further apart than that.
 *
 * Segments are hashed by orientation, by their fixed coordinate in buckets of `clearance` (a query looks at the
 * bucket and its two neighbours) and by their span in cells of `CELL` px, so a query costs the segments near it.
 */
import { EPSILON } from './geometry.js';

/** Span cell size along a segment. */
const CELL = 1024;
/** Cells per bucket row of the hash key: far more than a canvas spans. */
const CELLS = 1 << 16;

interface Entry {
  readonly c: number;
  readonly a: number;
  readonly b: number;
  readonly stub: boolean;
  readonly holder: number;
}

export class Occupancy {
  private readonly cells = new Map<number, Entry[]>();

  private readonly clearance: number;
  private readonly stubClearance: number;

  constructor(clearance: number, stubClearance = clearance) {
    this.clearance = clearance;
    this.stubClearance = Math.min(clearance, stubClearance);
  }

  private key(horizontal: boolean, bucket: number, cell: number): number {
    return (bucket * CELLS + cell) * 2 + (horizontal ? 1 : 0);
  }

  private bucketOf(c: number): number {
    return Math.max(0, Math.floor(c / this.clearance));
  }

  /**
   * Records the segment from `a` to `b` at fixed coordinate `c` (y of a horizontal segment, x of a vertical);
   * `stub` for a port's stub.
   */
  add(horizontal: boolean, c: number, a: number, b: number, holder: number, stub = false): void {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const entry: Entry = { c, a: lo, b: hi, stub, holder };
    const bucket = this.bucketOf(c);
    for (let cell = cellOf(lo); cell <= cellOf(hi); cell += 1) {
      const key = this.key(horizontal, bucket, cell);
      const list = this.cells.get(key);
      if (list === undefined) this.cells.set(key, [entry]);
      else list.push(entry);
    }
  }

  /**
   * Whether a segment of another holder runs parallel to the given one (a stub, with `stub`), closer than the
   * clearance, alongside it for more than a point.
   */
  blocked(horizontal: boolean, c: number, a: number, b: number, holder: number, stub = false): boolean {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const bucket = this.bucketOf(c);
    const limit = this.clearance - EPSILON;
    const stubLimit = this.stubClearance - EPSILON;
    for (let k = Math.max(0, bucket - 1); k <= bucket + 1; k += 1) {
      for (let cell = cellOf(lo); cell <= cellOf(hi); cell += 1) {
        const list = this.cells.get(this.key(horizontal, k, cell));
        if (list === undefined) continue;
        for (const entry of list) {
          if (entry.holder === holder) continue;
          if (Math.abs(entry.c - c) >= (stub && entry.stub ? stubLimit : limit)) continue;
          if (Math.min(hi, entry.b) - Math.max(lo, entry.a) > EPSILON) return true;
        }
      }
    }
    return false;
  }
}

function cellOf(value: number): number {
  return Math.max(0, Math.floor(value / CELL));
}
