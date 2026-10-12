// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * The draw.io translator on demo S's overview in both themes, the drawing the render golden is made of: every zone,
 * node and line of the layout is a cell (zones as containers, nodes as groups, lines between their nodes), every
 * text line of the SVG is in a label, the title block carries its three lines and nothing else, the cells' own labels
 * land within half a pixel of their places, the same drawing gives the same bytes, and both the compressed and the
 * plain file read back to the same model. And two "current viewport" crops: the title block and the legend clear of
 * everything kept.
 */
import { describe, expect, it } from 'vitest';

import { TAGLINE } from '../../branding';
import { buildDiagramModel } from '../../diagram/model';
import { renderDiagramSvg } from '../../diagram/static';
import { demoDiagram } from '../../diagram/testing/demoScenes';
import { readDrawioFile, svgToDrawio, type DrawioOptions } from './index';
import type { Cell } from './model';
import { boundsOf, boxesMeet, unionBoxes, type Box } from './svg';
import { DEFAULT_AREA_MARGIN, translateSvg } from './translate';
import { childElements, parseXml } from './xml';

interface ModelCell {
  readonly id: string;
  readonly parent: string;
  readonly style: string;
  readonly edge: boolean;
  readonly source?: string;
  readonly target?: string;
  readonly value: string;
  /** The geometry's corner as the file writes it (relative to the parent). */
  readonly x: number;
  readonly y: number;
}

function modelCells(model: string): ModelCell[] {
  const root = childElements(parseXml(model)).find((child) => child.name === 'root');
  return childElements(root ?? parseXml('<root/>')).map((cell) => {
    const source = cell.attributes.get('source');
    const target = cell.attributes.get('target');
    const geometry = childElements(cell).find((child) => child.name === 'mxGeometry');
    return {
      id: cell.attributes.get('id') ?? '',
      parent: cell.attributes.get('parent') ?? '',
      style: cell.attributes.get('style') ?? '',
      edge: cell.attributes.get('edge') === '1',
      value: cell.attributes.get('value') ?? '',
      ...(source === undefined ? {} : { source }),
      ...(target === undefined ? {} : { target }),
      x: Number(geometry?.attributes.get('x') ?? 0),
      y: Number(geometry?.attributes.get('y') ?? 0),
    };
  });
}

function styleValue(style: string, key: string): string | undefined {
  return style
    .split(';')
    .find((part) => part.startsWith(`${key}=`))
    ?.slice(key.length + 1);
}

function boxOfCell(cell: Cell): Box {
  return cell.kind === 'vertex' ? cell.box : boundsOf([cell.from, cell.to, ...cell.points]);
}

describe.each(['light', 'dark'] as const)('demo S overview, %s', (theme) => {
  it('turns every zone, node and line of the drawing into its cell, and every text line into a label', async () => {
    const { input } = await demoDiagram('S', 'overview', 'auto');
    const model = buildDiagramModel(input);
    const svg = renderDiagramSvg(input, { theme, utcOffsetMinutes: 0 });
    const options: DrawioOptions = { modified: input.scene.metadata.readTime, agent: 'gcportrait test' };
    const file = svgToDrawio(svg, options);

    const zones = model.rects.filter(([, rect]) => rect.role === 'zone').map(([id]) => id);
    const nodes = model.rects.filter(([, rect]) => rect.role !== 'zone').map(([id]) => id);
    expect(file.summary).toMatchObject({
      zones: zones.length,
      nodes: nodes.length,
      edges: model.lines.length,
      textLines: [...svg.matchAll(/<text\b/g)].length,
    });

    const read = readDrawioFile(file.text);
    expect(read.compressed).toBe(true);
    const cells = modelCells(read.model);
    const byId = new Map(cells.map((cell) => [cell.id, cell]));
    expect(cells).toHaveLength(file.summary.cells + 4);
    for (const id of zones) {
      const cell = byId.get(id);
      expect(cell?.style, id).toContain('container=1;');
      const parent = model.parent.get(id);
      expect(cell?.parent, id).toBe(parent === null || parent === undefined ? '1' : parent);
    }
    for (const id of nodes) {
      const cell = byId.get(id);
      expect(cell?.style.startsWith('group;'), id).toBe(true);
      const parent = model.parent.get(id);
      expect(cell?.parent, id).toBe(parent === null || parent === undefined ? '1' : parent);
    }
    const edges = cells.filter((cell) => cell.edge && cell.parent === '2');
    expect(edges).toHaveLength(model.lines.length);
    const ends = new Set(model.lines.flatMap((edge) => [edge.path.from, edge.path.to]));
    for (const edge of edges) {
      expect(ends.has(edge.source ?? '')).toBe(true);
      expect(ends.has(edge.target ?? '')).toBe(true);
    }
    // Every cell's parent is in the file before it.
    const seen = new Set<string>();
    for (const cell of cells) {
      if (cell.id !== '0') expect(seen.has(cell.parent), cell.id).toBe(true);
      seen.add(cell.id);
    }

    // The title block: its three lines, ending with the tagline, and no affiliation statement anywhere.
    const title = byId.get('title');
    expect(title?.parent).toBe('3');
    expect(title?.value.match(/<div /g)).toHaveLength(3);
    expect(title?.value).toContain(TAGLINE);
    expect(read.model).not.toMatch(/affiliated/i);
    expect(read.model).toContain(`background="${theme === 'light' ? '#ffffff' : '#1f1f1f'}"`);
    expect(read.model).toContain('adaptiveColors="none"');

    // A cell's own label (a zone's title, a badge's text): whole-pixel spacing (draw.io drops a fraction), drawn at
    // the cell's corner as the file places it (the sum of the relative geometry, rounded as the renderer rounds)
    // plus the spacing, within half a pixel of the exact place.
    const exact = new Map(
      translateSvg(svg).cells.flatMap((cell) =>
        cell.kind === 'vertex' && cell.labelOffset !== undefined
          ? [[cell.id, { x: cell.box.x + cell.labelOffset.x, y: cell.box.y + cell.labelOffset.y }] as const]
          : [],
      ),
    );
    expect(exact.size).toBeGreaterThan(10);
    const absolute = (id: string): { x: number; y: number } => {
      const cell = byId.get(id);
      if (cell === undefined || /^[0-3]$/.test(id)) return { x: 0, y: 0 };
      const origin = absolute(cell.parent);
      return { x: origin.x + cell.x, y: origin.y + cell.y };
    };
    for (const [id, place] of exact) {
      const cell = byId.get(id);
      const left = styleValue(cell?.style ?? '', 'spacingLeft') ?? '';
      const top = styleValue(cell?.style ?? '', 'spacingTop') ?? '';
      expect(left, id).toMatch(/^-?\d+$/);
      expect(top, id).toMatch(/^-?\d+$/);
      const corner = absolute(id);
      expect(Math.abs(Math.round(corner.x) + Number(left) - place.x), id).toBeLessThanOrEqual(0.51);
      expect(Math.abs(Math.round(corner.y) + Number(top) - place.y), id).toBeLessThanOrEqual(0.51);
    }

    // One drawing, the same bytes; the plain form holds the same model.
    expect(svgToDrawio(svg, options).text).toBe(file.text);
    const plain = svgToDrawio(svg, { ...options, compressed: false });
    expect(readDrawioFile(plain.text)).toMatchObject({ compressed: false, model: read.model });
  }, 60_000);

  it.each([
    { x: 300, y: 200, width: 700, height: 400 },
    { x: 1500, y: 500, width: 300, height: 300 },
  ])(
    'crops to %o with the title block above and the legend below everything kept',
    async (area) => {
      const { input } = await demoDiagram('S', 'overview', 'auto');
      const svg = renderDiagramSvg(input, { theme, utcOffsetMinutes: 0 });
      const { cells } = translateSvg(svg, { area });
      const byId = new Map(cells.map((cell) => [cell.id, cell]));
      const annotationOf = (cell: Cell): 'title' | 'legend' | null => {
        for (let up: Cell | undefined = cell; up !== undefined; up = byId.get(up.parent))
          if (up.role === 'title' || up.role === 'legend') return up.role;
        return null;
      };
      const content = cells.filter((cell) => annotationOf(cell) === null).map(boxOfCell);
      const kept = unionBoxes(content);
      if (kept === null) throw new Error('the crop kept nothing');
      // Zones kept whole reach beyond the crop (now at 0,0): the case where bands at the crop would cover them.
      expect(kept.y).toBeLessThan(0);
      const title = unionBoxes(cells.filter((cell) => annotationOf(cell) === 'title').map(boxOfCell));
      const legend = unionBoxes(cells.filter((cell) => annotationOf(cell) === 'legend').map(boxOfCell));
      expect(title?.y ?? NaN).toBeLessThan(kept.y);
      expect((title?.y ?? NaN) + (title?.height ?? NaN)).toBeCloseTo(kept.y - DEFAULT_AREA_MARGIN, 6);
      expect(legend?.y ?? NaN).toBeCloseTo(kept.y + kept.height + DEFAULT_AREA_MARGIN, 6);
      for (const box of content) {
        expect(title !== null && boxesMeet(title, box)).toBe(false);
        expect(legend !== null && boxesMeet(legend, box)).toBe(false);
      }
    },
    60_000,
  );
});
