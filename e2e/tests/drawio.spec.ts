// SPDX-License-Identifier: MIT
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Browser, type Page } from '@playwright/test';

import { DEMO_URL } from '../fixtures/servers.js';
import {
  cellIdOf,
  drawAndMeasure,
  fontCss,
  framedSvg,
  maxGraphScript,
  measureSvg,
  readDrawio,
  type Box,
  type MxCell,
  type MxMeasure,
  type Point,
  type SvgMeasure,
} from './drawioSupport.js';
import { decodePng, mismatch, OUT_DIR, REPO_ROOT, renderWithResvg } from './exportSupport.js';
import { openDiagram, TAGLINE } from './support.js';

/**
 * The draw.io export's fidelity (AGENTS.md, Exports and the render API): the `.drawio` file the Export menu
 * downloads, drawn by maxGraph (the maintained successor of mxGraph, the library diagrams.net is built on) in
 * Chromium, against the SVG export of the same view: demo S, M and L in both themes.
 *
 * - Structure, from the file: as many zone containers, node groups, connected lines and text lines as the SVG has zone
 *   groups, node groups, lines and text lines; every zone and node under its id in its zone; every line between the
 *   cells of its two nodes; every parent before its children; the page's background the theme's canvas; the title
 *   block's tagline and no affiliation line.
 * - Geometry, as maxGraph draws the file next to Chromium's layout of the SVG: every zone and node box, every line's
 *   ends at its heads' tips, every text line's place and font.
 * - Pixels: maxGraph's picture against resvg's PNG of the SVG export (the rasteriser of `pnpm render` and the render
 *   API), both at 1× with a 24 px margin on the canvas colour, compared with pixelmatch at threshold 0.1.
 *
 * The limits sit a little above what maxGraph 0.25.0 draws, and the spec fails on more: 2 to 3.3 % of the
 * pixels differ (text anti-aliasing, draw.io's half-pixel snap of odd line widths, its own arrowheads); every
 * text line lies within 1 px; before an open head draw.io stops the line 2.236 × its width short of the tip
 * (2.68 px at the 1.2 px memberOf line), where the SVG runs it to the tip; a block head is up to 1.26 px
 * wider than the drawing's. Boxes and line ends are exact in the file, so their limit is half a pixel. And
 * demo S light, the render golden's view, downloads byte for byte as the golden.
 */
test.use({ timezoneId: 'UTC', acceptDownloads: true });

const DRAWIO_ACTION = 'Download draw.io (.drawio)';
const FILE_NAME = /^gcportrait_example\.com_overview_20261008T000000Z\.drawio$/;
const MARGIN = 24;
const CANVAS = { light: '#ffffff', dark: '#1f1f1f' } as const;
const GOLDEN = path.join(REPO_ROOT, 'e2e/baselines/render/S-overview-auto-light.drawio');
/** Where the test page loads maxGraph from: a route of this spec answers it with the bundle built from node_modules. */
const MAXGRAPH_URL = `${DEMO_URL}/__fidelity/maxgraph.js`;

/** The limits (see above: what maxGraph draws, and a little room). */
const LIMITS = {
  /**
   * Share of pixels pixelmatch counts (threshold 0.1, anti-aliasing not counted): 2 to 3.3 % on macOS and
   * 4.15 % on demo L on Linux, whose FreeType text differs more from resvg's.
   */
  pixels: 0.05,
  /** A text line's place, its left edge and its middle: within 1 px. */
  text: 1.25,
  /**
   * How far before an open head's tip draw.io stops the line: 2.236 × the line's width (maxGraph's open arrow), so
   * 2.68 px at the 1.2 px memberOf line (about 2.2 px at a 1 px line).
   */
  openHeadShort: 3,
  /**
   * How much wider (or narrower) a block head is across the line, its outline and its stroke: maxGraph draws it
   * `size + 2 × width` across: up to 1.26 px wider (the 7 × 5 head at a 1.2 px line).
   */
  blockHeadWidth: 1.5,
  /** Zone and node boxes, line ends at the heads' tips: exact in the file. */
  geometry: 0.5,
} as const;

interface Saved {
  readonly name: string;
  readonly bytes: Buffer;
}

async function download(page: Page, action: string, theme: 'Light' | 'Dark', label: string): Promise<Saved> {
  await page.getByRole('banner').getByRole('button', { name: 'Export' }).click();
  const menu = page.getByRole('menu', { name: 'Export' });
  await menu.getByRole('menuitemradio', { name: theme, exact: true }).click();
  const pending = page.waitForEvent('download');
  await menu.getByRole('menuitem', { name: action }).click();
  const file = await pending;
  mkdirSync(OUT_DIR, { recursive: true });
  const saved = path.join(OUT_DIR, `drawio-${label}-${file.suggestedFilename()}`);
  await file.saveAs(saved);
  await expect(
    page.getByRole('status', { name: 'Export status' }).filter({ hasText: 'Saved' }),
  ).toBeVisible();
  return { name: file.suggestedFilename(), bytes: readFileSync(saved) };
}

const FACES = ['400', '500', '700'].flatMap((weight) =>
  ['Roboto', 'Google Sans', 'Google Sans Text'].map((family) => `${weight} 16px "${family}"`),
);

/** A page in a fresh context of the drawing's size, at 1×, that loads nothing but maxGraph from this spec's route. */
async function fidelityPage(browser: Browser, width: number, height: number): Promise<Page> {
  const script = await maxGraphScript();
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await context.route('**/*', (route) =>
    route.request().url() === MAXGRAPH_URL
      ? route.fulfill({ body: script, contentType: 'text/javascript' })
      : route.abort(),
  );
  return context.newPage();
}

async function loadFonts(page: Page): Promise<void> {
  await page.evaluate(async (faces) => {
    await Promise.all([...faces, '400 16px "Roboto Mono"'].map((face) => document.fonts.load(face)));
    await document.fonts.ready;
  }, FACES);
}

/** A screenshot once two in a row agree (the icons are images that decode on their own time). */
async function settledScreenshot(page: Page, width: number, height: number): Promise<Buffer> {
  let last = await page.screenshot({ clip: { x: 0, y: 0, width, height } });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
    const next = await page.screenshot({ clip: { x: 0, y: 0, width, height } });
    if (next.equals(last)) return next;
    last = next;
  }
  return last;
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const boxDeviation = (a: Box, b: Box): number =>
  Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.width - b.width),
    Math.abs(a.height - b.height),
  );

function styleOf(cell: MxCell): Map<string, string> {
  return new Map(
    cell.style
      .split(';')
      .filter((part) => part.includes('='))
      .map((part) => [part.slice(0, part.indexOf('=')), part.slice(part.indexOf('=') + 1)] as const),
  );
}

/** Text lines in the cells' labels (not the layers' names): a `<div>` per line, or a one-line label's text. */
function labelLines(model: string): number {
  let count = 0;
  for (const [tag] of model.matchAll(/<mxCell\b[^>]*>/g)) {
    if (!/\s(?:vertex|edge)="1"/.test(tag)) continue;
    const value = /\svalue="([^"]*)"/.exec(tag)?.[1] ?? '';
    if (value === '') continue;
    const blocks = value.match(/&lt;div /g)?.length ?? 0;
    count += blocks === 0 ? 1 : blocks;
  }
  return count;
}

interface Report {
  readonly pixels: number;
  readonly text: number;
  readonly geometry: number;
  readonly openHeadShort: number;
  readonly blockHeadWidth: number;
}

/** Compares the two measurements; returns the worst figures and every problem found. */
function compare(svg: SvgMeasure, mx: MxMeasure): { worst: Omit<Report, 'pixels'>; problems: string[] } {
  const problems: string[] = [...mx.problems];
  const byId = new Map(mx.cells.map((cell) => [cell.id, cell]));
  const worst = { text: 0, geometry: 0, openHeadShort: 0, blockHeadWidth: 0 };
  const geometry = (value: number, what: string): void => {
    worst.geometry = Math.max(worst.geometry, value);
    if (value > LIMITS.geometry) problems.push(`${what}: ${value.toFixed(2)} px off`);
  };

  // Zones and nodes: each under its id, in its zone, at its box.
  const byIndex = new Map([...svg.zones, ...svg.nodes].map((item) => [item.n, item.id]));
  const containers = mx.cells.filter((cell) => cell.vertex && /(^|;)container=1;/.test(cell.style));
  if (containers.length !== svg.zones.length)
    problems.push(`${String(containers.length)} zone containers for ${String(svg.zones.length)} zones`);
  const groups = mx.cells.filter(
    (cell) => cell.vertex && cell.style.startsWith('group;') && cell.parent !== '3',
  );
  if (groups.length !== svg.nodes.length)
    problems.push(`${String(groups.length)} node groups for ${String(svg.nodes.length)} nodes`);
  for (const [kind, items] of [
    ['zone', svg.zones],
    ['node', svg.nodes],
  ] as const) {
    for (const item of items) {
      const cell = byId.get(cellIdOf(item.id));
      if (cell === undefined) {
        problems.push(`${kind} ${item.id}: no cell`);
        continue;
      }
      if (kind === 'zone' ? !/(^|;)container=1;/.test(cell.style) : !cell.style.startsWith('group;'))
        problems.push(`${kind} ${item.id}: drawn as ${cell.style.slice(0, 40)}`);
      const parent = item.parent === null ? undefined : byIndex.get(item.parent);
      const expected = parent === undefined ? '1' : cellIdOf(parent);
      if (cell.parent !== expected)
        problems.push(`${kind} ${item.id}: in ${cell.parent}, not in ${expected}`);
      geometry(boxDeviation(cell.box, item.box), `${kind} ${item.id}'s box`);
    }
  }

  // Lines: each an edge between its two nodes' cells, its ends at the heads' tips, its heads as draw.io draws them.
  const edges = mx.cells.filter((cell) => cell.edge && cell.parent === '2');
  const connected = edges.filter((cell) => cell.source !== undefined && cell.target !== undefined);
  if (connected.length !== svg.lines.length || edges.length !== svg.lines.length)
    problems.push(
      `${String(connected.length)} connected lines (${String(edges.length)} in all) for ${String(svg.lines.length)} lines`,
    );
  const used = new Set<string>();
  for (const line of svg.lines) {
    const [from, to] = line.ends.map((index) => cellIdOf(byIndex.get(index) ?? `?${index}`));
    const candidates = connected.filter(
      (cell) =>
        !used.has(cell.id) && cell.source === from && cell.target === to && (cell.points?.length ?? 0) >= 2,
    );
    const ends = (cell: MxCell): number => {
      const points = cell.points ?? [];
      return Math.max(
        distance(points[0] ?? line.from, line.from),
        distance(points.at(-1) ?? line.to, line.to),
      );
    };
    const match = candidates.sort((a, b) => ends(a) - ends(b))[0];
    if (match === undefined) {
      problems.push(`line ${line.ends.join(' → ')}: no edge from ${from ?? '?'} to ${to ?? '?'}`);
      continue;
    }
    used.add(match.id);
    geometry(ends(match), `line ${match.id}'s ends`);
    const style = styleOf(match);
    const heads = [...(match.heads ?? [])];
    const lineWidth = match.lineWidth ?? 1;
    for (const [end, head, tip, drawnEnd] of [
      ['start', line.start, line.from, match.lineFrom],
      ['end', line.end, line.to, match.lineTo],
    ] as const) {
      if ((style.get(`${end}Arrow`) ?? 'none') === 'none') {
        if (head !== null) problems.push(`line ${match.id}: no ${end} head where the SVG has one`);
        continue;
      }
      const box = heads.shift();
      if (head === null || box === undefined) {
        problems.push(`line ${match.id}: a ${end} head the SVG does not have, or not drawn`);
        continue;
      }
      if (!head.closed) {
        // maxGraph draws a line of odd width half a pixel off to keep it crisp: that offset, read where the line
        // starts without a head, is taken off before the line's end is compared with the tip.
        const first = match.points?.[0];
        const snap =
          end === 'end' && line.start === null && first !== undefined && match.lineFrom !== undefined
            ? { x: match.lineFrom.x - first.x, y: match.lineFrom.y - first.y }
            : { x: 0, y: 0 };
        const short =
          drawnEnd === undefined
            ? Infinity
            : distance({ x: drawnEnd.x - snap.x, y: drawnEnd.y - snap.y }, tip);
        worst.openHeadShort = Math.max(worst.openHeadShort, short);
        if (short > LIMITS.openHeadShort)
          problems.push(
            `line ${match.id}: its line stops ${short.toFixed(2)} px before the ${end} head's tip`,
          );
        continue;
      }
      // Across the line: the head's box (its outline) and the stroke around it, against the marker's height.
      const points = match.points ?? [];
      const [a, b] = end === 'start' ? [points[0], points[1]] : [points.at(-2), points.at(-1)];
      if (a === undefined || b === undefined) continue;
      const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
      const across = (horizontal ? box.height : box.width) + lineWidth;
      const wider = across - head.width;
      if (Math.abs(wider) > Math.abs(worst.blockHeadWidth)) worst.blockHeadWidth = wider;
      if (Math.abs(wider) > LIMITS.blockHeadWidth)
        problems.push(`line ${match.id}: its ${end} head is ${wider.toFixed(2)} px wider than the SVG's`);
    }
  }

  // Text: every line of the SVG in a label, at its place, in its font.
  const lines = mx.cells.flatMap((cell) => (cell.lines ?? []).map((line) => ({ ...line, cell: cell.id })));
  if (lines.length !== svg.texts.length)
    problems.push(`${String(lines.length)} label lines for ${String(svg.texts.length)} text lines`);
  const taken = new Set<number>();
  for (const text of svg.texts) {
    let best = -1;
    let bestDistance = Infinity;
    lines.forEach((line, index) => {
      if (taken.has(index) || line.text !== text.text) return;
      const d = Math.hypot(line.box.x - text.box.x, line.box.y - text.box.y);
      if (d < bestDistance) {
        bestDistance = d;
        best = index;
      }
    });
    const line = lines[best];
    if (line === undefined) {
      problems.push(`text "${text.text}": in no label`);
      continue;
    }
    taken.add(best);
    const dx = Math.abs(line.box.x - text.box.x);
    const dy = Math.abs(line.box.y + line.box.height / 2 - (text.box.y + text.box.height / 2));
    worst.text = Math.max(worst.text, dx, dy);
    if (Math.max(dx, dy) > LIMITS.text)
      problems.push(
        `text "${text.text}": ${dx.toFixed(2)} px across, ${dy.toFixed(2)} px down from the SVG's`,
      );
    if (line.size !== text.size || line.weight !== text.weight || line.colour !== text.colour)
      problems.push(
        `text "${text.text}": ${line.size} ${line.weight} ${line.colour}, the SVG's ${text.size} ${text.weight} ${text.colour}`,
      );
  }
  return { worst, problems };
}

for (const size of ['S', 'M', 'L'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`demo ${size}, ${theme}: the draw.io file draws what the SVG export draws`, async ({
      page,
      browser,
    }) => {
      test.setTimeout(300_000);
      await openDiagram(page, `/diagram#snapshot=demo:${size}`);
      const label = theme === 'light' ? 'Light' : 'Dark';
      const svg = await download(page, 'Download SVG', label, `${size}-${theme}`);
      const drawio = await download(page, DRAWIO_ACTION, label, `${size}-${theme}`);

      // The file: its name, as diagrams.net reads it, compressed, and nothing an export must not carry
      // (AGENTS.md, Non-affiliation, brand and legal).
      expect(drawio.name).toMatch(FILE_NAME);
      const file = readDrawio(drawio.bytes);
      expect(file.compressed).toBe(true);
      expect(file.mxfile).toMatchObject({ host: 'gcportrait', agent: 'gcportrait' });
      expect(file.diagram.name).toBe('gcportrait diagram of example.com, Overview lens');
      expect(file.model).toContain(`background="${CANVAS[theme]}"`);
      expect(file.model).toContain(TAGLINE);
      expect(file.model).not.toMatch(/affiliated/i);
      if (size === 'S' && theme === 'light') {
        // The render golden's view: the app writes the bytes `pnpm render` and the render API write.
        expect(drawio.bytes.equals(readFileSync(GOLDEN)), 'demo S light differs from the render golden').toBe(
          true,
        );
      }

      const svgText = svg.bytes.toString('utf8').replace(/^<\?xml[^>]*>\s*/, '');
      const framed = framedSvg(svgText, MARGIN);
      const viewBox = (/\sviewBox="([^"]+)"/.exec(svgText)?.[1] ?? '0 0 0 0').split(/\s+/).map(Number);
      const origin = { x: MARGIN - (viewBox[0] ?? 0), y: MARGIN - (viewBox[1] ?? 0) };
      const css = fontCss();

      // The SVG export as Chromium lays it out.
      const svgPage = await fidelityPage(browser, framed.width, framed.height);
      let measured: SvgMeasure;
      try {
        await svgPage.setContent(
          `<!doctype html><meta charset="utf-8"><style>${css} html,body{margin:0;padding:0;background:${CANVAS[theme]}}</style>` +
            `<div id="svg" style="position:absolute;left:${String(MARGIN)}px;top:${String(MARGIN)}px">${svgText}</div>`,
        );
        await loadFonts(svgPage);
        measured = await svgPage.evaluate(measureSvg);
      } finally {
        await svgPage.context().close();
      }

      // The file as maxGraph draws it, offline: its script bundled from node_modules, its faces from the app's files.
      const graphPage = await fidelityPage(browser, framed.width, framed.height);
      let drawn: MxMeasure;
      let picture: Buffer;
      try {
        await graphPage.setContent(
          `<!doctype html><meta charset="utf-8"><style>${css} html,body{margin:0;padding:0}</style>` +
            `<script src="${MAXGRAPH_URL}"></script>` +
            `<div id="graph" style="position:absolute;left:0;top:0;width:${String(framed.width)}px;height:${String(framed.height)}px;overflow:hidden"></div>`,
        );
        await loadFonts(graphPage);
        drawn = await graphPage.evaluate(drawAndMeasure, { model: file.model, origin });
        picture = await settledScreenshot(graphPage, framed.width, framed.height);
      } finally {
        await graphPage.context().close();
      }
      expect(drawn.background).toBe(CANVAS[theme]);
      writeFileSync(path.join(OUT_DIR, `drawio-${size}-${theme}-maxgraph.png`), picture);

      // Structure and geometry.
      expect(labelLines(file.model), 'text lines in the file').toBe(measured.texts.length);
      const { worst, problems } = compare(measured, drawn);

      // Pixels: maxGraph's picture against resvg's PNG of the SVG export, both at 1× with the margin.
      const reference = renderWithResvg(framed.svg, 1, CANVAS[theme]);
      writeFileSync(path.join(OUT_DIR, `drawio-${size}-${theme}-resvg.png`), reference.png);
      const pixels = mismatch(decodePng(picture), reference, `drawio-${size}-${theme}-diff.png`);
      console.log(
        `draw.io vs SVG, demo ${size} ${theme}: ${String(measured.zones.length)} zones, ` +
          `${String(measured.nodes.length)} nodes, ${String(measured.lines.length)} lines, ` +
          `${String(measured.texts.length)} text lines; ${(pixels * 100).toFixed(2)} % of pixels differ; ` +
          `text within ${worst.text.toFixed(2)} px, boxes and line ends within ${worst.geometry.toFixed(2)} px, ` +
          `open heads ${worst.openHeadShort.toFixed(2)} px short, block heads ${worst.blockHeadWidth.toFixed(2)} px wider`,
      );
      expect(problems, problems.slice(0, 20).join('\n')).toEqual([]);
      expect(pixels).toBeLessThanOrEqual(LIMITS.pixels);
    });
  }
}
