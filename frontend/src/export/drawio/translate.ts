// SPDX-License-Identifier: Apache-2.0
/**
 * The diagram's SVG as draw.io cells (frontend/AGENTS.md, Exports). One drawing, three files: the
 * translator walks the markup the diagram's components drew (the same markup the SVG export and the PNG come from)
 * and turns every primitive into a draw.io cell at the same place and size, with the same colours, strokes, dashes,
 * corner radii, fonts and lines of text, so the file is the picture by construction. The structure comes from the
 * markers the components write on their groups:
 *
 * - `data-kind="zone"` (`data-id`, `data-n`: its short index in the drawing, `data-parent`: its zone's index): a
 *   container cell (`container=1`) drawn as the zone's body, nested in its parent zone's container with relative
 *   geometry, its title as the container's own label (placed by `spacingLeft` and `spacingTop`, in whole pixels: see
 *   {@link wholeSpacing}), its header icon and badges as child cells;
 * - `data-kind="node"` (`data-id`, `data-n`, `data-parent`): a group cell inside its zone, holding the body, the icon
 *   (an image of the icon's own SVG) and the text lines (one text cell), so moving a zone moves its nodes;
 * - a line's path with `data-ends` (the indices of the nodes at the drawn path's start and end): an edge between the
 *   two node cells, `edgeStyle=none` with the path's bends as waypoints, its ends fixed where the arrowheads' tips are
 *   (exit and entry constraints off the perimeter), heads, colour, width and dashes as drawn;
 * - `data-kind="title"` and `data-kind="legend"`: the title block (one text cell of its three lines) and the legend
 *   (a group of its panel, samples and labels).
 *
 * Everything else the drawing may hold (a timeline day's ghosts and markers, a selection's rings, a `secures`
 * overlay, which goes inside its target) is translated primitive by primitive. Three layers keep the SVG's paint
 * order: "Diagram" (zones, nodes and what lies under the lines), "Connections" (the lines and what lies on them),
 * "Title and legend". A path draw.io cannot draw as a line (a curve, a filled shape) becomes an image of itself.
 *
 * "Current viewport": the cells that meet the crop are kept whole (a zone that meets it is kept with its title,
 * a node with all its parts; an editable file never holds a cut shape), an edge is kept when both its ends are,
 * the crop's corner becomes 0,0, and the title block and the legend move into bands above and below, as in the SVG
 * export, but clear of everything kept: a zone kept whole can reach beyond the crop, and the bands go beyond it.
 * Deterministic: the same markup and options give the same cells, ids and bytes.
 */
import { labelOf, faceOfStack, weightOf, FACES, FONT_STYLESHEET, type TextLine, type TextRun } from './label';
import {
  CellIds,
  base64Of,
  formatNumber,
  hashOf,
  Style,
  type Cell,
  type CellRole,
  type EdgeCell,
  type LayerId,
  type VertexCell,
} from './model';
import {
  apply,
  boundsOf,
  boxesMeet,
  IDENTITY,
  inherit,
  INITIAL_PRESENTATION,
  multiply,
  numbersIn,
  ownPresentation,
  parseColour,
  parseLength,
  parseOpacity,
  parsePath,
  parseTransform,
  pathBounds,
  scaleOf,
  transformBox,
  unionBoxes,
  type Box,
  type Matrix,
  type PathSegment,
  type Point,
  type Presentation,
} from './svg';
import { childElements, parseXml, serializeXml, textContent, type XmlElement, type XmlNode } from './xml';

export interface TranslateOptions {
  /** Keep only what meets this part of the drawing (drawing coordinates): the "current viewport" export. */
  readonly area?: Box | undefined;
  /** With `area`: the space between the crop and the title and legend bands. Default 24. */
  readonly areaMargin?: number;
  /** Name Google Fonts' stylesheet of Roboto and Roboto Mono in every label (`fontSource`). Default true. */
  readonly fontSource?: boolean;
}

/** What a translation holds, counted from the drawing (the fidelity check compares them with the file). */
export interface DrawioSummary {
  readonly zones: number;
  readonly nodes: number;
  readonly edges: number;
  /** The `<text>` lines of the drawing written into labels. */
  readonly textLines: number;
  readonly cells: number;
}

export interface Translation {
  readonly cells: readonly Cell[];
  /** The page: the bounds of every cell. */
  readonly page: Box;
  /** The drawing's canvas colour, the page's background. */
  readonly background: string;
  /** The drawing's `<title>`. */
  readonly title: string;
  /** The theme the drawing names (its root's `data-theme`), `''` when it names none. */
  readonly theme: string;
  readonly summary: DrawioSummary;
}

/** The markup could not be translated (not an SVG document of the diagram). */
export class DrawioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DrawioError';
  }
}

/** The crop's margin when none is given: the SVG export's (`CROP_MARGIN`). */
export const DEFAULT_AREA_MARGIN = 24;

const SKIPPED = new Set([
  'title',
  'desc',
  'metadata',
  'defs',
  'marker',
  'clipPath',
  'mask',
  'symbol',
  'style',
  'script',
  'linearGradient',
  'radialGradient',
  'pattern',
  'filter',
  'foreignObject',
]);

/** The quarter of the drawing a layer-level cell goes to before the first line is drawn, and after. */
const DIAGRAM_LAYER: LayerId = '1';
const CONNECTIONS_LAYER: LayerId = '2';
const ANNOTATION_LAYER: LayerId = '3';

interface Context {
  readonly matrix: Matrix;
  readonly presentation: Presentation;
  /** The product of the group opacities above. */
  readonly opacity: number;
  /** The cell new cells go into: a layer, a zone, a node group, the legend. */
  readonly parent: string;
  /** The role of the primitives made here. */
  readonly role: CellRole;
  /** A zone whose title is still to be placed as its label. */
  readonly labelFor?: string | undefined;
  /** A node group whose body is still to be found. */
  readonly bodyFor?: string | undefined;
  /** How many `<use>` references deep (a guard against a reference cycle). */
  readonly depth: number;
}

interface MarkerHead {
  readonly shape: 'filled' | 'hollow' | 'open';
  /** From the path's end to the head's tip, along the path (negative: behind it). */
  readonly tipOffset: number;
  readonly length: number;
  /** `markerUnits="strokeWidth"` (SVG's default): the sizes are in multiples of the line's width. */
  readonly perStroke: boolean;
}

interface Heads {
  readonly start: MarkerHead | null;
  readonly end: MarkerHead | null;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

function attributeNumber(element: XmlElement, name: string, fallback = 0): number {
  return parseLength(element.attributes.get(name)) ?? fallback;
}

function classes(element: XmlElement): string[] {
  return (element.attributes.get('class') ?? '').split(/\s+/).filter((name) => name !== '');
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function unit(from: Point, to: Point): Point {
  const length = distance(from, to);
  return length === 0 ? { x: 0, y: 0 } : { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

/** The points without repeats and without middle points on a straight run (to a hundredth of a pixel). */
export function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last !== undefined && distance(last, point) < 0.01) continue;
    const before = out[out.length - 2];
    if (last !== undefined && before !== undefined) {
      const cross = (last.x - before.x) * (point.y - last.y) - (last.y - before.y) * (point.x - last.x);
      const dot = (last.x - before.x) * (point.x - last.x) + (last.y - before.y) * (point.y - last.y);
      if (Math.abs(cross) <= 0.01 * Math.max(1, distance(before, last), distance(last, point)) && dot > 0)
        out.pop();
    }
    out.push(point);
  }
  return out;
}

/**
 * A path of lines and quarter-circle elbows (what the renderer's `edgePathData` writes) as polylines, one per
 * subpath: each elbow becomes its corner, and the largest elbow radius is kept. Null for anything else (curves, a
 * closed subpath, an arc that is not a quarter circle), which is then drawn as an image.
 */
export function polylinesOf(
  segments: readonly PathSegment[],
): { readonly lines: Point[][]; readonly radius: number } | null {
  const lines: Point[][] = [];
  let current: Point[] | null = null;
  let radius = 0;
  for (const segment of segments) {
    switch (segment.type) {
      case 'M':
        current = [segment.to];
        lines.push(current);
        break;
      case 'L':
        if (current === null) return null;
        current.push(segment.to);
        break;
      case 'A': {
        if (current === null) return null;
        if (segment.large || Math.abs(segment.rx - segment.ry) > 0.01 || segment.rx === 0) return null;
        const start = current[current.length - 1];
        if (start === undefined) return null;
        const r = segment.rx;
        const end = segment.to;
        // The corner: one radius on along the incoming direction, else the box corner the sweep turns around.
        const before = current.length >= 2 ? current[current.length - 2] : undefined;
        let corner: Point | null = null;
        if (before !== undefined && distance(before, start) > 0.01) {
          const din = unit(before, start);
          const candidate = { x: start.x + din.x * r, y: start.y + din.y * r };
          if (Math.abs(distance(candidate, end) - r) <= 0.05 * r + 0.05) corner = candidate;
        }
        if (corner === null) {
          for (const candidate of [
            { x: end.x, y: start.y },
            { x: start.x, y: end.y },
          ]) {
            const din = unit(start, candidate);
            const dout = unit(candidate, end);
            const cross = din.x * dout.y - din.y * dout.x;
            if (cross !== 0 && cross > 0 === segment.sweep) corner = candidate;
          }
        }
        if (corner === null) return null;
        current.push(corner, end);
        radius = Math.max(radius, r);
        break;
      }
      default:
        return null;
    }
  }
  const simplified = lines.map(simplify).filter((line) => line.length >= 2);
  return simplified.length === 0 ? null : { lines: simplified, radius };
}

/** draw.io's arrow for a head: `block` (filled or hollow) or `open`, sized so its length is the head's. */
export function arrowOf(
  head: MarkerHead,
  strokeWidth: number,
): { readonly arrow: string; readonly fill: 0 | 1; readonly size: number } {
  // mxGraph draws a head `size + strokeWidth` long, stroked with the line's width, its stroked tip on the end point
  // (`block`: + 1.618 × width in all; `open`: + 1.118 × width at the tip).
  if (head.shape === 'open')
    return { arrow: 'open', fill: 0, size: Math.max(1, round2(head.length - 2.118 * strokeWidth)) };
  return {
    arrow: 'block',
    fill: head.shape === 'filled' ? 1 : 0,
    size: Math.max(1, round2(head.length - 2.618 * strokeWidth)),
  };
}

class Translator {
  readonly cells: Cell[] = [];
  readonly byId = new Map<string, Cell>();
  readonly ids = new CellIds();
  /** Zone and node cells by the drawing's id. */
  readonly modelCells = new Map<string, string>();
  /** The drawing's id and the cell of each zone and node, by its short index (`data-n`). */
  readonly indexed = new Map<string, { readonly modelId: string; readonly cell: string }>();
  readonly defs = new Map<string, XmlElement>();
  readonly bodies = new Map<string, Box>();
  readonly images = new Map<string, string>();
  readonly markers = new Map<string, MarkerHead | null>();
  readonly partCounts = new Map<string, number>();
  readonly fontSource: boolean;
  background = '#ffffff';
  /** Whether a line was drawn yet: layer-level content after it goes to the Connections layer. */
  passedLines = false;
  zones = 0;
  nodes = 0;
  edges = 0;

  constructor(fontSource: boolean) {
    this.fontSource = fontSource;
  }

  // Cells ---------------------------------------------------------------------------------------------------------

  partId(parent: string): string {
    const count = (this.partCounts.get(parent) ?? 0) + 1;
    this.partCounts.set(parent, count);
    const base = /^[123]$/.test(parent) ? `shape-${['', 'd', 'c', 't'][Number(parent)] ?? ''}` : parent;
    return this.ids.claim(`${base}#${String(count)}`);
  }

  add<T extends Cell>(cell: T): T {
    this.cells.push(cell);
    this.byId.set(cell.id, cell);
    return cell;
  }

  vertex(
    context: Context,
    style: Style,
    box: Box,
    options: {
      readonly id?: string;
      readonly role?: CellRole;
      readonly value?: string;
      readonly connectable?: boolean;
      readonly textLines?: number;
      readonly labelOffset?: Point;
    } = {},
  ): VertexCell {
    return this.add<VertexCell>({
      kind: 'vertex',
      id: options.id ?? this.partId(context.parent),
      parent: context.parent,
      role: options.role ?? context.role,
      style,
      value: options.value ?? '',
      box,
      connectable: options.connectable ?? true,
      textLines: options.textLines ?? 0,
      ...(options.labelOffset === undefined ? {} : { labelOffset: options.labelOffset }),
    });
  }

  /** The layer a layer-level cell goes to now: under the lines until the first line, on them after. */
  currentLayer(): LayerId {
    return this.passedLines ? CONNECTIONS_LAYER : DIAGRAM_LAYER;
  }

  // Paint ---------------------------------------------------------------------------------------------------------

  paint(style: Style, presentation: Presentation, own: ReadonlyMap<string, string>, context: Context): void {
    const scale = scaleOf(context.matrix);
    const factor = (scale.x + scale.y) / 2;
    const opacity = context.opacity * parseOpacity(own.get('opacity'));
    const fill = parseColour(presentation.fill ?? '#000000');
    const stroke = parseColour(presentation.stroke ?? 'none');
    style.set('fillColor', fill?.colour ?? 'none');
    const strokeColour = stroke?.colour ?? 'none';
    style.set('strokeColor', strokeColour);
    if (strokeColour !== 'none') {
      style.set('strokeWidth', round2((parseLength(presentation['stroke-width']) ?? 1) * factor));
      this.dash(style, presentation, factor);
    }
    if (opacity < 1) style.set('opacity', Math.round(opacity * 100));
    const fillOpacity = (fill?.alpha ?? 1) * parseOpacity(presentation['fill-opacity']);
    if (fill?.colour !== 'none' && fillOpacity < 1) style.set('fillOpacity', Math.round(fillOpacity * 100));
    const strokeOpacity = (stroke?.alpha ?? 1) * parseOpacity(presentation['stroke-opacity']);
    if (strokeColour !== 'none' && strokeOpacity < 1)
      style.set('strokeOpacity', Math.round(strokeOpacity * 100));
  }

  dash(style: Style, presentation: Presentation, factor: number): void {
    const dashes = presentation['stroke-dasharray'];
    if (dashes === undefined || dashes === 'none') return;
    const pattern = numbersIn(dashes).map((value) => round2(value * factor));
    if (pattern.length === 0 || pattern.every((value) => value === 0)) return;
    style.set('dashed', 1).set('dashPattern', pattern.map((value) => formatNumber(value)).join(' '));
    // Dash lengths in pixels, as in the SVG (draw.io multiplies them by the line width otherwise).
    style.set('fixDash', 1);
  }

  fontStyle(style: Style, label: ReturnType<typeof labelOf>): void {
    const face = FACES[label.font.face];
    style.set('fontFamily', face.family);
    if (this.fontSource) style.set('fontSource', encodeURIComponent(FONT_STYLESHEET));
    style.set('fontSize', round2(label.font.size)).set('fontColor', label.font.colour);
    style.set('fontStyle', label.font.fontStyle);
  }

  // The walk ------------------------------------------------------------------------------------------------------

  collectDefs(element: XmlElement): void {
    const id = element.attributes.get('id');
    if (id !== undefined && !this.defs.has(id)) this.defs.set(id, element);
    for (const child of childElements(element)) this.collectDefs(child);
  }

  /** The context inside `element` (its presentation, transform and opacity applied). */
  enter(element: XmlElement, context: Context): { context: Context; own: Map<string, string> } | null {
    const own = ownPresentation(element);
    if (own.get('display') === 'none' || own.get('visibility') === 'hidden') return null;
    const presentation = inherit(context.presentation, own);
    if (presentation.visibility === 'hidden' && element.name !== 'g') return null;
    const matrix = multiply(context.matrix, parseTransform(own.get('transform')));
    return { context: { ...context, matrix, presentation }, own };
  }

  walk(element: XmlElement, outer: Context): void {
    if (SKIPPED.has(element.name)) return;
    const entered = this.enter(element, outer);
    if (entered === null) return;
    const { context, own } = entered;
    switch (element.name) {
      case 'svg':
        this.image(element, context, own);
        return;
      case 'g':
      case 'a':
      case 'switch':
        this.group(element, context, own);
        return;
      case 'rect':
        this.rect(element, context, own);
        return;
      case 'circle':
      case 'ellipse':
        this.ellipse(element, context, own);
        return;
      case 'line': {
        const from = { x: attributeNumber(element, 'x1'), y: attributeNumber(element, 'y1') };
        const to = { x: attributeNumber(element, 'x2'), y: attributeNumber(element, 'y2') };
        this.lines([[from, to]], 0, context, own);
        return;
      }
      case 'polyline':
      case 'polygon': {
        const numbers = numbersIn(element.attributes.get('points') ?? '');
        const points: Point[] = [];
        for (let index = 0; index + 1 < numbers.length; index += 2)
          points.push({ x: numbers[index] ?? 0, y: numbers[index + 1] ?? 0 });
        if (element.name === 'polyline' && (context.presentation.fill ?? 'none') === 'none')
          this.lines([points], 0, context, own);
        else
          this.pathImage(context, own, `M${points.map((p) => `${String(p.x)} ${String(p.y)}`).join('L')}Z`);
        return;
      }
      case 'path':
        if (element.attributes.has('data-ends')) this.edge(element, context, own);
        else this.path(element, context, own);
        return;
      case 'text':
        this.texts([element], outer);
        return;
      case 'use':
        this.use(element, context, own);
        return;
      case 'image':
        this.imageElement(element, context, own);
        return;
      default:
        this.walkChildren(element, context);
    }
  }

  /** The children of `element`, with neighbouring texts that share their anchor drawn as one label. */
  walkChildren(element: XmlElement, context: Context, skip?: XmlElement): void {
    const children = element.children.filter(
      (child): child is XmlElement => child.kind === 'element' && child !== skip,
    );
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index] as XmlElement;
      if (child.name !== 'text') {
        this.walk(child, context);
        continue;
      }
      const run = [child];
      while (index + 1 < children.length && children[index + 1]?.name === 'text') {
        run.push(children[index + 1] as XmlElement);
        index += 1;
      }
      this.texts(run, context);
    }
  }

  group(element: XmlElement, context: Context, own: ReadonlyMap<string, string>): void {
    const inner: Context = { ...context, opacity: context.opacity * parseOpacity(own.get('opacity')) };
    switch (element.attributes.get('data-kind')) {
      case 'zone':
        this.zone(element, inner);
        return;
      case 'node':
        this.node(element, inner);
        return;
      case 'title':
        this.annotation(element, inner, 'title');
        return;
      case 'legend':
        this.annotation(element, inner, 'legend');
        return;
      default:
    }
    if (classes(element).includes('dg-background')) return;
    const secures = element.attributes.get('data-secures');
    const target = secures === undefined ? undefined : this.modelCells.get(secures);
    if (target !== undefined) {
      // A `secures` overlay lies inside its target: it moves with it.
      this.walkChildren(element, { ...inner, parent: target, role: 'part', labelFor: undefined });
      return;
    }
    if (this.labelledShape(element, inner)) return;
    const marked = [...element.attributes.keys()].some((name) => name.startsWith('data-'));
    if (marked && inner.role === 'other') {
      // A ghost, a changed dot: one group, so it moves as one.
      this.wrapped(element, { ...inner, parent: this.currentLayer() }, 'other');
      return;
    }
    this.walkChildren(element, inner);
  }

  /** Children of `element` in a new group cell; the group is dropped again when it holds one cell or none. */
  wrapped(element: XmlElement, context: Context, role: CellRole, id?: string): VertexCell | null {
    const group = this.vertex(
      context,
      groupStyle(),
      { x: 0, y: 0, width: 0, height: 0 },
      {
        ...(id === undefined ? {} : { id }),
        role,
      },
    );
    const start = this.cells.length;
    this.walkChildren(element, { ...context, parent: group.id, role: 'part', labelFor: undefined });
    const made = this.cells.slice(start);
    const children = made.filter((cell) => cell.parent === group.id);
    const only = children[0];
    if (children.length === 0) {
      this.remove(group);
      return null;
    }
    if (only !== undefined && children.length === 1 && !made.some((cell) => cell.parent === only.id)) {
      // One cell needs no group: it takes the group's place, id and role.
      this.remove(group);
      only.parent = group.parent;
      this.rename(only, group.id, role);
      return null;
    }
    group.box = unionBoxes(this.cells.slice(start).map(boxOfCell)) ?? group.box;
    return group;
  }

  remove(cell: Cell): void {
    const at = this.cells.indexOf(cell);
    if (at >= 0) this.cells.splice(at, 1);
    this.byId.delete(cell.id);
  }

  /** Gives a lone cell the id and role of the group it replaces. */
  rename(cell: Cell, id: string, role: CellRole): void {
    this.byId.delete(cell.id);
    const renamed = { ...cell, id, role } as Cell;
    const at = this.cells.indexOf(cell);
    this.cells[at] = renamed;
    this.byId.set(id, renamed);
  }

  /** The title block or the legend: on the top layer, as one group (or one cell). */
  annotation(element: XmlElement, context: Context, role: 'title' | 'legend'): void {
    const inner: Context = { ...context, parent: ANNOTATION_LAYER, role };
    this.wrapped(element, inner, role, this.ids.claim(role));
  }

  /** The cell of the zone a zone or a node lies in (`data-parent`, an index), or the Diagram layer. */
  parentOf(element: XmlElement): string {
    const parent = element.attributes.get('data-parent');
    return (parent === undefined ? undefined : this.indexed.get(parent)?.cell) ?? DIAGRAM_LAYER;
  }

  /** Records a zone's or a node's cell under the drawing's id and its index. */
  register(element: XmlElement, modelId: string, cell: string): void {
    this.modelCells.set(modelId, cell);
    const index = element.attributes.get('data-n');
    if (index !== undefined) this.indexed.set(index, { modelId, cell });
  }

  zone(element: XmlElement, context: Context): void {
    const modelId = element.attributes.get('data-id') ?? '';
    const body = childElements(element).find((child) => child.name === 'rect');
    if (body === undefined) {
      this.walkChildren(element, context);
      return;
    }
    const entered = this.enter(body, context);
    if (entered === null) return;
    const style = new Style();
    this.rectStyle(style, body, entered.context, entered.own);
    style
      .set('container', 1)
      .set('collapsible', 0)
      .set('recursiveResize', 0)
      .set('html', 1)
      .set('whiteSpace', 'nowrap');
    const id = this.ids.forModel(modelId);
    this.register(element, modelId, id);
    const cell = this.vertex(
      { ...context, parent: this.parentOf(element) },
      style,
      this.rectBox(body, entered.context),
      { id, role: 'zone' },
    );
    this.zones += 1;
    this.walkChildren(element, { ...context, parent: cell.id, role: 'part', labelFor: cell.id }, body);
  }

  node(element: XmlElement, context: Context): void {
    const modelId = element.attributes.get('data-id') ?? '';
    const id = this.ids.forModel(modelId);
    this.register(element, modelId, id);
    const group = this.vertex(
      { ...context, parent: this.parentOf(element) },
      groupStyle(),
      { x: 0, y: 0, width: 0, height: 0 },
      { id, role: 'node' },
    );
    this.nodes += 1;
    const start = this.cells.length;
    this.walkChildren(element, { ...context, parent: id, role: 'part', bodyFor: id, labelFor: undefined });
    group.box = this.bodies.get(id) ??
      unionBoxes(this.cells.slice(start).map(boxOfCell)) ?? { x: 0, y: 0, width: 0, height: 0 };
  }

  /** A group of a rect and a text that lies in it (a zone's badge): one shape with its label. */
  labelledShape(element: XmlElement, context: Context): boolean {
    const children = childElements(element).filter((child) => !SKIPPED.has(child.name));
    const [first, second] = children;
    if (children.length !== 2 || first?.name !== 'rect' || second?.name !== 'text') return false;
    const rectEntered = this.enter(first, context);
    const textEntered = this.enter(second, context);
    if (rectEntered === null || textEntered === null) return false;
    const box = this.rectBox(first, rectEntered.context);
    const line = this.textLine(second, textEntered.context);
    if (line === null || line.anchor !== 'start') return false;
    const label = labelOf([line]);
    if (
      label.x < box.x ||
      label.x + label.width > box.x + box.width + 1 ||
      label.y < box.y - 1 ||
      label.y + label.height > box.y + box.height + 1
    )
      return false;
    const style = new Style();
    this.rectStyle(style, first, rectEntered.context, rectEntered.own);
    const labelOffset = this.placeLabel(style, label, box);
    const opacity = context.opacity * parseOpacity(textEntered.own.get('opacity'));
    if (opacity < 1) style.set('textOpacity', Math.round(opacity * 100));
    this.vertex(this.layerContext(context), style, box, { value: label.html, textLines: 1, labelOffset });
    return true;
  }

  /**
   * Label keys that put `label` in a cell at `box`: left-aligned at the top, no spacing but the label's offset from
   * the cell's corner, in whole pixels ({@link wholeSpacing}). Returns the exact offset, which the cell keeps so the
   * spacing can follow it when the crop moves the cell ({@link settleLabels}).
   */
  placeLabel(style: Style, label: ReturnType<typeof labelOf>, box: Box): Point {
    const offset = { x: label.x - box.x, y: label.y - box.y };
    style
      .set('html', 1)
      .set('whiteSpace', 'nowrap')
      .set('overflow', 'visible')
      .set('align', 'left')
      .set('verticalAlign', 'top')
      .set('spacing', 0)
      .set('spacingLeft', wholeSpacing(box.x, offset.x))
      .set('spacingTop', wholeSpacing(box.y, offset.y));
    this.fontStyle(style, label);
    return offset;
  }

  // Primitives ----------------------------------------------------------------------------------------------------

  rectBox(element: XmlElement, context: Context): Box {
    return transformBox(context.matrix, {
      x: attributeNumber(element, 'x'),
      y: attributeNumber(element, 'y'),
      width: attributeNumber(element, 'width'),
      height: attributeNumber(element, 'height'),
    });
  }

  rectStyle(style: Style, element: XmlElement, context: Context, own: ReadonlyMap<string, string>): void {
    const scale = scaleOf(context.matrix);
    const rx = parseLength(element.attributes.get('rx')) ?? parseLength(element.attributes.get('ry')) ?? 0;
    const radius = rx * Math.min(scale.x, scale.y);
    if (radius > 0)
      style
        .set('rounded', 1)
        .set('absoluteArcSize', 1)
        .set('arcSize', round2(2 * radius));
    else style.set('rounded', 0);
    this.paint(style, context.presentation, own, context);
  }

  layerContext(context: Context): Context {
    return context.role === 'other' ? { ...context, parent: this.currentLayer() } : context;
  }

  rect(element: XmlElement, context: Context, own: ReadonlyMap<string, string>): void {
    if (classes(element).includes('dg-background')) {
      const fill = parseColour(context.presentation.fill ?? '#ffffff');
      if (fill !== null && fill.colour !== 'none') this.background = fill.colour;
      return;
    }
    const box = this.rectBox(element, context);
    if (box.width <= 0 || box.height <= 0) return;
    const style = new Style();
    this.rectStyle(style, element, context, own);
    style.set('whiteSpace', 'wrap').set('html', 1);
    // A node's body: its group takes the body's box, and lines end on the group, not on the body.
    const node = context.bodyFor;
    const isBody =
      node !== undefined &&
      node === context.parent &&
      !this.bodies.has(node) &&
      classes(element).includes('dg-body');
    if (isBody) this.bodies.set(node, box);
    this.vertex(this.layerContext(context), style, box, { connectable: !isBody });
  }

  ellipse(element: XmlElement, context: Context, own: ReadonlyMap<string, string>): void {
    const cx = attributeNumber(element, 'cx');
    const cy = attributeNumber(element, 'cy');
    const rx = element.name === 'circle' ? attributeNumber(element, 'r') : attributeNumber(element, 'rx');
    const ry = element.name === 'circle' ? rx : attributeNumber(element, 'ry');
    if (rx <= 0 || ry <= 0) return;
    const box = transformBox(context.matrix, { x: cx - rx, y: cy - ry, width: 2 * rx, height: 2 * ry });
    const style = new Style('ellipse')
      .set('shape', 'ellipse')
      .set('perimeter', 'ellipsePerimeter')
      .set('whiteSpace', 'wrap')
      .set('html', 1);
    this.paint(style, context.presentation, own, context);
    this.vertex(this.layerContext(context), style, box, { connectable: context.role === 'other' });
  }

  /** An inline `<svg>` (an icon): an image of its own markup, stretched to its box. */
  image(element: XmlElement, context: Context, own: ReadonlyMap<string, string>): void {
    const viewBox = numbersIn(element.attributes.get('viewBox') ?? '');
    const width = parseLength(element.attributes.get('width')) ?? viewBox[2] ?? 0;
    const height = parseLength(element.attributes.get('height')) ?? viewBox[3] ?? 0;
    if (width <= 0 || height <= 0) return;
    const box = transformBox(context.matrix, {
      x: attributeNumber(element, 'x'),
      y: attributeNumber(element, 'y'),
      width,
      height,
    });
    const attributes = new Map<string, string>([['xmlns', 'http://www.w3.org/2000/svg']]);
    for (const [name, value] of element.attributes)
      if (name !== 'x' && name !== 'y') attributes.set(name, value);
    attributes.set('width', formatNumber(width));
    attributes.set('height', formatNumber(height));
    const markup = serializeXml({ kind: 'element', name: 'svg', attributes, children: element.children });
    this.imageCell(markup, box, context, own);
  }

  imageCell(markup: string, box: Box, context: Context, own: ReadonlyMap<string, string>): void {
    let data = this.images.get(markup);
    if (data === undefined) {
      data = base64Of(new TextEncoder().encode(markup));
      this.images.set(markup, data);
    }
    // draw.io's form of a data URI in a style (a `;` would end the value): it adds `;base64` back when it reads it.
    const style = new Style()
      .set('shape', 'image')
      .set('imageAspect', 0)
      .set('image', `data:image/svg+xml,${data}`);
    const opacity = context.opacity * parseOpacity(own.get('opacity'));
    if (opacity < 1) style.set('opacity', Math.round(opacity * 100));
    this.vertex(this.layerContext(context), style, box, { connectable: false });
  }

  imageElement(element: XmlElement, context: Context, own: ReadonlyMap<string, string>): void {
    const href = element.attributes.get('href') ?? element.attributes.get('xlink:href');
    if (href === undefined) return;
    const box = this.rectBox(element, context);
    const comma = href.indexOf(',');
    const uri =
      href.startsWith('data:') && comma > 0
        ? href.slice(0, comma).replace(/;base64$/, '') + href.slice(comma)
        : href;
    const style = new Style()
      .set('shape', 'image')
      .set('imageAspect', 0)
      .set('image', uri.replace(/;/g, '%3B'));
    const opacity = context.opacity * parseOpacity(own.get('opacity'));
    if (opacity < 1) style.set('opacity', Math.round(opacity * 100));
    this.vertex(this.layerContext(context), style, box, { connectable: false });
  }

  use(element: XmlElement, context: Context, own: ReadonlyMap<string, string>): void {
    const href = element.attributes.get('href') ?? element.attributes.get('xlink:href') ?? '';
    const target = href.startsWith('#') ? this.defs.get(href.slice(1)) : undefined;
    if (target === undefined || context.depth > 8) return;
    const matrix = multiply(context.matrix, {
      ...IDENTITY,
      e: attributeNumber(element, 'x'),
      f: attributeNumber(element, 'y'),
    });
    const inner: Context = {
      ...context,
      matrix,
      opacity: context.opacity * parseOpacity(own.get('opacity')),
      depth: context.depth + 1,
    };
    if (target.name === 'svg' || target.name === 'symbol') {
      this.image(target, inner, new Map());
      return;
    }
    // A definition is drawn as if it stood here: a `<g>` around an icon's `<svg>`, the chip's ⊞ glyph.
    const entered = this.enter(target, inner);
    if (entered === null) return;
    if (target.name === 'g') this.walkChildren(target, entered.context);
    else this.walk(target, inner);
  }

  // Lines ---------------------------------------------------------------------------------------------------------

  markerHead(reference: string | undefined): MarkerHead | null {
    const id = /url\(\s*#([^)\s]+)\s*\)/.exec(reference ?? '')?.[1];
    if (id === undefined) return null;
    if (this.markers.has(id)) return this.markers.get(id) ?? null;
    const marker = this.defs.get(id);
    let head: MarkerHead | null = null;
    const shape =
      marker === undefined ? undefined : childElements(marker).find((child) => child.name === 'path');
    if (marker !== undefined && shape !== undefined) {
      const segments = parsePath(shape.attributes.get('d') ?? '');
      const points = segments.flatMap((segment) =>
        segment.type === 'Z' || segment.type === 'A' ? [] : [segment.to],
      );
      const closed = segments.some((segment) => segment.type === 'Z');
      const viewBox = numbersIn(marker.attributes.get('viewBox') ?? '');
      const markerWidth = parseLength(marker.attributes.get('markerWidth')) ?? 3;
      const scale = viewBox[2] !== undefined && viewBox[2] > 0 ? markerWidth / viewBox[2] : 1;
      const refX = parseLength(marker.attributes.get('refX')) ?? 0;
      const tip = points.reduce<Point | undefined>(
        (best, point) => (best === undefined || Math.abs(point.x) > Math.abs(best.x) ? point : best),
        undefined,
      );
      if (tip !== undefined) {
        const fill = parseColour(shape.attributes.get('fill') ?? '#000000')?.colour ?? 'none';
        const stroke = parseColour(shape.attributes.get('stroke') ?? 'none')?.colour ?? 'none';
        const base = points.filter((point) => point !== tip).map((point) => point.x);
        const baseX = base.length === 0 ? 0 : base.reduce((a, b) => a + b, 0) / base.length;
        head = {
          shape: !closed ? 'open' : stroke === 'none' || stroke === fill ? 'filled' : 'hollow',
          tipOffset: (tip.x - refX) * scale,
          length: Math.abs(tip.x - baseX) * scale,
          perStroke: marker.attributes.get('markerUnits') !== 'userSpaceOnUse',
        };
        if (head.shape === 'filled' && fill === 'none') head = { ...head, shape: 'hollow' };
      }
    }
    this.markers.set(id, head);
    return head;
  }

  /**
   * A line's heads at its place in the drawing: through the transform, and in multiples of the line's width where
   * the marker says so.
   */
  heads(presentation: Presentation, context: Context, start: boolean, end: boolean): Heads {
    const factor = (scaleOf(context.matrix).x + scaleOf(context.matrix).y) / 2;
    const width = (parseLength(presentation['stroke-width']) ?? 1) * factor;
    const placed = (head: MarkerHead | null): MarkerHead | null => {
      if (head === null) return null;
      const scale = head.perStroke ? width : factor;
      return { ...head, tipOffset: head.tipOffset * scale, length: head.length * scale, perStroke: false };
    };
    return {
      start: start ? placed(this.markerHead(presentation['marker-start'])) : null,
      end: end ? placed(this.markerHead(presentation['marker-end'])) : null,
    };
  }

  /** The style keys of a line: colour, width, dashes, heads (placed by {@link heads}), elbows. */
  lineStyle(
    presentation: Presentation,
    own: ReadonlyMap<string, string>,
    context: Context,
    heads: Heads,
    radius: number,
  ): Style {
    const factor = (scaleOf(context.matrix).x + scaleOf(context.matrix).y) / 2;
    const style = new Style().set('edgeStyle', 'none').set('html', 1);
    if (radius > 0) style.set('rounded', 1).set('arcSize', round2(2 * radius * factor));
    else style.set('rounded', 0);
    const stroke = parseColour(presentation.stroke ?? 'none');
    const width = round2((parseLength(presentation['stroke-width']) ?? 1) * factor);
    for (const [end, head] of [
      ['start', heads.start],
      ['end', heads.end],
    ] as const) {
      if (head === null) style.set(`${end}Arrow`, 'none');
      else {
        const arrow = arrowOf(head, width);
        style.set(`${end}Arrow`, arrow.arrow).set(`${end}Fill`, arrow.fill).set(`${end}Size`, arrow.size);
      }
    }
    style.set('strokeColor', stroke?.colour ?? 'none').set('strokeWidth', width);
    this.dash(style, presentation, factor);
    const opacity = context.opacity * parseOpacity(own.get('opacity'));
    const strokeOpacity = opacity * (stroke?.alpha ?? 1) * parseOpacity(presentation['stroke-opacity']);
    if (strokeOpacity < 1) style.set('opacity', Math.round(strokeOpacity * 100));
    return style;
  }

  /** A polyline with its heads: the end points moved to the heads' tips (where draw.io puts its arrows' tips). */
  withTips(points: readonly Point[], heads: Heads): Point[] {
    const out = [...points];
    const first = out[0];
    const second = out[1];
    if (heads.start !== null && first !== undefined && second !== undefined) {
      const direction = unit(first, second);
      out[0] = {
        x: first.x + direction.x * heads.start.tipOffset,
        y: first.y + direction.y * heads.start.tipOffset,
      };
    }
    const last = out[out.length - 1];
    const before = out[out.length - 2];
    if (heads.end !== null && last !== undefined && before !== undefined) {
      const direction = unit(before, last);
      out[out.length - 1] = {
        x: last.x + direction.x * heads.end.tipOffset,
        y: last.y + direction.y * heads.end.tipOffset,
      };
    }
    return out;
  }

  /** Lines without ends in a node (a legend sample, a glyph's stroke): edges without terminals. */
  lines(
    polylines: readonly Point[][],
    radius: number,
    context: Context,
    own: ReadonlyMap<string, string>,
  ): void {
    const presentation = context.presentation;
    if ((parseColour(presentation.stroke ?? 'none')?.colour ?? 'none') === 'none') return;
    polylines.forEach((local, index) => {
      const heads = this.heads(presentation, context, index === 0, index === polylines.length - 1);
      const points = this.withTips(
        local.map((point) => apply(context.matrix, point)),
        heads,
      );
      const first = points[0];
      const last = points[points.length - 1];
      if (first === undefined || last === undefined) return;
      const style = this.lineStyle(presentation, own, context, heads, radius);
      const parent = context.role === 'other' ? this.currentLayer() : context.parent;
      this.add<EdgeCell>({
        kind: 'edge',
        id: this.partId(parent),
        parent,
        role: context.role,
        style,
        value: '',
        from: first,
        to: last,
        points: points.slice(1, -1),
        textLines: 0,
      });
    });
  }

  path(element: XmlElement, context: Context, own: ReadonlyMap<string, string>): void {
    const d = element.attributes.get('d') ?? '';
    let segments: PathSegment[];
    try {
      segments = parsePath(d);
    } catch {
      return;
    }
    if (segments.length === 0) return;
    const filled = (parseColour(context.presentation.fill ?? '#000000')?.colour ?? 'none') !== 'none';
    const polylines = polylinesOf(segments);
    const hasArea = polylines?.lines.some((line) => line.length >= 3) ?? true;
    if (polylines !== null && !(filled && hasArea)) {
      this.lines(polylines.lines, polylines.radius, context, own);
      return;
    }
    this.pathImage(context, own, d);
  }

  /** A shape draw.io has no cell for, as an image of itself in its own box. */
  pathImage(context: Context, own: ReadonlyMap<string, string>, d: string): void {
    let segments: PathSegment[];
    try {
      segments = parsePath(d);
    } catch {
      return;
    }
    const bounds = pathBounds(segments);
    if (bounds === null) return;
    const presentation = context.presentation;
    const pad = (parseLength(presentation['stroke-width']) ?? 1) + 1;
    const local = {
      x: bounds.x - pad,
      y: bounds.y - pad,
      width: bounds.width + 2 * pad,
      height: bounds.height + 2 * pad,
    };
    const attributes = new Map<string, string>([['d', d]]);
    for (const name of [
      'fill',
      'fill-opacity',
      'stroke',
      'stroke-width',
      'stroke-dasharray',
      'stroke-opacity',
      'stroke-linecap',
      'stroke-linejoin',
    ] as const) {
      const value = presentation[name];
      if (value !== undefined) attributes.set(name, value);
    }
    const svgAttributes = new Map<string, string>([
      ['xmlns', 'http://www.w3.org/2000/svg'],
      ['width', formatNumber(local.width)],
      ['height', formatNumber(local.height)],
      [
        'viewBox',
        [local.x, local.y, local.width, local.height].map((value) => formatNumber(value)).join(' '),
      ],
    ]);
    const markup = serializeXml({
      kind: 'element',
      name: 'svg',
      attributes: svgAttributes,
      children: [{ kind: 'element', name: 'path', attributes, children: [] }],
    });
    this.imageCell(markup, transformBox(context.matrix, local), context, own);
  }

  edge(element: XmlElement, context: Context, own: ReadonlyMap<string, string>): void {
    const [startIndex = '', endIndex = ''] = (element.attributes.get('data-ends') ?? '').trim().split(/\s+/);
    const start = this.indexed.get(startIndex);
    const end = this.indexed.get(endIndex);
    // The id from the drawing's ids of its ends (a second line between the same two gets `~2`, in drawing order).
    const key = `${start?.modelId ?? startIndex} -> ${end?.modelId ?? endIndex}`;
    let segments: PathSegment[];
    try {
      segments = parsePath(element.attributes.get('d') ?? '');
    } catch {
      return;
    }
    const polylines = polylinesOf(segments);
    const local = polylines?.lines[0];
    if (polylines === null || local === undefined) return;
    const presentation = context.presentation;
    const heads = this.heads(presentation, context, true, true);
    const points = this.withTips(
      local.map((point) => apply(context.matrix, point)),
      heads,
    );
    const from = points[0];
    const to = points[points.length - 1];
    if (from === undefined || to === undefined) return;
    const style = this.lineStyle(presentation, own, context, heads, polylines.radius);
    const source = this.terminal(start?.cell);
    const target = this.terminal(end?.cell);
    if (source !== undefined) constrain(style, 'exit', source.box, from);
    if (target !== undefined) constrain(style, 'entry', target.box, to);
    this.add<EdgeCell>({
      kind: 'edge',
      id: this.ids.claim(`edge-${hashOf(key)}`),
      parent: CONNECTIONS_LAYER,
      role: 'edge',
      style,
      value: '',
      ...(source === undefined ? {} : { source: source.id }),
      ...(target === undefined ? {} : { target: target.id }),
      from,
      to,
      points: points.slice(1, -1),
      textLines: 0,
    });
    this.edges += 1;
    this.passedLines = true;
  }

  terminal(id: string | undefined): VertexCell | undefined {
    const cell = id === undefined ? undefined : this.byId.get(id);
    return cell?.kind === 'vertex' ? cell : undefined;
  }

  // Text ----------------------------------------------------------------------------------------------------------

  /** One `<text>` as a line: its runs (tspans) with their fonts and colours, its anchor and its baseline. */
  textLine(element: XmlElement, context: Context): TextLine | null {
    const presentation = context.presentation;
    const fill = parseColour(presentation.fill ?? '#000000');
    if (fill === null || fill.colour === 'none') return null;
    const scale = scaleOf(context.matrix).y;
    const preserve = presentation['xml:space'] === 'preserve';
    const runs: TextRun[] = [];
    const collect = (node: XmlNode, inherited: Presentation): void => {
      if (node.kind === 'text') {
        const text = preserve
          ? node.text.replace(/[\n\r\t]/g, ' ')
          : node.text.replace(/[\n\r]/g, '').replace(/\t/g, ' ');
        if (text === '') return;
        const colour = parseColour(inherited.fill ?? '#000000');
        if (colour === null || colour.colour === 'none') return;
        runs.push({
          text,
          face: faceOfStack(inherited['font-family'] ?? ''),
          size: round2((parseLength(inherited['font-size']) ?? 16) * scale),
          weight: weightOf(inherited['font-weight']),
          italic: inherited['font-style'] === 'italic' || inherited['font-style'] === 'oblique',
          colour: colour.colour,
        });
        return;
      }
      if (node.name !== 'tspan' && node.name !== 'a') return;
      const own = ownPresentation(node);
      if (own.get('display') === 'none') return;
      const next = inherit(inherited, own);
      for (const child of node.children) collect(child, next);
    };
    for (const child of element.children) collect(child, presentation);
    if (!preserve) {
      // Default white space handling: no leading or trailing spaces, runs of spaces as one.
      let previousSpace = true;
      for (let index = 0; index < runs.length; index += 1) {
        const run = runs[index] as TextRun;
        let text = '';
        for (const char of run.text) {
          if (char === ' ' && previousSpace) continue;
          text += char;
          previousSpace = char === ' ';
        }
        runs[index] = { ...run, text };
      }
      const last = runs[runs.length - 1];
      if (last !== undefined) runs[runs.length - 1] = { ...last, text: last.text.replace(/ $/, '') };
    }
    const kept = runs.filter((run) => run.text !== '');
    if (kept.length === 0) return null;
    const x = numbersIn(element.attributes.get('x') ?? '0')[0] ?? 0;
    const y = numbersIn(element.attributes.get('y') ?? '0')[0] ?? 0;
    const at = apply(context.matrix, { x, y });
    const face = faceOfStack(presentation['font-family'] ?? '');
    const size = round2((parseLength(presentation['font-size']) ?? 16) * scale);
    const anchorValue = presentation['text-anchor'];
    const anchor = anchorValue === 'middle' ? 'middle' : anchorValue === 'end' ? 'end' : 'start';
    const metrics = FACES[face];
    let baseline = at.y;
    switch (presentation['dominant-baseline']) {
      case 'middle':
      case 'central':
        baseline += ((metrics.ascent - metrics.descent) / 2) * size;
        break;
      case 'hanging':
      case 'text-before-edge':
        baseline += metrics.ascent * size;
        break;
      case 'text-after-edge':
      case 'ideographic':
        baseline -= metrics.descent * size;
        break;
      default:
    }
    return {
      runs: kept,
      face,
      size,
      weight: weightOf(presentation['font-weight']),
      italic: presentation['font-style'] === 'italic' || presentation['font-style'] === 'oblique',
      colour: fill.colour,
      x: at.x,
      baseline,
      anchor,
    };
  }

  /** Neighbouring `<text>` elements: one label for each run of lines that share their x and anchor, top to bottom. */
  texts(elements: readonly XmlElement[], context: Context): void {
    const lines: Array<{ line: TextLine; own: ReadonlyMap<string, string>; context: Context }> = [];
    for (const element of elements) {
      const entered = this.enter(element, context);
      if (entered === null) continue;
      const line = this.textLine(element, entered.context);
      if (line !== null) lines.push({ line, own: entered.own, context: entered.context });
    }
    let group: typeof lines = [];
    const flush = (): void => {
      if (group.length > 0)
        this.textCell(
          group.map((entry) => entry.line),
          group[0]?.own ?? new Map(),
          context,
        );
      group = [];
    };
    for (const entry of lines) {
      const previous = group[group.length - 1]?.line;
      const joins =
        previous !== undefined &&
        previous.anchor === entry.line.anchor &&
        Math.abs(previous.x - entry.line.x) < 0.01 &&
        entry.line.baseline > previous.baseline;
      if (!joins) flush();
      group.push(entry);
    }
    flush();
  }

  textCell(lines: readonly TextLine[], own: ReadonlyMap<string, string>, context: Context): void {
    const label = labelOf(lines);
    const opacity = context.opacity * parseOpacity(own.get('opacity'));
    // A zone's title is the zone's own label, at its exact place.
    if (context.labelFor !== undefined && label.align === 'left' && opacity >= 1) {
      const zone = this.byId.get(context.labelFor);
      if (zone?.kind === 'vertex' && zone.value === '') {
        zone.value = label.html;
        zone.textLines = lines.length;
        zone.labelOffset = this.placeLabel(zone.style, label, zone.box);
        return;
      }
    }
    const style = new Style('text')
      .set('html', 1)
      .set('whiteSpace', 'nowrap')
      .set('overflow', 'visible')
      .set('align', label.align)
      .set('verticalAlign', 'top')
      .set('spacing', 0)
      .set('strokeColor', 'none')
      .set('fillColor', 'none');
    this.fontStyle(style, label);
    if (opacity < 1) style.set('textOpacity', Math.round(opacity * 100));
    this.vertex(
      this.layerContext(context),
      style,
      { x: label.x, y: label.y, width: label.width, height: label.height },
      { value: label.html, connectable: false, textLines: lines.length },
    );
  }
}

/**
 * draw.io's spacing for a cell's own label `offset` pixels from the cell's edge at `origin`: a whole number, as
 * mxGraph and diagrams.net read `spacingLeft` and `spacingTop` (`parseInt`, which drops a fraction). The renderer
 * draws a label at a whole pixel (it rounds the label's position), so the spacing is the one that puts the label on
 * the pixel its exact place rounds to, the pixel a text cell at that place is drawn at.
 */
export function wholeSpacing(origin: number, offset: number): number {
  return Math.round(origin + offset) - Math.round(origin);
}

/** The cells' own labels at whole-pixel spacing from where the cells finally are (after the crop moved them). */
function settleLabels(cells: readonly Cell[]): void {
  for (const cell of cells) {
    if (cell.kind !== 'vertex' || cell.labelOffset === undefined) continue;
    cell.style
      .set('spacingLeft', wholeSpacing(cell.box.x, cell.labelOffset.x))
      .set('spacingTop', wholeSpacing(cell.box.y, cell.labelOffset.y));
  }
}

function groupStyle(): Style {
  return new Style('group').set('fillColor', 'none').set('strokeColor', 'none').set('pointerEvents', 0);
}

/** An exit or entry fixed at `point` on the terminal (off its perimeter, so the point is exactly the drawing's). */
function constrain(style: Style, end: 'exit' | 'entry', box: Box, point: Point): void {
  const fraction = (value: number, origin: number, size: number): string =>
    formatNumber(size === 0 ? 0 : (value - origin) / size, 6);
  style
    .set(`${end}X`, fraction(point.x, box.x, box.width))
    .set(`${end}Y`, fraction(point.y, box.y, box.height))
    .set(`${end}Perimeter`, 0);
}

function boxOfCell(cell: Cell): Box {
  if (cell.kind === 'vertex') return cell.box;
  return boundsOf([cell.from, cell.to, ...cell.points]);
}

// The crop ----------------------------------------------------------------------------------------------------------

function childrenByParent(cells: readonly Cell[]): Map<string, Cell[]> {
  const map = new Map<string, Cell[]>();
  for (const cell of cells) {
    const list = map.get(cell.parent);
    if (list === undefined) map.set(cell.parent, [cell]);
    else list.push(cell);
  }
  return map;
}

function shift(cell: Cell, children: ReadonlyMap<string, Cell[]>, dx: number, dy: number): void {
  if (cell.kind === 'vertex') cell.box = { ...cell.box, x: cell.box.x + dx, y: cell.box.y + dy };
  else {
    cell.from = { x: cell.from.x + dx, y: cell.from.y + dy };
    cell.to = { x: cell.to.x + dx, y: cell.to.y + dy };
    cell.points = cell.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
  }
  for (const child of children.get(cell.id) ?? []) shift(child, children, dx, dy);
}

/**
 * The cells a crop keeps, whole, with the crop's corner moved to 0,0. What is kept can reach beyond the crop (a zone
 * that meets it is kept at its full size), so the title block goes above, and the legend below, the crop and
 * everything kept, each `margin` away, at their left edge: neither covers a kept cell.
 */
export function cropCells(cells: readonly Cell[], area: Box, margin: number): Cell[] {
  const byId = new Map(cells.map((cell) => [cell.id, cell]));
  const children = childrenByParent(cells);
  const kept = new Set<string>();
  const keepWithParts = (cell: Cell): void => {
    kept.add(cell.id);
    for (const child of children.get(cell.id) ?? [])
      if (child.role === 'part' || cell.role === 'node' || cell.role === 'other') keepWithParts(child);
  };
  // Zones, nodes and other layer-level shapes that meet the crop, each with its parts and its zones around it.
  for (const cell of cells) {
    const decided =
      cell.role === 'zone' || cell.role === 'node' || (cell.role === 'other' && /^[123]$/.test(cell.parent));
    if (!decided || !boxesMeet(boxOfCell(cell), area)) continue;
    keepWithParts(cell);
    for (let up = byId.get(cell.parent); up !== undefined; up = byId.get(up.parent)) {
      if (kept.has(up.id)) break;
      keepWithParts(up);
    }
  }
  for (const cell of cells) {
    if (cell.role === 'edge' && cell.kind === 'edge') {
      const ends = [cell.source, cell.target];
      if (ends.every((end) => end !== undefined && kept.has(end))) kept.add(cell.id);
      else if (ends.every((end) => end === undefined) && boxesMeet(boxOfCell(cell), area)) kept.add(cell.id);
    }
    if (cell.role === 'title' || cell.role === 'legend') keepWithParts(cell);
  }
  const result = cells.filter((cell) => kept.has(cell.id));
  const keptChildren = childrenByParent(result);
  const layerLevel = (cell: Cell): boolean => /^[123]$/.test(cell.parent);
  const annotations = result.filter(
    (cell) => layerLevel(cell) && (cell.role === 'title' || cell.role === 'legend'),
  );
  const inAnnotation = new Set<string>();
  const mark = (cell: Cell): void => {
    inAnnotation.add(cell.id);
    for (const child of keptChildren.get(cell.id) ?? []) mark(child);
  };
  annotations.forEach(mark);
  // The crop and everything kept in it or reaching out of it (an empty group has no place).
  const content = result
    .filter((cell) => !inAnnotation.has(cell.id))
    .map(boxOfCell)
    .filter((box) => box.width > 0 || box.height > 0);
  const frame = unionBoxes([area, ...content]) ?? area;
  for (const cell of annotations) {
    const box = boxOfCell(cell);
    if (cell.role === 'title')
      shift(cell, keptChildren, frame.x - box.x, frame.y - margin - (box.y + box.height));
    else shift(cell, keptChildren, frame.x - box.x, frame.y + frame.height + margin - box.y);
  }
  for (const cell of result) if (layerLevel(cell)) shift(cell, keptChildren, -area.x, -area.y);
  return result;
}

/** Translates an SVG document of the diagram into draw.io cells. */
export function translateSvg(svg: string, options: TranslateOptions = {}): Translation {
  let root: XmlElement;
  try {
    root = parseXml(svg);
  } catch (error) {
    throw new DrawioError(
      `The drawing could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (root.name !== 'svg') throw new DrawioError('The drawing is not an SVG document.');
  const translator = new Translator(options.fontSource ?? true);
  translator.collectDefs(root);
  const title = childElements(root).find((child) => child.name === 'title');
  const context: Context = {
    matrix: IDENTITY,
    presentation: INITIAL_PRESENTATION,
    opacity: 1,
    parent: DIAGRAM_LAYER,
    role: 'other',
    depth: 0,
  };
  const entered = translator.enter(root, context);
  if (entered !== null) translator.walkChildren(root, entered.context);
  let cells: Cell[] = translator.cells;
  if (options.area !== undefined)
    cells = cropCells(cells, options.area, options.areaMargin ?? DEFAULT_AREA_MARGIN);
  settleLabels(cells);
  const page = unionBoxes(cells.map(boxOfCell)) ?? { x: 0, y: 0, width: 0, height: 0 };
  const count = (role: CellRole): number => cells.filter((cell) => cell.role === role).length;
  return {
    cells,
    page,
    background: translator.background,
    title: title === undefined ? '' : textContent(title).trim(),
    theme: root.attributes.get('data-theme') ?? '',
    summary: {
      zones: options.area === undefined ? translator.zones : count('zone'),
      nodes: options.area === undefined ? translator.nodes : count('node'),
      edges: options.area === undefined ? translator.edges : count('edge'),
      textLines: cells.reduce((sum, cell) => sum + cell.textLines, 0),
      cells: cells.length,
    },
  };
}
