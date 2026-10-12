// SPDX-License-Identifier: MIT
/**
 * `pnpm render`: one demo view as PNG, SVG and/or a draw.io file, every fixture × lens × theme (`--all`), or the list of demo
 * organisations. Every run starts with the command's name on standard error; neither the output nor the drawings
 * carry an affiliation line (ADR 0018: footers and long-form texts only). Exit codes: 0 done, 1 a check failed
 * (`--compare` beyond `--max-diff`, `--strict` with layout invariant violations), 2 a usage error.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { generateOrganization } from '@gcportrait/demo-data';
import { normalizeViewSpec } from '@gcportrait/model';
import {
  createDemoViews,
  drawDrawio,
  drawPng,
  drawSvg,
  FIXTURES,
  svgFrame,
  WORDMARK,
  type DemoView,
  type DrawioFile,
  type Raster,
} from '@gcportrait/render';

import {
  parseCommand,
  USAGE,
  UsageError,
  viewFileName,
  type AllCommand,
  type RenderCommand,
} from './args.js';
import { comparePng } from './compare.js';

/** Every run's first line of standard error: the command's name. */
export const BANNER = `${WORDMARK} render`;

export const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
/** Where output goes when no path is given (git-ignored). */
export const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'out/render');

/** The command's version (its package's, the product's): the draw.io file's `agent` says `gcportrait <version>`. */
export const CLI_VERSION: string = (
  JSON.parse(readFileSync(path.join(import.meta.dirname, '../package.json'), 'utf8')) as { version: string }
).version;

export interface Io {
  readonly stdout: (chunk: string | Uint8Array) => void;
  readonly stderr: (text: string) => void;
  /** Relative paths are taken from here: where the command was started (pnpm's INIT_CWD), not the package. */
  readonly cwd: string;
}

function writeOutput(file: string, bytes: string | Uint8Array): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

function bytesOf(content: string | Uint8Array): number {
  return typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength;
}

function grouped(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** The view and layout lines of the report. */
export function describeView(view: DemoView, theme: string): string[] {
  const { detail } = view.report;
  const { metadata } = view.input.scene;
  const routing = view.layout.report.routing;
  const lines = [
    `demo ${view.fixture} (${grouped(view.assets)} assets) · lens ${view.spec.lens} · detail ${detail.requested}` +
      `${detail.requested === 'auto' ? ` → ${detail.used} (budget ${String(detail.budget)})` : ''} · ${theme}`,
    `layout: ${String(view.layout.report.counts.rects)} rects, ${String(routing.edges)} edges routed` +
      ` (${String(routing.fallbacks)} fallbacks, ${String(routing.failed)} failed); ` +
      (view.violations.length === 0
        ? 'invariants hold'
        : `${String(view.violations.length)} invariant violations, first: [${view.violations[0]?.code ?? ''}] ${view.violations[0]?.message ?? ''}`),
  ];
  if (metadata.rootError !== undefined) lines.push(`root refused: ${metadata.rootError.message}`);
  if (metadata.focusError !== undefined) lines.push(`focus not applied: ${metadata.focusError.message}`);
  for (const warning of view.report.warnings) lines.push(`warning: ${warning}`);
  return lines;
}

/** The report's words for a draw.io file: what it holds and how it is stored. */
function drawioLine(file: DrawioFile, plain: boolean): string {
  const { summary } = file;
  return (
    `${String(summary.zones)} zones, ${String(summary.nodes)} nodes, ${String(summary.edges)} edges, ` +
    `${String(summary.cells)} cells, ${plain ? 'plain XML' : 'compressed'}`
  );
}

function rasterLine(raster: Raster): string {
  const scale = Math.round(raster.scale * 1000) / 1000;
  const capped = raster.capped ? ', lowered to fit 16 384 px a side and 2^27 px' : '';
  return `${String(raster.width)}×${String(raster.height)} px at ${String(scale)}× with a ${String(raster.margin)} px margin${capped}`;
}

async function renderOne(command: RenderCommand, io: Io): Promise<number> {
  const resolve = (file: string): string => path.resolve(io.cwd, file);
  const pngTarget =
    command.png ??
    (command.svg === undefined && command.drawio === undefined
      ? path.join(
          DEFAULT_OUT_DIR,
          `${viewFileName(command.fixture, command.spec.lens, command.spec.detail, command.theme)}.png`,
        )
      : undefined);
  // Report lines go to standard error when standard output carries a file.
  const toStdout = pngTarget === '-' || command.svg === '-' || command.drawio === '-';
  const report = (line: string): void => {
    if (toStdout) io.stderr(`${line}\n`);
    else io.stdout(`${line}\n`);
  };

  const view = await createDemoViews().prepare(command.fixture, command.spec, command.viewport);
  for (const line of describeView(view, command.theme)) report(line);
  const svg = drawSvg(view, command.theme);
  const size = svgFrame(svg);
  if (command.svg !== undefined) {
    if (command.svg === '-') io.stdout(svg);
    else writeOutput(resolve(command.svg), svg);
    report(
      `svg: ${String(size.width)}×${String(size.height)} → ${command.svg === '-' ? 'standard output' : resolve(command.svg)} (${grouped(bytesOf(svg))} bytes)`,
    );
  }
  if (command.drawio !== undefined) {
    const file = drawDrawio(view, command.theme, { compressed: !command.drawioPlain, version: CLI_VERSION });
    if (command.drawio === '-') io.stdout(file.text);
    else writeOutput(resolve(command.drawio), file.text);
    report(
      `drawio: ${drawioLine(file, command.drawioPlain)} → ${command.drawio === '-' ? 'standard output' : resolve(command.drawio)} (${grouped(bytesOf(file.text))} bytes)`,
    );
  }
  let code = 0;
  if (pngTarget !== undefined || command.compare !== undefined) {
    const raster = drawPng(svg, command.theme, command.raster);
    if (pngTarget !== undefined) {
      if (pngTarget === '-') io.stdout(raster.png);
      else writeOutput(resolve(pngTarget), raster.png);
      report(
        `png: ${rasterLine(raster)} → ${pngTarget === '-' ? 'standard output' : resolve(pngTarget)} (${grouped(raster.png.byteLength)} bytes)`,
      );
    }
    if (command.compare !== undefined) {
      const expectedPath = resolve(command.compare.expected);
      let expected: Buffer;
      try {
        expected = readFileSync(expectedPath);
      } catch {
        io.stderr(`render: cannot read ${expectedPath}\n`);
        return 2;
      }
      const diff = comparePng(raster.png, expected, { diffImage: command.compare.diff !== undefined });
      if (command.compare.diff !== undefined && diff.diff !== undefined) {
        writeOutput(resolve(command.compare.diff), diff.diff);
      }
      const verdict = diff.diffPixels > command.compare.maxDiff ? 'FAIL' : 'ok';
      report(
        diff.sizeMismatch
          ? `compare: ${verdict}: size differs from ${expectedPath}`
          : `compare: ${verdict}: ${grouped(diff.diffPixels)} of ${grouped(diff.width * diff.height)} pixels differ from ${expectedPath} (allowed ${grouped(command.compare.maxDiff)})` +
              (command.compare.diff === undefined || diff.diff === undefined
                ? ''
                : `; differences → ${resolve(command.compare.diff)}`),
      );
      if (verdict === 'FAIL') code = 1;
    }
  }
  if (command.strict && view.violations.length > 0) code = 1;
  return code;
}

/** One entry of `index.json` (--all): what was drawn and where; paths relative to the output directory. */
export interface IndexEntry {
  readonly fixture: string;
  readonly lens: string;
  readonly detail: string;
  readonly detailUsed: string;
  readonly theme: string;
  readonly rects: number;
  readonly edges: number;
  readonly violations: number;
  readonly svg?: string;
  readonly png?: string;
  readonly drawio?: string;
  readonly width?: number;
  readonly height?: number;
}

async function renderAll(command: AllCommand, io: Io): Promise<number> {
  const out =
    command.out === undefined ? path.join(DEFAULT_OUT_DIR, 'all') : path.resolve(io.cwd, command.out);
  mkdirSync(out, { recursive: true });
  const views = createDemoViews();
  const entries: IndexEntry[] = [];
  let broken = 0;
  for (const fixture of command.fixtures) {
    for (const lens of command.lenses) {
      const spec = normalizeViewSpec({ snapshot: `demo:${fixture}`, lens, detail: command.detail });
      const view = await views.prepare(fixture, spec, command.viewport);
      if (view.violations.length > 0) broken += 1;
      for (const theme of command.themes) {
        const name = viewFileName(fixture, lens, command.detail, theme);
        const svg = drawSvg(view, theme);
        let entry: IndexEntry = {
          fixture,
          lens,
          detail: command.detail,
          detailUsed: view.report.detail.used,
          theme,
          rects: view.layout.report.counts.rects,
          edges: view.layout.report.routing.edges,
          violations: view.violations.length,
        };
        if (command.formats.includes('svg')) {
          writeOutput(path.join(out, `${name}.svg`), svg);
          entry = { ...entry, svg: `${name}.svg` };
        }
        if (command.formats.includes('drawio')) {
          const file = drawDrawio(view, theme, { compressed: !command.drawioPlain, version: CLI_VERSION });
          writeOutput(path.join(out, `${name}.drawio`), file.text);
          entry = { ...entry, drawio: `${name}.drawio` };
        }
        if (command.formats.includes('png')) {
          const raster = drawPng(svg, theme, command.raster);
          writeOutput(path.join(out, `${name}.png`), raster.png);
          entry = { ...entry, png: `${name}.png`, width: raster.width, height: raster.height };
        }
        entries.push(entry);
        const size =
          entry.width === undefined ? '' : `, ${String(entry.width)}×${String(entry.height ?? 0)} px`;
        const broken = entry.violations === 0 ? '' : `, ${String(entry.violations)} invariant violations`;
        io.stdout(`${name}: ${String(entry.rects)} rects, ${String(entry.edges)} edges${size}${broken}\n`);
      }
    }
  }
  const index = {
    generator: `${WORDMARK} render`,
    detail: command.detail,
    viewport: command.viewport,
    raster: command.raster,
    renders: entries,
  };
  writeOutput(path.join(out, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  io.stdout(`wrote ${String(entries.length)} views to ${out} (index.json lists them)\n`);
  return command.strict && broken > 0 ? 1 : 0;
}

function listFixtures(io: Io): number {
  for (const fixture of FIXTURES) {
    const assets = generateOrganization({ size: fixture }).assets.length;
    io.stdout(`${fixture.padEnd(3)}${grouped(assets).padStart(7)} assets   demo:${fixture}\n`);
  }
  return 0;
}

/** Runs the command line; resolves to the exit code. */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  io.stderr(`${BANNER}\n`);
  let command;
  try {
    command = parseCommand(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.stderr(`render: ${error.message}\n\n${USAGE}\n`);
    return 2;
  }
  switch (command.kind) {
    case 'help':
      io.stdout(`${USAGE}\n`);
      return 0;
    case 'list-fixtures':
      return listFixtures(io);
    case 'render':
      return renderOne(command, io);
    case 'all':
      return renderAll(command, io);
  }
}
