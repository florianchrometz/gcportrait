// SPDX-License-Identifier: Apache-2.0
/**
 * Helpers for the draw.io fidelity spec (drawio.spec.ts): reading a `.drawio` file as draw.io opens it, the cell id the
 * translator gives a zone or a node, the fonts both renderings use, maxGraph as one script for the test page, and the
 * measurements taken in Chromium: the SVG export laid out by the browser (its zones, nodes, lines with their heads'
 * tips, text lines) and the draw.io file drawn by maxGraph (its cells, their boxes, each line's path and heads, each
 * label's lines). Nothing here imports the app: the file is checked as diagrams.net would read it.
 *
 * maxGraph (the `@maxgraph/core` package, Apache-2.0, a development dependency; THIRD_PARTY.md) is the maintained
 * successor of mxGraph, the JavaScript library diagrams.net is built on: it reads the same `mxGraphModel` XML (its
 * codec turns each cell's style string into the style object it draws with) and draws a file's cells as diagrams.net
 * does, minus diagrams.net's own additions (it ignores `fontSource`, so the faces come from the page here). Its ES
 * modules are bundled by esbuild, in memory, into one classic script, which a route of the spec serves to the test
 * page: nothing is written to disk and nothing is fetched from elsewhere.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

import { build } from 'esbuild';

import { REPO_ROOT } from './exportSupport.js';

/**
 * The global the bundled script defines, holding the two classes of maxGraph the test page draws a file with
 * (drawAndMeasure, which runs in the page, reads it by this name: `MaxGraphGlobals`).
 */
const MAXGRAPH_GLOBAL = 'gcportraitMaxGraph';

let maxGraphBundle: Promise<string> | undefined;

/**
 * maxGraph from the e2e package's node_modules as one classic script, an IIFE that defines `MAXGRAPH_GLOBAL`;
 * bundled by esbuild once per worker, in memory.
 */
export function maxGraphScript(): Promise<string> {
  maxGraphBundle ??= build({
    stdin: {
      contents: "export { Graph, ModelXmlSerializer } from '@maxgraph/core';",
      resolveDir: import.meta.dirname,
      loader: 'js',
    },
    bundle: true,
    format: 'iife',
    globalName: MAXGRAPH_GLOBAL,
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  }).then((result) => {
    const script = result.outputFiles[0]?.text;
    if (script === undefined) throw new Error('esbuild wrote no maxGraph bundle');
    return script;
  });
  return maxGraphBundle;
}

/** A `.drawio` file read back: its `mxfile` and `diagram` attributes and its model's XML, inflated if compressed. */
export interface ReadDrawio {
  readonly mxfile: Record<string, string>;
  readonly diagram: Record<string, string>;
  readonly compressed: boolean;
  readonly model: string;
}

function attributesOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of tag.matchAll(/\s([\w:-]+)="([^"]*)"/g)) out[match[1] ?? ''] = match[2] ?? '';
  return out;
}

/** As diagrams.net reads a file: a model in the `<diagram>`, or its text base64, raw-deflated, URI-encoded. */
export function readDrawio(bytes: Buffer): ReadDrawio {
  const text = bytes.toString('utf8');
  const mxfile = /^<mxfile\b[^>]*>/.exec(text)?.[0];
  const diagram = /<diagram\b[^>]*>([\s\S]*)<\/diagram>/.exec(text);
  if (mxfile === undefined || diagram === null) throw new Error('not a draw.io file');
  const body = diagram[1] ?? '';
  const compressed = !body.trimStart().startsWith('<');
  const model = compressed
    ? decodeURIComponent(inflateRawSync(Buffer.from(body.trim(), 'base64')).toString('latin1'))
    : body;
  return {
    mxfile: attributesOf(mxfile),
    diagram: attributesOf(/<diagram\b[^>]*>/.exec(text)?.[0] ?? ''),
    compressed,
    model,
  };
}

/** The translator's short hash (two 32-bit FNV-1a passes, base 36), for ids that are no plain token. */
function hashOf(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x01000193;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code ^ (first >>> 7), 0x01000193) >>> 0;
  }
  return first.toString(36).padStart(7, '0') + second.toString(36).padStart(7, '0');
}

/**
 * The cell id of a zone or a node (frontend/src/export/drawio/model.ts, `CellIds.forModel`): the drawing's id as it is
 * when it is a plain token (printable ASCII, no space, no `#`, not all digits), else `h` and its hash.
 */
export function cellIdOf(modelId: string): string {
  const plain = /^[\x21-\x7e]{1,400}$/.test(modelId) && !modelId.includes('#') && !/^\d+$/.test(modelId);
  return plain ? modelId : `h${hashOf(modelId)}`;
}

/**
 * The faces both renderings draw with: Roboto 400/500/700 and Roboto Mono 400 (the app's own woff2 files), and the
 * export SVG's first families, Google Sans and Google Sans Text, as Roboto, so a machine with Google Sans installed
 * lays the SVG out as resvg and the draw.io labels do.
 */
export function fontCss(): string {
  const require = createRequire(path.join(REPO_ROOT, 'frontend/package.json'));
  const face = (family: string, file: string, weight: number): string =>
    `@font-face{font-family:'${family}';font-weight:${String(weight)};src:url(data:font/woff2;base64,${readFileSync(require.resolve(file)).toString('base64')}) format('woff2');}`;
  const roboto = (family: string): string[] =>
    ([400, 500, 700] as const).map((weight) =>
      face(family, `@fontsource/roboto/files/roboto-latin-${String(weight)}-normal.woff2`, weight),
    );
  return [
    ...roboto('Roboto'),
    ...roboto('Google Sans'),
    ...roboto('Google Sans Text'),
    face('Roboto Mono', '@fontsource/roboto-mono/files/roboto-mono-latin-400-normal.woff2', 400),
  ].join('\n');
}

/** The SVG with a margin around its frame: its size and viewBox grown by `margin` on every side. */
export function framedSvg(svg: string, margin: number): { svg: string; width: number; height: number } {
  const root = /<svg\b[^>]*>/.exec(svg)?.[0];
  const viewBox = /\sviewBox="([^"]+)"/
    .exec(root ?? '')?.[1]
    ?.split(/\s+/)
    .map(Number);
  if (root === undefined || viewBox?.length !== 4) throw new Error('an SVG without a viewBox');
  const [x = 0, y = 0, w = 0, h = 0] = viewBox;
  const width = Math.ceil(w + 2 * margin);
  const height = Math.ceil(h + 2 * margin);
  const framed = root
    .replace(/\swidth="[^"]*"/, ` width="${String(width)}"`)
    .replace(/\sheight="[^"]*"/, ` height="${String(height)}"`)
    .replace(/\sviewBox="[^"]*"/, ` viewBox="${[x - margin, y - margin, width, height].join(' ')}"`);
  return { svg: svg.replace(root, framed), width, height };
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A line's head in the SVG: where its tip is, and how wide it is across the line. */
export interface SvgHead {
  readonly tip: Point;
  readonly width: number;
  /** Closed (a block, filled or hollow) or open (two strokes). */
  readonly closed: boolean;
}

export interface SvgLine {
  /** `data-ends`: the indices of the nodes at the path's start and end. */
  readonly ends: readonly [string, string];
  /** Where the line's ends are: at a head's tip where it has one. */
  readonly from: Point;
  readonly to: Point;
  readonly start: SvgHead | null;
  readonly end: SvgHead | null;
}

export interface SvgText {
  readonly text: string;
  readonly box: Box;
  readonly size: string;
  readonly weight: string;
  readonly colour: string;
}

/** A zone's or a node's group: its id, its index (`data-n`), its zone's index (`data-parent`), its body's box. */
export interface SvgGroup {
  readonly id: string;
  readonly n: string;
  readonly parent: string | null;
  readonly box: Box;
}

export interface SvgMeasure {
  readonly zones: readonly SvgGroup[];
  readonly nodes: readonly SvgGroup[];
  readonly lines: readonly SvgLine[];
  readonly texts: readonly SvgText[];
}

/**
 * Measures the SVG export laid out by Chromium in the page's `#svg` element (the page calls it with no argument):
 * every zone's and node's body box, every line's ends at its heads' tips (from each marker's path, viewBox, size and
 * `refX`, as the browser places it) and its heads' widths, and every text line's box and font. Screen coordinates.
 */
export function measureSvg(): SvgMeasure {
  const root = document.querySelector('#svg > svg');
  if (!(root instanceof SVGSVGElement)) throw new Error('no SVG on the page');
  const screenBox = (element: SVGGraphicsElement): Box => {
    const box = element.getBBox();
    const matrix = element.getScreenCTM() ?? new DOMMatrix();
    const a = new DOMPoint(box.x, box.y).matrixTransform(matrix);
    const c = new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(matrix);
    return {
      x: Math.min(a.x, c.x),
      y: Math.min(a.y, c.y),
      width: Math.abs(c.x - a.x),
      height: Math.abs(c.y - a.y),
    };
  };
  const body = (group: Element): SVGGraphicsElement | null =>
    group.querySelector(':scope > rect.dg-body') ?? group.querySelector(':scope > rect');
  const groups = (kind: 'zone' | 'node') =>
    [...root.querySelectorAll(`g[data-kind="${kind}"]`)].flatMap((group) => {
      const rect = body(group);
      return rect === null
        ? []
        : [
            {
              id: group.getAttribute('data-id') ?? '',
              n: group.getAttribute('data-n') ?? '',
              parent: group.getAttribute('data-parent'),
              box: screenBox(rect),
            },
          ];
    });
  /** A marker's tip (along the line from the path's end, in user units) and its width across the line. */
  const markerOf = (
    reference: string,
    lineWidth: number,
  ): { offset: number; width: number; closed: boolean } | null => {
    const id = /url\(["']?#([^)"']+)["']?\)/.exec(reference)?.[1];
    const marker = id === undefined ? null : document.getElementById(id);
    const shape = marker?.querySelector('path');
    if (marker === null || shape === null || shape === undefined) return null;
    const numbers = (shape.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const points: Point[] = [];
    for (let at = 0; at + 1 < numbers.length; at += 2)
      points.push({ x: numbers[at] ?? 0, y: numbers[at + 1] ?? 0 });
    const viewBox = (marker.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
    const markerWidth = Number(marker.getAttribute('markerWidth') ?? 3);
    const perStroke = (marker.getAttribute('markerUnits') ?? 'strokeWidth') === 'strokeWidth';
    const scale = ((viewBox[2] ?? 0) > 0 ? markerWidth / (viewBox[2] ?? 1) : 1) * (perStroke ? lineWidth : 1);
    const refX = Number(marker.getAttribute('refX') ?? 0);
    const tip = points.reduce((best, point) => (Math.abs(point.x) > Math.abs(best.x) ? point : best));
    const ys = points.map((point) => point.y);
    return {
      offset: (tip.x - refX) * scale,
      width: (Math.max(...ys) - Math.min(...ys)) * scale,
      closed: /z\s*$/i.test((shape.getAttribute('d') ?? '').trim()),
    };
  };
  const lines = [...root.querySelectorAll('path[data-ends]')].map((element): SvgLine => {
    const path = element as SVGPathElement;
    const matrix = path.getScreenCTM() ?? new DOMMatrix();
    const at = (length: number): Point => {
      const point = path.getPointAtLength(length);
      const placed = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      return { x: placed.x, y: placed.y };
    };
    const length = path.getTotalLength();
    const style = getComputedStyle(path);
    const lineWidth = Number.parseFloat(style.strokeWidth) || 1;
    const unit = (from: Point, to: Point): Point => {
      const d = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      return { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
    };
    const first = at(0);
    const last = at(length);
    const outStart = unit(at(Math.min(1, length)), first);
    const outEnd = unit(at(Math.max(0, length - 1)), last);
    const head = (reference: string, point: Point, outward: Point, start: boolean): SvgHead | null => {
      const marker = reference === 'none' ? null : markerOf(reference, lineWidth);
      if (marker === null) return null;
      // A start marker points back along the path (negative x), an end marker on beyond it.
      const along = start ? -marker.offset : marker.offset;
      return {
        tip: { x: point.x + outward.x * along, y: point.y + outward.y * along },
        width: marker.width,
        closed: marker.closed,
      };
    };
    const start = head(style.markerStart, first, outStart, true);
    const end = head(style.markerEnd, last, outEnd, false);
    const [a = '', b = ''] = (path.getAttribute('data-ends') ?? '').split(' ');
    return { ends: [a, b], from: start?.tip ?? first, to: end?.tip ?? last, start, end };
  });
  const texts = [...root.querySelectorAll('text')].flatMap((element): SvgText[] => {
    if (element.closest('defs') !== null) return [];
    const style = getComputedStyle(element);
    const text = element.textContent.replace(/\s+/g, ' ').trim();
    if (style.fill === 'none' || text === '' || style.display === 'none') return [];
    const rect = element.getBoundingClientRect();
    return [
      {
        text,
        box: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        size: style.fontSize,
        weight: style.fontWeight,
        colour: style.fill,
      },
    ];
  });
  return { zones: groups('zone'), nodes: groups('node'), lines, texts };
}

/** A cell of the file (an `mxCell`) as maxGraph drew it. */
export interface MxCell {
  readonly id: string;
  readonly parent: string;
  /** Its style as the file writes it. */
  readonly style: string;
  readonly vertex: boolean;
  readonly edge: boolean;
  readonly source?: string;
  readonly target?: string;
  /** Its box as drawn (screen coordinates). */
  readonly box: Box;
  /** An edge: its ends and bends as maxGraph placed them. */
  readonly points?: readonly Point[];
  /** An edge: where its drawn line stops at each end. */
  readonly lineFrom?: Point;
  readonly lineTo?: Point;
  /** An edge: each head's box as drawn (the start's first), and the line's width. */
  readonly heads?: readonly Box[];
  readonly lineWidth?: number;
  /** A label's lines as laid out, with their fonts. */
  readonly lines?: readonly SvgText[];
}

export interface MxMeasure {
  readonly cells: readonly MxCell[];
  readonly background: string;
  /** Problems the model's structure has (parents after children, unknown terminals). */
  readonly problems: readonly string[];
}

/** What the page's bundled script defines (`maxGraphScript`), as far as drawAndMeasure uses it. */
interface MaxGraphGlobals {
  readonly gcportraitMaxGraph: {
    readonly Graph: new (
      container: HTMLElement,
      model?: undefined,
      plugins?: readonly never[],
    ) => {
      setHtmlLabels(value: boolean): void;
      options: { foldingEnabled: boolean };
      setEnabled(value: boolean): void;
      getDataModel(): { cells: Record<string, MaxGraphCell> | null };
      view: {
        setTranslate(x: number, y: number): void;
        getState(cell: MaxGraphCell): MaxGraphState | null;
      };
    };
    readonly ModelXmlSerializer: new (model: unknown) => { import(input: Element): void };
  };
}

interface MaxGraphCell {
  readonly id: string | null;
  readonly parent?: MaxGraphCell | null;
  readonly source?: MaxGraphCell | null;
  readonly target?: MaxGraphCell | null;
  readonly value: unknown;
  isVertex(): boolean;
  isEdge(): boolean;
}

interface MaxGraphState {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly absolutePoints?: ReadonlyArray<{ x: number; y: number } | null>;
  readonly shape?: { node?: Element } | null;
  readonly text?: { node?: Element } | null;
}

/**
 * Draws the model (`mxGraphModel` XML) with maxGraph in the page's `#graph` element, translated so that drawing
 * coordinates land where the SVG page puts them (`origin`: the screen position of drawing coordinate 0,0), and
 * measures every cell: its box, an edge's points, line ends and heads, a label's lines.
 */
export function drawAndMeasure({ model, origin }: { model: string; origin: Point }): MxMeasure {
  const { Graph, ModelXmlSerializer } = (window as unknown as MaxGraphGlobals).gcportraitMaxGraph;
  const container = document.getElementById('graph');
  if (container === null) throw new Error('no #graph element');
  const xml = new DOMParser().parseFromString(model, 'text/xml');
  const root = xml.documentElement;
  const problems: string[] = [];
  // The model's own structure: every parent before its children, every edge's ends a cell of the file.
  const seen = new Set<string>();
  const cellsXml = [...root.getElementsByTagName('mxCell')];
  const ids = new Set(cellsXml.map((cell) => cell.getAttribute('id') ?? ''));
  // maxGraph keeps a cell's style as an object; the checks read the file's own style string.
  const styles = new Map(
    cellsXml.map((cell) => [cell.getAttribute('id') ?? '', cell.getAttribute('style') ?? '']),
  );
  for (const cell of cellsXml) {
    const id = cell.getAttribute('id') ?? '';
    const parent = cell.getAttribute('parent');
    if (parent !== null && !seen.has(parent)) problems.push(`${id}: its parent ${parent} comes after it`);
    for (const end of ['source', 'target']) {
      const value = cell.getAttribute(end);
      if (value !== null && !ids.has(value)) problems.push(`${id}: its ${end} ${value} is not in the file`);
    }
    seen.add(id);
  }
  const background = root.getAttribute('background') ?? '';
  document.body.style.background = background;
  container.style.background = background;
  // No plugins: nothing on the page is selected, panned or edited.
  const graph = new Graph(container, undefined, []);
  graph.setHtmlLabels(true);
  graph.options.foldingEnabled = false;
  graph.setEnabled(false);
  new ModelXmlSerializer(graph.getDataModel()).import(root);
  graph.view.setTranslate(origin.x, origin.y);
  const screen = (element: SVGGraphicsElement): Box => {
    const box = element.getBBox();
    const matrix = element.getScreenCTM() ?? new DOMMatrix();
    const a = new DOMPoint(box.x, box.y).matrixTransform(matrix);
    const c = new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(matrix);
    return {
      x: Math.min(a.x, c.x),
      y: Math.min(a.y, c.y),
      width: Math.abs(c.x - a.x),
      height: Math.abs(c.y - a.y),
    };
  };
  const cells: MxCell[] = [];
  for (const cell of Object.values(graph.getDataModel().cells ?? {})) {
    const state = graph.view.getState(cell);
    if (state === null || cell.id === null) continue;
    const source = cell.source?.id ?? null;
    const target = cell.target?.id ?? null;
    const base = {
      id: cell.id,
      parent: cell.parent?.id ?? '',
      style: styles.get(cell.id) ?? '',
      vertex: cell.isVertex(),
      edge: cell.isEdge(),
      ...(source === null ? {} : { source }),
      ...(target === null ? {} : { target }),
      box: { x: state.x, y: state.y, width: state.width, height: state.height },
    };
    let extra: Partial<MxCell> = {};
    if (cell.isEdge()) {
      // ConnectorShape paints the line first, then the heads (the start's first); a hidden copy is the hit area.
      const paths = [...(state.shape?.node?.querySelectorAll('path') ?? [])].filter(
        (path) =>
          path.getAttribute('visibility') !== 'hidden' && path.getAttribute('stroke') !== 'transparent',
      );
      const [line, ...heads] = paths;
      const ends =
        line === undefined
          ? {}
          : (() => {
              const matrix = line.getScreenCTM() ?? new DOMMatrix();
              const point = (length: number): Point => {
                const at = line.getPointAtLength(length);
                const placed = new DOMPoint(at.x, at.y).matrixTransform(matrix);
                return { x: placed.x, y: placed.y };
              };
              return { lineFrom: point(0), lineTo: point(line.getTotalLength()) };
            })();
      extra = {
        points: (state.absolutePoints ?? []).flatMap((point) =>
          point === null ? [] : [{ x: point.x, y: point.y }],
        ),
        ...ends,
        heads: heads.map(screen),
        lineWidth: Number.parseFloat(line?.getAttribute('stroke-width') ?? '1'),
      };
    }
    // A label's lines: the HTML label's blocks (one per line), or the label itself for one line.
    const label = state.text?.node?.querySelector('foreignObject');
    if (label !== null && label !== undefined && typeof cell.value === 'string' && cell.value !== '') {
      let element: Element = label;
      const hasText = (node: Element): boolean =>
        [...node.childNodes].some((child) => child.nodeType === 3 && (child.textContent ?? '').trim() !== '');
      while (
        element.children.length === 1 &&
        !hasText(element) &&
        element.firstElementChild?.tagName !== 'SPAN'
      )
        element = element.firstElementChild ?? element;
      const blocks = [...element.children];
      const lineElements =
        !hasText(element) && blocks.length >= 2 && blocks.every((child) => child.tagName === 'DIV')
          ? blocks
          : [element];
      extra = {
        ...extra,
        lines: lineElements.map((lineElement): SvgText => {
          const range = document.createRange();
          range.selectNodeContents(lineElement);
          const rect = range.getBoundingClientRect();
          const walker = document.createTreeWalker(lineElement, NodeFilter.SHOW_TEXT);
          let first = walker.nextNode();
          while (first !== null && (first.textContent ?? '').trim() === '') first = walker.nextNode();
          const style = getComputedStyle(first?.parentElement ?? lineElement);
          return {
            text: lineElement.textContent
              .replace(/\u00a0/g, ' ')
              .replace(/\s+/g, ' ')
              .trim(),
            box: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
            size: style.fontSize,
            weight: style.fontWeight,
            colour: style.color,
          };
        }),
      };
    }
    cells.push({ ...base, ...extra });
  }
  return { cells, background, problems };
}
