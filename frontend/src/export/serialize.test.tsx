// SPDX-License-Identifier: MIT
/**
 * The export serialiser: custom properties resolved for the export theme, `<title>` and `<desc>`,
 * the title block (the canvas's three lines, no affiliation line) and the legend
 * always present, the interactive scaffolding gone, the compatibility encodings (xlink:href, halo copies), the
 * "current viewport" crop, and well-formed XML.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TAGLINE } from '../branding';
import { DiagramCanvas } from '../diagram/DiagramCanvas';
import { documentText } from '../diagram/DiagramSvg';
import { planDrawing } from '../diagram/Drawing';
import { renderDiagramSvg } from '../diagram/static';
import { modelOf, smallScene, TRACE_EDGES } from '../diagram/testing/scenes';
import { DARK_PALETTE, LIGHT_PALETTE, type DiagramTheme } from '../diagram/theme/tokens';
import type { DiagramModel } from '../diagram/model';
import { withStandaloneSvg } from './render';
import {
  cropFrame,
  embedFontFaces,
  ExportFormatError,
  prepareExportSvg,
  resolveCustomProperties,
  serializeSvg,
  themeVariables,
  XLINK_NS,
  type OverlayBoxes,
  type PrepareOptions,
} from './serialize';

function smallModel(): DiagramModel {
  return modelOf(smallScene(TRACE_EDGES));
}

/** What the export orchestrator passes: `planDrawing`'s frame and overlay boxes, the document text. */
function optionsFor(model: DiagramModel, theme: DiagramTheme): PrepareOptions {
  const plan = planDrawing(model, { overlays: true, utcOffsetMinutes: 0 });
  if (plan.title === null || plan.legend === null) throw new Error('the small scene draws both overlays');
  const overlays: OverlayBoxes = {
    title: {
      x: plan.title.x,
      y: plan.title.y,
      width: plan.title.block.width,
      height: plan.title.block.height,
    },
    legend: {
      x: plan.legend.x,
      y: plan.legend.y,
      width: plan.legend.layout.width,
      height: plan.legend.layout.height,
    },
  };
  const text = documentText(model, 0);
  return { theme, title: text.title, desc: text.desc, frame: plan.frame, overlays };
}

/** The export of the small scene's standalone drawing, as the export flow makes it. */
function exported(theme: DiagramTheme, extra: Partial<PrepareOptions> = {}): SVGSVGElement {
  const model = smallModel();
  return withStandaloneSvg(
    model,
    { theme, utcOffsetMinutes: 0 },
    (svg) => prepareExportSvg(svg, { ...optionsFor(model, theme), ...extra }).svg,
  );
}

/** The title block's lines, top to bottom. */
function titleLines(svg: Element): Array<string | null> {
  return [...(svg.querySelector('.dg-title-block')?.querySelectorAll('text') ?? [])].map(
    (line) => line.textContent,
  );
}

/** Parses SVG markup in its own XML document, failing on a parser error. */
function parse(markup: string): SVGSVGElement {
  const document = new DOMParser().parseFromString(markup, 'image/svg+xml');
  expect(document.getElementsByTagName('parsererror')).toHaveLength(0);
  const root = document.documentElement;
  if (!(root instanceof SVGSVGElement)) throw new Error('not an <svg> document');
  return root;
}

describe('resolveCustomProperties', () => {
  const variables = new Map([
    ['--dg-ink', '#202124'],
    ['--dg-canvas', '#FFFFFF'],
  ]);

  it.each([
    ['var(--dg-ink)', '#202124'],
    ['var( --dg-ink )', '#202124'],
    ['url(#a) var(--dg-canvas)', 'url(#a) #FFFFFF'],
    ['var(--dg-ink) var(--dg-canvas)', '#202124 #FFFFFF'],
    ['var(--unknown, #123456)', '#123456'],
    ['var(--unknown, var(--dg-ink))', '#202124'],
    ['var(--unknown, rgb(1, 2, 3))', 'rgb(1, 2, 3)'],
    ['none', 'none'],
  ])('%s → %s', (value, expected) => {
    expect(resolveCustomProperties(value, variables)).toBe(expected);
  });

  it('gives up on an unknown variable without a fallback, and on a malformed value', () => {
    expect(resolveCustomProperties('var(--unknown)', variables)).toBeNull();
    expect(resolveCustomProperties('var(--dg-ink', variables)).toBeNull();
  });

  it('knows every diagram token of both themes, with the token table values', () => {
    expect(themeVariables('light').get('--dg-zone-project-fill')).toBe(LIGHT_PALETTE.zone.project.fill);
    expect(themeVariables('dark').get('--dg-zone-project-fill')).toBe(DARK_PALETTE.zone.project.fill);
    expect(themeVariables('dark').get('--dg-canvas')).toBe(DARK_PALETTE.canvas);
  });
});

describe('prepareExportSvg', () => {
  it('names the scope and the lens in <title>, the read time in <desc>, and no affiliation line anywhere', () => {
    const svg = exported('light');
    const [title, desc] = [...svg.children];
    expect(title?.localName).toBe('title');
    expect(title?.textContent).toBe('gcportrait diagram of example.com, Overview lens');
    expect(desc?.localName).toBe('desc');
    // The same description the canvas and the baselines carry (one wording, documentText).
    expect(desc?.textContent).toBe(
      'example.com, Overview lens, read 2026-10-08T00:00:00+00:00. Drawn with gcportrait.',
    );
    expect(serializeSvg(svg)).not.toMatch(/affiliated/i);
  });

  it('keeps the title block, ending with the tagline as on the canvas (no affiliation line), and the legend', () => {
    const svg = exported('light');
    const titleBlock = svg.querySelector('.dg-title-block');
    expect([...(titleBlock?.querySelectorAll('text') ?? [])].map((line) => line.textContent)).toEqual([
      'example.com',
      'Overview lens · read 2026-10-08T00:00:00+00:00',
      TAGLINE,
    ]);
    expect(titleBlock?.textContent).not.toMatch(/affiliated/i);
    const legend = svg.querySelector('.dg-legend');
    expect(legend?.textContent).toContain('Legend');
    expect(legend?.textContent).toContain('routes — traffic path');
  });

  it('frames the whole drawing as planDrawing does and writes the theme on the root', () => {
    const model = smallModel();
    const { frame } = planDrawing(model, { overlays: true, utcOffsetMinutes: 0 });
    const svg = exported('dark');
    expect(svg.getAttribute('viewBox')).toBe(
      `${String(frame.x)} ${String(frame.y)} ${String(frame.width)} ${String(frame.height)}`,
    );
    expect(svg.getAttribute('width')).toBe(String(frame.width));
    expect(svg.getAttribute('data-theme')).toBe('dark');
    expect(svg.getAttribute('version')).toBe('1.1');
  });

  it('draws the dark theme in dark colours, whatever the page shows', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    const svg = exported('dark');
    expect(svg.querySelector('.dg-background')?.getAttribute('fill')).toBe(DARK_PALETTE.canvas);
    expect(svg.querySelector('marker')?.id).toMatch(/^dg-dark-head-/);
    const light = exported('light');
    expect(light.querySelector('.dg-background')?.getAttribute('fill')).toBe(LIGHT_PALETTE.canvas);
  });

  it('writes xlink:href beside href on every <use>, and declares the namespace', () => {
    const svg = exported('light');
    const uses = [...svg.querySelectorAll('use')];
    expect(uses.length).toBeGreaterThan(3);
    for (const use of uses) expect(use.getAttributeNS(XLINK_NS, 'href')).toBe(use.getAttribute('href'));
    expect(serializeSvg(svg)).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
  });

  it('draws each zone-title halo as a stroke-only copy under the fill-only label', () => {
    const svg = exported('light');
    expect(svg.querySelectorAll('text[paint-order]')).toHaveLength(0);
    const halos = [...svg.querySelectorAll('text.dg-halo')];
    expect(halos.length).toBeGreaterThan(3);
    for (const halo of halos) {
      const label = halo.nextElementSibling;
      expect(label?.localName).toBe('text');
      expect(label?.textContent).toBe(halo.textContent);
      expect(label?.getAttribute('x')).toBe(halo.getAttribute('x'));
      expect(label?.getAttribute('y')).toBe(halo.getAttribute('y'));
      expect(label?.hasAttribute('stroke')).toBe(false);
      expect(halo.getAttribute('fill')).toBe('none');
      expect(halo.getAttribute('stroke')).not.toBeNull();
      expect(halo.querySelectorAll('[fill]')).toHaveLength(0);
      expect(halo.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('serialises to well-formed XML with a declaration, which parses back with the same content', () => {
    const svg = exported('light');
    const text = serializeSvg(svg);
    expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg')).toBe(true);
    expect(text.endsWith('</svg>\n')).toBe(true);
    expect(text).not.toContain('var(');
    expect(text.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g)?.length).toBeGreaterThanOrEqual(1);
    const root = parse(text);
    expect(root.querySelector('.dg-title-block')?.textContent).toContain(TAGLINE);
    expect(root.querySelectorAll('.dg-node')).toHaveLength(svg.querySelectorAll('.dg-node').length);
  });

  it("keeps every icon exactly as drawn: Google's artwork is never altered", () => {
    const model = smallModel();
    withStandaloneSvg(model, { theme: 'dark', utcOffsetMinutes: 0 }, (source) => {
      const icons = [...source.querySelectorAll('g[id^="dg-icon-"]')];
      expect(icons.length).toBeGreaterThan(3);
      const svg = prepareExportSvg(source, optionsFor(model, 'dark')).svg;
      for (const icon of icons) {
        expect(svg.querySelector(`g[id="${icon.id}"]`)?.outerHTML).toBe(icon.outerHTML);
      }
    });
  });

  it('does not change the drawing it clones', () => {
    const model = smallModel();
    withStandaloneSvg(model, { theme: 'light', utcOffsetMinutes: 0 }, (svg) => {
      const before = svg.outerHTML;
      prepareExportSvg(svg, optionsFor(model, 'light'));
      expect(svg.outerHTML).toBe(before);
    });
  });

  it('refuses a drawing in another theme: re-theming is a new drawing, never a recolour', () => {
    const model = smallModel();
    withStandaloneSvg(model, { theme: 'light', utcOffsetMinutes: 0 }, (svg) => {
      expect(() => prepareExportSvg(svg, optionsFor(model, 'dark'))).toThrow(ExportFormatError);
    });
  });

  it('refuses a drawing without the title block', () => {
    const model = smallModel();
    const markup = renderDiagramSvg(model.input, { theme: 'light', utcOffsetMinutes: 0, overlays: false });
    const error = (() => {
      try {
        prepareExportSvg(parse(markup), optionsFor(model, 'light'));
        return null;
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(ExportFormatError);
    expect((error as ExportFormatError).code).toBe('missing-title-block');
  });
});

describe('custom properties in the source', () => {
  /** The small drawing with CSS variables written into it, as a stylesheet-driven drawing would have them. */
  function withVariables(theme: DiagramTheme, extra = ''): SVGSVGElement {
    const model = smallModel();
    const markup = renderDiagramSvg(model.input, { theme, utcOffsetMinutes: 0 })
      .replace(
        'class="dg-background"',
        `class="dg-background" style="fill: var(--dg-canvas); --dg-local: 1; cursor: default${extra}"`,
      )
      .replace(
        '<g class="dg-zones"',
        '<g class="dg-zones" stroke="var(--dg-ink)" opacity="var(--missing, 0.9)"',
      );
    const svg = prepareExportSvg(parse(markup), optionsFor(model, theme)).svg;
    return svg;
  }

  it('resolves var() in attributes and style declarations with the export theme, as attributes', () => {
    for (const [theme, palette] of [
      ['light', LIGHT_PALETTE],
      ['dark', DARK_PALETTE],
    ] as const) {
      const svg = withVariables(theme);
      const background = svg.querySelector('.dg-background');
      expect(background?.getAttribute('fill')).toBe(palette.canvas);
      // Custom property declarations go; other declarations that are not presentation attributes stay.
      expect(background?.getAttribute('style')).toBe('cursor: default');
      const zones = svg.querySelector('.dg-zones');
      expect(zones?.getAttribute('stroke')).toBe(palette.ink);
      expect(zones?.getAttribute('opacity')).toBe('0.9');
      expect(serializeSvg(svg)).not.toContain('var(');
    }
  });

  it('refuses a variable the theme does not define and that has no fallback', () => {
    expect(() => withVariables('light', '; stroke: var(--dg-nothing)')).toThrow(/does not define/);
  });
});

describe('the live interactive canvas as the source', () => {
  /** The canvas drawn with a selection, live in the DOM. */
  function liveCanvas(model: DiagramModel): SVGSVGElement {
    const { container } = render(
      <DiagramCanvas
        model={model}
        theme="light"
        overlays
        utcOffsetMinutes={0}
        selection="run/api"
        onSelect={() => undefined}
      />,
    );
    const canvas = container.querySelector('svg.dg-canvas');
    if (!(canvas instanceof SVGSVGElement)) throw new Error('no canvas');
    return canvas;
  }

  it('keeps the canvas’s title block in the file, line for line', () => {
    // That the canvas draws the same block as a standalone file is Drawing.test.tsx's.
    const model = smallModel();
    const canvas = liveCanvas(model);
    expect(titleLines(canvas)).toHaveLength(3);
    expect(titleLines(prepareExportSvg(canvas, optionsFor(model, 'light')).svg)).toEqual(titleLines(canvas));
  });

  it('drops the interactive scaffolding: camera, rings, focused-edge copies, tab stops, roles, states', () => {
    const model = smallModel();
    const canvas = liveCanvas(model);
    expect(canvas.querySelector('.dg-marks')).not.toBeNull();
    expect(canvas.getAttribute('data-drawing')).toMatch(/^\d+$/);
    const svg = prepareExportSvg(canvas, optionsFor(model, 'light')).svg;
    expect(svg.querySelector('.dg-marks')).toBeNull();
    expect(svg.querySelector('.dg-edges-top')).toBeNull();
    expect(svg.querySelectorAll('[tabindex], [role], [aria-pressed], [aria-label]')).toHaveLength(0);
    expect(svg.querySelector('.dg-viewport')?.hasAttribute('transform')).toBe(false);
    expect(svg.querySelectorAll('[class*="is-"], [class*="dg-lod-"]')).toHaveLength(0);
    expect(svg.classList.contains('dg-canvas')).toBe(false);
    expect(svg.hasAttribute('data-diagram-ready')).toBe(false);
    expect(svg.hasAttribute('data-drawing')).toBe(false);
    expect(svg.querySelector('.dg-title-block')?.textContent).toContain(TAGLINE);
    expect(svg.getAttribute('viewBox')).not.toBeNull();
  });
});

describe('the current-viewport crop', () => {
  it('clips the content to the area and moves the title block and the legend into bands around it', () => {
    const model = smallModel();
    const options = optionsFor(model, 'light');
    const area = { x: 100, y: 120, width: 300, height: 200 };
    const crop = { area, margin: 24 };
    const frame = cropFrame(crop, options.overlays);
    const svg = exported('light', { crop });
    expect(svg.getAttribute('viewBox')).toBe(
      `${String(frame.x)} ${String(frame.y)} ${String(frame.width)} ${String(frame.height)}`,
    );
    // The title band above (margin, block, margin), the legend band below (margin, legend, margin).
    expect(frame.x).toBe(area.x - 24);
    expect(frame.y).toBe(area.y - 24 - options.overlays.title.height - 24);
    const legend = options.overlays.legend;
    if (legend === null) throw new Error('legend expected');
    expect(frame.y + frame.height).toBe(area.y + area.height + 24 + legend.height + 24);
    expect(frame.width).toBe(24 + Math.max(area.width, options.overlays.title.width, legend.width) + 24);

    const clip = svg.querySelector('clipPath#dg-export-crop rect');
    expect([
      clip?.getAttribute('x'),
      clip?.getAttribute('y'),
      clip?.getAttribute('width'),
      clip?.getAttribute('height'),
    ]).toEqual(['100', '120', '300', '200']);
    const cropped = svg.querySelector('.dg-crop');
    expect(cropped?.getAttribute('clip-path')).toBe('url(#dg-export-crop)');
    expect([...(cropped?.children ?? [])].map((child) => child.getAttribute('class'))).toEqual([
      'dg-zones',
      'dg-nodes',
      'dg-edges',
    ]);
    // The title block is in the file even though the area does not reach it, line for line as in the whole file:
    // it still ends with the tagline.
    expect(titleLines(svg)).toEqual(titleLines(exported('light')));
    expect(titleLines(svg).at(-1)).toBe(TAGLINE);
    const titleShift = svg.querySelector('.dg-title-block')?.parentElement?.getAttribute('transform');
    expect(titleShift).toBe(
      `translate(${String(area.x - options.overlays.title.x)} ${String(area.y - 24 - options.overlays.title.height - options.overlays.title.y)})`,
    );
    const legendShift = svg.querySelector('.dg-legend')?.parentElement?.getAttribute('transform');
    expect(legendShift).toBe(
      `translate(${String(area.x - legend.x)} ${String(area.y + area.height + 24 - legend.y)})`,
    );
    const background = svg.querySelector('.dg-background');
    expect(background?.getAttribute('y')).toBe(String(frame.y));
    expect(background?.getAttribute('height')).toBe(String(frame.height));
  });
});

describe('embedFontFaces', () => {
  it('puts the @font-face rules in a <style> right after <desc>', () => {
    const svg = exported('light');
    embedFontFaces(
      svg,
      "@font-face { font-family: 'Roboto'; src: url(data:font/woff2;base64,AAAA) format('woff2'); }",
    );
    const [, , defs] = [...svg.children];
    expect(defs?.localName).toBe('defs');
    expect(defs?.querySelector('style')?.textContent).toContain("font-family: 'Roboto'");
    expect(parse(serializeSvg(svg)).querySelector('style')?.textContent).toContain(
      'data:font/woff2;base64,AAAA',
    );
  });
});
