// SPDX-License-Identifier: MIT
// @ts-check
/**
 * The parts of `pnpm media` (scripts/media.mjs) that need no browser: the media list read from
 * website/src/data/media.json, the files a full run writes (by item: a still, a scene or a card), the staleness
 * inputs and their hash, each item's capture fingerprint, the manifest check, resampling captured frames to a fixed
 * frame rate, and the GIF assembly (one global palette, unchanged pixels transparent, repeated frames merged into one
 * longer frame). Plain ESM, Node built-ins only; the GIF encoder (gifenc) is passed in, so the tests can run the
 * assembly on synthetic frames.
 *
 * Staleness has two parts. The shared inputs (the demo app bundle, the fixtures, the tool versions, and the script
 * with every item's own capture code cut out) concern every file, so only a full run refreshes them. Each item's
 * fingerprint (its capture code and the fields of its entry in the media list that change its pixels) concerns its own
 * files only, and is recorded with each of them, so regenerating one item (`pnpm media --only scene:timeline`) after
 * changing only its capture leaves the check consistent without rewriting the others.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * @typedef {'light' | 'dark'} Theme
 * @typedef {{ id: string, title: string, alt: string }} StillSpec
 * @typedef {{ id: string, title: string, alt: string, seconds: number, posterAt: number }} SceneSpec
 * @typedef {{ id: string, heading: string, still: string }} SocialSpec
 * @typedef {{
 *   viewport: { width: number, height: number },
 *   themes: Theme[],
 *   web: { widths: number[], quality: number },
 *   animated: { width: number, fps: number, maxGifBytes: number, bitrate: number },
 *   social: { width: number, height: number, quality: number, theme: Theme },
 *   stills: StillSpec[],
 *   scenes: SceneSpec[],
 *   cards: SocialSpec[],
 * }} MediaConfig
 * @typedef {'still' | 'scene' | 'card'} ItemKind
 * @typedef {{ sha256: string, bytes: number, width?: number, height?: number, frames?: number, seconds?: number, item?: string }} OutputEntry
 * @typedef {{ bundle: string, fixtures: string, script: string, tools: Record<string, string> }} Inputs
 * @typedef {{ generator: string, inputsHash: string, inputs: Inputs, generatedOn: string, files: Record<string, OutputEntry> }} Manifest
 */

/** Where the media go, relative to the repository root, and the manifest's name inside it. */
export const MEDIA_DIR = 'docs/media';
export const MANIFEST = 'manifest.json';
/** The media list (ids, titles, alt texts); the website reads the same file. */
export const CONFIG_FILE = 'website/src/data/media.json';
/** The committed demo fixtures (packages/demo-data), an input of the staleness hash. */
export const FIXTURES_DIR = 'packages/demo-data/fixtures';
/**
 * The files whose text is "the script" in the shared staleness hash: scripts/media.mjs without the items' own capture
 * code (each item's fingerprint holds that), this file, the package lookup, and the media list's settings (its lists
 * of stills, scenes and cards go into the items' fingerprints instead; titles and alt texts change no pixel and
 * count nowhere).
 */
export const SCRIPT_FILES = Object.freeze([
  'scripts/media.mjs',
  'scripts/lib/media-core.mjs',
  'scripts/lib/dependency-versions.mjs',
  CONFIG_FILE,
]);
/** The script whose items' capture code is cut out of the shared hash. */
export const MEDIA_SCRIPT = 'scripts/media.mjs';
/**
 * The tools whose version changes the output, resolved for the website package: the capture, the encoders, and
 * the Roboto files the link-preview cards are set in.
 */
export const TOOLS = Object.freeze(['playwright', 'gifenc', 'mediabunny', 'pngjs', '@fontsource/roboto']);
/** Centiseconds the last frame of every GIF stays before the loop starts again (a loop is the scene plus this). */
export const GIF_HOLD = 50;

/** @param {unknown} value @param {string} what @returns {asserts value is Record<string, unknown>} */
function assertObject(value, what) {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`${CONFIG_FILE}: ${what} must be an object`);
}

/** @param {Record<string, unknown>} item @param {string} key @param {string} what @returns {string} */
function text(item, key, what) {
  const value = item[key];
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`${CONFIG_FILE}: ${what}.${key} must be a non-empty string`);
  return value;
}

/** @param {Record<string, unknown>} item @param {string} key @param {string} what @returns {number} */
function positive(item, key, what) {
  const value = item[key];
  if (typeof value !== 'number' || !(value > 0))
    throw new Error(`${CONFIG_FILE}: ${what}.${key} must be a positive number`);
  return value;
}

/** @param {unknown} list @param {string} what @returns {Record<string, unknown>[]} */
function objects(list, what) {
  if (!Array.isArray(list) || list.length === 0)
    throw new Error(`${CONFIG_FILE}: ${what} must be a non-empty list`);
  return list.map((item, index) => {
    assertObject(item, `${what}[${String(index)}]`);
    return item;
  });
}

/**
 * Validates the media list (website/src/data/media.json).
 * @param {unknown} raw
 * @returns {MediaConfig}
 */
export function parseConfig(raw) {
  assertObject(raw, 'the file');
  const viewport = raw.viewport;
  assertObject(viewport, 'viewport');
  const web = raw.web;
  assertObject(web, 'web');
  const animated = raw.animated;
  assertObject(animated, 'animated');
  const social = raw.social;
  assertObject(social, 'social');
  const themes = raw.themes;
  if (
    !Array.isArray(themes) ||
    themes.length === 0 ||
    !themes.every((theme) => theme === 'light' || theme === 'dark')
  ) {
    throw new Error(`${CONFIG_FILE}: themes must list light and/or dark`);
  }
  const widths = web.widths;
  if (
    !Array.isArray(widths) ||
    widths.length === 0 ||
    !widths.every((width) => Number.isInteger(width) && width > 0)
  ) {
    throw new Error(`${CONFIG_FILE}: web.widths must be positive integers`);
  }
  const socialTheme = social.theme;
  if (socialTheme !== 'light' && socialTheme !== 'dark')
    throw new Error(`${CONFIG_FILE}: social.theme must be light or dark`);
  /** @type {MediaConfig} */
  const config = {
    viewport: {
      width: positive(viewport, 'width', 'viewport'),
      height: positive(viewport, 'height', 'viewport'),
    },
    themes: themes.map((/** @type {unknown} */ theme) => (theme === 'dark' ? 'dark' : 'light')),
    web: {
      widths: widths.map((/** @type {unknown} */ width) => Number(width)),
      quality: positive(web, 'quality', 'web'),
    },
    animated: {
      width: positive(animated, 'width', 'animated'),
      fps: positive(animated, 'fps', 'animated'),
      maxGifBytes: positive(animated, 'maxGifBytes', 'animated'),
      bitrate: positive(animated, 'bitrate', 'animated'),
    },
    social: {
      width: positive(social, 'width', 'social'),
      height: positive(social, 'height', 'social'),
      quality: positive(social, 'quality', 'social'),
      theme: socialTheme,
    },
    stills: objects(raw.stills, 'stills').map((item, index) => ({
      id: text(item, 'id', `stills[${String(index)}]`),
      title: text(item, 'title', `stills[${String(index)}]`),
      alt: text(item, 'alt', `stills[${String(index)}]`),
    })),
    scenes: objects(raw.scenes, 'scenes').map((item, index) => ({
      id: text(item, 'id', `scenes[${String(index)}]`),
      title: text(item, 'title', `scenes[${String(index)}]`),
      alt: text(item, 'alt', `scenes[${String(index)}]`),
      seconds: positive(item, 'seconds', `scenes[${String(index)}]`),
      posterAt: positive(item, 'posterAt', `scenes[${String(index)}]`),
    })),
    cards: objects(raw.cards, 'cards').map((item, index) => ({
      id: text(item, 'id', `cards[${String(index)}]`),
      heading: text(item, 'heading', `cards[${String(index)}]`),
      still: text(item, 'still', `cards[${String(index)}]`),
    })),
  };
  const stillIds = new Set(config.stills.map((still) => still.id));
  for (const [list, what] of /** @type {const} */ ([
    [config.stills, 'stills'],
    [config.scenes, 'scenes'],
    [config.cards, 'cards'],
  ])) {
    const ids = list.map((item) => item.id);
    const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
    if (duplicate !== undefined) throw new Error(`${CONFIG_FILE}: ${what} lists ${duplicate} twice`);
    for (const id of ids) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))
        throw new Error(`${CONFIG_FILE}: ${what} id ${id} is not kebab-case`);
    }
  }
  for (const card of config.cards) {
    if (!stillIds.has(card.still))
      throw new Error(`${CONFIG_FILE}: card ${card.id} names an unknown still ${card.still}`);
  }
  for (const scene of config.scenes) {
    if (scene.posterAt > scene.seconds)
      throw new Error(`${CONFIG_FILE}: scene ${scene.id}: posterAt is after its end`);
  }
  return config;
}

/** @param {string} root @returns {MediaConfig} */
export function readConfig(root) {
  return parseConfig(JSON.parse(readFileSync(path.join(root, CONFIG_FILE), 'utf8')));
}

/** The path (under docs/media/) of each kind of output. */
export const paths = Object.freeze({
  /** @param {string} id @param {Theme} theme */
  still: (id, theme) => `stills/${id}-${theme}.png`,
  /** @param {string} id @param {Theme} theme @param {number} width */
  web: (id, theme, width) => `web/${id}-${theme}-${String(width)}.webp`,
  /** @param {string} id @param {Theme} theme */
  gif: (id, theme) => `animated/${id}-${theme}.gif`,
  /** @param {string} id @param {Theme} theme */
  webm: (id, theme) => `animated/${id}-${theme}.webm`,
  /** @param {string} id @param {Theme} theme */
  poster: (id, theme) => `animated/${id}-${theme}-poster.webp`,
  /** @param {string} id */
  card: (id) => `social/${id}.jpg`,
});

/** An item of the media list as `--only` and the manifest's messages name it: "scene:timeline". */
export function itemKey(/** @type {ItemKind} */ kind, /** @type {string} */ id) {
  return `${kind}:${id}`;
}

/**
 * Every file a full run writes, relative to docs/media/, by item ("still:hero", "scene:trace", "card:home"), each
 * item's files sorted.
 * @param {MediaConfig} config
 * @returns {Map<string, string[]>}
 */
export function outputsByItem(config) {
  /** @type {Map<string, string[]>} */
  const items = new Map();
  /** @param {string} key @param {string[]} files */
  const add = (key, files) => {
    items.set(key, [...(items.get(key) ?? []), ...files]);
  };
  for (const theme of config.themes) {
    for (const still of config.stills) {
      add(itemKey('still', still.id), [
        paths.still(still.id, theme),
        ...config.web.widths.map((width) => paths.web(still.id, theme, width)),
      ]);
    }
    for (const scene of config.scenes) {
      add(itemKey('scene', scene.id), [
        paths.gif(scene.id, theme),
        paths.webm(scene.id, theme),
        paths.poster(scene.id, theme),
      ]);
    }
  }
  for (const card of config.cards) add(itemKey('card', card.id), [paths.card(card.id)]);
  for (const [key, files] of items) items.set(key, files.sort());
  return items;
}

/**
 * Every file a full run writes, relative to docs/media/, sorted.
 * @param {MediaConfig} config
 * @returns {string[]}
 */
export function expectedOutputs(config) {
  return [...outputsByItem(config).values()].flat().sort();
}

/** @param {Buffer | string} data @returns {string} */
export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * The hash of a directory tree: every file's path (relative, with forward slashes) and content hash, sorted.
 * @param {string} dir
 * @returns {string}
 */
export function treeHash(dir) {
  /** @type {string[]} */
  const lines = [];
  /** @param {string} current */
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      const file = path.join(current, name);
      if (statSync(file).isDirectory()) walk(file);
      else lines.push(`${path.relative(dir, file).split(path.sep).join('/')}\0${sha256(readFileSync(file))}`);
    }
  };
  walk(dir);
  return sha256(lines.join('\n'));
}

/**
 * Script text without its comment lines: lines that are a `//` comment, and `/* … *\/` comments that start a line
 * and end one. A comment changes no pixel, so editing one never makes the media stale. A comment after code on the
 * same line stays (stripping it would need a parser: `//` also occurs in strings).
 * @param {string} text
 */
export function withoutCommentLines(text) {
  /** @type {string[]} */
  const kept = [];
  let inBlock = false;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false;
      continue;
    }
    if (trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlock = true;
      else if (!trimmed.endsWith('*/')) kept.push(line);
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

/**
 * The text of scripts/media.mjs with each item's capture code (`captures`: the source text of its functions, as
 * Function.prototype.toString returns it) replaced by one marker, and without comment lines. The marker does not name
 * the item: two items may share a function's text (two scenes that open the same view), and changing one of them
 * must not change the rest. A capture that is not in the text is an error: the hash would silently include it.
 * @param {string} text @param {Readonly<Record<string, readonly string[]>>} captures
 */
export function sharedScriptText(text, captures) {
  const sources = Object.keys(captures)
    .sort()
    .flatMap((key) =>
      (captures[key] ?? []).map((source) => {
        if (!text.includes(source))
          throw new Error(`${MEDIA_SCRIPT}: the capture code of ${key} is not in the file`);
        return source;
      }),
    )
    // Longest first, so a function whose text holds another's is cut out whole.
    .sort((a, b) => b.length - a.length);
  let shared = text;
  for (const source of sources) shared = shared.split(source).join('/* item capture */');
  return withoutCommentLines(shared);
}

/**
 * The media list's settings: the file without its lists of stills, scenes and cards.
 * @param {string} text
 */
export function sharedConfigText(text) {
  /** @type {unknown} */
  const raw = JSON.parse(text);
  assertObject(raw, 'the file');
  const lists = new Set(['stills', 'scenes', 'cards']);
  return JSON.stringify(Object.fromEntries(Object.entries(raw).filter(([key]) => !lists.has(key))));
}

/**
 * The shared staleness inputs: the demo app bundle the media are captured from (a production build in demo mode), the
 * demo fixtures, the script (scripts/media.mjs without the items' capture code, this file, the package lookup,
 * the media list's settings), and the versions of the capture and encoding tools.
 * @param {{ root: string, appDir: string, toolVersion: (name: string) => string, captures?: Readonly<Record<string, readonly string[]>> }} options
 * @returns {Inputs}
 */
export function computeInputs({ root, appDir, toolVersion, captures = {} }) {
  const fixtures = path.join(root, FIXTURES_DIR);
  /** @param {string} file */
  const shared = (file) => {
    const text = readFileSync(path.join(root, file), 'utf8');
    if (file === MEDIA_SCRIPT) return sharedScriptText(text, captures);
    if (file === CONFIG_FILE) return sharedConfigText(text);
    return withoutCommentLines(text);
  };
  return {
    bundle: treeHash(appDir),
    fixtures: existsSync(fixtures) ? treeHash(fixtures) : 'none',
    script: sha256(SCRIPT_FILES.map((file) => `${file}\0${sha256(shared(file))}`).join('\n')),
    tools: Object.fromEntries(TOOLS.map((name) => [name, toolVersion(name)])),
  };
}

/**
 * Each item's fingerprint: what makes its own files, outside the shared inputs. A still: its capture code. A scene:
 * its capture code (prepare and play), its length and its poster's moment. A card: its heading, and its still's
 * fingerprint (the card is composed from that still). Comment lines in the capture code do not count.
 * @param {MediaConfig} config @param {Readonly<Record<string, readonly string[]>>} captures
 * @returns {Record<string, string>}
 */
export function itemFingerprints(config, captures) {
  /** @type {Record<string, string>} */
  const fingerprints = {};
  /** @param {string} key */
  const capture = (key) => {
    const sources = captures[key];
    if (sources === undefined || sources.length === 0) throw new Error(`media: no capture code for ${key}`);
    return sources.map((source) => withoutCommentLines(source));
  };
  for (const still of config.stills) {
    const key = itemKey('still', still.id);
    fingerprints[key] = sha256([key, ...capture(key)].join('\0'));
  }
  for (const scene of config.scenes) {
    const key = itemKey('scene', scene.id);
    fingerprints[key] = sha256(
      [key, `seconds ${String(scene.seconds)}`, `poster ${String(scene.posterAt)}`, ...capture(key)].join(
        '\0',
      ),
    );
  }
  for (const card of config.cards) {
    const key = itemKey('card', card.id);
    const still = fingerprints[itemKey('still', card.still)] ?? '';
    fingerprints[key] = sha256([key, `heading ${card.heading}`, `still ${card.still} ${still}`].join('\0'));
  }
  return fingerprints;
}

/** @param {Inputs} inputs @returns {string} */
export function inputsHash(inputs) {
  const tools = Object.keys(inputs.tools)
    .sort()
    .map((name) => `${name}@${inputs.tools[name] ?? ''}`);
  return sha256(
    [`bundle ${inputs.bundle}`, `fixtures ${inputs.fixtures}`, `script ${inputs.script}`, ...tools].join(
      '\n',
    ),
  );
}

/** The folders under docs/media/ a run writes into; anything else there is not the generator's. */
export const OUTPUT_DIRS = Object.freeze(['stills', 'web', 'animated', 'social']);

/**
 * The files in the output folders of a media directory, relative to it, sorted.
 * @param {string} mediaDir
 * @returns {string[]}
 */
export function presentOutputs(mediaDir) {
  return OUTPUT_DIRS.flatMap((dir) => {
    const full = path.join(mediaDir, dir);
    if (!existsSync(full)) return [];
    return readdirSync(full)
      .filter((name) => statSync(path.join(full, name)).isFile())
      .map((name) => `${dir}/${name}`);
  }).sort();
}

/**
 * What makes the committed media stale: a changed shared input, an item whose fingerprint differs from the one its
 * files were made with (`fingerprints`, when given: its capture code or its entry changed), a file a full run writes
 * that the manifest does not list or that is missing or differs from the manifest (edited by hand), a listed file a
 * full run no longer writes, and a file in an output folder that no run writes (`present`, when given).
 * An empty list means fresh.
 * @param {{ manifest: Manifest | undefined, inputs: Inputs, expected: string[], readOutput: (file: string) => Buffer | undefined, present?: string[], items?: Map<string, string[]>, fingerprints?: Readonly<Record<string, string>> }} options
 * @returns {string[]}
 */
export function staleness({ manifest, inputs, expected, readOutput, present = [], items, fingerprints }) {
  if (manifest === undefined) return [`no ${MEDIA_DIR}/${MANIFEST}: run \`pnpm media\``];
  /** @type {string[]} */
  const problems = [];
  if (manifest.inputsHash !== inputsHash(inputs)) {
    if (manifest.inputs.bundle !== inputs.bundle)
      problems.push('the demo app bundle changed (frontend/ or a package it bundles)');
    if (manifest.inputs.fixtures !== inputs.fixtures)
      problems.push(`the demo fixtures changed (${FIXTURES_DIR})`);
    if (manifest.inputs.script !== inputs.script)
      problems.push(`the media script or its list changed (${SCRIPT_FILES.join(', ')})`);
    for (const [name, version] of Object.entries(inputs.tools)) {
      if (manifest.inputs.tools[name] !== version) {
        problems.push(`${name} changed (${manifest.inputs.tools[name] ?? 'none'} → ${version})`);
      }
    }
    if (problems.length === 0) problems.push('the inputs hash differs');
  }
  if (items !== undefined && fingerprints !== undefined) {
    for (const [key, files] of items) {
      const entries = files.flatMap((file) => manifest.files[file] ?? []);
      const outdated = entries.filter((entry) => entry.item !== fingerprints[key]);
      if (outdated.length === 0) continue;
      const which =
        outdated.length === files.length
          ? 'its files were'
          : `${String(outdated.length)} of its ${String(files.length)} files were`;
      problems.push(
        outdated.every((entry) => entry.item === undefined)
          ? `the manifest records no capture fingerprint for ${key}: run \`pnpm media --only ${key}\``
          : `the capture of ${key} changed since ${which} made (scripts/media.mjs or its entry in the media list): run \`pnpm media --only ${key}\``,
      );
    }
  }
  for (const file of expected) {
    const entry = manifest.files[file];
    if (entry === undefined) {
      problems.push(`${file} is not in the manifest`);
      continue;
    }
    const data = readOutput(file);
    if (data === undefined) problems.push(`${file} is missing`);
    else if (sha256(data) !== entry.sha256)
      problems.push(`${file} differs from the manifest (edited by hand?)`);
  }
  for (const file of Object.keys(manifest.files)) {
    if (!expected.includes(file)) problems.push(`${file} is listed but no longer generated`);
  }
  for (const file of present) {
    if (!expected.includes(file) && manifest.files[file] === undefined) {
      problems.push(`${file} is not generated by \`pnpm media\` (delete it, or add it to the media list)`);
    }
  }
  return problems;
}

/**
 * Picks, for each tick of a fixed frame rate, the newest captured frame taken at or before it.
 * @template T
 * @param {{ t: number, frame: T }[]} captured  frames with their capture time in ms from the start, in order
 * @param {number} fps
 * @param {number} seconds  the length of the result
 * @returns {T[]}
 */
export function resample(captured, fps, seconds) {
  if (captured.length === 0) throw new Error('resample: no frames were captured');
  const count = Math.max(1, Math.round(seconds * fps));
  /** @type {T[]} */
  const frames = [];
  let next = 0;
  for (let index = 0; index < count; index += 1) {
    const at = (index * 1000) / fps;
    while (next + 1 < captured.length && (captured[next + 1]?.t ?? Infinity) <= at) next += 1;
    const pick = captured[next];
    if (pick === undefined) throw new Error('resample: frame lost');
    frames.push(pick.frame);
  }
  return frames;
}

/**
 * The delay of each frame in GIF centiseconds for a frame rate, so the total stays exact (8 and 9 cs alternate at 12
 * frames per second instead of a drifting 8).
 * @param {number} count
 * @param {number} fps
 * @returns {number[]}
 */
export function gifDelays(count, fps) {
  /** @type {number[]} */
  const delays = [];
  for (let index = 0; index < count; index += 1) {
    delays.push(Math.round(((index + 1) * 100) / fps) - Math.round((index * 100) / fps));
  }
  return delays;
}

/**
 * @typedef {{
 *   GIFEncoder: () => { writeFrame: (index: Uint8Array, width: number, height: number, options: Record<string, unknown>) => void, finish: () => void, bytes: () => Uint8Array },
 *   quantize: (rgba: Uint8Array, maxColors: number, options?: Record<string, unknown>) => number[][],
 *   applyPalette: (rgba: Uint8Array, palette: number[][], format?: string) => Uint8Array,
 * }} GifEncoderApi
 */

/**
 * Assembles an animated GIF from RGBA frames of one size, shown at `fps`: one palette for the whole animation
 * (quantised from up to eight frames spread over it, so colours never flicker), every pixel that did not change since
 * the previous frame transparent (it then compresses to almost nothing), and a frame equal to the one before merged
 * into it as a longer delay. `hold` adds centiseconds to the last frame before the loop starts again.
 * @param {{ frames: Uint8Array[], width: number, height: number, fps: number, colors: number, hold?: number, gif: GifEncoderApi }} options
 * @returns {{ bytes: Uint8Array, written: number }}
 */
export function assembleGif({ frames, width, height, fps, colors, hold = 0, gif }) {
  if (frames.length === 0) throw new Error('assembleGif: no frames');
  if (colors < 2 || colors > 255)
    throw new Error('assembleGif: colors must be 2 to 255 (one index stays transparent)');
  const size = width * height * 4;
  for (const frame of frames) {
    if (frame.length !== size) throw new Error('assembleGif: every frame must be width × height RGBA');
  }
  const sampleCount = Math.min(8, frames.length);
  const sample = new Uint8Array(size * sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const frame = frames[Math.floor((index * frames.length) / sampleCount)];
    if (frame !== undefined) sample.set(frame, index * size);
  }
  const palette = gif.quantize(sample, colors, { format: 'rgb565' });
  const transparentIndex = palette.length;
  // The transparent entry's colour never shows; the table is padded to the 256 entries of an 8-bit table.
  const table = [...palette];
  while (table.length < 256) table.push([255, 0, 255]);

  const delays = gifDelays(frames.length, fps);
  /** @type {{ index: Uint8Array, delay: number }[]} */
  const merged = [];
  /** @type {Uint8Array | undefined} */
  let previous;
  frames.forEach((frame, i) => {
    const index = gif.applyPalette(frame, palette, 'rgb565');
    const last = merged[merged.length - 1];
    if (previous !== undefined && last !== undefined && sameIndices(index, previous)) {
      last.delay += delays[i] ?? 0;
      return;
    }
    merged.push({ index, delay: delays[i] ?? 0 });
    previous = index;
  });
  const lastFrame = merged[merged.length - 1];
  if (lastFrame !== undefined) lastFrame.delay += hold;

  const encoder = gif.GIFEncoder();
  /** @type {Uint8Array | undefined} */
  let shown;
  for (const { index, delay } of merged) {
    let pixels = index;
    if (shown !== undefined) {
      pixels = new Uint8Array(index.length);
      for (let p = 0; p < index.length; p += 1)
        pixels[p] = index[p] === shown[p] ? transparentIndex : (index[p] ?? 0);
    }
    // The first frame carries the palette as the global colour table; the others use it.
    encoder.writeFrame(pixels, width, height, {
      ...(shown === undefined ? { palette: table } : {}),
      delay: delay * 10,
      transparent: shown !== undefined,
      transparentIndex,
      dispose: 1,
    });
    shown = index;
  }
  encoder.finish();
  return { bytes: encoder.bytes(), written: merged.length };
}

/** @param {Uint8Array} a @param {Uint8Array} b */
function sameIndices(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
