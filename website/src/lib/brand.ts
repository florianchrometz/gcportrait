// SPDX-License-Identifier: MIT
/**
 * gcportrait's mark from its one source file, brand/icon.svg at the repository root (brand/README.md; decision of
 * 2026-10-11). The website's favicon is that file as it is (astro.config.ts copies it to /favicon.svg), and the logo in
 * the header and the footer (src/components/Logo.astro) draws the same shapes in the same colours, read from the file
 * here at build time. The app's favicon is the same file (frontend/vite.config.ts, BRAND_ICON).
 *
 * The file is a few rounded rectangles (`<rect>`) coloured by a `<style>`: class rules with the light colours, and the
 * same rules inside `@media (prefers-color-scheme: dark)` with the dark ones, so one file follows the visitor's theme.
 * `drawingOfSvg` reads such a file (or any SVG of rectangles coloured by attributes, such as the README's wordmarks)
 * into a Drawing: each shape's geometry and its fill, stroke and stroke width in either theme. The logo writes the
 * light colours as attributes and the dark ones as custom properties that its stylesheet applies in the dark theme
 * (`logoShapeAttributes`); `drawingOfLogo` reads a drawn logo back into a Drawing, so a test and `pnpm website:check`
 * can tell that the favicon and the logo are the same drawing. Anything in the file the logo could not follow (another
 * element, another selector or property, another at-rule) is refused, so the build fails instead of drawing a
 * different mark.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { repoRoot } from './repo.js';

/** The mark's one source file, relative to the repository root. */
export const BRAND_ICON = 'brand/icon.svg';

/** How a shape is painted in one theme: colours as lowercase six-digit hex (or a keyword), widths as plain numbers. */
export type Paint = { readonly fill: string; readonly stroke: string; readonly strokeWidth: string };

/** A rounded rectangle of the mark: its geometry (in the drawing's own units) and its paint in either theme. */
export type Shape = {
  readonly x: string;
  readonly y: string;
  readonly width: string;
  readonly height: string;
  readonly rx: string;
  readonly light: Paint;
  readonly dark: Paint;
};

export type Drawing = { readonly viewBox: string; readonly shapes: readonly Shape[] };

/** A problem with a drawing the mark's derivation cannot follow; the message names what and where. */
export class BrandError extends Error {
  override readonly name = 'BrandError';
}

/** SVG's initial values: no fill given is black, no stroke none, no stroke width 1. */
const DEFAULT_PAINT: Paint = { fill: '#000000', stroke: 'none', strokeWidth: '1' };

/** The paint properties a rule or an attribute may set, and the Paint field each sets. */
const PAINT_PROPERTIES: Readonly<Record<string, keyof Paint>> = {
  fill: 'fill',
  stroke: 'stroke',
  'stroke-width': 'strokeWidth',
};

const GEOMETRY = ['x', 'y', 'width', 'height', 'rx'] as const;

/** The elements a drawing of the mark may hold. */
const ELEMENTS = new Set(['svg', 'g', 'style', 'rect', 'title', 'desc']);

/** A colour as one spelling: lowercase, #abc as #aabbcc. */
export function normalColour(value: string): string {
  const colour = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(colour);
  return short === null
    ? colour
    : `#${short[1] ?? ''}${short[1] ?? ''}${short[2] ?? ''}${short[2] ?? ''}${short[3] ?? ''}${short[3] ?? ''}`;
}

/** A number as one spelling ("1.60" → "1.6", "03" → "3"). */
function normalNumber(value: string, where: string): string {
  const number = Number(value.trim());
  if (value.trim() === '' || !Number.isFinite(number))
    throw new BrandError(`${where}: "${value}" is not a number`);
  return String(number);
}

function normalPaintValue(field: keyof Paint, value: string, where: string): string {
  return field === 'strokeWidth' ? normalNumber(value, where) : normalColour(value);
}

/** The attributes of one start tag's text (after its name), names lowercased, values decoded from &quot; and &amp;. */
function attributesOf(text: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of text.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes.set(
      (match[1] ?? '').toLowerCase(),
      (match[2] ?? match[3] ?? '')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&'),
    );
  }
  return attributes;
}

/** The declarations of a style text ("fill:#fff;stroke:#1a73e8"), by property. */
function declarationsOf(text: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const part of text.split(';')) {
    if (part.trim() === '') continue;
    const colon = part.indexOf(':');
    if (colon < 0) throw new BrandError(`a declaration without a value: "${part.trim()}"`);
    declarations.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim());
  }
  return declarations;
}

type Rule = { readonly classes: readonly string[]; readonly paint: Partial<Paint>; readonly dark: boolean };

/** The paint of a declaration block, refusing any property but fill, stroke and stroke-width. */
function paintOf(declarations: Map<string, string>, where: string): Partial<Paint> {
  const paint: { -readonly [K in keyof Paint]?: string } = {};
  for (const [property, value] of declarations) {
    const field = PAINT_PROPERTIES[property];
    if (field === undefined)
      throw new BrandError(`${where}: the property ${property} (only fill, stroke, stroke-width)`);
    paint[field] = normalPaintValue(field, value, `${where} ${property}`);
  }
  return paint;
}

/**
 * The rules of a stylesheet: top-level class rules (light), and class rules inside `@media (prefers-color-scheme:
 * dark)` (dark). Every selector must be a single class (`.f`, or a list of them).
 */
function rulesOf(css: string): Rule[] {
  const rules: Rule[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = (source: string, dark: boolean): void => {
    let index = 0;
    while (index < source.length) {
      const open = source.indexOf('{', index);
      if (open < 0) {
        if (source.slice(index).trim() !== '')
          throw new BrandError(`stray text in the <style>: "${source.slice(index).trim()}"`);
        return;
      }
      const prelude = source.slice(index, open).trim();
      // The block's end: the matching brace (a @media block holds rules of its own).
      let depth = 1;
      let close = open + 1;
      while (close < source.length && depth > 0) {
        if (source[close] === '{') depth += 1;
        else if (source[close] === '}') depth -= 1;
        close += 1;
      }
      if (depth !== 0) throw new BrandError('an unclosed block in the <style>');
      const body = source.slice(open + 1, close - 1);
      if (prelude.startsWith('@')) {
        if (dark || !/^@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/.test(prelude))
          throw new BrandError(
            `the at-rule "${prelude}" (only one @media (prefers-color-scheme: dark) block)`,
          );
        blocks(body, true);
      } else {
        const classes = prelude.split(',').map((selector) => selector.trim());
        for (const selector of classes) {
          if (!/^\.[A-Za-z_][-A-Za-z0-9_]*$/.test(selector))
            throw new BrandError(`the selector "${selector}" (only single classes, such as .f)`);
        }
        rules.push({
          classes: classes.map((selector) => selector.slice(1)),
          paint: paintOf(declarationsOf(body), `the rule ${prelude}`),
          dark,
        });
      }
      index = close;
    }
  };
  blocks(text, false);
  return rules;
}

/** The viewBox of the first <svg> start tag, as four plain numbers. */
function viewBoxOf(svg: string): string {
  const tag = /<svg\b([^>]*)>/i.exec(svg);
  const value = tag === null ? undefined : attributesOf(tag[1] ?? '').get('viewbox');
  if (value === undefined) throw new BrandError('no <svg viewBox>');
  return value
    .trim()
    .split(/[\s,]+/)
    .map((part) => normalNumber(part, 'the viewBox'))
    .join(' ');
}

/** Refuses an element the mark's drawing may not hold (comments, the XML declaration and the text of <title> aside). */
function checkElements(svg: string): void {
  const markup = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
  for (const match of markup.matchAll(/<([a-zA-Z][\w:-]*)/g)) {
    const name = (match[1] ?? '').toLowerCase();
    if (!ELEMENTS.has(name)) throw new BrandError(`the element <${name}> (only rect, g, style, title, desc)`);
  }
}

/** The geometry of a <rect>'s attributes, rx 0 when it has none. */
function geometryOf(attributes: Map<string, string>, where: string): Pick<Shape, (typeof GEOMETRY)[number]> {
  const value = (name: string, fallback?: string): string => {
    const raw = attributes.get(name) ?? fallback;
    if (raw === undefined) throw new BrandError(`${where} has no ${name}`);
    return normalNumber(raw, `${where} ${name}`);
  };
  return {
    x: value('x', '0'),
    y: value('y', '0'),
    width: value('width'),
    height: value('height'),
    rx: value('rx', '0'),
  };
}

/** The paint a <rect>'s presentation attributes set (fill, stroke, stroke-width). */
function attributePaint(attributes: Map<string, string>, where: string): Partial<Paint> {
  const paint: { -readonly [K in keyof Paint]?: string } = {};
  for (const [property, field] of Object.entries(PAINT_PROPERTIES)) {
    const value = attributes.get(property);
    if (value !== undefined) paint[field] = normalPaintValue(field, value, `${where} ${property}`);
  }
  return paint;
}

/** The <rect> elements of an SVG text, each as its attributes, in document order. */
function rectsOf(svg: string): Map<string, string>[] {
  return [...svg.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<rect\b([^>]*?)\/?>/gi)].map((match) =>
    attributesOf(match[1] ?? ''),
  );
}

/**
 * The drawing of a standalone SVG of the mark: brand/icon.svg (rectangles coloured by class rules, light at the top
 * level and dark in `@media (prefers-color-scheme: dark)`), or a copy coloured by attributes alone (then both themes
 * are the same). A class rule wins over an attribute, as in a browser; rules apply in order. Throws a BrandError for
 * anything the logo could not follow.
 */
export function drawingOfSvg(svg: string): Drawing {
  checkElements(svg);
  const rules = [...svg.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].flatMap((match) =>
    rulesOf(match[1] ?? ''),
  );
  const shapes = rectsOf(svg).map((attributes, index): Shape => {
    const where = `<rect> ${String(index + 1)}`;
    for (const name of attributes.keys()) {
      if (![...GEOMETRY, 'class', 'fill', 'stroke', 'stroke-width'].includes(name))
        throw new BrandError(
          `${where}: the attribute ${name} (only geometry, class, fill, stroke, stroke-width)`,
        );
    }
    const classes = new Set((attributes.get('class') ?? '').split(/\s+/).filter((name) => name !== ''));
    const matching = (dark: boolean): Partial<Paint> =>
      Object.assign(
        {},
        ...rules
          .filter((rule) => rule.dark === dark && rule.classes.some((name) => classes.has(name)))
          .map((rule) => rule.paint),
      ) as Partial<Paint>;
    const light: Paint = { ...DEFAULT_PAINT, ...attributePaint(attributes, where), ...matching(false) };
    return { ...geometryOf(attributes, where), light, dark: { ...light, ...matching(true) } };
  });
  if (shapes.length === 0) throw new BrandError('no <rect>');
  return { viewBox: viewBoxOf(svg), shapes };
}

/** The custom properties a logo shape carries its dark paint in, applied by Logo.astro's stylesheet. */
export const DARK_PROPERTIES: Readonly<Record<keyof Paint, string>> = {
  fill: '--dark-fill',
  stroke: '--dark-stroke',
  strokeWidth: '--dark-stroke-width',
};

/**
 * The attributes of one shape of the logo (src/components/Logo.astro): its geometry, its light paint as presentation
 * attributes (so it draws without any stylesheet), and its dark paint as custom properties in `style`, which the
 * component's stylesheet applies under `prefers-color-scheme: dark`.
 */
export function logoShapeAttributes(shape: Shape): Record<string, string> {
  return {
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
    rx: shape.rx,
    fill: shape.light.fill,
    stroke: shape.light.stroke,
    'stroke-width': shape.light.strokeWidth,
    style: (Object.keys(DARK_PROPERTIES) as (keyof Paint)[])
      .map((field) => `${DARK_PROPERTIES[field]}:${shape.dark[field]}`)
      .join(';'),
  };
}

/**
 * The drawing of a logo as the build wrote it (an `<svg class="logo">…</svg>` of the page): the light paint from each
 * shape's attributes, the dark paint from its custom properties (`logoShapeAttributes`). Data attributes (Astro's
 * scoping) and the class are ignored.
 */
export function drawingOfLogo(svg: string): Drawing {
  checkElements(svg);
  const shapes = rectsOf(svg).map((attributes, index): Shape => {
    const where = `logo <rect> ${String(index + 1)}`;
    const light: Paint = { ...DEFAULT_PAINT, ...attributePaint(attributes, where) };
    const style = declarationsOf(attributes.get('style') ?? '');
    const dark = { ...light };
    for (const field of Object.keys(DARK_PROPERTIES) as (keyof Paint)[]) {
      const value = style.get(DARK_PROPERTIES[field]);
      if (value === undefined) throw new BrandError(`${where} has no ${DARK_PROPERTIES[field]}`);
      dark[field] = normalPaintValue(field, value, `${where} ${DARK_PROPERTIES[field]}`);
    }
    return { ...geometryOf(attributes, where), light, dark };
  });
  if (shapes.length === 0) throw new BrandError('the logo has no <rect>');
  return { viewBox: viewBoxOf(svg), shapes };
}

/** Where two drawings differ, as short phrases (empty when they are the same drawing). */
export function drawingDifferences(expected: Drawing, actual: Drawing): string[] {
  const differences: string[] = [];
  if (expected.viewBox !== actual.viewBox)
    differences.push(`viewBox ${actual.viewBox}, not ${expected.viewBox}`);
  if (expected.shapes.length !== actual.shapes.length)
    differences.push(`${String(actual.shapes.length)} shapes, not ${String(expected.shapes.length)}`);
  expected.shapes.forEach((shape, index) => {
    const other = actual.shapes[index];
    if (other === undefined) return;
    const where = `shape ${String(index + 1)}`;
    for (const key of GEOMETRY) {
      if (shape[key] !== other[key]) differences.push(`${where}: ${key} ${other[key]}, not ${shape[key]}`);
    }
    for (const theme of ['light', 'dark'] as const) {
      for (const field of ['fill', 'stroke', 'strokeWidth'] as const) {
        if (shape[theme][field] !== other[theme][field])
          differences.push(`${where}, ${theme}: ${field} ${other[theme][field]}, not ${shape[theme][field]}`);
      }
    }
  });
  return differences;
}

let cached: Drawing | undefined;

/** The mark as brand/icon.svg draws it, read once per build. */
export function brandDrawing(): Drawing {
  if (cached !== undefined) return cached;
  const file = path.join(repoRoot(), BRAND_ICON);
  try {
    cached = drawingOfSvg(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error instanceof BrandError)
      throw new BrandError(`${BRAND_ICON}: ${error.message} (brand/README.md)`);
    throw error;
  }
  return cached;
}
