// SPDX-License-Identifier: Apache-2.0
/**
 * Arrow-key navigation (style skill §13): a hand-made drawing whose geometry is known, and the demo
 * organisations as the app lays them out, where every item must be reachable from the first by the keys alone and
 * every arrow must move the way it points.
 */
import type { DetailLevel, DemoSize, LensId } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import { buildDiagramModel } from '../model';
import { demoDiagram } from '../testing/demoScenes';
import {
  isNavigationKey,
  keyboardMap,
  navigate,
  zoneOf,
  type KeyboardMap,
  type NavigationKey,
  type NavigationRect,
} from './navigation';

function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  parent: string | null,
  role: NavigationRect['role'] = 'card',
): NavigationRect {
  return { x, y, width, height, parent, role };
}

/**
 * Zone A holds two rows of cards (a1 a2 a3 / a4 a5); beside it zone B (card b1) stacked over zone C (card c1);
 * card d below A at the top level.
 */
const RECTS: ReadonlyArray<readonly [string, NavigationRect]> = [
  ['A', rect(0, 0, 400, 200, null, 'zone')],
  ['B', rect(420, 0, 300, 100, null, 'zone')],
  ['C', rect(420, 120, 300, 80, null, 'zone')],
  ['d', rect(0, 220, 148, 44, null)],
  ['a1', rect(10, 40, 100, 44, 'A')],
  ['a2', rect(130, 40, 100, 44, 'A')],
  ['a3', rect(250, 40, 100, 44, 'A')],
  ['a4', rect(10, 100, 100, 44, 'A')],
  ['a5', rect(130, 100, 100, 44, 'A', 'chip')],
  ['b1', rect(430, 40, 148, 44, 'B')],
  ['c1', rect(430, 150, 148, 44, 'C', 'empty')],
];

describe('keyboardMap', () => {
  it('groups the items by the open zone around them, in reading order', () => {
    const map = keyboardMap(RECTS, true);
    expect(map.items.get(null)).toEqual(['A', 'B', 'C', 'd']);
    expect(map.items.get('A')).toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);
    expect(zoneOf(map, 'a5')).toBe('A');
    expect(zoneOf(map, 'A')).toBeNull();
    expect([...map.zones]).toEqual(['A', 'B', 'C']);
  });

  it('without collapse buttons, makes every solid node an item of the canvas', () => {
    const map = keyboardMap(RECTS, false);
    expect(map.items.get(null)).toEqual(['a1', 'a2', 'a3', 'b1', 'a4', 'a5', 'c1', 'd']);
    expect(zoneOf(map, 'a1')).toBeNull();
    expect(map.zones.size).toBe(0);
    expect(navigate(map, 'a3', 'ArrowRight')).toBe('b1');
    expect(navigate(map, 'b1', 'ArrowDown')).toBe('c1');
  });
});

describe('navigate', () => {
  const map = keyboardMap(RECTS, true);
  const go = (from: string, ...keys: NavigationKey[]): string | null =>
    keys.reduce<string | null>((at, key) => (at === null ? null : (navigate(map, at, key) ?? at)), from);

  it('moves between the cards of a zone, level ones first, then the nearest', () => {
    expect(navigate(map, 'a1', 'ArrowRight')).toBe('a2');
    expect(navigate(map, 'a2', 'ArrowLeft')).toBe('a1');
    expect(navigate(map, 'a1', 'ArrowDown')).toBe('a4');
    expect(navigate(map, 'a5', 'ArrowUp')).toBe('a2');
    // No card below a3 is level with it: the nearest, counting the gap across twice.
    expect(navigate(map, 'a3', 'ArrowDown')).toBe('a5');
  });

  it('goes to the first and last item of the zone with Home and End', () => {
    expect(navigate(map, 'a5', 'Home')).toBe('a1');
    expect(navigate(map, 'a1', 'End')).toBe('a5');
    expect(navigate(map, 'a1', 'Home')).toBeNull();
    expect(navigate(map, 'd', 'Home')).toBe('A');
  });

  it('enters an open zone with ↓ and leaves it upwards through its header', () => {
    expect(navigate(map, 'A', 'ArrowDown')).toBe('a1');
    expect(navigate(map, 'a2', 'ArrowUp')).toBe('A');
    expect(navigate(map, 'A', 'ArrowUp')).toBeNull();
    expect(go('B', 'ArrowDown')).toBe('b1');
  });

  it('carries on among the zone’s neighbours when nothing in the zone lies that way', () => {
    expect(navigate(map, 'a3', 'ArrowRight')).toBe('B');
    expect(navigate(map, 'a4', 'ArrowDown')).toBe('d');
    expect(navigate(map, 'b1', 'ArrowDown')).toBe('C');
    expect(navigate(map, 'b1', 'ArrowLeft')).toBe('A');
    expect(navigate(map, 'a1', 'ArrowLeft')).toBeNull();
    expect(navigate(map, 'A', 'ArrowRight')).toBe('B');
  });

  it('answers null for anything that is no item', () => {
    expect(navigate(map, 'nowhere', 'ArrowRight')).toBeNull();
    expect(isNavigationKey('ArrowUp')).toBe(true);
    expect(isNavigationKey('Enter')).toBe(false);
  });
});

const KEYS: readonly NavigationKey[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

/** Whether `to` lies wholly beyond `from` in the arrow's direction (half a unit of slack). */
function beyond(map: KeyboardMap, from: string, to: string, key: NavigationKey): boolean {
  const a = map.boxes.get(from);
  const b = map.boxes.get(to);
  if (a === undefined || b === undefined) return false;
  switch (key) {
    case 'ArrowRight':
      return b.x >= a.x + a.width - 0.5;
    case 'ArrowLeft':
      return b.x + b.width <= a.x + 0.5;
    case 'ArrowDown':
      return b.y >= a.y + a.height - 0.5;
    case 'ArrowUp':
      return b.y + b.height <= a.y + 0.5;
    default:
      return true;
  }
}

/** Whether `zone` is `id`'s zone or one around it. */
function around(map: KeyboardMap, id: string, zone: string): boolean {
  for (let at = zoneOf(map, id); at !== null; at = zoneOf(map, at)) if (at === zone) return true;
  return false;
}

const VIEWS: ReadonlyArray<readonly [DemoSize, LensId, DetailLevel]> = [
  ['S', 'overview', 'auto'],
  ['M', 'overview', 'auto'],
  ['M', 'overview', 'all'],
  ['M', 'networking', 'networks'],
  ['L', 'overview', 'projects'],
];

describe('navigate on the demo organisations', () => {
  for (const [size, lens, detail] of VIEWS) {
    // Without collapse buttons every solid node is an item of one canvas: S and M prove that mode, L the zoned one.
    for (const zonesAreItems of size === 'L' ? [true] : [true, false]) {
      it(`reaches every item of ${size} ${lens} at ${detail} by the keys alone, each arrow the way it points${
        zonesAreItems ? '' : ' (no collapse buttons)'
      }`, async () => {
        const diagram = await demoDiagram(size, lens, detail);
        const model = buildDiagramModel(diagram.input);
        const map = keyboardMap(model.rects, zonesAreItems);
        const all = [...map.boxes.keys()];
        expect(all.length).toBeGreaterThan(0);
        const first = map.items.get(null)?.[0];
        if (first === undefined) throw new Error('no item at the top level');
        const seen = new Set([first]);
        const queue = [first];
        for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
          for (const key of KEYS) {
            const next = navigate(map, at, key);
            if (next === null) continue;
            expect(next).not.toBe(at);
            if (key === 'Home' || key === 'End') {
              expect(zoneOf(map, next)).toBe(zoneOf(map, at));
            } else if (key === 'ArrowDown' && zoneOf(map, next) === at) {
              // ↓ into an open zone.
            } else if (key === 'ArrowUp' && around(map, at, next)) {
              // ↑ out to the zone's header.
            } else {
              expect(beyond(map, at, next, key), `${key} from ${at} to ${next}`).toBe(true);
            }
            if (!seen.has(next)) {
              seen.add(next);
              queue.push(next);
            }
          }
        }
        expect(all.filter((id) => !seen.has(id))).toEqual([]);
      }, 60_000);
    }
  }
});
