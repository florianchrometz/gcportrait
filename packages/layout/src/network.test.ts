// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import type { GutterLine } from './gutters.js';
import { HUG_MARGIN, HUG_NONE, HUG_RING, PieceIds, buildNetwork, pieceKey } from './network.js';

function line(
  horizontal: boolean,
  c: number,
  a: number,
  b: number,
  owners: [number, number, number][] = [],
  strips: number[] = [],
): GutterLine {
  const pieces = owners.length === 0 ? [[0, a, b] as [number, number, number]] : owners;
  return {
    horizontal,
    c,
    a,
    b,
    strip: Math.min(24, ...strips),
    pieces: pieces.map(([owner, from, to], i) => ({
      a: from,
      b: to,
      owner,
      strip: strips[i] ?? 24,
      gap: { kind: 'ring', side: 'top' },
    })),
  };
}

describe('buildNetwork', () => {
  // A horizontal line y = 0 from 0 to 300 (two gutters: owner 1 up to 100, owner 2 beyond), crossed by a
  // vertical line x = 100 (passing through) and joined by one ending on it at x = 200 (a T-junction).
  const lines = [
    line(true, 0, 0, 300, [
      [1, 0, 100],
      [2, 100, 300],
    ]),
    line(false, 100, -50, 50),
    line(false, 200, 0, 80),
  ];

  it('puts a node at every intersection, sorted along each line', () => {
    const { network } = buildNetwork(lines, [], 200);
    expect(network.nodeCount).toBe(2);
    expect(network.crossings).toBe(2);
    expect([network.x[0], network.y[0], network.x[1], network.y[1]]).toEqual([100, 0, 200, 0]);
    // Node 0 is on line 0 (horizontal) at position 0 and on line 1 (vertical) at position 0.
    expect([network.line[0], network.line[1], network.pos[0], network.pos[1]]).toEqual([0, 1, 0, 0]);
    expect(network.segmentCount).toBe(1);
    expect(network.length[0]).toBe(100);
  });

  it('adds a node where a port’s stub meets a line, reusing an intersection at the same point', () => {
    const { network, attached } = buildNetwork(
      lines,
      [
        { line: 0, t: 50 },
        { line: 0, t: 100 },
        { line: 0, t: 50 },
        { line: 1, t: 30 },
        { line: 7, t: 0 },
      ],
      200,
    );
    expect(Array.from(attached)).toEqual([2, 0, 2, 3, -1]);
    expect(network.nodeCount).toBe(4);
    expect([network.x[2], network.y[2], network.x[3], network.y[3]]).toEqual([50, 0, 100, 30]);
    // Line 0 now holds 50, 100, 200: segments of 50 and 100.
    const first = network.start[0] ?? 0;
    expect(Array.from(network.nodes.slice(first, first + 3))).toEqual([2, 0, 1]);
    expect(Array.from(network.length.slice(0, 2))).toEqual([50, 100]);
  });

  it('spreads the lane cost over each gutter by length and records the gutters’ owners per segment', () => {
    const { network } = buildNetwork(lines, [{ line: 0, t: 50 }], 200);
    // Segment 0: 50..100 inside owner 1's gutter (0..100, 100 long); segment 1: 100..200 in owner 2's (200 long).
    expect(network.pressure[0]).toBe(100);
    expect(network.pressure[1]).toBe(100);
    const owners = (s: number): number[] =>
      Array.from(network.owners.slice(network.ownerStart[s] ?? 0, network.ownerStart[s + 1] ?? 0));
    expect(owners(0)).toEqual([1]);
    expect(owners(1)).toEqual([2]);
  });

  it('records per segment the narrowest strip and the stable keys of the gutter pieces covering it', () => {
    const narrow = [
      line(
        true,
        0,
        0,
        300,
        [
          [1, 0, 100],
          [2, 100, 300],
        ],
        [40, 16],
      ),
      lines[1] as GutterLine,
      lines[2] as GutterLine,
    ];
    const ids = new PieceIds();
    const { network } = buildNetwork(narrow, [{ line: 0, t: 50 }], 200, ids);
    expect(Array.from(network.strip.slice(0, 2))).toEqual([40, 16]);
    const keys = (s: number): number[] =>
      Array.from(network.pieceKeys.slice(network.pieceStart[s] ?? 0, network.pieceStart[s + 1] ?? 0));
    const idOf = (owner: number): number =>
      ids.idOf({ a: 0, b: 1, owner, strip: 0, gap: { kind: 'ring', side: 'top' } });
    expect(keys(0)).toEqual([idOf(1)]);
    expect(keys(1)).toEqual([idOf(2)]);
    // The same key gets the same number in every pass of a layout.
    expect(idOf(1)).not.toBe(idOf(2));
  });
});

describe('hugging and port-line segments', () => {
  it('marks a segment as hugging where every piece covering it hugs, and as exclusive on a port line', () => {
    const lines: GutterLine[] = [
      {
        horizontal: true,
        c: 0,
        a: 0,
        b: 300,
        strip: 24,
        pieces: [
          { a: 0, b: 300, owner: 1, strip: 24, gap: { kind: 'ring', side: 'top' }, hugSpans: [[0, 100]] },
        ],
      },
      {
        horizontal: true,
        c: 50,
        a: 0,
        b: 300,
        strip: 16,
        pieces: [{ a: 0, b: 300, owner: 1, strip: 16, gap: { kind: 'port', key: '0.0' }, holder: 7 }],
      },
      ...[20, 80, 250].map((x): GutterLine => ({
        horizontal: false,
        c: x,
        a: -10,
        b: 60,
        strip: 24,
        pieces: [{ a: -10, b: 60, owner: 1, strip: 24, gap: { kind: 'row', index: 0 } }],
      })),
    ];
    const { network } = buildNetwork(lines, [], 200);
    // Line 0 has segments 20–80 and 80–250: the first's midpoint (50) hugs, the second's (165) does not.
    const first0 = network.segment[0] ?? 0;
    expect([network.hug[first0], network.hug[first0 + 1]]).toEqual([1, 0]);
    // The hugging segment records the length of the ring side it runs along (100), the other none.
    expect([network.hugSide[first0], network.hugSide[first0 + 1]]).toEqual([100, 0]);
    expect(network.exclusive[first0]).toBe(-1);
    const first1 = network.segment[1] ?? 0;
    expect([network.exclusive[first1], network.exclusive[first1 + 1]]).toEqual([7, 7]);
  });
});

describe('margin segments', () => {
  it('marks a segment as in the canvas margin where every piece covering it is the canvas ring hugging there', () => {
    const ring = { owner: 0, strip: 24, gap: { kind: 'ring', side: 'top' } } as const;
    const lines: GutterLine[] = [
      {
        horizontal: true,
        c: 0,
        a: 0,
        b: 300,
        strip: 24,
        pieces: [
          { ...ring, a: 0, b: 300, hugSpans: [[0, 300]], margin: true },
          // A zone's ring side merged into the canvas ring over 0–100: there the segment hugs a ring side.
          { ...ring, a: 0, b: 100, owner: 1, hugSpans: [[0, 100]] },
        ],
      },
      {
        horizontal: true,
        c: 50,
        a: 0,
        b: 300,
        strip: 24,
        pieces: [{ a: 0, b: 300, owner: 0, strip: 24, gap: { kind: 'row', index: 0 } }],
      },
      ...[20, 80, 250].map((x): GutterLine => ({
        horizontal: false,
        c: x,
        a: -10,
        b: 60,
        strip: 24,
        pieces: [{ a: -10, b: 60, owner: 0, strip: 24, gap: { kind: 'row', index: 0 } }],
      })),
    ];
    const { network } = buildNetwork(lines, [], 200);
    const first = network.segment[0] ?? 0;
    expect([network.hug[first], network.hug[first + 1]]).toEqual([HUG_RING, HUG_MARGIN]);
    // Where pieces of several borders cover a segment, the longest stretch counts (the canvas's side here).
    expect([network.hugSide[first], network.hugSide[first + 1]]).toEqual([300, 300]);
    // A gap costs its length.
    const gap = network.segment[1] ?? 0;
    expect([network.hug[gap], network.hug[gap + 1]]).toEqual([HUG_NONE, HUG_NONE]);
  });
});

describe('pieceKey', () => {
  it('names a gutter piece by its container and gap, which survive a re-pack with pinned arrangements', () => {
    const piece = { a: 0, b: 1, owner: 3, strip: 24 };
    expect(pieceKey({ ...piece, gap: { kind: 'ring', side: 'left' } })).toBe('3:ring:left');
    expect(pieceKey({ ...piece, gap: { kind: 'row', index: 2 } })).toBe('3:row:2');
    expect(pieceKey({ ...piece, gap: { kind: 'card-column', index: 1 } })).toBe('3:card-column:1');
    expect(pieceKey({ ...piece, gap: { kind: 'zone-column', row: 1, index: 0 } })).toBe('3:zone-column:1.0');
    expect(pieceKey({ ...piece, gap: { kind: 'stack', row: 1, cell: 2, index: 0 } })).toBe('3:stack:1.2.0');
    expect(pieceKey({ ...piece, gap: { kind: 'port', key: '7.1' } })).toBe('3:port:7.1');
  });
});
