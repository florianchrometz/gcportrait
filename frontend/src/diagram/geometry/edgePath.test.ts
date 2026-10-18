// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { edgePathData, fmt, simplifyPoints } from './edgePath';

const p = (x: number, y: number) => ({ x, y });

describe('fmt', () => {
  it('writes at most two decimals, no trailing zeros, never -0', () => {
    expect(fmt(12)).toBe('12');
    expect(fmt(12.5)).toBe('12.5');
    expect(fmt(1 / 3)).toBe('0.33');
    expect(fmt(-0.001)).toBe('0');
    expect(fmt(-2.255)).toBe('-2.25');
  });
});

describe('simplifyPoints', () => {
  it('drops repeated points and middle points that do not turn', () => {
    expect(simplifyPoints([p(0, 0), p(0, 0), p(10, 0), p(20, 0), p(20, 10), p(20, 10)])).toEqual([
      p(0, 0),
      p(20, 0),
      p(20, 10),
    ]);
  });
});

describe('edgePathData', () => {
  it('draws a straight edge as one line, trimmed under its heads', () => {
    expect(edgePathData([p(0, 0), p(100, 0)], { radius: 6 })).toBe('M0 0L100 0');
    expect(edgePathData([p(0, 0), p(100, 0)], { radius: 6, trimEnd: 9 })).toBe('M0 0L91 0');
    expect(edgePathData([p(0, 0), p(100, 0)], { radius: 6, trimStart: 9, trimEnd: 9 })).toBe('M9 0L91 0');
  });

  it('rounds each elbow with a quarter circle of the radius, sweeping the way the edge turns', () => {
    // Right, then down: a clockwise turn on screen (sweep 1).
    expect(edgePathData([p(0, 0), p(50, 0), p(50, 50)], { radius: 6 })).toBe(
      'M0 0L44 0A6 6 0 0 1 50 6L50 50',
    );
    // Right, then up: counter-clockwise (sweep 0).
    expect(edgePathData([p(0, 0), p(50, 0), p(50, -50)], { radius: 6 })).toBe(
      'M0 0L44 0A6 6 0 0 0 50 -6L50 -50',
    );
    // Down, then left: clockwise.
    expect(edgePathData([p(0, 0), p(0, 40), p(-40, 40)], { radius: 6 })).toBe(
      'M0 0L0 34A6 6 0 0 1 -6 40L-40 40',
    );
  });

  it('never lets two elbows overlap: at most half of a segment between them', () => {
    const d = edgePathData([p(0, 0), p(40, 0), p(40, 8), p(80, 8)], { radius: 6 });
    expect(d).toBe('M0 0L36 0A4 4 0 0 1 40 4A4 4 0 0 0 44 8L80 8');
  });

  it('keeps an arrowhead on a straight stretch, with a lead of straight line before it', () => {
    // A 12 px end segment and a 9 px head: the elbow may take only 12 − 9 − 1 = 2 px.
    const d = edgePathData([p(0, 0), p(40, 0), p(40, 12)], { radius: 6, trimEnd: 9 });
    expect(d).toBe('M0 0L38 0A2 2 0 0 1 40 2L40 3');
    // An open head is not trimmed, but its length stays straight too.
    expect(edgePathData([p(0, 0), p(40, 0), p(40, 12)], { radius: 6, straightEnd: 7 })).toBe(
      'M0 0L36 0A4 4 0 0 1 40 4L40 12',
    );
  });

  it('never trims a segment away entirely, so the marker keeps the line direction', () => {
    const d = edgePathData([p(0, 0), p(40, 0), p(40, 8)], { radius: 6, trimEnd: 9 });
    expect(d).toBe('M0 0L40 0L40 0.5');
  });

  it('gives an empty path for fewer than two distinct points', () => {
    expect(edgePathData([p(1, 1)], { radius: 6 })).toBe('');
    expect(edgePathData([p(1, 1), p(1, 1)], { radius: 6 })).toBe('');
  });
});
