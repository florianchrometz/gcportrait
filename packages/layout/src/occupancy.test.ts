// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { Occupancy } from './occupancy.js';

describe('Occupancy', () => {
  const index = (): Occupancy => {
    const occupancy = new Occupancy(8);
    occupancy.add(true, 100, 0, 200, 1); // horizontal, y = 100, x 0…200, holder 1
    occupancy.add(false, 50, 300, 400, 2); // vertical, x = 50, y 300…400, holder 2
    return occupancy;
  };

  it('blocks a parallel segment of another holder closer than the clearance alongside it', () => {
    const occupancy = index();
    expect(occupancy.blocked(true, 100, 150, 250, 3)).toBe(true);
    expect(occupancy.blocked(true, 107.5, 10, 20, 3)).toBe(true);
    expect(occupancy.blocked(true, 92.5, 10, 20, 3)).toBe(true);
    expect(occupancy.blocked(false, 45, 350, 360, 3)).toBe(true);
  });

  it('lets a segment pass at the clearance, beside the other’s ends, across it, or of the same holder', () => {
    const occupancy = index();
    expect(occupancy.blocked(true, 108, 10, 20, 3)).toBe(false);
    expect(occupancy.blocked(true, 92, 10, 20, 3)).toBe(false);
    // Touching an end is not running alongside.
    expect(occupancy.blocked(true, 100, 200, 300, 3)).toBe(false);
    expect(occupancy.blocked(true, 100, -50, 0, 3)).toBe(false);
    // Perpendicular segments cross; they never block.
    expect(occupancy.blocked(false, 100, 0, 200, 3)).toBe(false);
    // A holder never blocks itself (a bundle's members share their lanes).
    expect(occupancy.blocked(true, 100, 0, 200, 1)).toBe(false);
  });

  it('finds long segments from any of the cells they span, in either direction', () => {
    const occupancy = new Occupancy(8);
    occupancy.add(true, 4000, 9000, 1000, 7);
    expect(occupancy.blocked(true, 4003, 5000, 5001, 8)).toBe(true);
    expect(occupancy.blocked(true, 4003, 9100, 8999, 8)).toBe(true);
    expect(occupancy.blocked(true, 4003, 9000, 9100, 8)).toBe(false);
  });

  it('lets two stubs come as close as the stub clearance, but a stub and a run only as close as the clearance', () => {
    const occupancy = new Occupancy(8, 6);
    occupancy.add(true, 100, 0, 20, 1, true); // a stub
    occupancy.add(true, 200, 0, 20, 2); // a run
    expect(occupancy.blocked(true, 106, 10, 30, 3, true)).toBe(false);
    expect(occupancy.blocked(true, 105, 10, 30, 3, true)).toBe(true);
    expect(occupancy.blocked(true, 106, 10, 30, 3)).toBe(true);
    expect(occupancy.blocked(true, 206, 10, 30, 3, true)).toBe(true);
    // The stub clearance never exceeds the clearance.
    const wide = new Occupancy(8, 20);
    wide.add(true, 100, 0, 20, 1, true);
    expect(wide.blocked(true, 108, 10, 30, 3, true)).toBe(false);
  });
});
