// SPDX-License-Identifier: Apache-2.0
/**
 * The draw.io side of the export: cells with absolute geometry while the translator builds them, then the file
 * draw.io reads (an `mxfile` with one `diagram` holding an `mxGraphModel`), plain or compressed as draw.io itself
 * saves (the model's XML URI-encoded, deflated without a zlib header, base64). The compressor is fflate's, plain
 * JavaScript, so the same drawing gives the same bytes in the browser and in Node, on every platform.
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';

import { formatNumber } from '../../diagram/geometry/edgePath';
import type { Box, Point } from './svg';
import { childElements, escapeAttribute, parseXml, serializeXml, type XmlElement } from './xml';

export { formatNumber };

/** The three layers, bottom to top: zones and nodes, the lines, the title block and the legend. */
export const LAYERS = [
  { id: '1', name: 'Diagram' },
  { id: '2', name: 'Connections' },
  { id: '3', name: 'Title and legend' },
] as const;

export type LayerId = (typeof LAYERS)[number]['id'];

export const ROOT_ID = '0';

/** A style as draw.io writes it: an optional named style first, then `key=value` pairs, in order. */
export class Style {
  readonly #entries: Array<readonly [string, string]> = [];
  readonly #named: string | undefined;

  constructor(named?: string) {
    this.#named = named;
  }

  set(key: string, value: string | number | undefined): this {
    if (value === undefined) return this;
    const text = typeof value === 'number' ? formatNumber(value) : value;
    const at = this.#entries.findIndex(([name]) => name === key);
    if (at >= 0) this.#entries[at] = [key, text];
    else this.#entries.push([key, text]);
    return this;
  }

  get(key: string): string | undefined {
    return this.#entries.find(([name]) => name === key)?.[1];
  }

  toString(): string {
    const pairs = this.#entries.map(([key, value]) => `${key}=${value}`);
    return [...(this.#named === undefined ? [] : [this.#named]), ...pairs].map((part) => `${part};`).join('');
  }
}

/** What a cell stands for: the export's structure, which the viewport crop and the summary read. */
export type CellRole =
  | 'zone'
  | 'node'
  | 'edge'
  | 'title'
  | 'legend'
  /** Part of a zone or node (its icon, label, badges) or of the legend: moves and is kept with it. */
  | 'part'
  /** Anything else the drawing has (timeline ghosts and markers, a selection's rings), decided on its own. */
  | 'other';

interface CellBase {
  readonly id: string;
  parent: string;
  readonly role: CellRole;
  readonly style: Style;
  value: string;
  /** How many of the drawing's text lines its label holds. */
  textLines: number;
}

export interface VertexCell extends CellBase {
  readonly kind: 'vertex';
  /** In drawing coordinates (the file writes it relative to its parent). */
  box: Box;
  readonly connectable: boolean;
  /**
   * Where the cell's own label starts (its top-left corner), from the cell's top-left corner: a zone's title, a
   * badge's text. draw.io reads `spacingLeft` and `spacingTop` as whole pixels, so the file writes the whole-pixel
   * spacing that puts the label on the pixel the exact place rounds to (the translator's `settleLabels`).
   */
  labelOffset?: Point;
}

export interface EdgeCell extends CellBase {
  readonly kind: 'edge';
  source?: string;
  target?: string;
  /** Drawing coordinates: where it starts and ends, and the bends in between. */
  from: Point;
  to: Point;
  points: Point[];
}

export type Cell = VertexCell | EdgeCell;

/** A deterministic short hash of a string (two 32-bit FNV-1a passes, base 36). */
export function hashOf(value: string): string {
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
 * Cell ids from the drawing's own ids: an asset name or a zone id as it is when it is a plain token (printable ASCII
 * without spaces or `#`, which the translator uses for a cell's parts), else `h` and its hash. Every id is unique.
 */
export class CellIds {
  readonly #used = new Set<string>([ROOT_ID, ...LAYERS.map((layer) => layer.id)]);

  /** An id for `wanted`, made unique with `~2`, `~3`, … when it is taken. */
  claim(wanted: string): string {
    let id = wanted;
    for (let count = 2; this.#used.has(id); count += 1) id = `${wanted}~${String(count)}`;
    this.#used.add(id);
    return id;
  }

  /** The id of a zone or a node with the drawing's id `modelId`. */
  forModel(modelId: string): string {
    const plain = /^[\x21-\x7e]{1,400}$/.test(modelId) && !modelId.includes('#') && !/^\d+$/.test(modelId);
    return this.claim(plain ? modelId : `h${hashOf(modelId)}`);
  }
}

export interface MxfileOptions {
  /** `host`: what wrote the file. */
  readonly host: string;
  /** `modified`: an ISO-8601 instant (the data's read time). */
  readonly modified: string;
  /** `agent`: the writer and its version. */
  readonly agent: string;
  /** The diagram's (page's) name. */
  readonly name: string;
  /** The drawing's theme and view (its app link's hash), which tell this page's id from the other views'. */
  readonly theme: string;
  readonly view: string;
  readonly compressed: boolean;
}

/** The draw.io release whose file format this writes (`mxfile`'s `version`). */
export const DRAWIO_VERSION = '24.7.17';

function absoluteOrigin(cells: ReadonlyMap<string, Cell>, parent: string): Point {
  const cell = cells.get(parent);
  return cell?.kind === 'vertex' ? { x: cell.box.x, y: cell.box.y } : { x: 0, y: 0 };
}

function pointXml(point: Point, origin: Point, as?: string): string {
  return `<mxPoint x="${formatNumber(point.x - origin.x)}" y="${formatNumber(point.y - origin.y)}"${as === undefined ? '' : ` as="${as}"`}/>`;
}

function cellXml(cell: Cell, cells: ReadonlyMap<string, Cell>): string {
  const origin = absoluteOrigin(cells, cell.parent);
  const head =
    `<mxCell id="${escapeAttribute(cell.id)}" value="${escapeAttribute(cell.value)}" ` +
    `style="${escapeAttribute(cell.style.toString())}"`;
  if (cell.kind === 'vertex') {
    const { box } = cell;
    return (
      `${head} vertex="1"${cell.connectable ? '' : ' connectable="0"'} parent="${escapeAttribute(cell.parent)}">` +
      `<mxGeometry x="${formatNumber(box.x - origin.x)}" y="${formatNumber(box.y - origin.y)}" ` +
      `width="${formatNumber(box.width)}" height="${formatNumber(box.height)}" as="geometry"/></mxCell>`
    );
  }
  const terminals =
    (cell.source === undefined ? '' : ` source="${escapeAttribute(cell.source)}"`) +
    (cell.target === undefined ? '' : ` target="${escapeAttribute(cell.target)}"`);
  const points =
    cell.points.length === 0
      ? ''
      : `<Array as="points">${cell.points.map((point) => pointXml(point, origin)).join('')}</Array>`;
  return (
    `${head} edge="1" parent="${escapeAttribute(cell.parent)}"${terminals}>` +
    `<mxGeometry relative="1" as="geometry">${pointXml(cell.from, origin, 'sourcePoint')}` +
    `${pointXml(cell.to, origin, 'targetPoint')}${points}</mxGeometry></mxCell>`
  );
}

/**
 * The `mxGraphModel` of the cells (in order: parents before their children), with the three layers. Its colours are
 * the drawing's own in draw.io's light and dark UI alike: `adaptiveColors="none"` turns off the recolouring that
 * diagrams.net applies to a diagram in its dark UI otherwise (a version that does not know the attribute ignores it).
 */
export function modelXml(cells: readonly Cell[], page: Box, background: string): string {
  const byId = new Map(cells.map((cell) => [cell.id, cell]));
  const layers = LAYERS.map(
    (layer) => `<mxCell id="${layer.id}" value="${escapeAttribute(layer.name)}" parent="${ROOT_ID}"/>`,
  );
  return (
    `<mxGraphModel dx="0" dy="0" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" ` +
    `fold="1" page="0" pageScale="1" pageWidth="${formatNumber(Math.ceil(page.width), 0)}" ` +
    `pageHeight="${formatNumber(Math.ceil(page.height), 0)}" math="0" shadow="0" ` +
    `background="${escapeAttribute(background)}" adaptiveColors="none"><root><mxCell id="${ROOT_ID}"/>${layers.join('')}` +
    `${cells.map((cell) => cellXml(cell, byId)).join('')}</root></mxGraphModel>`
  );
}

/** Bytes as base64 (no line breaks). */
export function base64Of(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk)
    binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  return btoa(binary);
}

function bytesOfBase64(text: string): Uint8Array {
  const binary = atob(text.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** draw.io's compressed diagram: the XML URI-encoded, deflated (raw, no zlib header), base64. */
export function compressDiagram(xml: string): string {
  return base64Of(deflateSync(strToU8(encodeURIComponent(xml))));
}

/** The reverse of {@link compressDiagram}. */
export function decompressDiagram(text: string): string {
  return decodeURIComponent(strFromU8(inflateSync(bytesOfBase64(text))));
}

/**
 * The diagram's (page's) id: deterministic, and different for each view, theme and read time of the same data, so
 * pages copied from several files into one keep their own ids.
 */
export function diagramIdOf(options: Pick<MxfileOptions, 'name' | 'modified' | 'theme' | 'view'>): string {
  return `gcportrait-${hashOf([options.name, options.modified, options.theme, options.view].join('\n'))}`;
}

/** The whole file: `mxfile`, its one `diagram`, and the model (compressed or as XML), with a trailing newline. */
export function mxfileXml(model: string, options: MxfileOptions): string {
  const diagramId = diagramIdOf(options);
  const body = options.compressed ? compressDiagram(model) : model;
  return (
    `<mxfile host="${escapeAttribute(options.host)}" modified="${escapeAttribute(options.modified)}" ` +
    `agent="${escapeAttribute(options.agent)}" version="${DRAWIO_VERSION}">` +
    `<diagram id="${escapeAttribute(diagramId)}" name="${escapeAttribute(options.name)}">${body}</diagram>` +
    `</mxfile>\n`
  );
}

/** A `.drawio` file read back: its attributes and its model's XML, whichever way the model was stored. */
export interface ReadDrawio {
  readonly attributes: ReadonlyMap<string, string>;
  readonly diagram: ReadonlyMap<string, string>;
  readonly compressed: boolean;
  /** The `mxGraphModel` element's markup. */
  readonly model: string;
}

/** Reads a `.drawio` file's first diagram (plain or compressed), as draw.io opens it. */
export function readDrawio(file: string): ReadDrawio {
  const root = parseXml(file);
  if (root.name !== 'mxfile') throw new Error('not a draw.io file: the root element is not <mxfile>');
  const diagram = childElements(root).find((child) => child.name === 'diagram');
  if (diagram === undefined) throw new Error('the draw.io file has no <diagram>');
  const model: XmlElement | undefined = childElements(diagram).find((child) => child.name === 'mxGraphModel');
  if (model !== undefined)
    return {
      attributes: root.attributes,
      diagram: diagram.attributes,
      compressed: false,
      model: serializeXml(model),
    };
  const text = diagram.children.map((child) => (child.kind === 'text' ? child.text : '')).join('');
  return {
    attributes: root.attributes,
    diagram: diagram.attributes,
    compressed: true,
    model: decompressDiagram(text.trim()),
  };
}
