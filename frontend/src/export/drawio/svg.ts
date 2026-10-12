// SPDX-License-Identifier: MIT
/**
 * What the draw.io translator reads from SVG markup: presentation attributes with their inheritance, colours,
 * lengths, transforms and path data. Only what the diagram's components write is needed, but every reader takes the
 * general SVG syntax (relative path commands, `style` declarations, `rgb()` colours), so a drawing written by the
 * browser's serialiser reads the same as the static render's.
 */
import type { XmlElement } from './xml';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** An affine transform `[a c e; b d f]`, as SVG's `matrix(a b c d e f)`. */
export interface Matrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function multiply(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

export function apply(m: Matrix, point: Point): Point {
  return { x: m.a * point.x + m.c * point.y + m.e, y: m.b * point.x + m.d * point.y + m.f };
}

/** The transform's scale along each axis (its column lengths). */
export function scaleOf(m: Matrix): { readonly x: number; readonly y: number } {
  return { x: Math.hypot(m.a, m.b), y: Math.hypot(m.c, m.d) };
}

/** A box through a transform: the axis-aligned box around its four transformed corners. */
export function transformBox(m: Matrix, box: Box): Box {
  const corners = [
    apply(m, { x: box.x, y: box.y }),
    apply(m, { x: box.x + box.width, y: box.y }),
    apply(m, { x: box.x, y: box.y + box.height }),
    apply(m, { x: box.x + box.width, y: box.y + box.height }),
  ];
  return boundsOf(corners);
}

export function boundsOf(points: readonly Point[]): Box {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function unionBoxes(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  return boundsOf(
    boxes.flatMap((box) => [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
    ]),
  );
}

/** Whether two boxes overlap (touching edges do not count). */
export function boxesMeet(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/** The numbers in a list (`"0 -2.5 7 5"`, `"1,2"`, `"1.5.5"`). */
export function numbersIn(value: string): number[] {
  return [...value.matchAll(NUMBER)].map((match) => Number(match[0]));
}

/** A length in user units (`"13"`, `"13px"`); undefined when it is not one. */
export function parseLength(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)(px)?\s*$/.exec(value);
  return match === null ? undefined : Number(match[1]);
}

export function parseTransform(value: string | undefined): Matrix {
  if (value === undefined) return IDENTITY;
  let matrix = IDENTITY;
  for (const match of value.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const name = match[1];
    const args = numbersIn(match[2] ?? '');
    const [p = 0, q, r, s, t, u] = args;
    let step: Matrix;
    switch (name) {
      case 'matrix':
        step = { a: p, b: q ?? 0, c: r ?? 0, d: s ?? 1, e: t ?? 0, f: u ?? 0 };
        break;
      case 'translate':
        step = { ...IDENTITY, e: p, f: q ?? 0 };
        break;
      case 'scale':
        step = { ...IDENTITY, a: p, d: q ?? p };
        break;
      case 'rotate': {
        const angle = (p * Math.PI) / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const rotation: Matrix = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
        const cx = q ?? 0;
        const cy = r ?? 0;
        step = multiply(multiply({ ...IDENTITY, e: cx, f: cy }, rotation), { ...IDENTITY, e: -cx, f: -cy });
        break;
      }
      case 'skewX':
        step = { ...IDENTITY, c: Math.tan((p * Math.PI) / 180) };
        break;
      default:
        step = { ...IDENTITY, b: Math.tan((p * Math.PI) / 180) };
    }
    matrix = multiply(matrix, step);
  }
  return matrix;
}

/** An opacity value (`"0.5"`, `"50%"`); 1 when absent or unreadable. */
export function parseOpacity(value: string | undefined): number {
  if (value === undefined) return 1;
  const number = value.trim().endsWith('%') ? Number.parseFloat(value) / 100 : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 1;
}

const NAMED_COLOURS: Readonly<Record<string, string>> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  gray: '#808080',
  grey: '#808080',
};

const hex2 = (value: number): string =>
  Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0');

/**
 * A paint as draw.io writes colours: `#rrggbb` (lowercase), `none`, or null for a paint it cannot be (a gradient
 * or pattern reference, `currentColor`). An alpha channel is returned apart.
 */
export function parseColour(value: string): { readonly colour: string; readonly alpha: number } | null {
  const paint = value.trim().toLowerCase();
  if (paint === 'none' || paint === 'transparent') return { colour: 'none', alpha: 1 };
  const named = NAMED_COLOURS[paint];
  if (named !== undefined) return { colour: named, alpha: 1 };
  let match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(paint);
  if (match !== null) {
    let digits = match[1] ?? '';
    if (digits.length <= 4) digits = digits.replace(/[0-9a-f]/g, (digit) => digit + digit);
    const alpha = digits.length === 8 ? Number.parseInt(digits.slice(6), 16) / 255 : 1;
    return { colour: `#${digits.slice(0, 6)}`, alpha };
  }
  match = /^rgba?\(([^)]*)\)$/.exec(paint);
  if (match !== null) {
    const parts = (match[1] ?? '').split(/[\s,/]+/).filter((part) => part !== '');
    const channel = (part: string | undefined): number =>
      part === undefined ? 0 : part.endsWith('%') ? (Number.parseFloat(part) * 255) / 100 : Number(part);
    const alphaPart = parts[3];
    const alpha =
      alphaPart === undefined
        ? 1
        : alphaPart.endsWith('%')
          ? Number.parseFloat(alphaPart) / 100
          : Number(alphaPart);
    return {
      colour: `#${hex2(channel(parts[0]))}${hex2(channel(parts[1]))}${hex2(channel(parts[2]))}`,
      alpha,
    };
  }
  return null;
}

/** Presentation attributes that children inherit (SVG 1.1 §6.18, the ones a drawing of ours uses). */
const INHERITED = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'marker-start',
  'marker-end',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'visibility',
  'xml:space',
] as const;

export type InheritedName = (typeof INHERITED)[number];

/** The presentation attributes in effect at an element. */
export type Presentation = Readonly<Partial<Record<InheritedName, string>>>;

/** The initial values a drawing starts from (SVG's own defaults). */
export const INITIAL_PRESENTATION: Presentation = {
  fill: '#000000',
  stroke: 'none',
  'stroke-width': '1',
  'font-size': '16',
  'font-weight': '400',
  'font-family': 'sans-serif',
  'text-anchor': 'start',
};

/** An element's own presentation: its attributes, then its `style` declarations, which win. */
export function ownPresentation(element: XmlElement): Map<string, string> {
  const own = new Map<string, string>();
  for (const [name, value] of element.attributes) own.set(name, value);
  const style = element.attributes.get('style');
  if (style !== undefined) {
    for (const declaration of style.split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      const name = declaration.slice(0, colon).trim();
      const value = declaration
        .slice(colon + 1)
        .replace(/!important\s*$/, '')
        .trim();
      if (name !== '' && value !== '') own.set(name, value);
    }
  }
  return own;
}

/** The presentation in effect at `element`, given its parent's. */
export function inherit(parent: Presentation, own: ReadonlyMap<string, string>): Presentation {
  const next: Partial<Record<InheritedName, string>> = { ...parent };
  for (const name of INHERITED) {
    const value = own.get(name);
    if (value !== undefined && value !== 'inherit') next[name] = value;
  }
  return next;
}

/** A path as absolute segments; arcs keep their parameters. */
export type PathSegment =
  | { readonly type: 'M'; readonly to: Point }
  | { readonly type: 'L'; readonly to: Point }
  | {
      readonly type: 'A';
      readonly rx: number;
      readonly ry: number;
      readonly rotation: number;
      readonly large: boolean;
      readonly sweep: boolean;
      readonly to: Point;
    }
  | { readonly type: 'C'; readonly c1: Point; readonly c2: Point; readonly to: Point }
  | { readonly type: 'Q'; readonly c: Point; readonly to: Point }
  | { readonly type: 'Z' };

/** Path data as absolute segments (H and V become lines, S and T their full curves). */
export function parsePath(d: string): PathSegment[] {
  const tokens = [...d.matchAll(/[MmLlHhVvAaCcSsQqTtZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)].map(
    (match) => match[0],
  );
  const segments: PathSegment[] = [];
  let index = 0;
  let current: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let command = '';
  let lastControl: Point | null = null;
  let lastType = '';
  const next = (): number => {
    const token = tokens[index];
    if (token === undefined || /[A-Za-z]/.test(token)) throw new Error(`path data ends early: "${d}"`);
    index += 1;
    return Number(token);
  };
  const flag = (): boolean => next() !== 0;
  while (index < tokens.length) {
    const token = tokens[index] ?? '';
    if (/[A-Za-z]/.test(token)) {
      command = token;
      index += 1;
    } else if (command === '') {
      throw new Error(`path data starts without a command: "${d}"`);
    }
    const relative = command === command.toLowerCase();
    const point = (x: number, y: number): Point =>
      relative ? { x: current.x + x, y: current.y + y } : { x, y };
    switch (command.toUpperCase()) {
      case 'M': {
        current = point(next(), next());
        start = current;
        segments.push({ type: 'M', to: current });
        // Further pairs after a moveto are lines.
        command = relative ? 'l' : 'L';
        lastType = 'M';
        break;
      }
      case 'L':
        current = point(next(), next());
        segments.push({ type: 'L', to: current });
        lastType = 'L';
        break;
      case 'H': {
        const x = next();
        current = { x: relative ? current.x + x : x, y: current.y };
        segments.push({ type: 'L', to: current });
        lastType = 'L';
        break;
      }
      case 'V': {
        const y = next();
        current = { x: current.x, y: relative ? current.y + y : y };
        segments.push({ type: 'L', to: current });
        lastType = 'L';
        break;
      }
      case 'A': {
        const rx = Math.abs(next());
        const ry = Math.abs(next());
        const rotation = next();
        const large = flag();
        const sweep = flag();
        current = point(next(), next());
        segments.push({ type: 'A', rx, ry, rotation, large, sweep, to: current });
        lastType = 'A';
        break;
      }
      case 'C': {
        const c1 = point(next(), next());
        const c2 = point(next(), next());
        current = point(next(), next());
        segments.push({ type: 'C', c1, c2, to: current });
        lastControl = c2;
        lastType = 'C';
        break;
      }
      case 'S': {
        const c1: Point =
          lastType === 'C' && lastControl !== null
            ? { x: 2 * current.x - lastControl.x, y: 2 * current.y - lastControl.y }
            : current;
        const c2 = point(next(), next());
        current = point(next(), next());
        segments.push({ type: 'C', c1, c2, to: current });
        lastControl = c2;
        lastType = 'C';
        break;
      }
      case 'Q': {
        const c = point(next(), next());
        current = point(next(), next());
        segments.push({ type: 'Q', c, to: current });
        lastControl = c;
        lastType = 'Q';
        break;
      }
      case 'T': {
        const c: Point =
          lastType === 'Q' && lastControl !== null
            ? { x: 2 * current.x - lastControl.x, y: 2 * current.y - lastControl.y }
            : current;
        current = point(next(), next());
        segments.push({ type: 'Q', c, to: current });
        lastControl = c;
        lastType = 'Q';
        break;
      }
      default:
        segments.push({ type: 'Z' });
        current = start;
        lastType = 'Z';
        // A closepath takes no numbers; a number after it starts an implicit lineto in SVG 2 only.
        command = '';
    }
  }
  return segments;
}

/**
 * A box around a path's segments: the points, the control points, and around each arc's end twice its radius (the
 * whole circle the arc lies on).
 */
export function pathBounds(segments: readonly PathSegment[]): Box | null {
  const points: Point[] = [];
  for (const segment of segments) {
    switch (segment.type) {
      case 'Z':
        break;
      case 'A':
        points.push(
          { x: segment.to.x - 2 * segment.rx, y: segment.to.y - 2 * segment.ry },
          { x: segment.to.x + 2 * segment.rx, y: segment.to.y + 2 * segment.ry },
        );
        break;
      case 'C':
        points.push(segment.c1, segment.c2, segment.to);
        break;
      case 'Q':
        points.push(segment.c, segment.to);
        break;
      default:
        points.push(segment.to);
    }
  }
  return points.length === 0 ? null : boundsOf(points);
}
