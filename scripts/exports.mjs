// SPDX-License-Identifier: MIT
// @ts-check
/**
 * `node scripts/exports.mjs`: the sample exports the website offers for download (docs/website.md, "Sample
 * exports"): real SVG, PNG and draw.io files of the synthetic demo organisations, drawn by `pnpm render` exactly as the
 * app's Export menu draws them (the title block's three lines, scope, lens with read time and tagline, the legend, 2×
 * PNG with a 24 px margin, the draw.io file compressed as diagrams.net saves it, ADR 0036; its `agent` without the
 * command's version, `gcportrait` alone as the render golden has it, so a release leaves the samples as they are), in
 * the light and the dark
 * theme, with a WebP preview of each PNG at 480 and 960 pixels wide. Everything goes to docs/media/exports/ with a
 * manifest (each file's sample, demo size, lens, theme, size in pixels, bytes, hash and the command that made it),
 * which the website reads.
 *
 * No file carries the non-affiliation line (ADR 0018 as placed on 2026-10-11): the statement is in the
 * footers of the app and the website and in the long form, never in a drawing, so neither an SVG's title block nor its
 * <title> or <desc> may hold it, nor a draw.io file's labels, and `--check` fails a file that does.
 *
 *   node scripts/exports.mjs                     render every sample, write docs/media/exports/ and its manifest
 *   node scripts/exports.mjs --check             compare the manifest with the files and this script: every file
 *                                                listed, present and unchanged, nothing else there, the generator's
 *                                                version, no SVG with an affiliation line (title block, <title> or
 *                                                <desc>), nothing loaded from elsewhere, every draw.io file readable
 *                                                as diagrams.net reads it and as clean, the size budget
 *   node scripts/exports.mjs --check --render    also render everything again into a temporary folder and compare
 *                                                byte for byte (the renderer, the demo data or the fonts changed?)
 *   node scripts/exports.mjs --list              print the files a run writes
 *
 * Kept apart from `pnpm media` (scripts/media.mjs) on purpose: these files come from the headless renderer, not from
 * screenshots of the app, so they neither depend on the demo app bundle nor touch the animated demos; `pnpm media
 * --check` does not look at them. The renderer is byte-stable (packages/render-cli/README.md): the same arguments give
 * the same bytes, so a second run writes the same files, on every platform since its rasteriser is resvg's
 * WebAssembly build (ADR 0033).
 *
 * The previews are encoded by Playwright's Chromium (a canvas scaled with high-quality smoothing, then WebP), as the
 * media script encodes its WebPs: the website package's dev dependency, with Chromium from
 * `pnpm --filter @gcportrait/e2e install-browsers`. Only the synthetic demo organisations are drawn (ADR 0014).
 * Exit code 0 on success (and with --check when everything agrees), 1 on a failure or a difference, 2 on a usage
 * error.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { inflateRawSync } from 'node:zlib';

/**
 * @typedef {'light' | 'dark'} Theme
 * @typedef {'png' | 'svg' | 'drawio' | 'webp'} Format
 * @typedef {{
 *   id: string, fixture: 'S' | 'M' | 'L' | 'XL', lens: string, focus?: string,
 *   title: string, summary: string,
 * }} Sample
 * @typedef {{
 *   file: string, sample: string, fixture: string, lens: string, theme: Theme, format: Format,
 *   width: number, height: number, bytes: number, sha256: string, detail?: string, command: string,
 * }} ExportFile
 * @typedef {{
 *   generator: string, generatorHash: string, tools: Record<string, string>,
 *   samples: (Sample & { lensTitle: string })[], files: ExportFile[],
 * }} ExportManifest
 * @typedef {{ evaluate: (expression: string) => Promise<unknown>, setContent: (html: string) => Promise<void> }} Page
 * @typedef {{ newPage: () => Promise<Page>, close: () => Promise<void> }} Browser
 * @typedef {{ chromium: { launch: () => Promise<Browser> } }} Playwright
 */

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Where the samples go, relative to the repository root, and the manifest's name inside it. */
export const EXPORTS_DIR = 'docs/media/exports';
export const MANIFEST = 'manifest.json';
export const THEMES = /** @type {const} */ (['light', 'dark']);
/** The widths of each PNG's WebP preview, and their quality. */
export const PREVIEW_WIDTHS = Object.freeze([480, 960]);
const PREVIEW_QUALITY = 0.82;
/** All files together stay under this (docs/website.md, "Sample exports"): the site publishes every one. */
export const BUDGET_BYTES = 6 * 1024 * 1024;
/**
 * The tools whose version changes the bytes: the rasteriser (pinned by the render library) and the preview encoder.
 * Not `pnpm render`'s own version, which changes with every release: the draw.io files are written without it
 * (`--drawio-unversioned`, renderArgs), so their `agent` is `gcportrait` alone, and `--check` refuses one that names a
 * version (drawioProblems).
 */
const TOOLS = Object.freeze([
  ['@resvg/resvg-wasm', 'packages/render'],
  ['playwright', 'website'],
]);

/**
 * The samples: the whole of demo S and demo M in the Overview lens, as the app opens them (detail `auto` at the
 * 1280×800 canvas the render CLI fits by default), and demo M's production Shared VPC in the Networking lens, which
 * shows resources the overview of M keeps collapsed. L and XL are left out: L's overview alone is a 8172×5284 PNG of
 * about 1.9 MB per theme, which would take the set over its budget.
 * @type {readonly Sample[]}
 */
export const SAMPLES = Object.freeze([
  {
    id: 'S-overview',
    fixture: 'S',
    lens: 'overview',
    title: 'Demo S, Overview lens',
    summary:
      'The whole small demo organisation as the app opens it: folders, projects, the Shared VPC with its networks and every resource, with arrows for the references.',
  },
  {
    id: 'M-overview',
    fixture: 'M',
    lens: 'overview',
    title: 'Demo M, Overview lens',
    summary:
      'The medium demo organisation as the app opens it: three business units of folders, their projects collapsed into chips that count what they hold.',
  },
  {
    id: 'M-shared-vpc',
    fixture: 'M',
    lens: 'networking',
    focus: 'kind=shared-vpc,host=demo-net-1',
    title: 'Demo M, Networking lens, focused on the production Shared VPC',
    summary:
      'The production Shared VPC of demo M and the projects attached to it: load balancers, addresses, Cloud Interconnect and VPN, with the host project’s network.',
  },
]);

const LENS_TITLES = Object.freeze(
  /** @type {Record<string, string>} */ ({ overview: 'Overview', networking: 'Networking' }),
);

class UsageError extends Error {}

/** @param {Buffer | string} data */
export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

/** The stem of a sample's files in a theme: "S-overview-light". @param {string} sample @param {Theme} theme */
export function stem(sample, theme) {
  return `${sample}-${theme}`;
}

/** Every file a run writes, relative to docs/media/exports/, sorted (the manifest besides). */
export function expectedFiles(/** @type {readonly Sample[]} */ samples = SAMPLES) {
  return samples
    .flatMap((sample) =>
      THEMES.flatMap((theme) => [
        `${stem(sample.id, theme)}.png`,
        `${stem(sample.id, theme)}.svg`,
        `${stem(sample.id, theme)}.drawio`,
        ...PREVIEW_WIDTHS.map((width) => `${stem(sample.id, theme)}-${String(width)}.webp`),
      ]),
    )
    .sort();
}

/** The `pnpm render` arguments of a sample in a theme, writing to `png`, `svg` and `drawio`. */
export function renderArgs(
  /** @type {Sample} */ sample,
  /** @type {Theme} */ theme,
  /** @type {string} */ png,
  /** @type {string} */ svg,
  /** @type {string} */ drawio,
) {
  return [
    '--fixture',
    sample.fixture,
    '--lens',
    sample.lens,
    ...(sample.focus === undefined ? [] : ['--focus', sample.focus]),
    '--theme',
    theme,
    '--png',
    png,
    '--svg',
    svg,
    '--drawio',
    drawio,
    '--drawio-unversioned',
  ];
}

/**
 * The command that makes a sample's PNG, SVG and draw.io file, as the manifest records it (paths from the repository
 * root).
 */
export function renderCommand(/** @type {Sample} */ sample, /** @type {Theme} */ theme) {
  const base = `${EXPORTS_DIR}/${stem(sample.id, theme)}`;
  return ['pnpm render', ...renderArgs(sample, theme, `${base}.png`, `${base}.svg`, `${base}.drawio`)].join(
    ' ',
  );
}

/** The width and height of a PNG, from its IHDR chunk. @param {Buffer} data */
export function pngSize(data) {
  if (
    data.length < 24 ||
    data.toString('latin1', 1, 4) !== 'PNG' ||
    data.toString('latin1', 12, 16) !== 'IHDR'
  ) {
    throw new Error('not a PNG');
  }
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/** The width and height of an SVG, from its root element's attributes. @param {string} text */
export function svgSize(text) {
  const root = /<svg\b([^>]*)>/.exec(text)?.[1] ?? '';
  const width = Number(/\swidth="([\d.]+)"/.exec(root)?.[1]);
  const height = Number(/\sheight="([\d.]+)"/.exec(root)?.[1]);
  if (!(width > 0) || !(height > 0)) throw new Error('an SVG without width and height');
  return { width, height };
}

/** The text of XML character data: the five named entities and numeric references. @param {string} text */
function decodeXml(text) {
  /** @type {Record<string, string>} */
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return text.replace(
    /&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi,
    (
      /** @type {string} */ whole,
      /** @type {string | undefined} */ hex,
      /** @type {string | undefined} */ dec,
      /** @type {string | undefined} */ name,
    ) => {
      if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16));
      if (dec !== undefined) return String.fromCodePoint(Number(dec));
      return named[(name ?? '').toLowerCase()] ?? whole;
    },
  );
}

/**
 * Whether a text states an affiliation: any sentence that says "affiliated with … Google" (the long form, the footer's
 * first sentence, the short lines of earlier versions). @param {string} text
 */
export function statesAffiliation(text) {
  return /\baffiliated with\b[^.]*\bGoogle\b/i.test(text);
}

/**
 * What an exported SVG must not say or do: no affiliation line in its title block (any <text> of the drawing), its
 * <title> or its <desc>, nor anywhere else in the file (ADR 0018 as placed on 2026-10-11: the statement is in the
 * footers and the long form, never in a drawing; the <desc> keeps neutral metadata only); and it loads nothing from
 * another host and holds no script. An empty list means it is fine.
 * @param {string} text
 * @returns {string[]}
 */
export function svgProblems(text) {
  /** @type {string[]} */
  const problems = [];
  const lines = [...text.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((match) => decodeXml(match[1] ?? ''));
  for (const line of lines.filter((value) => statesAffiliation(value)))
    problems.push(`its title block carries the affiliation line "${line}"`);
  const title = decodeXml(/<title>([^<]*)<\/title>/.exec(text)?.[1] ?? '');
  if (statesAffiliation(title)) problems.push('its <title> states an affiliation');
  const desc = decodeXml(/<desc>([^<]*)<\/desc>/.exec(text)?.[1] ?? '');
  if (statesAffiliation(desc)) problems.push('its <desc> states an affiliation');
  if (problems.length === 0 && statesAffiliation(decodeXml(text)))
    problems.push('it states an affiliation outside its title block, <title> and <desc>');
  if (/(?:href|src)\s*=\s*"(?:https?:)?\/\//i.test(text) || /url\(\s*['"]?(?:https?:)?\/\//i.test(text)) {
    problems.push('it loads something from another host');
  }
  if (/<script\b/i.test(text)) problems.push('it holds a script');
  return problems;
}

/** The address of Google Fonts' stylesheet a draw.io file names in `fontSource` (the user's diagrams.net loads it). */
export const FONT_SOURCE_PREFIX = 'https://fonts.googleapis.com/css2?';

/**
 * A `.drawio` file as diagrams.net reads it: its one diagram's model, compressed (base64 of the raw-deflated,
 * URI-encoded XML) or plain, and the page's size from the model. Throws when the file is not one.
 * @param {string} text
 */
export function readDrawio(text) {
  if (!/^<mxfile\b[^>]*>/.test(text)) throw new Error('not a draw.io file (no <mxfile>)');
  const diagrams = [...text.matchAll(/<diagram\b[^>]*>([\s\S]*?)<\/diagram>/g)];
  if (diagrams.length !== 1) throw new Error(`${String(diagrams.length)} diagrams, not one`);
  const body = (diagrams[0]?.[1] ?? '').trim();
  const compressed = !body.startsWith('<');
  const model = compressed
    ? decodeURIComponent(inflateRawSync(Buffer.from(body, 'base64')).toString('latin1'))
    : body;
  const head = /^<mxGraphModel\b([^>]*)>/.exec(model)?.[1];
  if (head === undefined) throw new Error('its diagram holds no <mxGraphModel>');
  const width = Number(/\spageWidth="(\d+)"/.exec(head)?.[1]);
  const height = Number(/\spageHeight="(\d+)"/.exec(head)?.[1]);
  return { compressed, model, width, height };
}

/**
 * What a sample draw.io file must not say or do: unreadable as diagrams.net reads it, or stored as plain XML; an
 * `agent` other than `gcportrait` alone (a version there would make every release's samples stale); an affiliation
 * line in any label (ADR 0018: never in a drawing); a script; or an address other than Google Fonts' stylesheet,
 * which each label names for the user's diagrams.net to load the faces (icons are embedded). An empty list means it
 * is fine.
 * @param {string} text
 * @returns {string[]}
 */
export function drawioProblems(text) {
  /** @type {ReturnType<typeof readDrawio>} */
  let file;
  try {
    file = readDrawio(text);
  } catch (error) {
    return [
      `it is not readable as diagrams.net reads it: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  /** @type {string[]} */
  const problems = [];
  if (!file.compressed) problems.push('its diagram is plain XML, not compressed as diagrams.net saves it');
  const agent = /^<mxfile\b[^>]*\sagent="([^"]*)"/.exec(text)?.[1];
  if (agent !== 'gcportrait')
    problems.push(
      `its agent is ${agent === undefined ? 'missing' : `"${agent}"`}, not "gcportrait" (no version)`,
    );
  const decoded = decodeXml(file.model);
  if (statesAffiliation(decoded.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')))
    problems.push('a label states an affiliation');
  if (/<script\b/i.test(decoded)) problems.push('it holds a script');
  let styles = '';
  for (const match of file.model.matchAll(/\sstyle="([^"]*)"/g)) {
    try {
      styles += `${decodeURIComponent(decodeXml(match[1] ?? ''))}\n`;
    } catch {
      styles += `${decodeXml(match[1] ?? '')}\n`;
    }
  }
  for (const [address] of `${decoded}\n${styles}`.matchAll(/https?:\/\/[^\s"';)<>]+/gi)) {
    if (address.startsWith(FONT_SOURCE_PREFIX)) continue;
    problems.push(`it names another address: ${address.slice(0, 80)}`);
    break;
  }
  return problems;
}

/**
 * The generator's version: what shapes its files besides the renderer, which `--check --render` covers: the samples,
 * the previews' widths and quality, and the page that encodes them. Not the script's text: formatting or a comment
 * changes no byte. The render command of each file is checked on its own (problemsOf).
 */
export function generatorHash(
  /** @type {{ samples: readonly Sample[], widths: readonly number[], quality: number, encoder: string }} */ parts = {
    samples: SAMPLES,
    widths: PREVIEW_WIDTHS,
    quality: PREVIEW_QUALITY,
    encoder: ENCODER_PAGE,
  },
) {
  return sha256(JSON.stringify(parts));
}

/** @param {string} name @param {string} workspace @returns {string} */
function toolVersion(name, workspace) {
  // A tool of this repository is its workspace package; the others are installed in a workspace's node_modules.
  const own = path.join(ROOT, workspace, 'package.json');
  const file = name.startsWith('@gcportrait/')
    ? own
    : path.join(ROOT, workspace, 'node_modules', name, 'package.json');
  if (!existsSync(file)) return 'missing';
  /** @type {unknown} */
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  return typeof manifest === 'object' &&
    manifest !== null &&
    'version' in manifest &&
    typeof manifest.version === 'string'
    ? manifest.version
    : 'unknown';
}

function tools() {
  return Object.fromEntries(
    TOOLS.map(([name, workspace]) => [name ?? '', toolVersion(name ?? '', workspace ?? '')]),
  );
}

/** @param {string} message */
function log(message) {
  process.stdout.write(`exports: ${message}\n`);
}

/**
 * Renders a sample in a theme with `pnpm render` into `dir`; returns the detail level `auto` chose.
 * @param {Sample} sample @param {Theme} theme @param {string} dir
 */
function render(sample, theme, dir) {
  const base = path.join(dir, stem(sample.id, theme));
  const result = spawnSync(
    'pnpm',
    ['-s', 'render', ...renderArgs(sample, theme, `${base}.png`, `${base}.svg`, `${base}.drawio`)],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, INIT_CWD: ROOT },
    },
  );
  if (result.status !== 0) {
    throw new Error(`pnpm render failed for ${stem(sample.id, theme)}:\n${result.stderr}${result.stdout}`);
  }
  return /detail auto → (\w+)/.exec(`${result.stdout}\n${result.stderr}`)?.[1];
}

const ENCODER_PAGE = `<!doctype html><meta charset="utf-8"><title>preview encoder</title><script>
window.preview = async (png, width, quality) => {
  const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
  const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const height = Math.round((image.height * width) / image.width);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
  const out = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < out.length; i += 0x8000) text += String.fromCharCode(...out.subarray(i, i + 0x8000));
  return { data: btoa(text), width, height };
};
</script>`;

/**
 * Renders every sample in both themes into `dir` and writes the previews; returns the files' entries.
 * @param {string} dir
 * @returns {Promise<ExportFile[]>}
 */
async function generate(dir) {
  // Playwright is the website package's dev dependency, loaded from there (its types are not visible from scripts/).
  /** @type {unknown} */
  const loaded = createRequire(path.join(ROOT, 'website', 'package.json'))('playwright');
  const playwright = /** @type {Playwright} */ (loaded);
  /** @type {ExportFile[]} */
  const files = [];
  const browser = await playwright.chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(ENCODER_PAGE);
    for (const sample of SAMPLES) {
      for (const theme of THEMES) {
        log(`${stem(sample.id, theme)}: ${renderCommand(sample, theme)}`);
        const detail = render(sample, theme, dir);
        const name = stem(sample.id, theme);
        const command = renderCommand(sample, theme);
        const common = { sample: sample.id, fixture: sample.fixture, lens: sample.lens, theme, command };
        const png = readFileSync(path.join(dir, `${name}.png`));
        const svg = readFileSync(path.join(dir, `${name}.svg`));
        files.push({
          file: `${name}.png`,
          ...common,
          format: 'png',
          ...pngSize(png),
          bytes: png.length,
          sha256: sha256(png),
          ...(detail === undefined ? {} : { detail }),
        });
        files.push({
          file: `${name}.svg`,
          ...common,
          format: 'svg',
          ...svgSize(svg.toString('utf8')),
          bytes: svg.length,
          sha256: sha256(svg),
          ...(detail === undefined ? {} : { detail }),
        });
        const drawio = readFileSync(path.join(dir, `${name}.drawio`));
        const sheet = readDrawio(drawio.toString('utf8'));
        files.push({
          file: `${name}.drawio`,
          ...common,
          format: 'drawio',
          width: sheet.width,
          height: sheet.height,
          bytes: drawio.length,
          sha256: sha256(drawio),
          ...(detail === undefined ? {} : { detail }),
        });
        for (const width of PREVIEW_WIDTHS) {
          const result = /** @type {{ data: string, width: number, height: number }} */ (
            await page.evaluate(
              `window.preview(${JSON.stringify(png.toString('base64'))}, ${String(width)}, ${String(PREVIEW_QUALITY)})`,
            )
          );
          const webp = Buffer.from(result.data, 'base64');
          const file = `${name}-${String(width)}.webp`;
          writeFileSync(path.join(dir, file), webp);
          files.push({
            file,
            ...common,
            command: `node scripts/exports.mjs (the ${String(width)}-pixel WebP preview of ${name}.png)`,
            format: 'webp',
            width: result.width,
            height: result.height,
            bytes: webp.length,
            sha256: sha256(webp),
          });
        }
      }
    }
  } finally {
    await browser.close();
  }
  return files.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/** @param {string} dir @returns {ExportManifest | undefined} */
export function readManifest(dir) {
  const file = path.join(dir, MANIFEST);
  if (!existsSync(file)) return undefined;
  /** @type {unknown} */
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return /** @type {ExportManifest} */ (parsed);
}

/**
 * What is wrong with the committed samples: a missing manifest, a different generator or tool version, a file the
 * samples need that is not listed, missing or changed, a file in the folder that is not listed, an SVG that carries an
 * affiliation line or loads from elsewhere, a PNG whose size differs from the manifest, and a set over its budget.
 * @param {{ dir: string, manifest: ExportManifest | undefined, hash: string, tools: Record<string, string> }} options
 * @returns {string[]}
 */
export function problemsOf({ dir, manifest, hash, tools: versions }) {
  if (manifest === undefined) return [`no ${EXPORTS_DIR}/${MANIFEST}: run \`node scripts/exports.mjs\``];
  /** @type {string[]} */
  const problems = [];
  if (manifest.generatorHash !== hash)
    problems.push('the samples or their previews changed in scripts/exports.mjs since the files were made');
  for (const sample of SAMPLES) {
    for (const theme of THEMES) {
      const command = renderCommand(sample, theme);
      const recorded = manifest.files.filter(
        (entry) => entry.sample === sample.id && entry.theme === theme && entry.format !== 'webp',
      );
      if (recorded.some((entry) => entry.command !== command))
        problems.push(`${stem(sample.id, theme)} was made with another command than \`${command}\``);
    }
  }
  for (const [name, version] of Object.entries(versions)) {
    if (manifest.tools[name] !== version)
      problems.push(`${name} changed (${manifest.tools[name] ?? 'none'} → ${version})`);
  }
  const listed = new Map(manifest.files.map((entry) => [entry.file, entry]));
  for (const file of expectedFiles()) if (!listed.has(file)) problems.push(`${file} is not in the manifest`);
  const present = existsSync(dir) ? readdirSync(dir).filter((name) => name !== MANIFEST) : [];
  for (const name of present)
    if (!listed.has(name))
      problems.push(`${name} is not a sample (delete it, or add it to scripts/exports.mjs)`);
  let total = 0;
  for (const entry of manifest.files) {
    const full = path.join(dir, entry.file);
    if (!existsSync(full)) {
      problems.push(`${entry.file} is missing`);
      continue;
    }
    const data = readFileSync(full);
    total += data.length;
    if (sha256(data) !== entry.sha256 || data.length !== entry.bytes) {
      problems.push(`${entry.file} differs from the manifest (edited by hand?)`);
      continue;
    }
    if (entry.format === 'svg') {
      for (const problem of svgProblems(data.toString('utf8'))) problems.push(`${entry.file}: ${problem}`);
    }
    if (entry.format === 'drawio') {
      for (const problem of drawioProblems(data.toString('utf8'))) problems.push(`${entry.file}: ${problem}`);
    }
    if (entry.format === 'png') {
      const size = pngSize(data);
      if (size.width !== entry.width || size.height !== entry.height)
        problems.push(`${entry.file}: not ${String(entry.width)}×${String(entry.height)}`);
    }
  }
  if (total > BUDGET_BYTES) {
    problems.push(`the samples take ${String(total)} bytes, over the budget of ${String(BUDGET_BYTES)}`);
  }
  return problems;
}

/** @param {readonly string[]} argv */
export async function main(argv) {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      check: { type: 'boolean', default: false },
      render: { type: 'boolean', default: false },
      list: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    process.stdout.write('usage: node scripts/exports.mjs [--check [--render]] [--list]\n');
    return 0;
  }
  if (values.render && !values.check) throw new UsageError('--render goes with --check');
  const dir = path.join(ROOT, EXPORTS_DIR);
  if (values.list) {
    for (const file of [...expectedFiles(), MANIFEST]) process.stdout.write(`${EXPORTS_DIR}/${file}\n`);
    return 0;
  }
  const hash = generatorHash();
  const versions = tools();

  if (values.check) {
    const manifest = readManifest(dir);
    const problems = problemsOf({ dir, manifest, hash, tools: versions });
    if (values.render && manifest !== undefined) {
      const scratch = mkdtempSync(path.join(tmpdir(), 'gcportrait-exports-'));
      try {
        const again = await generate(scratch);
        for (const entry of again) {
          const committed = manifest.files.find((item) => item.file === entry.file);
          if (committed === undefined || committed.sha256 !== entry.sha256) {
            problems.push(
              `${entry.file} renders differently now (${String(entry.bytes)} bytes, ${entry.sha256.slice(0, 12)})`,
            );
          }
        }
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    }
    if (problems.length === 0) {
      const total = manifest?.files.reduce((sum, entry) => sum + entry.bytes, 0) ?? 0;
      log(
        `${EXPORTS_DIR} is up to date (${String(manifest?.files.length ?? 0)} files, ${(total / 1048576).toFixed(2)} MiB${values.render ? ', rendered again: byte for byte the same' : ''}).`,
      );
      return 0;
    }
    process.stderr.write(
      `exports: ${EXPORTS_DIR} is stale; run \`node scripts/exports.mjs\` and commit the result:\n`,
    );
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    return 1;
  }

  const scratch = mkdtempSync(path.join(tmpdir(), 'gcportrait-exports-'));
  try {
    const files = await generate(scratch);
    mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(dir)) {
      if (name !== MANIFEST && !files.some((entry) => entry.file === name)) {
        rmSync(path.join(dir, name));
        log(`removed ${name} (no longer a sample)`);
      }
    }
    for (const entry of files)
      writeFileSync(path.join(dir, entry.file), readFileSync(path.join(scratch, entry.file)));
    /** @type {ExportManifest} */
    const manifest = {
      generator: 'node scripts/exports.mjs',
      generatorHash: hash,
      tools: versions,
      samples: SAMPLES.map((sample) => ({ ...sample, lensTitle: LENS_TITLES[sample.lens] ?? sample.lens })),
      files,
    };
    writeFileSync(path.join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    const total = files.reduce((sum, entry) => sum + entry.bytes, 0);
    log(
      `wrote ${String(files.length)} files and the manifest to ${EXPORTS_DIR} (${(total / 1048576).toFixed(2)} MiB).`,
    );
    if (total > BUDGET_BYTES) log(`the samples are over their budget of ${String(BUDGET_BYTES)} bytes`);
    return total > BUDGET_BYTES ? 1 : 0;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (/** @type {unknown} */ error) => {
      if (
        error instanceof UsageError ||
        (error instanceof Error && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS'))
      ) {
        process.stderr.write(`exports: ${error.message}\n`);
        process.exitCode = 2;
      } else {
        process.stderr.write(
          `exports: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
        );
        process.exitCode = 1;
      }
    },
  );
}
