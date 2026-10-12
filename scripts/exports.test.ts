// SPDX-License-Identifier: MIT
/**
 * scripts/exports.mjs: the sample exports' file list, the render command each manifest entry records, the PNG and
 * SVG sizes, the non-affiliation rule for an exported SVG (no affiliation line in its title block, <title> or
 * <desc>, ADR 0018 as placed on 2026-10-11) and for a draw.io file's labels, the draw.io file read as diagrams.net
 * reads it, the staleness check against the manifest, the committed samples themselves, and the command line's paths
 * that need no browser.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BUDGET_BYTES,
  EXPORTS_DIR,
  FONT_SOURCE_PREFIX,
  SAMPLES,
  drawioProblems,
  expectedFiles,
  generatorHash,
  pngSize,
  problemsOf,
  readDrawio,
  readManifest,
  renderCommand,
  sha256,
  statesAffiliation,
  svgProblems,
  svgSize,
  type ExportManifest,
} from './exports.mjs';
import { SCRIPTS_DIR, createTempTree, runScript, type TempTree } from './testing/temp-tree.js';

const REPO = path.resolve(SCRIPTS_DIR, '..');
/** The short non-affiliation line of earlier versions, which an export must never carry either. */
const DISCLAIMER = 'Not affiliated with Google / Google Cloud.';
const TAGLINE = 'gcportrait.app - Visualize your Google Cloud Infrastructure';
/** The title block's three lines and the <desc> of an export since 2026-10-11 (frontend/src/diagram/titleBlock.ts). */
const TITLE_BLOCK = ['example.com', 'Overview lens · read 2026-10-08T00:00:00+00:00', TAGLINE];
const DESC = 'example.com, Overview lens, read 2026-10-08T00:00:00+00:00. Drawn with gcportrait.';

/** A minimal PNG header of a width and height (signature and IHDR; enough for pngSize). */
function pngHeader(width: number, height: number): Buffer {
  const data = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data, 0);
  data.writeUInt32BE(13, 8);
  data.write('IHDR', 12, 'latin1');
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

function svg(
  lines: readonly string[],
  desc: string,
  title = 'gcportrait diagram of example.com, Overview lens',
): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 -60 200 160">',
    `<title>${title}</title>`,
    `<desc>${desc}</desc>`,
    ...lines.map((line) => `<text x="24" y="0">${line}</text>`),
    '</svg>',
  ].join('');
}

/**
 * A `.drawio` file of a model whose labels are `labels`, compressed as diagrams.net saves it unless `plain`; each label
 * names Google Fonts' stylesheet as the translator writes it.
 */
function drawio(labels: readonly string[], plain = false): string {
  const font = encodeURIComponent(`${FONT_SOURCE_PREFIX}family=Roboto`);
  const escape = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cells = labels.map(
    (label, index) =>
      `<mxCell id="t${String(index)}" value="${escape(`<div style="line-height: 18px">${label}</div>`)}" style="text;html=1;fontSource=${font};" vertex="1" parent="3"><mxGeometry x="24" y="${String(index * 18)}" width="300" height="18" as="geometry"/></mxCell>`,
  );
  const model =
    `<mxGraphModel pageWidth="400" pageHeight="300" background="#ffffff"><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
    `<mxCell id="3" value="Title and legend" parent="0"/>${cells.join('')}</root></mxGraphModel>`;
  const body = plain ? model : deflateRawSync(encodeURIComponent(model)).toString('base64');
  return `<mxfile host="gcportrait" modified="2026-10-08T00:00:00.000Z" agent="gcportrait" version="24.7.17"><diagram id="gcportrait-x" name="gcportrait diagram">${body}</diagram></mxfile>\n`;
}

describe('the samples', () => {
  it('are demo S and M in both themes: a PNG, an SVG, a draw.io file and two previews each, never L or XL', () => {
    expect(SAMPLES.map((sample) => sample.id)).toEqual(['S-overview', 'M-overview', 'M-shared-vpc']);
    expect(new Set(SAMPLES.map((sample) => sample.fixture))).toEqual(new Set(['S', 'M']));
    const files = expectedFiles();
    expect(files).toHaveLength(SAMPLES.length * 2 * 5);
    expect(files).toContain('S-overview-dark.svg');
    expect(files).toContain('S-overview-dark.drawio');
    expect(files).toContain('M-shared-vpc-light-960.webp');
    expect(files.filter((file) => file.endsWith('.png'))).toHaveLength(6);
  });

  it('records the exact pnpm render command of each sample, paths from the repository root', () => {
    const [overview, , focused] = SAMPLES;
    if (overview === undefined || focused === undefined) throw new Error('no samples');
    expect(renderCommand(overview, 'light')).toBe(
      'pnpm render --fixture S --lens overview --theme light --png docs/media/exports/S-overview-light.png --svg docs/media/exports/S-overview-light.svg --drawio docs/media/exports/S-overview-light.drawio --drawio-unversioned',
    );
    expect(renderCommand(focused, 'dark')).toBe(
      'pnpm render --fixture M --lens networking --focus kind=shared-vpc,host=demo-net-1 --theme dark --png docs/media/exports/M-shared-vpc-dark.png --svg docs/media/exports/M-shared-vpc-dark.svg --drawio docs/media/exports/M-shared-vpc-dark.drawio --drawio-unversioned',
    );
  });

  it('reads the sizes of a PNG and an SVG', () => {
    expect(pngSize(pngHeader(4794, 2844))).toEqual({ width: 4794, height: 2844 });
    expect(() => pngSize(Buffer.from('GIF89a'))).toThrow(/not a PNG/);
    expect(svgSize(svg([], 'x'))).toEqual({ width: 200, height: 100 });
    expect(() => svgSize('<svg viewBox="0 0 1 1"></svg>')).toThrow(/without width and height/);
  });

  it('tells an affiliation statement from neutral metadata', () => {
    expect(statesAffiliation(DISCLAIMER)).toBe(true);
    expect(statesAffiliation('Not affiliated with Google. An independent open-source side project.')).toBe(
      true,
    );
    expect(statesAffiliation('… is not affiliated with, endorsed by, or sponsored by Google. …')).toBe(true);
    for (const neutral of [...TITLE_BLOCK, DESC, 'gcportrait diagram of example.com, Overview lens'])
      expect(statesAffiliation(neutral), neutral).toBe(false);
  });

  it('wants an exported SVG without an affiliation line in its title block, <title> or <desc>, loading nothing', () => {
    const good = svg(TITLE_BLOCK, DESC);
    expect(svgProblems(good)).toEqual([]);
    expect(svgProblems(svg([...TITLE_BLOCK, DISCLAIMER], `${DESC} ${DISCLAIMER}`))).toEqual([
      `its title block carries the affiliation line "${DISCLAIMER}"`,
      'its <desc> states an affiliation',
    ]);
    expect(svgProblems(svg(TITLE_BLOCK, DESC, `gcportrait diagram. ${DISCLAIMER}`))).toEqual([
      'its <title> states an affiliation',
    ]);
    // Entities are read as text, and the line anywhere else in the file counts as well.
    expect(svgProblems(svg(['Not affiliated with Google &#x2F; Google Cloud.'], DESC))).toEqual([
      `its title block carries the affiliation line "${DISCLAIMER}"`,
    ]);
    expect(svgProblems(good.replace('</svg>', `<!-- ${DISCLAIMER} --></svg>`))).toEqual([
      'it states an affiliation outside its title block, <title> and <desc>',
    ]);
    const remote = good.replace(
      '</svg>',
      '<image href="https://example.org/x.png"/><script>1</script></svg>',
    );
    expect(svgProblems(remote)).toEqual(['it loads something from another host', 'it holds a script']);
  });

  it('reads a draw.io file as diagrams.net does, and wants it compressed, without an affiliation line, naming no other address', () => {
    const good = drawio(TITLE_BLOCK);
    expect(readDrawio(good)).toMatchObject({ compressed: true, width: 400, height: 300 });
    expect(readDrawio(good).model).toContain(TAGLINE);
    expect(drawioProblems(good)).toEqual([]);
    expect(drawioProblems(drawio(TITLE_BLOCK, true))).toEqual([
      'its diagram is plain XML, not compressed as diagrams.net saves it',
    ]);
    expect(drawioProblems(drawio([...TITLE_BLOCK, DISCLAIMER]))).toEqual(['a label states an affiliation']);
    expect(drawioProblems(drawio(['<a href="https://example.org/x">x</a>']))).toEqual([
      'it names another address: https://example.org/x',
    ]);
    expect(drawioProblems('<svg/>')).toEqual([
      'it is not readable as diagrams.net reads it: not a draw.io file (no <mxfile>)',
    ]);
    expect(drawioProblems('<mxfile><diagram>!!</diagram></mxfile>')[0]).toMatch(/^it is not readable/);
  });

  it('wants a draw.io file’s agent without a version, so that a release leaves the samples as they are', () => {
    const good = drawio(TITLE_BLOCK);
    expect(good).toContain(' agent="gcportrait" ');
    expect(drawioProblems(good.replace(' agent="gcportrait" ', ' agent="gcportrait 1.1.0" '))).toEqual([
      'its agent is "gcportrait 1.1.0", not "gcportrait" (no version)',
    ]);
    expect(drawioProblems(good.replace(' agent="gcportrait"', ''))).toEqual([
      'its agent is missing, not "gcportrait" (no version)',
    ]);
  });

  it('versions the generator by its samples, previews and encoder, not by its text', () => {
    const parts = { samples: SAMPLES, widths: [480, 960], quality: 0.82, encoder: '<script></script>' };
    expect(generatorHash(parts)).toBe(generatorHash({ ...parts }));
    expect(generatorHash({ ...parts, widths: [480] })).not.toBe(generatorHash(parts));
    expect(generatorHash({ ...parts, samples: SAMPLES.slice(1) })).not.toBe(generatorHash(parts));
    expect(generatorHash()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('the staleness check', () => {
  let tree: TempTree;
  const tools = { '@resvg/resvg-js': '2.6.2', playwright: '1.64.0' };
  const files: Record<string, Buffer> = {};

  beforeEach(() => {
    tree = createTempTree('exports');
    for (const file of expectedFiles()) {
      const data = file.endsWith('.svg')
        ? Buffer.from(svg(TITLE_BLOCK, DESC))
        : file.endsWith('.png')
          ? pngHeader(100, 50)
          : file.endsWith('.drawio')
            ? Buffer.from(drawio(TITLE_BLOCK))
            : Buffer.from(`webp ${file}`);
      files[file] = data;
      tree.write(file, data);
    }
  });
  afterEach(() => {
    tree.remove();
  });

  function manifest(): ExportManifest {
    return {
      generator: 'node scripts/exports.mjs',
      generatorHash: 'h',
      tools,
      samples: SAMPLES.map((sample) => ({ ...sample, lensTitle: sample.lens })),
      files: SAMPLES.flatMap((sample) =>
        (['light', 'dark'] as const).flatMap((theme) =>
          expectedFiles([sample])
            .filter((file) => file.startsWith(`${sample.id}-${theme}`))
            .map((file) => {
              const data = files[file] ?? Buffer.alloc(0);
              const format = file.endsWith('.svg')
                ? 'svg'
                : file.endsWith('.png')
                  ? 'png'
                  : file.endsWith('.drawio')
                    ? 'drawio'
                    : 'webp';
              return {
                file,
                sample: sample.id,
                fixture: sample.fixture,
                lens: sample.lens,
                theme,
                format,
                width: 100,
                height: 50,
                bytes: data.length,
                sha256: sha256(data),
                command:
                  format === 'webp' ? 'node scripts/exports.mjs (a preview)' : renderCommand(sample, theme),
              } as const;
            }),
        ),
      ),
    };
  }

  const check = (
    value: ExportManifest | undefined,
    extra: Partial<Parameters<typeof problemsOf>[0]> = {},
  ): string[] => problemsOf({ dir: tree.root, manifest: value, hash: 'h', tools, ...extra });

  it('is fresh when the files, the generator and the tools match the manifest', () => {
    expect(check(manifest())).toEqual([]);
    expect(check(undefined)).toEqual([`no ${EXPORTS_DIR}/manifest.json: run \`node scripts/exports.mjs\``]);
  });

  it('names a changed generator or tool, a changed command, an edited, missing or unlisted file', () => {
    expect(check(manifest(), { hash: 'other', tools: { ...tools, '@resvg/resvg-js': '2.7.0' } })).toEqual([
      'the samples or their previews changed in scripts/exports.mjs since the files were made',
      '@resvg/resvg-js changed (2.6.2 → 2.7.0)',
    ]);
    const renamed = manifest();
    const first = renamed.files.find((entry) => entry.file === 'S-overview-dark.svg');
    if (first !== undefined) first.command = 'pnpm render --fixture S --lens overview --theme dark';
    expect(check(renamed)).toEqual([
      'S-overview-dark was made with another command than `pnpm render --fixture S --lens overview --theme dark --png docs/media/exports/S-overview-dark.png --svg docs/media/exports/S-overview-dark.svg --drawio docs/media/exports/S-overview-dark.drawio --drawio-unversioned`',
    ]);
    tree.write('S-overview-light.png', pngHeader(100, 51));
    tree.write('stray.png', 'x');
    const value = manifest();
    value.files = value.files.filter((entry) => entry.file !== 'M-overview-dark-480.webp');
    expect(check(value)).toEqual([
      'M-overview-dark-480.webp is not in the manifest',
      'M-overview-dark-480.webp is not a sample (delete it, or add it to scripts/exports.mjs)',
      'stray.png is not a sample (delete it, or add it to scripts/exports.mjs)',
      'S-overview-light.png differs from the manifest (edited by hand?)',
    ]);
  });

  it('fails every SVG and draw.io file that carries the non-affiliation line, and the whole set over its budget', () => {
    const old = Buffer.from(svg([...TITLE_BLOCK, DISCLAIMER], `${DESC} ${DISCLAIMER}`));
    files['M-overview-light.svg'] = old;
    tree.write('M-overview-light.svg', old);
    const stated = Buffer.from(drawio([...TITLE_BLOCK, DISCLAIMER]));
    files['S-overview-dark.drawio'] = stated;
    tree.write('S-overview-dark.drawio', stated);
    const value = manifest();
    expect(check(value)).toEqual([
      'S-overview-dark.drawio: a label states an affiliation',
      `M-overview-light.svg: its title block carries the affiliation line "${DISCLAIMER}"`,
      'M-overview-light.svg: its <desc> states an affiliation',
    ]);
    const big = Buffer.alloc(BUDGET_BYTES + 1);
    files['S-overview-dark-960.webp'] = big;
    tree.write('S-overview-dark-960.webp', big);
    expect(check(manifest()).at(-1)).toMatch(/over the budget of 6291456/);
  });
});

describe('the committed samples (docs/media/exports)', () => {
  it('are listed in the manifest with their sizes, carry no affiliation line, load nothing and keep to the budget', () => {
    const dir = path.join(REPO, EXPORTS_DIR);
    const value = readManifest(dir);
    expect(value).toBeDefined();
    if (value === undefined) return;
    expect(value.files.map((entry) => entry.file).sort()).toEqual(expectedFiles());
    expect(value).not.toHaveProperty('disclaimer');
    let total = 0;
    for (const entry of value.files) {
      const data = readFileSync(path.join(dir, entry.file));
      total += data.length;
      expect(sha256(data), entry.file).toBe(entry.sha256);
      if (entry.format === 'svg') {
        const text = data.toString('utf8');
        expect(svgProblems(text), entry.file).toEqual([]);
        expect(text, entry.file).not.toContain('Not affiliated');
        expect(text, entry.file).toContain(`>${TAGLINE}</text>`);
      }
      if (entry.format === 'png') {
        expect(pngSize(data)).toEqual({ width: entry.width, height: entry.height });
        expect(entry.command).toMatch(/^pnpm render --fixture [SM] --lens /);
      }
      if (entry.format === 'drawio') {
        const text = data.toString('utf8');
        expect(drawioProblems(text), entry.file).toEqual([]);
        const file = readDrawio(text);
        expect({ width: file.width, height: file.height }).toEqual({
          width: entry.width,
          height: entry.height,
        });
        expect(file.model, entry.file).toContain(TAGLINE);
      }
    }
    expect(total).toBeLessThanOrEqual(BUDGET_BYTES);
  });
});

describe('the command line', () => {
  it('prints its usage and its files without a browser, and refuses --render alone', () => {
    const help = runScript('exports.mjs', ['--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('usage: node scripts/exports.mjs');
    const list = runScript('exports.mjs', ['--list']);
    expect(list.status).toBe(0);
    expect(list.stdout.trim().split('\n')).toHaveLength(expectedFiles().length + 1);
    expect(list.stdout).toContain('docs/media/exports/manifest.json');
    expect(runScript('exports.mjs', ['--render']).status).toBe(2);
    expect(runScript('exports.mjs', ['--nope']).status).toBe(2);
  });

  it('passes its own check on the committed samples', () => {
    const check = runScript('exports.mjs', ['--check']);
    expect(check.stderr).toBe('');
    expect(check.status).toBe(0);
  });
});
