// SPDX-License-Identifier: MIT
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BRAND_ICON,
  BrandError,
  brandDrawing,
  drawingDifferences,
  drawingOfLogo,
  drawingOfSvg,
  logoShapeAttributes,
  normalColour,
  type Drawing,
  type Paint,
} from './brand.js';
import { repoRoot } from './repo.js';
import { logoMarkup } from './testing/helpers.js';

const read = (repoPath: string): string => readFileSync(path.join(repoRoot(), repoPath), 'utf8');

const paint = (fill: string, stroke: string, strokeWidth: string): Paint => ({ fill, stroke, strokeWidth });

/** The mark as the maintainer approved it (brand/icon.svg): kept exactly. */
const APPROVED: Drawing = {
  viewBox: '0 0 48 48',
  shapes: [
    {
      x: '3',
      y: '3',
      width: '42',
      height: '42',
      rx: '9',
      light: paint('#ffffff', '#1a73e8', '3'),
      dark: paint('#1f1f1f', '#8ab4f8', '3'),
    },
    {
      x: '10',
      y: '11',
      width: '28',
      height: '13',
      rx: '3',
      light: paint('#a8c7fa', '#202124', '1.6'),
      dark: paint('#1c3a5e', '#e8eaed', '1.6'),
    },
    {
      x: '10',
      y: '28',
      width: '12',
      height: '9',
      rx: '2.5',
      light: paint('#ceead6', '#202124', '1.6'),
      dark: paint('#1e3a2a', '#e8eaed', '1.6'),
    },
    {
      x: '26',
      y: '28',
      width: '12',
      height: '9',
      rx: '2.5',
      light: paint('#ffeebd', '#202124', '1.6'),
      dark: paint('#3d3419', '#e8eaed', '1.6'),
    },
  ],
};

/** One theme of a drawing: geometry and that theme's paint (a copy drawn for one theme only). */
function themeOf(drawing: Drawing, theme: 'light' | 'dark'): unknown {
  return drawing.shapes.map((shape) => ({ ...shape, light: shape[theme], dark: undefined }));
}

describe('the mark’s one source, brand/icon.svg', () => {
  it('is the drawing the maintainer approved, in both themes', () => {
    expect(drawingOfSvg(read(BRAND_ICON))).toEqual(APPROVED);
    expect(brandDrawing()).toEqual(APPROVED);
  });

  it('is the website’s only copy of the favicon: the build copies it, nothing keeps another', () => {
    expect(existsSync(path.join(repoRoot(), 'website', 'public', 'favicon.svg'))).toBe(false);
    expect(read('website/astro.config.ts')).toContain("'brand', 'icon.svg'");
    expect(read('website/src/layouts/Base.astro')).toContain(
      '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />',
    );
  });
});

describe('the favicon and the logo are the same drawing', () => {
  it('reads the logo as the component draws it back as the favicon’s drawing: shapes, colours, both themes', () => {
    const favicon = drawingOfSvg(read(BRAND_ICON));
    const logo = drawingOfLogo(logoMarkup(brandDrawing()));
    expect(drawingDifferences(favicon, logo)).toEqual([]);
    expect(logo).toEqual(favicon);
    // The light colours are attributes (the logo draws without a stylesheet), the dark ones custom properties.
    const [frame] = APPROVED.shapes;
    if (frame === undefined) throw new Error('the approved drawing has no frame');
    expect(logoShapeAttributes(frame)).toEqual({
      x: '3',
      y: '3',
      width: '42',
      height: '42',
      rx: '9',
      fill: '#ffffff',
      stroke: '#1a73e8',
      'stroke-width': '3',
      style: '--dark-fill:#1f1f1f;--dark-stroke:#8ab4f8;--dark-stroke-width:3',
    });
  });

  it('tells a logo of another drawing apart', () => {
    const favicon = drawingOfSvg(read(BRAND_ICON));
    const changed = logoMarkup(favicon)
      .replace('--dark-fill:#1c3a5e', '--dark-fill:#1c3a5f')
      .replace('rx="2.5"', 'rx="2"');
    expect(drawingDifferences(favicon, drawingOfLogo(changed))).toEqual([
      'shape 2, dark: fill #1c3a5f, not #1c3a5e',
      'shape 3: rx 2, not 2.5',
    ]);
    expect(drawingDifferences(favicon, { ...favicon, shapes: favicon.shapes.slice(1) })).toContain(
      '3 shapes, not 4',
    );
    expect(() => drawingOfLogo(logoMarkup(favicon).replace(/;--dark-stroke-width:[^"]*/, ''))).toThrow(
      /has no --dark-stroke-width/,
    );
  });

  it('is also what the README’s wordmarks and the link-preview images draw (their mark, per theme)', () => {
    const group = (file: string): string => /<g\b[^>]*>[\s\S]*?<\/g>/.exec(read(file))?.[0] ?? '';
    const wrap = (inner: string): string => `<svg viewBox="0 0 48 48">${inner}</svg>`;
    expect(themeOf(drawingOfSvg(wrap(group('docs/media/brand/wordmark-light.svg'))), 'light')).toEqual(
      themeOf(APPROVED, 'light'),
    );
    expect(themeOf(drawingOfSvg(wrap(group('docs/media/brand/wordmark-dark.svg'))), 'light')).toEqual(
      themeOf(APPROVED, 'dark'),
    );
    // scripts/media.mjs draws the mark on every link-preview image (light).
    const card = /const MARK_SVG =\s*'([^']*)'/.exec(read('scripts/media.mjs'))?.[1] ?? '';
    expect(themeOf(drawingOfSvg(card), 'light')).toEqual(themeOf(APPROVED, 'light'));
  });
});

describe('drawingOfSvg refuses what the logo could not follow', () => {
  const svg = (style: string, body = '<rect class="f" x="1" y="1" width="2" height="2"/>'): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><style>${style}</style>${body}</svg>`;

  it('reads class rules in order, attributes below them, and the dark block over the light paint', () => {
    const drawing = drawingOfSvg(
      svg(
        '.f{fill:#ABC}.g,.f{stroke:red}@media (prefers-color-scheme: dark){.f{fill:#000}}',
        '<rect class="f" x="1" y="1" width="2" height="2" fill="#fff" stroke-width="2.50"/>',
      ),
    );
    expect(drawing.shapes[0]).toEqual({
      x: '1',
      y: '1',
      width: '2',
      height: '2',
      rx: '0',
      light: paint('#aabbcc', 'red', '2.5'),
      dark: paint('#000000', 'red', '2.5'),
    });
    expect(normalColour(' #FfF ')).toBe('#ffffff');
  });

  it('refuses other elements, selectors, properties and at-rules', () => {
    const refusal = (text: string): string => {
      try {
        drawingOfSvg(text);
        return 'accepted';
      } catch (error) {
        expect(error).toBeInstanceOf(BrandError);
        return error instanceof Error ? error.message : String(error);
      }
    };
    expect(refusal(svg('', '<path d="M0 0h4"/>'))).toMatch(/the element <path>/);
    expect(refusal(svg('.f{opacity:.5}'))).toMatch(/the property opacity/);
    expect(refusal(svg('rect{fill:red}'))).toMatch(/the selector "rect"/);
    expect(refusal(svg('@media (min-width: 1px){.f{fill:red}}'))).toMatch(/the at-rule/);
    expect(
      refusal(svg('', '<rect class="f" x="1" y="1" width="2" height="2" transform="rotate(4)"/>')),
    ).toMatch(/the attribute transform/);
    expect(refusal(svg('', '<rect x="1" y="1" height="2"/>'))).toMatch(/has no width/);
    expect(refusal('<svg viewBox="0 0 4 4"></svg>')).toBe('no <rect>');
  });
});
