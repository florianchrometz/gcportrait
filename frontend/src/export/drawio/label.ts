// SPDX-License-Identifier: MIT
/**
 * SVG text as draw.io labels. A drawing's `<text>` is one line at a baseline; the translator gives draw.io one text
 * cell for the lines that belong together (a card's title and subtitle, the title block's three lines) as an HTML
 * label (`html=1`), each run of a line (a tspan's weight, colour or face) as a `<span>`, and places the cell so that
 * every baseline lands where the SVG has it.
 *
 * How draw.io lays an HTML label out (mxGraph's `mxSvgCanvas2D`, the same in diagrams.net): with `verticalAlign=top`,
 * no wrapping (`whiteSpace=nowrap`) and no clipping, the label is an inline block whose top is the cell's top plus
 * `spacingTop`, rounded to a whole pixel, with `line-height: 1.2`. A line's baseline then lies `T` below its top,
 * where `T` is the largest of `L / 2 + (ascent − descent) / 2 × size` over the line's inline boxes (CSS's
 * half-leading model: `L` is each box's line height, ascent and descent are the font's `hhea` metrics). A one-line
 * label needs nothing more. Lines of different sizes are written as `<div>` blocks with a line height in pixels and,
 * from the second on, a top margin that puts each baseline at its SVG distance from the one before (a `<br>` would
 * leave each line at the label's own line height, so the second baseline would land wherever the first line's size
 * puts it).
 *
 * The faces are Roboto and Roboto Mono: the faces the layout measures with and every raster export draws with (the
 * label stack's `'Google Sans'` is not installed where the PNGs are drawn, so its text is Roboto). With `fontSource`
 * (the default) each label names Google Fonts' stylesheet of both faces, which diagrams.net loads for the cells that
 * use it, so the file draws with the same faces there. Without it, draw.io falls back to its default font (Helvetica)
 * unless Roboto is installed, and the lines keep their places but not their widths.
 */
import { measureText, type FontFamily, type FontWeight } from '@gcportrait/layout';

import { escapeText } from './xml';

/** A face draw.io names and the vertical metrics (`hhea`, in em) the browser lays its lines out with. */
export interface DrawioFace {
  readonly family: string;
  readonly measure: FontFamily;
  readonly ascent: number;
  readonly descent: number;
}

/** Roboto and Roboto Mono, the faces of `@fontsource` (and of Google Fonts): `hhea` ascender and descender / 2048. */
export const FACES: Readonly<Record<FontFamily, DrawioFace>> = Object.freeze({
  sans: { family: 'Roboto', measure: 'sans', ascent: 1900 / 2048, descent: 500 / 2048 },
  mono: { family: 'Roboto Mono', measure: 'mono', ascent: 2146 / 2048, descent: 555 / 2048 },
});

/** Google Fonts' stylesheet of the drawing's faces (Roboto 400/500/700, Roboto Mono 400), for `fontSource`. */
export const FONT_STYLESHEET =
  'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=Roboto+Mono&display=swap';

/** The line height mxGraph gives an HTML label (`mxConstants.LINE_HEIGHT`), in em. */
export const LINE_HEIGHT = 1.2;

/** The face of a CSS font-family stack: the first family in it that is Roboto Mono or a monospace generic, else Roboto. */
export function faceOfStack(stack: string): FontFamily {
  for (const raw of stack.split(',')) {
    const name = raw
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .toLowerCase();
    if (name === 'roboto mono' || name === 'monospace' || name === 'ui-monospace') return 'mono';
    if (name === 'roboto' || name === 'sans-serif' || name === 'system-ui') return 'sans';
  }
  return 'sans';
}

/** A CSS font weight as the layout's metrics know it (400, 500 or 700). */
export function weightOf(value: string | undefined): FontWeight {
  if (value === undefined || value === 'normal') return 400;
  if (value === 'bold' || value === 'bolder') return 700;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 400;
  return numeric >= 600 ? 700 : numeric >= 500 ? 500 : 400;
}

/** A run of text in one face, size, weight and colour. */
export interface TextRun {
  readonly text: string;
  readonly face: FontFamily;
  readonly size: number;
  readonly weight: FontWeight;
  readonly italic: boolean;
  readonly colour: string;
}

export type TextAnchor = 'start' | 'middle' | 'end';

/** One SVG `<text>`: its runs, where its anchor is, and its alphabetic baseline. */
export interface TextLine {
  readonly runs: readonly TextRun[];
  /** The `<text>` element's own font, which its runs inherit (the strut of the line). */
  readonly face: FontFamily;
  readonly size: number;
  readonly weight: FontWeight;
  readonly italic: boolean;
  readonly colour: string;
  readonly x: number;
  readonly baseline: number;
  readonly anchor: TextAnchor;
}

/** The cell-level font of a label: what draw.io's style keys say. */
export interface LabelFont {
  readonly face: FontFamily;
  readonly size: number;
  /** draw.io's `fontStyle`: bold 1, italic 2. */
  readonly fontStyle: number;
  readonly colour: string;
}

export interface Label {
  readonly html: string;
  readonly font: LabelFont;
  readonly align: 'left' | 'center' | 'right';
  /** The label's box in drawing coordinates: its top is the first line's top, its left the anchor's side. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const halfDifference = (face: FontFamily): number => (FACES[face].ascent - FACES[face].descent) / 2;

interface InlineBox {
  readonly face: FontFamily;
  readonly size: number;
  readonly lineHeight: number;
}

/** The part of a line box above its baseline (`top`) and below it (`bottom`), from its inline boxes. */
function lineBox(boxes: readonly InlineBox[]): { readonly top: number; readonly bottom: number } {
  let top = 0;
  let bottom = 0;
  for (const box of boxes) {
    const shift = halfDifference(box.face) * box.size;
    top = Math.max(top, box.lineHeight / 2 + shift);
    bottom = Math.max(bottom, box.lineHeight / 2 - shift);
  }
  return { top, bottom };
}

const round = (value: number): number => Math.round(value * 100) / 100;
const px = (value: number): string => `${String(round(value))}px`;

/**
 * Spaces as HTML keeps them: a space after a space, or at either end of a line, becomes a no-break space, so the
 * label's `white-space: nowrap` does not collapse what the SVG keeps (`xml:space="preserve"`).
 */
function keepSpaces(runs: readonly TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  let previousEndsWithSpace = true;
  runs.forEach((run, index) => {
    let text = '';
    for (const char of run.text) {
      if (char === ' ' && previousEndsWithSpace) text += '\u00a0';
      else text += char;
      previousEndsWithSpace = char === ' ';
    }
    if (index === runs.length - 1) text = text.replace(/ $/, '\u00a0');
    out.push({ ...run, text });
  });
  return out;
}

function htmlText(text: string): string {
  return escapeText(text)
    .replace(/"/g, '&quot;')
    .replace(/\u00a0/g, '&nbsp;');
}

/** The CSS of the properties of `run` that differ from `context`. */
function differences(run: Omit<TextRun, 'text'>, context: Omit<TextRun, 'text'>): string[] {
  const css: string[] = [];
  if (run.face !== context.face)
    css.push(`font-family: '${FACES[run.face].family}', ${run.face === 'mono' ? 'monospace' : 'sans-serif'}`);
  if (run.size !== context.size) css.push(`font-size: ${px(run.size)}`);
  if (run.weight !== context.weight) css.push(`font-weight: ${String(run.weight)}`);
  if (run.italic !== context.italic) css.push(`font-style: ${run.italic ? 'italic' : 'normal'}`);
  if (run.colour !== context.colour) css.push(`color: ${run.colour}`);
  return css;
}

function runsHtml(runs: readonly TextRun[], context: Omit<TextRun, 'text'>): string {
  // Neighbouring runs that look the same are one span.
  const merged: TextRun[] = [];
  for (const run of keepSpaces(runs)) {
    const last = merged[merged.length - 1];
    if (last !== undefined && differences(run, last).length === 0)
      merged[merged.length - 1] = { ...last, text: last.text + run.text };
    else merged.push(run);
  }
  return merged
    .map((run) => {
      const css = differences(run, context);
      const text = htmlText(run.text);
      return css.length === 0 ? text : `<span style="${css.join('; ')}">${text}</span>`;
    })
    .join('');
}

/** The width of a line in the layout's Roboto metrics. */
export function lineWidth(line: Pick<TextLine, 'runs'>): number {
  return line.runs.reduce(
    (sum, run) => sum + measureText(run.text, run.weight, run.size, { family: run.face }),
    0,
  );
}

/** The label of lines that share their anchor (same x and alignment), top to bottom. */
export function labelOf(lines: readonly TextLine[]): Label {
  const first = lines[0];
  if (first === undefined) throw new Error('a label needs at least one line');
  const bold = first.weight === 700;
  const font: LabelFont = {
    face: first.face,
    size: first.size,
    fontStyle: (bold ? 1 : 0) | (first.italic ? 2 : 0),
    colour: first.colour,
  };
  const cellContext: Omit<TextRun, 'text'> = {
    face: font.face,
    size: font.size,
    weight: bold ? 700 : 400,
    italic: first.italic,
    colour: font.colour,
  };
  const width = Math.max(...lines.map(lineWidth));
  const align = first.anchor === 'middle' ? 'center' : first.anchor === 'end' ? 'right' : 'left';
  const x = align === 'left' ? first.x : align === 'center' ? first.x - width / 2 : first.x - width;

  if (lines.length === 1) {
    // One line: the label's own strut (the cell's font at line-height 1.2) and the runs, each at 1.2 × its size.
    const boxes: InlineBox[] = [
      { face: font.face, size: font.size, lineHeight: LINE_HEIGHT * font.size },
      ...first.runs.map((run) => ({ face: run.face, size: run.size, lineHeight: LINE_HEIGHT * run.size })),
    ];
    const box = lineBox(boxes);
    // A weight other than the cell's (500 for a zone title) goes on the runs that have it.
    return {
      html: runsHtml(first.runs, cellContext),
      font,
      align,
      x,
      y: first.baseline - box.top,
      width,
      height: box.top + box.bottom,
    };
  }

  // Several lines: each a block with a line height in pixels (1.2 × its size), the second on with a top margin
  // that keeps the SVG's distance between baselines.
  const parts: string[] = [];
  let height = 0;
  let top = 0;
  let previous: { readonly baseline: number; readonly bottom: number } | null = null;
  for (const line of lines) {
    const lineHeight = round(LINE_HEIGHT * line.size);
    const box = lineBox([
      { face: line.face, size: line.size, lineHeight },
      ...line.runs.map((run) => ({ face: run.face, size: run.size, lineHeight })),
    ]);
    const lineContext: Omit<TextRun, 'text'> = {
      face: line.face,
      size: line.size,
      weight: line.weight,
      italic: line.italic,
      colour: line.colour,
    };
    const css = differences(lineContext, cellContext);
    css.push(`line-height: ${px(lineHeight)}`);
    let margin = 0;
    if (previous === null) top = line.baseline - box.top;
    else {
      margin = line.baseline - previous.baseline - previous.bottom - box.top;
      css.push(`margin-top: ${px(margin)}`);
    }
    height += margin + box.top + box.bottom;
    parts.push(`<div style="${css.join('; ')}">${runsHtml(line.runs, lineContext)}</div>`);
    previous = { baseline: line.baseline, bottom: box.bottom };
  }
  return { html: parts.join(''), font, align, x, y: top, width, height };
}
