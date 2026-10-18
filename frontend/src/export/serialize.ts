// SPDX-License-Identifier: MIT
/**
 * The SVG serialiser of the export (skill gcp-diagram-style §7–§8). It clones the standalone drawing of
 * `DiagramSvg` (export/render.tsx draws it off-screen in the export's theme) and turns the clone into a file.
 * That drawing is already standalone: every colour is an attribute of its theme (no `var()`, no `style`), it
 * carries no interactive scaffolding, and its `<title>` and `<desc>` are `documentText`'s (neutral metadata: no
 * affiliation sentence). The icons stay inline as they are. The serialiser adds:
 *
 * - the title block and the legend are required: a drawing without them is refused, never exported. The title
 *   block is the canvas's own three lines, ending with the tagline; the non-affiliation statement is in the app
 *   footer, never in a drawing (AGENTS.md, Non-affiliation, brand and legal);
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

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const XLINK_NS = 'http://www.w3.org/1999/xlink';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

/** Thrown when a drawing cannot be exported as asked; `code` says why. */
export class ExportFormatError extends Error {
  readonly code: 'missing-title-block';

  constructor(code: ExportFormatError['code'], message: string) {
    super(message);
    this.name = 'ExportFormatError';
    this.code = code;
  }
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
 * Clones a diagram `<svg>` (the standalone drawing of `DiagramSvg`, drawn in the export's theme with both overlays)
 * and makes the clone a standalone export. The source is not changed.
 */
export function prepareExportSvg(source: SVGSVGElement, options: PrepareOptions): PreparedSvg {
  const svg = source.cloneNode(true) as SVGSVGElement;
  const drawing = svg.querySelector('.dg-drawing');
  const titleBlock = drawing?.querySelector('.dg-title-block') ?? null;
  if (drawing === null || titleBlock === null) {
    throw new ExportFormatError(
      'missing-title-block',
      'An export always carries the title block and the legend; the drawing has no title block.',
    );
  }
  splitHalos(svg);
  addXlinkHrefs(svg);
  const frame = options.crop === undefined ? options.frame : cropFrame(options.crop, options.overlays);
  if (options.crop !== undefined) applyCrop(drawing, options.crop, options.overlays, frame);
  // React writes `xmlns` as a plain attribute; the serialiser declares the namespace itself.
  svg.removeAttribute('xmlns');
  svg.setAttribute('version', '1.1');
  setFrame(svg, frame);
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
