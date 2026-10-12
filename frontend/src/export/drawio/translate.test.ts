// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * The draw.io translator on small drawings written by hand in the markup the diagram's components write: a zone
 * with two nodes and a line, nested zones, a dashed line with elbows and heads at both ends, a dotted line with
 * open heads, text of several lines and runs, the viewport crop, the file's attributes, and both forms of the file
 * (the compressed one read back with the platform's own inflater, not the writer's library).
 */
import { describe, expect, it } from 'vitest';

import { DrawioError, readDrawioFile, svgToDrawio, type DrawioOptions } from './index';
import { FACES, labelOf, LINE_HEIGHT, type TextLine } from './label';
import { decompressDiagram } from './model';
import { polylinesOf, translateSvg } from './translate';
import { parsePath } from './svg';
import { childElements, parseXml, type XmlElement } from './xml';

const OPTIONS: DrawioOptions = { modified: '2026-10-08T00:00:00Z', agent: 'gcportrait test' };

/** Above the baseline of a one-line Roboto label of `size` px at draw.io's line height. */
const top = (size: number): number =>
  (LINE_HEIGHT / 2) * size + ((FACES.sans.ascent - FACES.sans.descent) / 2) * size;

const MARKERS = `
  <marker id="head" viewBox="0 -3.5 9 7" markerWidth="9" markerHeight="7" markerUnits="userSpaceOnUse" refX="0" refY="0" orient="auto"><path d="M0 -3.5L9 0L0 3.5Z" fill="#202124" stroke="none"/></marker>
  <marker id="head-start" viewBox="-9 -3.5 9 7" markerWidth="9" markerHeight="7" markerUnits="userSpaceOnUse" refX="0" refY="0" orient="auto"><path d="M0 -3.5L-9 0L0 3.5Z" fill="#202124" stroke="none"/></marker>
  <marker id="open" viewBox="0 -2.5 7 5" markerWidth="7" markerHeight="5" markerUnits="userSpaceOnUse" refX="7" refY="0" orient="auto"><path d="M0 -2.5L7 0L0 2.5" fill="none" stroke="#202124" stroke-width="1.2"/></marker>
  <g id="icon-a"><svg x="0" y="0" width="24" height="24" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#4285f4"/></svg></g>`;

/** A node's group: its id, its short index (`data-n`) and its zone's (`data-parent`), as the components mark it. */
function card(
  id: string,
  n: number,
  parent: number | null,
  x: number,
  y: number,
  title: string,
  subtitle: string,
): string {
  return (
    `<g class="dg-node dg-card" data-kind="node" data-id="${id}" data-n="${String(n)}"${parent === null ? '' : ` data-parent="${String(parent)}"`}>` +
    `<rect class="dg-body" x="${String(x)}" y="${String(y)}" width="120" height="52" rx="8" fill="#FFFFFF" stroke="#202124" stroke-width="1.5"/>` +
    `<use href="#icon-a" x="${String(x + 12)}" y="${String(y + 14)}"/>` +
    `<text class="dg-label" x="${String(x + 48)}" y="${String(y + 19)}" font-size="13" font-weight="700" fill="#202124">${title}</text>` +
    `<text class="dg-sub" x="${String(x + 48)}" y="${String(y + 34)}" font-size="11" fill="#5F6368">${subtitle}</text></g>`
  );
}

function zone(
  id: string,
  n: number,
  parent: number | null,
  box: string,
  title: string,
  titleX: number,
  baseline: number,
): string {
  return (
    `<g class="dg-zone" data-kind="zone" data-id="${id}" data-n="${String(n)}"${parent === null ? '' : ` data-parent="${String(parent)}"`}>` +
    `<rect class="dg-body" ${box} rx="10" fill="#F1F3F4" stroke="#5F6368" stroke-width="1"/>` +
    `<g><use href="#icon-a" x="${String(titleX - 32)}" y="${String(baseline - 17)}"/>` +
    `<text class="dg-label" xml:space="preserve" x="${String(titleX)}" y="${String(baseline)}" font-size="15" font-weight="500" fill="#202124" stroke="#F1F3F4" stroke-width="4" paint-order="stroke">${title}<tspan font-weight="400" fill="#5F6368"><tspan> · folder 1</tspan></tspan></text>` +
    `<g><rect x="300" y="${String(baseline - 13)}" width="60" height="18" rx="9" fill="#F8F9FA" stroke="#DADCE0"/><text x="306" y="${String(baseline - 0.5)}" font-size="10.5" fill="#5F6368">1 hidden</text></g>` +
    `</g></g>`
  );
}

function drawing(body: string, edges: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 -80 400 400" data-theme="light">` +
    `<title>gcportrait diagram of example.com, Overview lens</title><desc>example.com, Overview lens.</desc>` +
    `<g class="dg-drawing" font-family="&#x27;Google Sans&#x27;, Roboto, system-ui, sans-serif"><defs>${MARKERS}</defs>` +
    `<rect class="dg-background" x="0" y="-80" width="400" height="400" fill="#FFFFFF"/>` +
    `<g class="dg-title-block" data-kind="title">` +
    `<text xml:space="preserve" x="24" y="-41" font-size="15" font-weight="500" fill="#202124">example.com</text>` +
    `<text xml:space="preserve" x="24" y="-23" font-size="11" font-weight="400" fill="#5F6368">Overview lens · read 2026-10-08</text>` +
    `<text xml:space="preserve" x="24" y="-6" font-size="10.5" font-weight="400" fill="#5F6368">gcportrait.app - Visualize your Google Cloud Infrastructure</text></g>` +
    `${body}<g class="dg-edges" aria-hidden="true" fill="none" stroke="#202124">${edges}</g>` +
    `<g class="dg-legend" data-kind="legend" transform="translate(24 260)"><rect x="0.5" y="0.5" width="199" height="39" rx="8" fill="#F8F9FA" stroke="#DADCE0"/>` +
    `<text x="12" y="23" font-size="11" font-weight="700" fill="#202124">Legend</text>` +
    `<g><path d="M120 20H150" fill="none" stroke="#202124" stroke-width="2" marker-end="url(#head)"/><text x="160" y="24" font-size="11" fill="#202124">routes</text></g></g>` +
    `</g></svg>\n`
  );
}

const ONE_ZONE = drawing(
  `<g class="dg-zones">${zone('zone-a', 0, null, 'x="20" y="20" width="360" height="200"', 'Zone A', 68, 45.25)}</g>` +
    `<g class="dg-nodes">${card('node-1', 1, 0, 40, 80, 'first', 'sub')}${card('node-2', 2, 0, 240, 80, 'second', 'more')}</g>`,
  `<path data-ends="1 2" d="M160 106L231 106" stroke-width="2" marker-end="url(#head)"/>`,
);

interface ReadCell {
  readonly attributes: ReadonlyMap<string, string>;
  readonly style: ReadonlyMap<string, string>;
  readonly named: string | undefined;
  readonly geometry: ReadonlyMap<string, string>;
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number; readonly as?: string }>;
}

/** The cells of a file, by id, in file order. */
function cellsOf(file: string): Map<string, ReadCell> {
  const model = parseXml(readDrawioFile(file).model);
  const root = childElements(model).find((child) => child.name === 'root');
  const cells = new Map<string, ReadCell>();
  for (const cell of childElements(root as XmlElement)) {
    const style = new Map<string, string>();
    let named: string | undefined;
    for (const part of (cell.attributes.get('style') ?? '').split(';')) {
      if (part === '') continue;
      const at = part.indexOf('=');
      if (at < 0) named = part;
      else style.set(part.slice(0, at), part.slice(at + 1));
    }
    const geometry = childElements(cell).find((child) => child.name === 'mxGeometry');
    const points = geometry === undefined ? [] : collectPoints(geometry);
    cells.set(cell.attributes.get('id') ?? '', {
      attributes: cell.attributes,
      style,
      named,
      geometry: geometry?.attributes ?? new Map(),
      points,
    });
  }
  return cells;
}

function collectPoints(element: XmlElement): Array<{ x: number; y: number; as?: string }> {
  return childElements(element).flatMap((child) => {
    if (child.name === 'Array') return collectPoints(child);
    if (child.name !== 'mxPoint') return [];
    const as = child.attributes.get('as');
    return [
      {
        x: Number(child.attributes.get('x')),
        y: Number(child.attributes.get('y')),
        ...(as === undefined ? {} : { as }),
      },
    ];
  });
}

function cell(cells: ReadonlyMap<string, ReadCell>, id: string): ReadCell {
  const found = cells.get(id);
  if (found === undefined) throw new Error(`no cell ${id}; cells: ${[...cells.keys()].join(', ')}`);
  return found;
}

const number = (map: ReadonlyMap<string, string>, key: string): number => Number(map.get(key));

function plain(svg: string, options: Partial<DrawioOptions> = {}): string {
  return svgToDrawio(svg, { ...OPTIONS, compressed: false, ...options }).text;
}

describe('svgToDrawio: a zone with two nodes and a line', () => {
  const cells = cellsOf(plain(ONE_ZONE));

  it('writes the three layers under the root, bottom to top', () => {
    expect([...cells.keys()].slice(0, 4)).toEqual(['0', '1', '2', '3']);
    expect(['1', '2', '3'].map((id) => cell(cells, id).attributes.get('value'))).toEqual([
      'Diagram',
      'Connections',
      'Title and legend',
    ]);
  });

  it('draws the zone as a container with its title as its own label, placed exactly', () => {
    const zoneA = cell(cells, 'zone-a');
    expect(zoneA.attributes.get('parent')).toBe('1');
    expect(Object.fromEntries(zoneA.geometry)).toMatchObject({
      x: '20',
      y: '20',
      width: '360',
      height: '200',
    });
    expect(Object.fromEntries(zoneA.style)).toMatchObject({
      rounded: '1',
      absoluteArcSize: '1',
      arcSize: '20',
      fillColor: '#f1f3f4',
      strokeColor: '#5f6368',
      strokeWidth: '1',
      container: '1',
      collapsible: '0',
      html: '1',
      align: 'left',
      verticalAlign: 'top',
      spacing: '0',
      spacingLeft: '48',
      fontFamily: 'Roboto',
      fontSize: '15',
      fontColor: '#202124',
      fontStyle: '0',
    });
    // The first baseline lands where the SVG has it: the label's top is the baseline less the line's top part, on
    // the whole pixel that place rounds to (draw.io reads the spacing as whole pixels).
    expect(45.25 - top(15)).toBeCloseTo(31.12, 2);
    expect(zoneA.style.get('spacingTop')).toBe('11');
    expect(zoneA.attributes.get('value')).toBe(
      '<span style="font-weight: 500">Zone A</span><span style="color: #5f6368"> · folder 1</span>',
    );
    expect(zoneA.style.get('fontSource')).toBe(
      encodeURIComponent(
        'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=Roboto+Mono&display=swap',
      ),
    );
  });

  it('puts the zone icon and its badge inside the zone, at relative positions', () => {
    const icon = cell(cells, 'zone-a#1');
    expect(icon.attributes.get('parent')).toBe('zone-a');
    expect(Object.fromEntries(icon.geometry)).toMatchObject({
      x: '16',
      y: '8.25',
      width: '24',
      height: '24',
    });
    expect(icon.style.get('shape')).toBe('image');
    expect(icon.style.get('imageAspect')).toBe('0');
    const image = icon.style.get('image') ?? '';
    expect(image.startsWith('data:image/svg+xml,')).toBe(true);
    const markup = atob(image.slice('data:image/svg+xml,'.length));
    expect(markup).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" fill="#4285f4"/></svg>',
    );
    const badge = cell(cells, 'zone-a#2');
    expect(badge.attributes.get('value')).toBe('1 hidden');
    expect(Object.fromEntries(badge.geometry)).toMatchObject({
      x: '280',
      y: '12.25',
      width: '60',
      height: '18',
    });
    expect(Object.fromEntries(badge.style)).toMatchObject({
      arcSize: '18',
      spacingLeft: '6',
      fontSize: '10.5',
    });
    // The text's top, 44.75 − 6.3 − 3.59 = 34.86, rounds to 35 and the badge's top, 32.25, to 32: 3 pixels apart.
    expect(badge.style.get('spacingTop')).toBe('3');
  });

  it('draws each node as a group in its zone: body, icon and one text cell of its lines', () => {
    const node = cell(cells, 'node-1');
    expect(node.named).toBe('group');
    expect(node.attributes.get('parent')).toBe('zone-a');
    expect(Object.fromEntries(node.geometry)).toMatchObject({ x: '20', y: '60', width: '120', height: '52' });
    const parts = [...cells.values()].filter((entry) => entry.attributes.get('parent') === 'node-1');
    expect(parts).toHaveLength(3);
    const [body, icon, text] = parts;
    expect(Object.fromEntries(body?.geometry ?? new Map())).toMatchObject({ x: '0', y: '0', width: '120' });
    expect(body?.style.get('strokeWidth')).toBe('1.5');
    expect(body?.style.get('arcSize')).toBe('16');
    expect(body?.attributes.get('connectable')).toBe('0');
    expect(Object.fromEntries(icon?.geometry ?? new Map())).toMatchObject({ x: '12', y: '14' });
    expect(text?.named).toBe('text');
    expect(text?.attributes.get('connectable')).toBe('0');
    expect(text?.style.get('fontStyle')).toBe('1');
    expect(text?.attributes.get('value')).toMatch(
      /^<div style="line-height: 15.6px">first<\/div><div style="font-size: 11px; font-weight: 400; color: #5f6368; line-height: 13.2px; margin-top: [\d.]+px">sub<\/div>$/,
    );
    expect(number(text?.geometry ?? new Map(), 'x')).toBe(48);
    expect(number(text?.geometry ?? new Map(), 'y')).toBeCloseTo(19 - top(13), 1);
  });

  it('draws the line as an edge between the two node groups, its end at the head’s tip', () => {
    const edges = [...cells.entries()].filter(([, entry]) => entry.attributes.get('edge') === '1');
    const [id, edge] = edges.find(([, entry]) => entry.attributes.get('parent') === '2') ?? [];
    expect(id).toMatch(/^edge-[0-9a-z]+$/);
    expect(edge?.attributes.get('source')).toBe('node-1');
    expect(edge?.attributes.get('target')).toBe('node-2');
    expect(Object.fromEntries(edge?.style ?? new Map())).toMatchObject({
      edgeStyle: 'none',
      rounded: '0',
      startArrow: 'none',
      endArrow: 'block',
      endFill: '1',
      endSize: '3.76',
      strokeColor: '#202124',
      strokeWidth: '2',
      exitX: '1',
      exitY: '0.5',
      exitPerimeter: '0',
      entryX: '0',
      entryY: '0.5',
      entryPerimeter: '0',
    });
    expect(edge?.points).toEqual([
      { x: 160, y: 106, as: 'sourcePoint' },
      { x: 240, y: 106, as: 'targetPoint' },
    ]);
  });

  it('writes the title block as one text cell of its three lines, and the legend as a group', () => {
    const title = cell(cells, 'title');
    expect(title.attributes.get('parent')).toBe('3');
    const value = title.attributes.get('value') ?? '';
    expect(value.match(/<div /g)).toHaveLength(3);
    expect(value).toContain('gcportrait.app - Visualize your Google Cloud Infrastructure');
    expect(value).not.toMatch(/affiliated/i);
    const legend = cell(cells, 'legend');
    expect(legend.named).toBe('group');
    expect(legend.attributes.get('parent')).toBe('3');
    const parts = [...cells.values()].filter((entry) => entry.attributes.get('parent') === 'legend');
    // The panel, the title, the sample line with its head and its label.
    expect(
      parts.map((entry) => entry.named ?? (entry.attributes.get('edge') === '1' ? 'line' : 'shape')),
    ).toEqual(['shape', 'text', 'line', 'text']);
    const sample = parts[2];
    expect(sample?.style.get('endArrow')).toBe('block');
    expect(sample?.points).toEqual([
      // Relative to the legend group's origin, the panel's corner (24.5, 260.5).
      { x: 119.5, y: 19.5, as: 'sourcePoint' },
      { x: 158.5, y: 19.5, as: 'targetPoint' },
    ]);
  });

  it('takes the page background from the drawing’s canvas, and names the page after its title', () => {
    const file = plain(ONE_ZONE);
    expect(file).toContain('background="#ffffff"');
    // The drawing's colours in draw.io's dark UI too: no adaptive recolouring.
    expect(file).toContain('adaptiveColors="none"');
    const read = readDrawioFile(file);
    expect(read.diagram.get('name')).toBe('gcportrait diagram of example.com, Overview lens');
    expect(Object.fromEntries(read.attributes)).toEqual({
      host: 'gcportrait',
      modified: '2026-10-08T00:00:00.000Z',
      agent: 'gcportrait test',
      version: '24.7.17',
    });
  });

  it('counts what it drew', () => {
    expect(svgToDrawio(ONE_ZONE, OPTIONS).summary).toEqual({
      zones: 1,
      nodes: 2,
      edges: 1,
      textLines: 11,
      cells: 18,
    });
  });
});

describe('svgToDrawio: structure and lines', () => {
  it('nests zones as containers with geometry relative to their parent', () => {
    const svg = drawing(
      `<g class="dg-zones">${zone('outer', 0, null, 'x="20" y="20" width="360" height="220"', 'Outer', 68, 45.25)}` +
        zone('inner', 1, 0, 'x="40" y="70" width="320" height="150"', 'Inner', 88, 95.25) +
        `</g><g class="dg-nodes">${card('leaf', 2, 1, 60, 120, 'leaf', 'in inner')}</g>`,
      '',
    );
    const cells = cellsOf(plain(svg));
    expect(cell(cells, 'inner').attributes.get('parent')).toBe('outer');
    expect(Object.fromEntries(cell(cells, 'inner').geometry)).toMatchObject({ x: '20', y: '50' });
    expect(cell(cells, 'leaf').attributes.get('parent')).toBe('inner');
    expect(Object.fromEntries(cell(cells, 'leaf').geometry)).toMatchObject({ x: '20', y: '50' });
    // Parents come before their children in the file.
    const order = [...cells.keys()];
    expect(order.indexOf('outer')).toBeLessThan(order.indexOf('inner'));
    expect(order.indexOf('inner')).toBeLessThan(order.indexOf('leaf'));
  });

  it('draws a dashed line with elbows and heads at both ends: waypoints, dashes in pixels, both arrows', () => {
    const svg = drawing(
      `<g class="dg-nodes">${card('a', 0, null, 40, 80, 'a', 'x')}${card('b', 1, null, 240, 200, 'b', 'y')}</g>`,
      `<path data-ends="0 1" ` +
        `d="M169 106L190 106A6 6 0 0 1 196 112L196 220A6 6 0 0 0 202 226L231 226" stroke-width="2" ` +
        `stroke-dasharray="6 5" marker-start="url(#head-start)" marker-end="url(#head)"/>`,
    );
    const cells = cellsOf(plain(svg));
    const edge = [...cells.values()].find((entry) => entry.attributes.get('source') === 'a');
    expect(Object.fromEntries(edge?.style ?? new Map())).toMatchObject({
      rounded: '1',
      arcSize: '12',
      startArrow: 'block',
      startFill: '1',
      endArrow: 'block',
      dashed: '1',
      dashPattern: '6 5',
      fixDash: '1',
      exitX: '1',
      entryX: '0',
    });
    expect(edge?.points).toEqual([
      { x: 160, y: 106, as: 'sourcePoint' },
      { x: 240, y: 226, as: 'targetPoint' },
      { x: 196, y: 106 },
      { x: 196, y: 226 },
    ]);
  });

  it('draws a dotted line with an open head as draw.io’s open arrow, its tip where the path ends', () => {
    const svg = drawing(
      `<g class="dg-nodes">${card('a', 0, null, 40, 80, 'a', 'x')}${card('b', 1, null, 240, 80, 'b', 'y')}</g>`,
      `<path data-ends="0 1" d="M160 106L240 106" ` +
        `stroke-width="1.2" stroke-dasharray="1 3" marker-end="url(#open)"/>`,
    );
    const edge = [...cellsOf(plain(svg)).values()].find((entry) => entry.attributes.get('source') === 'a');
    expect(Object.fromEntries(edge?.style ?? new Map())).toMatchObject({
      endArrow: 'open',
      endFill: '0',
      endSize: '4.46',
      strokeWidth: '1.2',
      dashPattern: '1 3',
    });
    expect(edge?.points.find((point) => point.as === 'targetPoint')).toEqual({
      x: 240,
      y: 106,
      as: 'targetPoint',
    });
  });

  it('reads elbows back to their corners, also two elbows in a row', () => {
    expect(
      polylinesOf(parsePath('M1232 642L1245 642A3 3 0 0 0 1248 639A3 3 0 0 1 1251 636L1259 636')),
    ).toEqual({
      lines: [
        [
          { x: 1232, y: 642 },
          { x: 1248, y: 642 },
          { x: 1248, y: 636 },
          { x: 1259, y: 636 },
        ],
      ],
      radius: 3,
    });
    expect(polylinesOf(parsePath('M0 0C10 10 20 10 30 0'))).toBeNull();
  });

  it('draws a shape it has no cell for (a curve, a filled path) as an image of itself', () => {
    const svg = drawing(
      '<g class="dg-diff"><path d="M10 10C20 0 30 0 40 10" fill="none" stroke="#F9AB00"/></g>',
      '',
    );
    const image = [...cellsOf(plain(svg)).values()].find((entry) => entry.style.get('shape') === 'image');
    const markup = atob((image?.style.get('image') ?? '').slice('data:image/svg+xml,'.length));
    expect(markup).toContain('<path d="M10 10C20 0 30 0 40 10" fill="none" stroke="#F9AB00"');
  });

  it('keeps a timeline ghost together as one group on the layer under the lines', () => {
    const svg = drawing(
      `<g class="dg-ghosts"><g class="dg-ghost" data-ghost="gone" data-reason="removed"><title>gone</title>` +
        `<g opacity="0.5"><rect x="40" y="80" width="120" height="52" rx="8" fill="#FFFFFF"/></g>` +
        `<text x="88" y="99" font-size="13" font-weight="700" fill="#5F6368">gone</text>` +
        `<rect x="40" y="80" width="120" height="52" rx="8" fill="none" stroke="#D93025" stroke-dasharray="5 3"/></g></g>`,
      '',
    );
    const cells = cellsOf(plain(svg));
    const group = [...cells.entries()].find(
      ([, entry]) => entry.named === 'group' && entry.attributes.get('parent') === '1',
    );
    expect(group).toBeDefined();
    const parts = [...cells.values()].filter((entry) => entry.attributes.get('parent') === group?.[0]);
    expect(parts).toHaveLength(3);
    expect(parts[0]?.style.get('opacity')).toBe('50');
  });

  it('refuses markup that is not an SVG document', () => {
    expect(() => translateSvg('<html></html>')).toThrow(DrawioError);
    expect(() => translateSvg('<svg><g></svg>')).toThrow(DrawioError);
  });
});

describe('labels', () => {
  const line = (overrides: Partial<TextLine>): TextLine => ({
    runs: [{ text: 'label', face: 'sans', size: 13, weight: 400, italic: false, colour: '#202124' }],
    face: 'sans',
    size: 13,
    weight: 400,
    italic: false,
    colour: '#202124',
    x: 10,
    baseline: 30,
    anchor: 'start',
    ...overrides,
  });

  it('puts a one-line label’s top where its baseline lands at line-height 1.2', () => {
    const label = labelOf([line({})]);
    expect(label.y).toBeCloseTo(30 - top(13), 6);
    expect(label.html).toBe('label');
    expect(label.align).toBe('left');
  });

  it('keeps the baselines of several lines apart as in the SVG', () => {
    const label = labelOf([
      line({ baseline: 19, size: 13 }),
      line({
        baseline: 34,
        size: 11,
        runs: [{ text: 'b', face: 'sans', size: 11, weight: 400, italic: false, colour: '#202124' }],
      }),
    ]);
    const margin = Number(/margin-top: ([\d.]+)px/.exec(label.html)?.[1]);
    // The second baseline: the first line's box (15.6 px), the margin, then the second line's top part.
    const second =
      label.y + 15.6 + margin + (LINE_HEIGHT / 2) * 11 + ((FACES.sans.ascent - FACES.sans.descent) / 2) * 11;
    expect(second).toBeCloseTo(34, 1);
  });

  it('writes runs in another face, weight or colour as spans, and keeps spaces HTML would collapse', () => {
    const label = labelOf([
      line({
        runs: [
          { text: ' 10.0.0.0/8', face: 'mono', size: 11, weight: 400, italic: false, colour: '#5f6368' },
          { text: '  · a&b', face: 'sans', size: 11, weight: 500, italic: false, colour: '#5f6368' },
        ],
        size: 11,
        colour: '#5f6368',
      }),
    ]);
    expect(label.html).toBe(
      `<span style="font-family: 'Roboto Mono', monospace">&nbsp;10.0.0.0/8</span>` +
        '<span style="font-weight: 500"> &nbsp;· a&amp;b</span>',
    );
  });

  it('centres and right-aligns around the anchor', () => {
    expect(labelOf([line({ anchor: 'middle' })])).toMatchObject({ align: 'center' });
    const right = labelOf([line({ anchor: 'end' })]);
    expect(right.align).toBe('right');
    expect(right.x + right.width).toBeCloseTo(10, 6);
  });
});

describe('the viewport crop', () => {
  // Only the first node is in view.
  const area = { x: 30, y: 70, width: 100, height: 70 };
  const cells = cellsOf(plain(ONE_ZONE, { area, areaMargin: 24 }));

  it('keeps what meets the area, whole, with the zones around it, and drops the rest', () => {
    expect(cells.has('zone-a')).toBe(true);
    expect(cells.has('node-1')).toBe(true);
    expect(cells.has('node-2')).toBe(false);
    expect([...cells.values()].some((entry) => entry.attributes.get('parent') === 'node-2')).toBe(false);
    // The line leads to a node outside the area.
    expect([...cells.values()].some((entry) => entry.attributes.get('parent') === '2')).toBe(false);
    // Kept whole: the zone keeps its full size.
    expect(Object.fromEntries(cell(cells, 'zone-a').geometry)).toMatchObject({ width: '360', height: '200' });
  });

  it('moves the area’s corner to 0,0, and the title block and the legend clear of everything kept', () => {
    // The zone, kept whole, reaches 10 px left of the area, 50 above it and 80 below it (to y 150).
    expect(Object.fromEntries(cell(cells, 'zone-a').geometry)).toMatchObject({ x: '-10', y: '-50' });
    const title = cell(cells, 'title').geometry;
    expect(number(title, 'x')).toBe(-10);
    expect(number(title, 'y') + number(title, 'height')).toBeCloseTo(-50 - 24, 6);
    const legend = cell(cells, 'legend').geometry;
    expect(Object.fromEntries(legend)).toMatchObject({ x: '-10', y: '174' });
  });

  it('keeps the bands at the area when nothing kept reaches beyond it', () => {
    // The whole zone in view: the title block 24 above the area, the legend 24 below it.
    const wide = { x: 10, y: 10, width: 380, height: 220 };
    const kept = cellsOf(plain(ONE_ZONE, { area: wide, areaMargin: 24 }));
    const title = cell(kept, 'title').geometry;
    expect(number(title, 'x')).toBe(0);
    expect(number(title, 'y') + number(title, 'height')).toBeCloseTo(-24, 6);
    expect(Object.fromEntries(cell(kept, 'legend').geometry)).toMatchObject({ x: '0', y: '244' });
  });

  it('puts a moved zone’s title on the pixel its exact place rounds to', () => {
    // A crop at a fraction of a pixel: the zone's corner at (−10.4, −50.6), its title's top at 31.12 − 70.6 =
    // −39.48. draw.io draws the label at round(−50.6) + spacingTop = −51 + 12 = −39 (the whole-diagram file has 11).
    const fractional = cellsOf(plain(ONE_ZONE, { area: { x: 30.4, y: 70.6, width: 100, height: 70 } }));
    const zoneA = cell(fractional, 'zone-a');
    expect(Object.fromEntries(zoneA.geometry)).toMatchObject({ x: '-10.4', y: '-50.6' });
    expect(zoneA.style.get('spacingTop')).toBe('12');
    expect(zoneA.style.get('spacingLeft')).toBe('48');
  });

  it('counts what it kept', () => {
    expect(svgToDrawio(ONE_ZONE, { ...OPTIONS, area }).summary).toMatchObject({
      zones: 1,
      nodes: 1,
      edges: 0,
    });
  });
});

describe('the file', () => {
  it('compresses the diagram as draw.io does: URI-encoded XML, raw deflate, base64', async () => {
    const compressed = svgToDrawio(ONE_ZONE, OPTIONS).text;
    const body = /<diagram [^>]*>([^<]*)<\/diagram>/.exec(compressed)?.[1] ?? '';
    expect(body).toMatch(/^[A-Za-z0-9+/]+=*$/);
    const bytes = Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const inflated = decodeURIComponent(await new Response(stream).text());
    const model = /<diagram [^>]*>(.*)<\/diagram>/.exec(plain(ONE_ZONE))?.[1];
    expect(inflated).toBe(model);
    expect(decompressDiagram(body)).toBe(model);
    expect(readDrawioFile(compressed)).toMatchObject({ compressed: true, model });
  });

  it('writes the same bytes for the same drawing', () => {
    expect(svgToDrawio(ONE_ZONE, OPTIONS).text).toBe(svgToDrawio(ONE_ZONE, OPTIONS).text);
  });

  it('leaves the fonts’ stylesheet out on request', () => {
    expect(plain(ONE_ZONE, { fontSource: false })).not.toContain('fontSource=');
    expect(plain(ONE_ZONE)).toContain('fontSource=');
  });

  it('gives each theme, view and read time of the same data its own page id, the same on every run', () => {
    const idOf = (svg: string, options: Partial<DrawioOptions> = {}): string =>
      readDrawioFile(svgToDrawio(svg, { ...OPTIONS, ...options }).text).diagram.get('id') ?? '';
    const light = idOf(ONE_ZONE, { view: 'snapshot=demo%3AS' });
    expect(light).toMatch(/^gcportrait-[0-9a-z]{14}$/);
    expect(idOf(ONE_ZONE, { view: 'snapshot=demo%3AS' })).toBe(light);
    const ids = [
      light,
      idOf(ONE_ZONE.replace('data-theme="light"', 'data-theme="dark"'), { view: 'snapshot=demo%3AS' }),
      idOf(ONE_ZONE, { view: 'snapshot=demo%3AS&detail=folders' }),
      idOf(ONE_ZONE, { view: 'snapshot=demo%3AS&focus=perimeter' }),
      idOf(ONE_ZONE, { view: 'snapshot=demo%3AS', modified: '2026-10-07T00:00:00Z' }),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the markers', () => {
  it('connects a line to the nodes its `data-ends` indices name, and keeps a second line between them apart', () => {
    const svg = drawing(
      `<g class="dg-nodes">${card('//example/a', 7, null, 40, 80, 'a', 'x')}${card('//example/b', 3, null, 240, 80, 'b', 'y')}</g>`,
      `<path data-ends="7 3" d="M160 100L240 100"/><path data-ends="7 3" d="M160 112L240 112" stroke-dasharray="6 5"/>`,
    );
    const edges = [...cellsOf(plain(svg)).entries()].filter(
      ([, entry]) => entry.attributes.get('parent') === '2',
    );
    expect(
      edges.map(([, entry]) => [entry.attributes.get('source'), entry.attributes.get('target')]),
    ).toEqual([
      ['//example/a', '//example/b'],
      ['//example/a', '//example/b'],
    ]);
    const [first, second] = edges.map(([id]) => id);
    expect(second).toBe(`${first ?? ''}~2`);
    expect(translateSvg(svg).summary).toMatchObject({ nodes: 2, edges: 2 });
  });

  it('draws a line whose ends name no node as a line without terminals', () => {
    const svg = drawing(
      `<g class="dg-nodes">${card('a', 0, null, 40, 80, 'a', 'x')}</g>`,
      `<path data-ends="0 9" d="M160 100L240 100"/>`,
    );
    const [edge] = [...cellsOf(plain(svg)).values()].filter(
      (entry) => entry.attributes.get('parent') === '2',
    );
    expect(edge?.attributes.get('source')).toBe('a');
    expect(edge?.attributes.has('target')).toBe(false);
  });
});
