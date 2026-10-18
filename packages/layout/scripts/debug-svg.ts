// SPDX-License-Identifier: Apache-2.0
/**
 * `pnpm --filter @gcportrait/layout debug-svg`: lays out a demo organisation's Scene and writes a plain SVG
 * (and a PNG) of the rects so the packing can be looked at. A development aid for the layout, not the
 * SVG renderer and not `pnpm render`.
 *
 *   pnpm --filter @gcportrait/layout debug-svg --fixture M --lens overview
 *   pnpm --filter @gcportrait/layout debug-svg --fixture M --lens networking --detail all --theme both --aspects
 *
 * Output goes to out/layout/ at the repository root (git-ignored) unless --out names another directory; a
 * relative --out is taken from the directory the command was started in (pnpm's INIT_CWD), not from the
 * package directory pnpm runs the script in.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Resvg } from '@resvg/resvg-js';
import { DetailLevelSchema, LensIdSchema } from '@gcportrait/model';
import { ASPECT_TOLERANCE, layoutScene, packingAspects } from '../src/index.js';
import { debugSvg, type Theme } from './lib/debug-svg.js';
import { REPO_ROOT, faceFiles } from './lib/fonts.js';
import { demoScene } from './lib/scenes.js';
import { woffToSfnt } from './lib/woff.js';

const USAGE = `Usage:
  pnpm --filter @gcportrait/layout debug-svg --fixture S|M|L [--lens LENS] [--detail LEVEL]
       [--theme light|dark|both] [--aspects] [--no-png] [--out DIR]

Writes out/layout/<fixture>-<lens>-<detail>-<theme>.svg and .png: the layout's rects, labels, routed edges and
(with --aspects) each container's children box and packing aspect. Not the renderer.`;

/**
 * The Roboto faces as TrueType files the rasteriser can load, written once into the output directory. Every
 * unicode-range subset of a face carries the face's family name and the rasteriser takes the first file that
 * matches a family, falling back to another family for glyphs that file lacks; so the Latin subsets come first,
 * or "Roboto Mono" text would resolve to the Cyrillic subset and be drawn in Roboto.
 */
function rasteriserFonts(outDir: string): string[] {
  const fontDir = path.join(outDir, 'fonts');
  mkdirSync(fontDir, { recursive: true });
  const rank = (file: string): number => (/-latin-\d/.test(file) ? 0 : /-latin-ext-/.test(file) ? 1 : 2);
  const files: string[] = [];
  for (const key of ['sans-400', 'sans-500', 'sans-700', 'mono-400'] as const) {
    for (const woff of [...faceFiles(key)].sort((a, b) => rank(a) - rank(b))) {
      let bytes: Buffer;
      try {
        bytes = readFileSync(woff);
      } catch {
        continue;
      }
      const ttf = path.join(fontDir, `${path.basename(woff, '.woff')}.ttf`);
      writeFileSync(ttf, woffToSfnt(bytes));
      files.push(ttf);
    }
  }
  return files;
}

export function run(argv: readonly string[]): number {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      fixture: { type: 'string', default: 'M' },
      lens: { type: 'string', default: 'overview' },
      detail: { type: 'string', default: 'auto' },
      theme: { type: 'string', default: 'light' },
      aspects: { type: 'boolean', default: false },
      'no-png': { type: 'boolean', default: false },
      out: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const fixture =
    values.fixture === 'S' || values.fixture === 'M' || values.fixture === 'L' ? values.fixture : undefined;
  const lens = LensIdSchema.safeParse(values.lens);
  const detail = DetailLevelSchema.safeParse(values.detail);
  const themes: Theme[] =
    values.theme === 'both' ? ['light', 'dark'] : values.theme === 'dark' ? ['dark'] : ['light'];
  if (
    fixture === undefined ||
    !lens.success ||
    !detail.success ||
    !['light', 'dark', 'both'].includes(values.theme)
  ) {
    process.stderr.write(`debug-svg: invalid arguments\n\n${USAGE}\n`);
    return 2;
  }
  const outDir =
    values.out === undefined
      ? path.join(REPO_ROOT, 'out/layout')
      : path.resolve(process.env.INIT_CWD ?? process.cwd(), values.out);
  mkdirSync(outDir, { recursive: true });
  process.stdout.write('gcportrait layout debug-svg\n');

  const scene = demoScene(fixture, lens.data, detail.data);
  const layout = layoutScene(scene);
  const aspects = packingAspects(layout).filter((aspect) => aspect.children >= 4);
  const within = aspects.filter((aspect) => aspect.deviation <= ASPECT_TOLERANCE).length;
  const minFill = Math.min(1, ...aspects.map((aspect) => aspect.fill));
  process.stdout.write(
    `demo ${fixture} · ${lens.data} · detail ${detail.data}: ${String(layout.report.counts.rects)} rects, canvas ${String(layout.bounds.width)}×${String(layout.bounds.height)}; ` +
      `${String(within)} of ${String(aspects.length)} containers with ≥ 4 children within 20 % of their target aspect, ` +
      `lowest fill ${String(Math.round(minFill * 100))} %\n`,
  );
  const routing = layout.report.routing;
  process.stdout.write(
    `edges: ${String(routing.edges)} routed (${routing.mode}), ${String(routing.fallbacks)} fallback(s), ` +
      `most lanes in a gutter ${String(routing.maxLanes)}, bends ${JSON.stringify(routing.bends)}\n`,
  );
  const fonts = values['no-png'] ? [] : rasteriserFonts(outDir);
  for (const theme of themes) {
    const base = path.join(outDir, `${fixture}-${lens.data}-${detail.data}-${theme}`);
    const svg = debugSvg(scene, layout, {
      theme,
      caption: `demo ${fixture} · lens ${lens.data} · detail ${detail.data} · ${theme}`,
      aspects: values.aspects,
    });
    writeFileSync(`${base}.svg`, svg);
    process.stdout.write(`wrote ${base}.svg\n`);
    if (!values['no-png']) {
      const png = new Resvg(svg, {
        font: {
          loadSystemFonts: false,
          fontFiles: fonts,
          defaultFontFamily: 'Roboto',
          sansSerifFamily: 'Roboto',
        },
      })
        .render()
        .asPng();
      writeFileSync(`${base}.png`, png);
      process.stdout.write(`wrote ${base}.png\n`);
    }
  }
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run(process.argv.slice(2));
}
