// SPDX-License-Identifier: MIT
/**
 * The export flow on a laid-out Scene: file names, the SVG file, the "current viewport" crop from the canvas's
 * visible area, the PNG's source (margin, pixel size, embedded fonts, sentinels) handed to the rasteriser, and the
 * draw.io file (the drawing the browser renders gives the file the static render gives the render library).
 */
import type { Rect } from '@gcportrait/layout';
import { describe, expect, it, vi } from 'vitest';

import { planDrawing } from '../diagram/Drawing';
import { renderDiagramSvg } from '../diagram/static';
import { modelOf, smallScene } from '../diagram/testing/scenes';
import { DARK_PALETTE, LIGHT_PALETTE } from '../diagram/theme/tokens';
import { readDrawioFile, svgToDrawio } from './drawio';
import {
  ExportError,
  exportDrawioFile,
  exportName,
  exportPngFile,
  exportSvgFile,
  pngSource,
  viewportCrop,
} from './exportDiagram';
import type { PngGeometry } from './raster';
import type { ExportSource } from './source';

const FONTS = "@font-face { font-family: 'Roboto'; src: url(data:font/woff2;base64,AAAA) format('woff2'); }";

function sourceWith(visible: Rect | null = null): ExportSource {
  return {
    model: modelOf(smallScene([['run/web', 'run/api', 'routes']])),
    utcOffsetMinutes: 120,
    visibleArea: () => visible,
  };
}

function viewBox(text: string): number[] {
  const match = /viewBox="([^"]+)"/.exec(text);
  return (match?.[1] ?? '').split(' ').map(Number);
}

describe('the SVG file', () => {
  it('is named gcportrait_<scope>_<lens>_<readTime>.svg and carries no affiliation line', async () => {
    // How the title block, <title> and <desc> are written into a file is serialize.test.tsx's; here, that the export
    // flow hands them this source's text and the viewer's offset, and that the whole file it writes carries no
    // affiliation line anywhere (agents.md, Non-affiliation, brand and legal).
    const source = sourceWith();
    const file = exportSvgFile(source, { area: 'whole', theme: 'light' });
    expect(file.fileName).toBe('gcportrait_example.com_overview_20261008T000000Z.svg');
    expect(exportName(source, 'png')).toBe('gcportrait_example.com_overview_20261008T000000Z.png');
    expect(file.blob.type).toBe('image/svg+xml;charset=utf-8');
    expect(file.blob.size).toBeGreaterThan(1000);
    expect(await file.blob.text()).toBe(file.text);
    expect(file.text).not.toMatch(/affiliated/i);
    expect(file.text).toContain('<title>gcportrait diagram of example.com, Overview lens</title>');
    // The viewer's offset (here +02:00) is in the description and in the title block's second line.
    expect(file.text).toContain(
      '<desc>example.com, Overview lens, read 2026-10-08T02:00:00+02:00. Drawn with gcportrait.</desc>',
    );
    const titleBlock = new DOMParser()
      .parseFromString(file.text, 'image/svg+xml')
      .querySelector('.dg-title-block');
    expect([...(titleBlock?.querySelectorAll('text') ?? [])][1]?.textContent).toBe(
      'Overview lens · read 2026-10-08T02:00:00+02:00',
    );
    expect(file.text).not.toContain('@font-face');
  });

  it('embeds the fonts only when asked', () => {
    expect(exportSvgFile(sourceWith(), { area: 'whole', theme: 'dark' }, FONTS).text).toContain('@font-face');
  });
});

describe('the current viewport', () => {
  it('is what the canvas shows of the diagram, and carries no affiliation line', () => {
    const source = sourceWith({ x: -500, y: 60, width: 700, height: 100 });
    const { bounds } = source.model.input.layout;
    expect(viewportCrop(source)).toEqual({ x: bounds.x, y: 60, width: 200 - bounds.x, height: 100 });
    const file = exportSvgFile(source, { area: 'viewport', theme: 'light' });
    expect(file.text).toContain('<clipPath id="dg-export-crop"');
    expect(file.text).toContain('class="dg-title-block"');
    // The crop re-wraps the title block, so the cropped file gets its own whole-file placement check.
    expect(file.text).not.toMatch(/affiliated/i);
    const whole = exportSvgFile(sourceWith(), { area: 'whole', theme: 'light' });
    expect(viewBox(file.text)[2]).toBeLessThan(viewBox(whole.text)[2] ?? 0);
  });

  it('is refused, with a reason a person can act on, when nothing of the diagram is in view', () => {
    expect(() => viewportCrop(sourceWith({ x: -5000, y: -5000, width: 100, height: 100 }))).toThrow(
      /No part of the diagram is in view/,
    );
    expect(() => viewportCrop(sourceWith(null))).toThrow(ExportError);
  });
});

describe('the PNG', () => {
  it("draws the SVG with the fonts, grown by the margin on the theme's canvas colour, sized in pixels", () => {
    const source = sourceWith();
    const { frame } = planDrawing(source.model, { overlays: true, utcOffsetMinutes: 120 });
    const { text, geometry } = pngSource(source, { area: 'whole', theme: 'dark', scale: 3 }, FONTS);
    expect(geometry).toMatchObject({
      width: Math.ceil((frame.width + 48) * 3),
      height: Math.ceil((frame.height + 48) * 3),
      scale: 3,
      reduced: false,
    });
    expect(text).toContain(`width="${String(geometry.width)}" height="${String(geometry.height)}"`);
    const [x, y, width, height] = viewBox(text);
    expect([x, y]).toEqual([frame.x - 24, frame.y - 24]);
    expect(width).toBeCloseTo(geometry.width / 3, 9);
    expect(height).toBeCloseTo(geometry.height / 3, 9);
    expect(text).toContain(`class="dg-export-margin"`);
    expect(text).toContain(`fill="${DARK_PALETTE.canvas}"`);
    expect(text).toContain('@font-face');
    expect(text.match(/<text [^>]*font-size="10" fill="#7F7F7F">M<\/text>/g)).toHaveLength(4);
  });

  it('hands the source to the rasteriser with the background and names the file .png', async () => {
    const rasterize = vi.fn<(text: string, geometry: PngGeometry, background: string) => Promise<Blob>>(() =>
      Promise.resolve(new Blob(['png'], { type: 'image/png' })),
    );
    const file = await exportPngFile(
      sourceWith(),
      { area: 'whole', theme: 'light', scale: 2 },
      Promise.resolve(FONTS),
      rasterize,
    );
    expect(file.fileName).toBe('gcportrait_example.com_overview_20261008T000000Z.png');
    expect(file.geometry.scale).toBe(2);
    expect(rasterize).toHaveBeenCalledTimes(1);
    const [text, geometry, background] = rasterize.mock.calls[0] ?? [];
    expect(text).toContain('<svg');
    expect(geometry).toEqual(file.geometry);
    expect(background).toBe(LIGHT_PALETTE.canvas);
  });
});

describe('the draw.io file', () => {
  it('is named like the other exports, typed as draw.io’s, and says what wrote it', async () => {
    const file = await exportDrawioFile(sourceWith(), { area: 'whole', theme: 'light' }, '1.2.3');
    expect(file.fileName).toBe('gcportrait_example.com_overview_20261008T000000Z.drawio');
    expect(file.blob.type).toBe('application/vnd.jgraph.mxfile');
    expect(await file.blob.text()).toBe(file.text);
    const read = readDrawioFile(file.text);
    expect(read.compressed).toBe(true);
    expect(read.attributes.get('agent')).toBe('gcportrait 1.2.3');
    expect(read.attributes.get('modified')).toBe('2026-10-08T00:00:00.000Z');
    expect(read.model).not.toMatch(/affiliated/i);
    const unversioned = await exportDrawioFile(sourceWith(), { area: 'whole', theme: 'dark' });
    expect(readDrawioFile(unversioned.text).attributes.get('agent')).toBe('gcportrait');
  });

  it('is the file of the static render of the same view: one drawing, whichever way it was drawn', async () => {
    const source = sourceWith();
    for (const theme of ['light', 'dark'] as const) {
      const file = await exportDrawioFile(source, { area: 'whole', theme }, '1.2.3');
      const svg = renderDiagramSvg(source.model.input, { theme, utcOffsetMinutes: source.utcOffsetMinutes });
      const expected = svgToDrawio(svg, {
        modified: source.model.input.scene.metadata.readTime,
        agent: 'gcportrait 1.2.3',
      });
      expect(file.text).toBe(expected.text);
    }
  });

  it('keeps what the canvas shows for "current viewport", and refuses an empty view', async () => {
    const whole = await exportDrawioFile(sourceWith(), { area: 'whole', theme: 'light' });
    const part = await exportDrawioFile(sourceWith({ x: -500, y: 60, width: 520, height: 40 }), {
      area: 'viewport',
      theme: 'light',
    });
    expect(part.text.length).toBeLessThan(whole.text.length);
    await expect(
      exportDrawioFile(sourceWith({ x: 5000, y: 5000, width: 10, height: 10 }), {
        area: 'viewport',
        theme: 'light',
      }),
    ).rejects.toThrow(ExportError);
  });
});
