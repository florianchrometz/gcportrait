// SPDX-License-Identifier: MIT
/**
 * scripts/media.mjs and scripts/lib/media-core.mjs: the media list, the files a run writes, the
 * staleness inputs and check, the frame resampling and the GIF assembly, without a browser; and the command line's
 * usage paths that need none (--help, --list, refusals).
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GIF_HOLD,
  assembleGif,
  computeInputs,
  expectedOutputs,
  gifDelays,
  inputsHash,
  itemFingerprints,
  outputsByItem,
  parseConfig,
  presentOutputs,
  readConfig,
  resample,
  sha256,
  sharedConfigText,
  sharedScriptText,
  staleness,
  withoutCommentLines,
  treeHash,
  type GifEncoderApi,
  type Manifest,
} from './lib/media-core.mjs';
import { CAPTURES, run as runMedia } from './media.mjs';
import {
  SCRIPTS_DIR,
  SPAWN_TIMEOUT,
  createTempTree,
  runInProcess,
  runScript,
  type TempTree,
} from './testing/temp-tree.js';

const REPO = path.resolve(SCRIPTS_DIR, '..');
const gif = createRequire(path.join(REPO, 'website', 'package.json'))('gifenc') as GifEncoderApi;

/** A minimal valid media list. */
function config(): Record<string, unknown> {
  return {
    viewport: { width: 1440, height: 900 },
    themes: ['light', 'dark'],
    web: { widths: [1440, 720], quality: 0.8 },
    animated: { width: 1200, fps: 12, maxGifBytes: 3145728, bitrate: 600000 },
    social: { width: 1200, height: 630, quality: 86, theme: 'light' },
    stills: [{ id: 'hero', title: 'Hero', alt: 'The hero.' }],
    scenes: [{ id: 'trace', title: 'Trace', alt: 'A trace.', seconds: 8, posterAt: 6 }],
    cards: [{ id: 'home', heading: 'Home', still: 'hero' }],
  };
}

/** The frames of a GIF and their delays (centiseconds), read block by block. */
function gifFrames(bytes: Uint8Array): { width: number; height: number; delays: number[] } {
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  if (header !== 'GIF89a') throw new Error(`not a GIF89a: ${header}`);
  const width = (bytes[6] ?? 0) | ((bytes[7] ?? 0) << 8);
  const height = (bytes[8] ?? 0) | ((bytes[9] ?? 0) << 8);
  const packed = bytes[10] ?? 0;
  let at = 13 + (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0);
  const skipSubBlocks = (): void => {
    while ((bytes[at] ?? 0) !== 0) at += (bytes[at] ?? 0) + 1;
    at += 1;
  };
  const delays: number[] = [];
  let delay = 0;
  for (;;) {
    const block = bytes[at];
    if (block === 0x3b || block === undefined) break;
    if (block === 0x21) {
      const label = bytes[at + 1];
      if (label === 0xf9) delay = (bytes[at + 4] ?? 0) | ((bytes[at + 5] ?? 0) << 8);
      at += 2;
      skipSubBlocks();
    } else if (block === 0x2c) {
      const local = bytes[at + 9] ?? 0;
      at += 10 + (local & 0x80 ? 3 * 2 ** ((local & 7) + 1) : 0);
      at += 1; // LZW minimum code size
      skipSubBlocks();
      delays.push(delay);
    } else {
      throw new Error(`unexpected block 0x${block.toString(16)} at ${String(at)}`);
    }
  }
  return { width, height, delays };
}

/** A width × height RGBA frame filled with one colour, with an optional square of another. */
function frame(
  width: number,
  height: number,
  colour: number[],
  square?: { x: number; colour: number[] },
): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p += 1) {
    const x = p % width;
    const c =
      square !== undefined && x >= square.x && x < square.x + 4 && Math.floor(p / width) < 4
        ? square.colour
        : colour;
    data.set([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, 255], p * 4);
  }
  return data;
}

describe('the media list (website/src/data/media.json)', () => {
  it('reads the repository’s list: stills, scenes and cards with unique ids, in both themes', () => {
    const list = readConfig(REPO);
    expect(list.themes).toEqual(['light', 'dark']);
    expect(list.viewport).toEqual({ width: 1440, height: 900 });
    for (const items of [list.stills, list.scenes, list.cards]) {
      const ids = items.map((item) => item.id);
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size, ids.join(', ')).toBe(ids.length);
    }
    // Every card's link preview is one of the stills.
    const stills = new Set(list.stills.map((still) => still.id));
    for (const card of list.cards) expect(stills, card.id).toContain(card.still);
    for (const scene of list.scenes) {
      // 6 to 12.5 s per loop, the GIF's hold on the last frame included (the timeline scene's close-ups of its last
      // day take it to 12 s).
      expect(scene.seconds).toBeGreaterThanOrEqual(6);
      expect(scene.seconds + GIF_HOLD / 100).toBeLessThanOrEqual(12.5);
    }
    expect(list.animated.maxGifBytes).toBeLessThanOrEqual(3 * 1024 * 1024);
  });

  it('refuses an unknown still on a card, a duplicate id, a poster after the end and a theme it does not know', () => {
    const card = config();
    card.cards = [{ id: 'home', heading: 'Home', still: 'nope' }];
    expect(() => parseConfig(card)).toThrow(/unknown still nope/);
    const twice = config();
    twice.stills = [
      { id: 'hero', title: 'a', alt: 'a' },
      { id: 'hero', title: 'b', alt: 'b' },
    ];
    expect(() => parseConfig(twice)).toThrow(/lists hero twice/);
    const late = config();
    late.scenes = [{ id: 'trace', title: 'T', alt: 'A', seconds: 4, posterAt: 5 }];
    expect(() => parseConfig(late)).toThrow(/posterAt is after its end/);
    const theme = config();
    theme.themes = ['sepia'];
    expect(() => parseConfig(theme)).toThrow(/themes/);
  });

  it('names every file a full run writes', () => {
    const files = expectedOutputs(parseConfig(config()));
    expect(files).toEqual([
      'animated/trace-dark-poster.webp',
      'animated/trace-dark.gif',
      'animated/trace-dark.webm',
      'animated/trace-light-poster.webp',
      'animated/trace-light.gif',
      'animated/trace-light.webm',
      'social/home.jpg',
      'stills/hero-dark.png',
      'stills/hero-light.png',
      'web/hero-dark-1440.webp',
      'web/hero-dark-720.webp',
      'web/hero-light-1440.webp',
      'web/hero-light-720.webp',
    ]);
    expect([...outputsByItem(parseConfig(config())).entries()]).toEqual([
      [
        'still:hero',
        [
          'stills/hero-dark.png',
          'stills/hero-light.png',
          'web/hero-dark-1440.webp',
          'web/hero-dark-720.webp',
          'web/hero-light-1440.webp',
          'web/hero-light-720.webp',
        ],
      ],
      [
        'scene:trace',
        [
          'animated/trace-dark-poster.webp',
          'animated/trace-dark.gif',
          'animated/trace-dark.webm',
          'animated/trace-light-poster.webp',
          'animated/trace-light.gif',
          'animated/trace-light.webm',
        ],
      ],
      ['card:home', ['social/home.jpg']],
    ]);
  });
});

describe('capture fingerprints', () => {
  const captures = {
    'still:hero': ['async (page) => { await shoot(page, "hero"); }'],
    'scene:trace': [
      'async (page) => { await open(page); }',
      'async (director) => { await director.pause(1); }',
    ],
  };

  it('fingerprints each item by its capture code and the fields that change its pixels, not by its words', () => {
    const list = parseConfig(config());
    const before = itemFingerprints(list, captures);
    expect(Object.keys(before)).toEqual(['still:hero', 'scene:trace', 'card:home']);
    const reworded = config();
    reworded.stills = [{ id: 'hero', title: 'Another title', alt: 'Another alt text.' }];
    reworded.scenes = [{ id: 'trace', title: 'T', alt: 'Other words.', seconds: 8, posterAt: 6 }];
    expect(itemFingerprints(parseConfig(reworded), captures)).toEqual(before);
    const longer = config();
    longer.scenes = [{ id: 'trace', title: 'Trace', alt: 'A trace.', seconds: 9, posterAt: 6 }];
    const afterLonger = itemFingerprints(parseConfig(longer), captures);
    expect(afterLonger['scene:trace']).not.toBe(before['scene:trace']);
    expect(afterLonger['still:hero']).toBe(before['still:hero']);
    const played = itemFingerprints(list, {
      ...captures,
      'scene:trace': [
        'async (page) => { await open(page); }',
        'async (director) => { await director.pause(2); }',
      ],
    });
    expect(played['scene:trace']).not.toBe(before['scene:trace']);
    expect(played['still:hero']).toBe(before['still:hero']);
    // A card is composed from its still: it follows the still's fingerprint.
    const shot = itemFingerprints(list, {
      ...captures,
      'still:hero': ['async (page) => { await other(page); }'],
    });
    expect(shot['card:home']).not.toBe(before['card:home']);
    expect(() => itemFingerprints(list, { 'still:hero': captures['still:hero'] })).toThrow(
      /no capture code for scene:trace/,
    );
  });

  it('has the capture code of every still and scene of the media list, and cuts all of it out of the script', () => {
    const list = readConfig(REPO);
    expect(Object.keys(CAPTURES).sort()).toEqual(
      [
        ...list.stills.map((still) => `still:${still.id}`),
        ...list.scenes.map((scene) => `scene:${scene.id}`),
      ].sort(),
    );
    const fingerprints = itemFingerprints(list, CAPTURES);
    expect(new Set(Object.values(fingerprints)).size).toBe(Object.keys(fingerprints).length);
    // In Node itself: Vitest's transform reformats the functions, so their text is not the file's here.
    const probe = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        [
          `import { readFileSync } from 'node:fs';`,
          `import { CAPTURES } from ${JSON.stringify(pathToFileURL(path.join(SCRIPTS_DIR, 'media.mjs')).href)};`,
          `import { sharedScriptText } from ${JSON.stringify(pathToFileURL(path.join(SCRIPTS_DIR, 'lib', 'media-core.mjs')).href)};`,
          `process.stdout.write(sharedScriptText(readFileSync(${JSON.stringify(path.join(SCRIPTS_DIR, 'media.mjs'))}, 'utf8'), CAPTURES));`,
        ].join('\n'),
      ],
      { encoding: 'utf8' },
    );
    expect(probe.stderr).toBe('');
    expect(probe.stdout).toContain('/* item capture */');
    expect(probe.stdout).toContain('const SCENES = {');
    expect(probe.stdout).not.toContain('frameNode(page, nodeSelector(DEMO.httpsRule)');
    expect(probe.stdout).not.toContain("'10.0.14.5'");
  });

  it('cuts every item’s capture code out of the shared script, so changing one item leaves the shared hash alone', () => {
    const text = (pause: number): string =>
      [
        'const shared = 1;',
        'const STILLS = { hero: async (page) => { await shoot(page, "hero"); } };',
        `const SCENES = { trace: { prepare: async (page) => { await open(page); }, play: async (director) => { await director.pause(${String(pause)}); } } };`,
        // Another scene with the same prepare: one marker for both, whichever item it is attributed to.
        'const MORE = { prepare: async (page) => { await open(page); } };',
      ].join('\n');
    const shared = sharedScriptText(text(1), captures);
    expect(shared).toContain('const shared = 1;');
    expect(shared).not.toContain('shoot(page');
    expect(shared).not.toContain('open(page)');
    expect(shared.match(/\/\* item capture \*\//g)).toHaveLength(4);
    const changed = {
      ...captures,
      'scene:trace': [
        'async (page) => { await open(page); }',
        'async (director) => { await director.pause(2); }',
      ],
    };
    expect(sharedScriptText(text(2), changed)).toBe(shared);
    expect(() => sharedScriptText('const nothing = 0;', captures)).toThrow(
      /capture code of scene:trace is not in the file/,
    );
    // Comment lines change no pixel: rewording one, outside or inside a capture, changes no hash.
    expect(sharedScriptText(`// The scene's story, reworded.\n${text(1)}`, captures)).toBe(shared);
    expect(
      withoutCommentLines(
        [
          'a();',
          '  // one',
          '  /**',
          '   * two',
          '   */',
          '  /** @type {X} */ (b);',
          '/* three */',
          "c('http://x');",
        ].join('\n'),
      ),
    ).toBe(['a();', '  /** @type {X} */ (b);', "c('http://x');"].join('\n'));
    const commented = itemFingerprints(parseConfig(config()), {
      ...captures,
      'still:hero': ['async (page) => {\n  // Why the hero shows S.\n  await shoot(page, "hero");\n}'],
    });
    const plain = itemFingerprints(parseConfig(config()), {
      ...captures,
      'still:hero': ['async (page) => {\n  await shoot(page, "hero");\n}'],
    });
    expect(commented['still:hero']).toBe(plain['still:hero']);
    // The media list's settings are shared; its lists (and their words) are not.
    const settings = sharedConfigText(JSON.stringify(config()));
    expect(settings).toContain('"viewport"');
    expect(settings).not.toContain('"stills"');
    const reworded = config();
    reworded.stills = [{ id: 'hero', title: 'Other', alt: 'Other.' }];
    expect(sharedConfigText(JSON.stringify(reworded))).toBe(settings);
  });
});

describe('staleness', () => {
  let tree: TempTree;
  beforeEach(() => {
    tree = createTempTree('media');
    tree.write('app/index.html', '<html></html>');
    tree.write('app/assets/index-abc.js', 'console.log(1)');
    tree.write('packages/demo-data/fixtures/S.ndjson', '{}\n');
    for (const file of [
      'scripts/media.mjs',
      'scripts/lib/media-core.mjs',
      'scripts/lib/dependency-versions.mjs',
    ])
      tree.write(file, file);
    tree.write('website/src/data/media.json', JSON.stringify(config()));
  });
  afterEach(() => {
    tree.remove();
  });

  const tools = (name: string): string => (name === 'gifenc' ? '1.0.3' : '1.0.0');
  /** The staleness inputs of the test's tree, its app in app/, with `extra` options. */
  const inputsOf = (extra: Partial<Parameters<typeof computeInputs>[0]> = {}) =>
    computeInputs({ root: tree.root, appDir: path.join(tree.root, 'app'), toolVersion: tools, ...extra });

  it('includes package lookup code in the shared hash but ignores its comments', () => {
    const file = 'scripts/lib/dependency-versions.mjs';
    const before = inputsOf();
    tree.write(file, `// Package lookup.\n${file}`);
    expect(inputsOf().script).toBe(before.script);
    tree.write(file, 'export const lookup = 1;');
    expect(inputsOf().script).not.toBe(before.script);
  });

  it('hashes the app bundle, the fixtures, the script and the tools, and notices a change in each', () => {
    const before = inputsOf();
    expect(inputsOf()).toEqual(before);
    tree.write('app/assets/index-abc.js', 'console.log(2)');
    const bundle = inputsOf();
    expect(bundle.bundle).not.toBe(before.bundle);
    expect(inputsHash(bundle)).not.toBe(inputsHash(before));
    tree.write('packages/demo-data/fixtures/S.ndjson', '{"a":1}\n');
    expect(inputsOf().fixtures).not.toBe(before.fixtures);
    tree.write('website/src/data/media.json', '{}');
    expect(inputsOf().script).not.toBe(before.script);
    expect(treeHash(path.join(tree.root, 'app'))).toBe(bundle.bundle);
    tree.write('media/social/home.jpg', 'x');
    tree.write('media/stills/hero-light.png', 'x');
    tree.write('media/manifest.json', '{}');
    expect(presentOutputs(path.join(tree.root, 'media'))).toEqual([
      'social/home.jpg',
      'stills/hero-light.png',
    ]);
  });

  it('leaves the items’ capture code out of the shared script hash', () => {
    const captures = { 'scene:trace': ['async () => { await play(1); }'] };
    tree.write(
      'scripts/media.mjs',
      'const shared = 1;\nconst SCENES = { trace: async () => { await play(1); } };\n',
    );
    const before = inputsOf({ captures });
    tree.write(
      'scripts/media.mjs',
      'const shared = 1;\nconst SCENES = { trace: async () => { await play(2); } };\n',
    );
    expect(inputsOf({ captures: { 'scene:trace': ['async () => { await play(2); }'] } }).script).toBe(
      before.script,
    );
    tree.write(
      'scripts/media.mjs',
      'const shared = 2;\nconst SCENES = { trace: async () => { await play(2); } };\n',
    );
    expect(inputsOf({ captures: { 'scene:trace': ['async () => { await play(2); }'] } }).script).not.toBe(
      before.script,
    );
  });

  it('is fresh when the inputs and the files match the manifest, and says what is stale otherwise', () => {
    const inputs = inputsOf();
    const files: Record<string, Buffer> = {
      'stills/a.png': Buffer.from('a'),
      'social/b.jpg': Buffer.from('b'),
    };
    const manifest: Manifest = {
      generator: 'test',
      inputsHash: inputsHash(inputs),
      inputs,
      generatedOn: '2026-10-11',
      files: Object.fromEntries(
        Object.entries(files).map(([file, data]) => [file, { sha256: sha256(data), bytes: data.length }]),
      ),
    };
    const expected = Object.keys(files).sort();
    const readOutput = (file: string): Buffer | undefined => files[file];
    expect(staleness({ manifest, inputs, expected, readOutput })).toEqual([]);
    expect(staleness({ manifest: undefined, inputs, expected, readOutput })).toEqual([
      'no docs/media/manifest.json: run `pnpm media`',
    ]);

    const changed = { ...inputs, bundle: 'other', tools: { ...inputs.tools, gifenc: '2.0.0' } };
    expect(staleness({ manifest, inputs: changed, expected, readOutput })).toEqual([
      'the demo app bundle changed (frontend/ or a package it bundles)',
      'gifenc changed (1.0.3 → 2.0.0)',
    ]);
    files['stills/a.png'] = Buffer.from('edited');
    expect(staleness({ manifest, inputs, expected: [...expected, 'web/c.webp'], readOutput })).toEqual([
      'stills/a.png differs from the manifest (edited by hand?)',
      'web/c.webp is not in the manifest',
    ]);
    expect(staleness({ manifest, inputs, expected: ['social/b.jpg'], readOutput })).toEqual([
      'stills/a.png is listed but no longer generated',
    ]);
    expect(
      staleness({ manifest, inputs, expected, readOutput, present: [...expected, 'social/old.jpg'] }),
    ).toEqual([
      'stills/a.png differs from the manifest (edited by hand?)',
      'social/old.jpg is not generated by `pnpm media` (delete it, or add it to the media list)',
    ]);
  });

  it('names an item whose capture changed, and is fresh once that item alone is made again', () => {
    const inputs = inputsOf();
    const files: Record<string, Buffer> = {
      'animated/t-light.gif': Buffer.from('g'),
      'animated/t-dark.gif': Buffer.from('h'),
      'stills/a-light.png': Buffer.from('a'),
    };
    const items = new Map([
      ['scene:t', ['animated/t-dark.gif', 'animated/t-light.gif']],
      ['still:a', ['stills/a-light.png']],
    ]);
    const made = { 'scene:t': 'one', 'still:a': 'still' };
    const entry = (file: string, item: string | undefined) => ({
      sha256: sha256(files[file] ?? ''),
      bytes: 1,
      ...(item === undefined ? {} : { item }),
    });
    const manifest: Manifest = {
      generator: 'test',
      inputsHash: inputsHash(inputs),
      inputs,
      generatedOn: '2026-10-11',
      files: {
        'animated/t-dark.gif': entry('animated/t-dark.gif', made['scene:t']),
        'animated/t-light.gif': entry('animated/t-light.gif', made['scene:t']),
        'stills/a-light.png': entry('stills/a-light.png', undefined),
      },
    };
    const expected = Object.keys(files).sort();
    const readOutput = (file: string): Buffer | undefined => files[file];
    const check = (fingerprints: Record<string, string>): string[] =>
      staleness({ manifest, inputs, expected, readOutput, items, fingerprints });
    expect(check({ 'scene:t': 'two', 'still:a': 'still' })).toEqual([
      'the capture of scene:t changed since its files were made (scripts/media.mjs or its entry in the media list): run `pnpm media --only scene:t`',
      'the manifest records no capture fingerprint for still:a: run `pnpm media --only still:a`',
    ]);
    manifest.files['stills/a-light.png'] = entry('stills/a-light.png', 'still');
    // One theme made again with the new capture: the other is still behind.
    manifest.files['animated/t-light.gif'] = entry('animated/t-light.gif', 'two');
    expect(check({ 'scene:t': 'two', 'still:a': 'still' })).toEqual([
      'the capture of scene:t changed since 1 of its 2 files were made (scripts/media.mjs or its entry in the media list): run `pnpm media --only scene:t`',
    ]);
    manifest.files['animated/t-dark.gif'] = entry('animated/t-dark.gif', 'two');
    expect(check({ 'scene:t': 'two', 'still:a': 'still' })).toEqual([]);
  });
});

describe('frames', () => {
  it('resamples captured frames to a fixed rate, the newest frame at or before each tick', () => {
    const captured = [
      { t: 0, frame: 'a' },
      { t: 30, frame: 'b' },
      { t: 95, frame: 'c' },
      { t: 260, frame: 'd' },
    ];
    expect(resample(captured, 12, 0.25)).toEqual(['a', 'b', 'c']);
    expect(resample(captured, 10, 0.4)).toEqual(['a', 'c', 'c', 'd']);
    expect(() => resample([], 12, 1)).toThrow(/no frames/);
  });

  it('spreads GIF delays so the total stays exact', () => {
    const delays = gifDelays(12, 12);
    expect(delays.reduce((sum, delay) => sum + delay, 0)).toBe(100);
    expect(new Set(delays)).toEqual(new Set([8, 9]));
  });

  it('assembles a looping GIF: one palette, repeated frames merged, the end held', () => {
    const width = 16;
    const height = 8;
    const white = [255, 255, 255];
    const frames = [
      frame(width, height, white),
      frame(width, height, white),
      frame(width, height, white, { x: 4, colour: [26, 115, 232] }),
      frame(width, height, white, { x: 8, colour: [26, 115, 232] }),
    ];
    const { bytes, written } = assembleGif({ frames, width, height, fps: 12, colors: 255, hold: 50, gif });
    expect(written).toBe(3);
    const parsed = gifFrames(bytes);
    expect([parsed.width, parsed.height]).toEqual([16, 8]);
    expect(parsed.delays).toHaveLength(3);
    // 4 frames at 12 fps (8 + 9 + 8 + 8 cs), the first two merged, and 50 cs held at the end.
    expect(parsed.delays).toEqual([17, 8, 58]);
    expect(() =>
      assembleGif({ frames: [new Uint8Array(4)], width, height, fps: 12, colors: 255, gif }),
    ).toThrow(/width × height/);
    expect(() => assembleGif({ frames, width, height, fps: 12, colors: 256, gif })).toThrow(/2 to 255/);
  });
});

describe('the command line', () => {
  it('imports a runner without output or an exit-code change', async () => {
    const argv = process.argv;
    const exitCode = process.exitCode;
    process.argv = [process.execPath, path.join(SCRIPTS_DIR, 'media.test.ts')];
    vi.resetModules();
    try {
      const result = await runInProcess(async () => {
        const imported = await import('./media.mjs');
        expect(imported).toHaveProperty('run');
        return 0;
      });
      expect(result).toEqual({ status: 0, stdout: '', stderr: '' });
      expect(process.exitCode).toBe(exitCode);
    } finally {
      process.argv = argv;
      process.exitCode = exitCode;
      vi.resetModules();
    }
  });

  it('prints its usage and the list of files without a browser', async () => {
    const help = await runInProcess(() => runMedia(['--help']));
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('usage: pnpm media');
    const list = await runInProcess(() => runMedia(['--list']));
    expect(list.status).toBe(0);
    // Every file a full run writes for the repository's list, under docs/media/.
    expect(list.stdout.trim().split('\n').sort()).toEqual(
      expectedOutputs(readConfig(REPO))
        .map((file) => `docs/media/${file}`)
        .sort(),
    );
  });

  it(
    'matches the real CLI for a usage error and leaves subsequent calls independent',
    SPAWN_TIMEOUT,
    async () => {
      const args = ['--theme', 'sepia'];
      const result = await runInProcess(() => runMedia(args));
      expect(result.status).toBe(2);
      expect(result.stderr).toBe('media: --theme sepia: light or dark\n');
      expect(runScript('media.mjs', args)).toEqual(result);
      expect((await runInProcess(() => runMedia(['--help']))).status).toBe(0);
      expect(await runInProcess(() => runMedia(args))).toEqual(result);
    },
  );

  it('reports a non-usage failure with its stack and exit code 1', async () => {
    vi.doMock('./lib/media-core.mjs', async () => ({
      ...(await vi.importActual<typeof import('./lib/media-core.mjs')>('./lib/media-core.mjs')),
      readConfig: () => {
        throw new Error('synthetic media config failure');
      },
    }));
    vi.resetModules();
    try {
      const { run } = await import('./media.mjs');
      const result = await runInProcess(() => run(['--list']));
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('media: Error: synthetic media config failure');
      expect(result.stderr).toContain('\n    at ');
    } finally {
      vi.doUnmock('./lib/media-core.mjs');
      vi.resetModules();
    }
  });

  it('keeps parser usage errors concise and leaves the next call independent', async () => {
    const result = await runInProcess(() => runMedia(['--unknown-option']));
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe("media: Unknown option '--unknown-option'\n");
    expect((await runInProcess(() => runMedia(['--list']))).status).toBe(0);
  });

  const NO_SUCH_ITEM = 'no still, scene or card has this id';
  for (const { refused, args, message } of [
    {
      refused: 'an unknown option',
      args: ['--unknown-option'],
      message: "Unknown option '--unknown-option'",
    },
    {
      refused: 'a missing option value',
      args: ['--only'],
      message: "Option '--only <value>' argument missing",
    },
    { refused: 'a positional argument', args: ['unexpected'], message: "Unexpected argument 'unexpected'" },
    { refused: 'an id no item has', args: ['--only', 'nope'], message: `--only nope: ${NO_SUCH_ITEM}` },
    {
      refused: 'an id of another kind than it names (card:timeline)',
      args: ['--only', 'card:timeline'],
      message: `--only card:timeline: ${NO_SUCH_ITEM}`,
    },
    {
      refused: 'an id of another kind than it names (scene:hero)',
      args: ['--only', 'scene:hero'],
      message: `--only scene:hero: ${NO_SUCH_ITEM}`,
    },
    {
      refused: 'a theme other than light or dark',
      args: ['--theme', 'sepia'],
      message: '--theme sepia: light or dark',
    },
    {
      refused: '--check with a selection',
      args: ['--check', '--only', 'hero'],
      message: '--check compares everything; it takes no --only or --theme',
    },
  ]) {
    it(`refuses ${refused} with a usage error`, async () => {
      const result = await runInProcess(() => runMedia(args));
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(message);
      expect(result.stderr).not.toContain('TypeError');
      expect(result.stderr).not.toContain('\n    at ');
    });
  }
});
