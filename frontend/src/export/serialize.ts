// SPDX-License-Identifier: MIT
/**
 * The SVG serialiser of the export (skill gcp-diagram-style §7–§8). It clones a diagram `<svg>` that
 * is live in a DOM and turns the clone into a standalone file:
 *
 * - every CSS custom property (`var(--dg-…)`, in an attribute or a `style` declaration) is resolved to the
 *   export theme's token value, and `style` declarations become presentation attributes, so the file does not
 *   depend on the app's stylesheets;
 * - the interactive scaffolding (focused-edge copies, highlight rings, tab stops, roles, state classes, the
 *   camera transform) is dropped; the icons stay inline as they are;
 * - `<title>` and `<desc>` carry the scope, the lens and the read time (neutral metadata: no affiliation
 *   sentence), and the title block and the legend are required: a drawing without them is refused, never
 *   exported. The title block is the canvas's own three lines, ending with the tagline; the non-affiliation
 *   statement is in the app footer, never in a drawing (ADR 0018, placement of 2026-10-11);
 * - "current viewport": the drawing is clipped to the visible area and the title block and the legend move into
 *   bands above and below it, so they are in the file even when they are scrolled away;
 * - two encodings make the file draw the same in older editors (Illustrator, Inkscape 0.92) as in a browser,
 *   without changing what it draws: `xlink:href` beside `href` on every `<use>`, and each haloed label
 *   (`paint-order="stroke"`) written as a halo copy under the label instead of relying on `paint-order`.
 *
 * Everything here works on a detached DOM (the export renders its drawing off-screen) and in jsdom.
 */
import type { Rect } from '@gcportrait/layout';

import { fmt } from '../diagram/geometry/edgePath';
import { cssVariables, PALETTES, type DiagramTheme } from '../diagram/theme/tokens';

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const XLINK_NS = 'http://www.w3.org/1999/xlink';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

/** Thrown when a drawing cannot be exported as asked; `code` says why. */
export class ExportFormatError extends Error {
  readonly code: 'theme-mismatch' | 'missing-title-block' | 'unresolved-variable';

  constructor(code: ExportFormatError['code'], message: string) {
    super(message);
    this.name = 'ExportFormatError';
    this.code = code;
  }
}

/** The `--dg-*` custom properties of a theme, name → value (the table `tokens.css` defines). */
export function themeVariables(theme: DiagramTheme): ReadonlyMap<string, string> {
  return new Map(cssVariables(PALETTES[theme]));
}

/** How deep `var()` fallbacks may nest before a value is given up on. */
const FALLBACK_DEPTH = 8;

/**
 * A CSS value with every `var(--name[, fallback])` replaced by the variable's value, or by its fallback when the
 * variable is unknown. Null when a variable is unknown and has no fallback (the declaration is then invalid),
 * or when the value is malformed.
 */
export function resolveCustomProperties(
  value: string,
  variables: ReadonlyMap<string, string>,
  depth = 0,
): string | null {
  let resolved = '';
  let index = 0;
  for (;;) {
    const start = value.indexOf('var(', index);
    if (start < 0) return resolved + value.slice(index);
    resolved += value.slice(index, start);
    let level = 0;
    let end = -1;
    let comma = -1;
    for (let at = start + 3; at < value.length; at += 1) {
      const char = value[at];
      if (char === '(') level += 1;
      else if (char === ')') {
        level -= 1;
        if (level === 0) {
          end = at;
          break;
        }
      } else if (char === ',' && level === 1 && comma < 0) comma = at;
    }
    if (end < 0) return null;
    const name = value.slice(start + 4, comma < 0 ? end : comma).trim();
    const known = variables.get(name);
    let replacement: string | null = known ?? null;
    if (known === undefined && comma >= 0 && depth < FALLBACK_DEPTH) {
      replacement = resolveCustomProperties(value.slice(comma + 1, end).trim(), variables, depth + 1);
    }
    if (replacement === null) return null;
    resolved += replacement;
    index = end + 1;
  }
}

/** SVG presentation attributes: a `style` declaration of one of these becomes the attribute. */
const PRESENTATION = new Set([
  'clip-path',
  'clip-rule',
  'color',
  'display',
  'dominant-baseline',
  'fill',
  'fill-opacity',
  'fill-rule',
  'filter',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'marker-end',
  'marker-mid',
  'marker-start',
  'mask',
  'opacity',
  'paint-order',
  'stop-color',
  'stop-opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'text-anchor',
  'visibility',
]);

/** Splits a `style` attribute into declarations, keeping `;` inside parentheses (`url(data:…;base64,…)`). */
function declarations(style: string): Array<readonly [string, string]> {
  const parts: string[] = [];
  let level = 0;
  let from = 0;
  for (let at = 0; at < style.length; at += 1) {
    const char = style[at];
    if (char === '(') level += 1;
    else if (char === ')') level = Math.max(0, level - 1);
    else if (char === ';' && level === 0) {
      parts.push(style.slice(from, at));
      from = at + 1;
    }
  }
  parts.push(style.slice(from));
  return parts.flatMap((part) => {
    const colon = part.indexOf(':');
    if (colon < 0) return [];
    const property = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).trim();
    return property === '' || value === '' ? [] : [[property, value] as const];
  });
}

function unresolved(element: Element, name: string, value: string): ExportFormatError {
  return new ExportFormatError(
    'unresolved-variable',
    `<${element.localName}> ${name}="${value}" names a custom property the export theme does not define.`,
  );
}

/** Resolves the custom properties of one element's attributes and moves its `style` into attributes. */
function resolveElement(element: Element, variables: ReadonlyMap<string, string>): void {
  for (const attribute of [...element.attributes]) {
    if (attribute.name === 'style' || !attribute.value.includes('var(')) continue;
    const value = resolveCustomProperties(attribute.value, variables);
    if (value === null) throw unresolved(element, attribute.name, attribute.value);
    attribute.value = value;
  }
  const style = element.getAttribute('style');
  if (style === null) return;
  const kept: string[] = [];
  for (const [property, raw] of declarations(style)) {
    if (property.startsWith('--')) continue;
    const value = raw.includes('var(') ? resolveCustomProperties(raw, variables) : raw;
    if (value === null) throw unresolved(element, property, raw);
    if (PRESENTATION.has(property)) element.setAttribute(property, value.replace(/\s*!important$/, ''));
    else kept.push(`${property}: ${value}`);
  }
  if (kept.length === 0) element.removeAttribute('style');
  else element.setAttribute('style', kept.join('; '));
}

/** What only the interactive canvas carries: dropped from an export. */
const INTERACTIVE_GROUPS = ['.dg-edges-top', '.dg-marks'];
const INTERACTIVE_ATTRIBUTES = [
  'tabindex',
  'role',
  'aria-pressed',
  'aria-label',
  'aria-labelledby',
  'data-diagram-ready',
  'data-scale',
];
/** Highlight and level-of-detail classes the painter and the camera set. */
const STATE_CLASS = /^(?:is-|dg-lod-)/;

function stripInteractive(svg: SVGSVGElement): void {
  for (const selector of INTERACTIVE_GROUPS)
    for (const group of svg.querySelectorAll(selector)) group.remove();
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    for (const name of INTERACTIVE_ATTRIBUTES) element.removeAttribute(name);
    const classes = [...element.classList].filter((name) => STATE_CLASS.test(name) || name === 'dg-canvas');
    for (const name of classes) element.classList.remove(name);
    if (element.getAttribute('class') === '') element.removeAttribute('class');
  }
  // The canvas camera: the drawing is exported at its own coordinates.
  for (const viewport of svg.querySelectorAll('.dg-viewport')) viewport.removeAttribute('transform');
}

/** `xlink:href` beside `href` on every `<use>`: SVG 1.1 editors read only the former. */
function addXlinkHrefs(svg: SVGSVGElement): void {
  svg.setAttributeNS(XMLNS_NS, 'xmlns:xlink', XLINK_NS);
  for (const use of svg.querySelectorAll('use')) {
    const href = use.getAttribute('href');
    if (href !== null && !use.hasAttributeNS(XLINK_NS, 'href'))
      use.setAttributeNS(XLINK_NS, 'xlink:href', href);
  }
}

const HALO_ATTRIBUTES = ['stroke', 'stroke-width', 'stroke-linejoin', 'stroke-opacity', 'paint-order'];

/**
 * Each haloed label (`paint-order="stroke"`: the stroke in the zone's fill, under the glyphs) as two texts: the
 * halo (stroke only) and above it the label (fill only). The same picture in every renderer, also in those that
 * ignore `paint-order` and would paint the halo over the glyphs.
 */
function splitHalos(svg: SVGSVGElement): void {
  for (const text of svg.querySelectorAll('text[paint-order]')) {
    const order = text.getAttribute('paint-order')?.trim() ?? '';
    if (!order.startsWith('stroke') || !text.hasAttribute('stroke')) continue;
    const halo = text.cloneNode(true);
    if (!(halo instanceof Element)) continue;
    halo.setAttribute('fill', 'none');
    halo.removeAttribute('paint-order');
    halo.setAttribute('aria-hidden', 'true');
    halo.setAttribute('class', 'dg-halo');
    for (const inner of halo.querySelectorAll('[fill]')) inner.removeAttribute('fill');
    for (const name of HALO_ATTRIBUTES) text.removeAttribute(name);
    text.before(halo);
  }
}

/** A new SVG element in `document` with the given attributes. */
export function svgChild<K extends keyof SVGElementTagNameMap>(
  document: Document,
  name: K,
  attributes: Readonly<Record<string, string>> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

/** Sets `<title>` and `<desc>` as the root's first children (creating them when the source has none). */
function setDocumentText(svg: SVGSVGElement, title: string, desc: string): void {
  const document = svg.ownerDocument;
  const existing = (name: 'title' | 'desc'): Element => {
    const found = [...svg.children].find((child) => child.localName === name);
    return found ?? svgChild(document, name);
  };
  const titleElement = existing('title');
  const descElement = existing('desc');
  titleElement.removeAttribute('id');
  titleElement.textContent = title;
  descElement.textContent = desc;
  svg.prepend(titleElement, descElement);
}

/** Where the title block and the legend sit in the full drawing (top-left corner and size). */
export interface OverlayBoxes {
  readonly title: Rect;
  readonly legend: Rect | null;
}

export interface CropOptions {
  /** The part of the drawing to keep, in drawing coordinates. */
  readonly area: Rect;
  /** Space around the crop and between it and the title and legend bands. */
  readonly margin: number;
}

export interface PrepareOptions {
  /** The theme the source was drawn in; its tokens resolve every custom property. */
  readonly theme: DiagramTheme;
  /** `<title>`: the scope and the lens. */
  readonly title: string;
  /** `<desc>`: the scope, the lens, the read time and what drew it (no affiliation sentence). */
  readonly desc: string;
  /** The whole drawing's frame (the source's viewBox when it has one). */
  readonly frame: Rect;
  /** Where the source's title block and legend are. */
  readonly overlays: OverlayBoxes;
  /** Export only this part ("current viewport"); absent: the whole diagram. */
  readonly crop?: CropOptions | undefined;
}

export interface PreparedSvg {
  readonly svg: SVGSVGElement;
  /** The exported frame: the viewBox written on the root. */
  readonly frame: Rect;
}

function viewBoxOf(frame: Rect): string {
  return `${fmt(frame.x)} ${fmt(frame.y)} ${fmt(frame.width)} ${fmt(frame.height)}`;
}

function setFrame(svg: SVGSVGElement, frame: Rect): void {
  svg.setAttribute('width', fmt(frame.width));
  svg.setAttribute('height', fmt(frame.height));
  svg.setAttribute('viewBox', viewBoxOf(frame));
}

function wrapIn(element: Element, wrapper: Element): void {
  element.replaceWith(wrapper);
  wrapper.append(element);
}

/**
 * The "current viewport" layout, in drawing coordinates: the content keeps its coordinates and is clipped to the
 * crop; the title block goes into a band above it and the legend into a band below it, each `margin` away.
 */
export function cropFrame(crop: CropOptions, overlays: OverlayBoxes): Rect {
  const { area, margin } = crop;
  const top = area.y - margin - overlays.title.height - margin;
  const legendHeight = overlays.legend === null ? 0 : margin + overlays.legend.height;
  const bottom = area.y + area.height + legendHeight + margin;
  const widest = Math.max(area.width, overlays.title.width, overlays.legend?.width ?? 0);
  return { x: area.x - margin, y: top, width: margin + widest + margin, height: bottom - top };
}

function applyCrop(drawing: Element, crop: CropOptions, overlays: OverlayBoxes, frame: Rect): void {
  const document = drawing.ownerDocument;
  const { area, margin } = crop;
  const clipId = 'dg-export-crop';
  let defs = [...drawing.children].find((child) => child.localName === 'defs');
  if (defs === undefined) {
    defs = svgChild(document, 'defs');
    drawing.prepend(defs);
  }
  const clip = svgChild(document, 'clipPath', { id: clipId, clipPathUnits: 'userSpaceOnUse' });
  clip.append(
    svgChild(document, 'rect', {
      x: fmt(area.x),
      y: fmt(area.y),
      width: fmt(area.width),
      height: fmt(area.height),
    }),
  );
  defs.append(clip);
  const content = svgChild(document, 'g', { class: 'dg-crop', 'clip-path': `url(#${clipId})` });
  const groups = [...drawing.children].filter((child) =>
    ['dg-zones', 'dg-nodes', 'dg-edges', 'dg-overlays'].some((name) => child.classList.contains(name)),
  );
  groups[0]?.before(content);
  content.append(...groups);

  const titleBlock = drawing.querySelector('.dg-title-block');
  if (titleBlock !== null) {
    const dx = area.x - overlays.title.x;
    const dy = area.y - margin - overlays.title.height - overlays.title.y;
    wrapIn(titleBlock, svgChild(document, 'g', { transform: `translate(${fmt(dx)} ${fmt(dy)})` }));
  }
  const legend = drawing.querySelector('.dg-legend');
  if (legend !== null && overlays.legend !== null) {
    const dx = area.x - overlays.legend.x;
    const dy = area.y + area.height + margin - overlays.legend.y;
    wrapIn(legend, svgChild(document, 'g', { transform: `translate(${fmt(dx)} ${fmt(dy)})` }));
  }
  const background = drawing.querySelector('.dg-background');
  if (background !== null) {
    background.setAttribute('x', fmt(frame.x));
    background.setAttribute('y', fmt(frame.y));
    background.setAttribute('width', fmt(frame.width));
    background.setAttribute('height', fmt(frame.height));
  }
}

/**
 * Clones a diagram `<svg>` (the drawing of `DiagramSvg`, live in a DOM) and makes the clone a standalone export.
 * The source is not changed.
 */
export function prepareExportSvg(source: SVGSVGElement, options: PrepareOptions): PreparedSvg {
  const drawnIn = source.getAttribute('data-theme');
  if (drawnIn !== null && drawnIn !== options.theme) {
    throw new ExportFormatError(
      'theme-mismatch',
      `The drawing is in the ${drawnIn} theme; an export in the ${options.theme} theme is drawn in that theme.`,
    );
  }
  const svg = source.cloneNode(true) as SVGSVGElement;
  stripInteractive(svg);
  const drawing = svg.querySelector('.dg-drawing');
  const titleBlock = drawing?.querySelector('.dg-title-block') ?? null;
  if (drawing === null || titleBlock === null) {
    throw new ExportFormatError(
      'missing-title-block',
      'An export always carries the title block and the legend; the drawing has no title block.',
    );
  }
  const variables = themeVariables(options.theme);
  for (const element of [svg, ...svg.querySelectorAll('*')]) resolveElement(element, variables);
  splitHalos(svg);
  addXlinkHrefs(svg);
  const frame = options.crop === undefined ? options.frame : cropFrame(options.crop, options.overlays);
  if (options.crop !== undefined) applyCrop(drawing, options.crop, options.overlays, frame);
  // React writes `xmlns` as a plain attribute; the serialiser declares the namespace itself.
  svg.removeAttribute('xmlns');
  svg.setAttribute('version', '1.1');
  svg.setAttribute('data-theme', options.theme);
  setFrame(svg, frame);
  setDocumentText(svg, options.title, options.desc);
  return { svg, frame };
}

/**
 * Adds `@font-face` rules (the embedded Roboto subset) in a `<style>` right after `<desc>`. Renderers that do
 * not read CSS fonts (resvg, most editors) fall back to the `font-family` stack as before.
 */
export function embedFontFaces(svg: SVGSVGElement, css: string): void {
  const document = svg.ownerDocument;
  const defs = svgChild(document, 'defs', { class: 'dg-export-fonts' });
  const style = svgChild(document, 'style', { type: 'text/css' });
  style.textContent = css;
  defs.append(style);
  const desc = [...svg.children].find((child) => child.localName === 'desc');
  if (desc === undefined) svg.prepend(defs);
  else desc.after(defs);
}

/** The standalone file: an XML declaration, the markup, a trailing newline. */
export function serializeSvg(svg: SVGSVGElement): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}\n`;
}
