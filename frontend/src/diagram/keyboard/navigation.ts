// SPDX-License-Identifier: Apache-2.0
/**
 * Arrow-key navigation on the interactive canvas (style skill §13). Pure: the drawing's rects and nesting
 * in, the next item to focus out; the canvas moves focus and the camera (DiagramCanvas.tsx).
 *
 * **Items.** Every solid node (a card, a chip, a card-sized empty zone) and, when the canvas flips zones,
 * every open zone, whose collapse button over its header icon stands for it (an open zone takes focus only
 * there). Each item belongs to a **zone**: the nearest open zone around it that is an item itself, or the canvas.
 * Without collapse buttons no open zone is an item, so every solid node belongs to the canvas and the arrows
 * move across the whole drawing.
 *
 * **Keys.**
 *
 * | Key | Moves to |
 * |---|---|
 * | ← → ↑ ↓ | the nearest item of the same zone in that direction: one whose rect lies wholly beyond the item's edge, those level with it first (overlapping across the direction), then the nearest by gap (the gap across counts twice) |
 * | ↓ on an open zone | its first item (reading order): the zone's content lies below its header |
 * | an arrow with nothing in that direction in the zone | ↑: the zone itself (its header is above its content); else the nearest item in that direction among the zone's own neighbours, and so on outwards |
 * | Home / End | the first / last item of the zone, in reading order (top to bottom, then left to right) |
 *
 * Escape's target, the zone around an item, is `zoneOf`. Enter, Space and the menu keys stay the canvas's.
 */
import type { LayoutRect } from '@gcportrait/layout';

export type NavigationKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

const KEYS: ReadonlySet<string> = new Set<NavigationKey>([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
]);

export function isNavigationKey(key: string): key is NavigationKey {
  return KEYS.has(key);
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What navigation reads of a layout rect (`DiagramModel.rects` holds them, parents before children). */
export type NavigationRect = Pick<LayoutRect, 'x' | 'y' | 'width' | 'height' | 'parent' | 'role'>;

/** The items of a drawing, grouped by zone (`null`: the canvas), each zone's items in reading order. */
export interface KeyboardMap {
  /** The zone each item belongs to (`null`: the canvas). */
  readonly zone: ReadonlyMap<string, string | null>;
  /** The items of each zone (`null`: the canvas's), in reading order. */
  readonly items: ReadonlyMap<string | null, readonly string[]>;
  readonly boxes: ReadonlyMap<string, Box>;
  /** Open zones that are items (their collapse buttons stand for them). */
  readonly zones: ReadonlySet<string>;
}

/** Rects closer than this (drawing units) count as touching: the layout's coordinates are exact sums. */
const EPSILON = 0.5;

function readingOrder(a: Box, b: Box): number {
  return a.y - b.y || a.x - b.x;
}

/**
 * The items of a drawing (its rects: `DiagramModel.rects`). `zonesAreItems`: the canvas draws collapse buttons,
 * so open zones take focus and hold the items inside them; otherwise only solid nodes are items, all of
 * the canvas.
 */
export function keyboardMap(
  rects: ReadonlyArray<readonly [string, NavigationRect]>,
  zonesAreItems: boolean,
): KeyboardMap {
  const byId = new Map<string, NavigationRect>(rects);
  const isItem = (rect: NavigationRect): boolean => rect.role !== 'zone' || zonesAreItems;
  const zone = new Map<string, string | null>();
  const items = new Map<string | null, string[]>();
  const boxes = new Map<string, Box>();
  const zones = new Set<string>();
  for (const [id, rect] of rects) {
    if (!isItem(rect)) continue;
    if (rect.role === 'zone') zones.add(id);
    boxes.set(id, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    // The nearest rect around it that is an item (an open zone), else the canvas.
    let owner: string | null = rect.parent;
    let depth = 0;
    while (owner !== null && depth <= rects.length) {
      const around = byId.get(owner);
      if (around === undefined) {
        owner = null;
        break;
      }
      if (isItem(around)) break;
      owner = around.parent;
      depth += 1;
    }
    zone.set(id, owner);
    const list = items.get(owner);
    if (list === undefined) items.set(owner, [id]);
    else list.push(id);
  }
  for (const list of items.values()) {
    list.sort((a, b) => {
      const boxA = boxes.get(a);
      const boxB = boxes.get(b);
      return boxA === undefined || boxB === undefined ? 0 : readingOrder(boxA, boxB);
    });
  }
  return { zone, items, boxes, zones };
}

/** The zone an item belongs to, when that is an open zone (Escape's target); null at the canvas. */
export function zoneOf(map: KeyboardMap, id: string): string | null {
  return map.zone.get(id) ?? null;
}

type Direction = 'left' | 'right' | 'up' | 'down';

const DIRECTIONS: Readonly<Record<Exclude<NavigationKey, 'Home' | 'End'>, Direction>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/** The gap between two intervals (0 when they overlap or touch) and whether they overlap. */
function across(a0: number, a1: number, b0: number, b1: number): { gap: number; overlap: boolean } {
  const overlap = Math.min(a1, b1) - Math.max(a0, b0);
  return { gap: Math.max(0, -overlap), overlap: overlap > EPSILON };
}

interface Candidate {
  readonly level: boolean;
  readonly distance: number;
  readonly offset: number;
}

/** How `to` lies in `direction` from `from`: null when it is not wholly beyond `from`'s edge. */
function candidate(from: Box, to: Box, direction: Direction): Candidate | null {
  const horizontal = direction === 'left' || direction === 'right';
  let along: number;
  switch (direction) {
    case 'right':
      along = to.x - (from.x + from.width);
      break;
    case 'left':
      along = from.x - (to.x + to.width);
      break;
    case 'down':
      along = to.y - (from.y + from.height);
      break;
    case 'up':
      along = from.y - (to.y + to.height);
      break;
  }
  if (along < -EPSILON) return null;
  const side = horizontal
    ? across(from.y, from.y + from.height, to.y, to.y + to.height)
    : across(from.x, from.x + from.width, to.x, to.x + to.width);
  const offset = horizontal
    ? Math.abs(from.y + from.height / 2 - (to.y + to.height / 2))
    : Math.abs(from.x + from.width / 2 - (to.x + to.width / 2));
  return { level: side.overlap, distance: Math.max(0, along) + 2 * side.gap, offset };
}

function better(a: Candidate, b: Candidate): boolean {
  if (a.level !== b.level) return a.level;
  if (a.distance !== b.distance) return a.distance < b.distance;
  return a.offset < b.offset;
}

/** The nearest of `ids` in `direction` from the box `from` (never `skip`); null when none lies that way. */
function nearest(
  map: KeyboardMap,
  ids: readonly string[],
  from: Box,
  direction: Direction,
  skip: string,
): string | null {
  let best: { readonly id: string; readonly score: Candidate } | null = null;
  for (const id of ids) {
    if (id === skip) continue;
    const box = map.boxes.get(id);
    if (box === undefined) continue;
    const score = candidate(from, box, direction);
    if (score !== null && (best === null || better(score, best.score))) best = { id, score };
  }
  return best?.id ?? null;
}

/**
 * The item a navigation key moves to from the item `from`; null when it stays (nothing in that direction, or
 * `from` is no item of the map).
 */
export function navigate(map: KeyboardMap, from: string, key: NavigationKey): string | null {
  const box = map.boxes.get(from);
  if (box === undefined) return null;
  const owner = zoneOf(map, from);
  const siblings = map.items.get(owner) ?? [];
  if (key === 'Home' || key === 'End') {
    const target = key === 'Home' ? siblings[0] : siblings[siblings.length - 1];
    return target === undefined || target === from ? null : target;
  }
  const direction = DIRECTIONS[key];
  // ↓ on an open zone goes inside it: its content lies below its header.
  if (direction === 'down' && map.zones.has(from)) {
    const first = map.items.get(from)?.[0];
    if (first !== undefined) return first;
  }
  const found = nearest(map, siblings, box, direction, from);
  if (found !== null) return found;
  // Nothing that way in the zone: ↑ reaches the zone's header; the other arrows look among the zone's neighbours.
  let zone = owner;
  while (zone !== null) {
    if (direction === 'up') return zone;
    const outer = zoneOf(map, zone);
    const next = nearest(map, map.items.get(outer) ?? [], box, direction, zone);
    if (next !== null) return next;
    zone = outer;
  }
  return null;
}
