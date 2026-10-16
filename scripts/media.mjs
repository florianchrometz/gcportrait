// SPDX-License-Identifier: MIT
// @ts-check
/**
 * `pnpm media`: the website's and the README's screenshots, animated demos and link-preview images, generated from
 * the app in demo mode (docs/website.md; synthetic data only, never a real organisation). Everything is
 * written to docs/media/ and committed, with docs/media/manifest.json recording the hash of what the media were made
 * from, so `pnpm media --check` (CI) says when they are stale.
 *
 *   pnpm media                       build the demo app, capture everything, write docs/media/ and the manifest
 *   pnpm media --check               build the demo app and compare the inputs and the files with the manifest
 *   pnpm media --only trace          only the still, scene or card with this id (repeatable; `scene:trace`,
 *                                    `still:trace` or `card:home` names one kind); the manifest keeps its shared
 *                                    inputs unless every output was regenerated, and records each file's fingerprint
 *   pnpm media --theme dark          only this theme (repeatable)
 *   pnpm media --skip-build          reuse out/media/app from the last run
 *   pnpm media --list                print the files a full run writes
 *
 * How: a production build of the app in demo mode (`VITE_DEMO=1 vite build` into out/media/app, git-ignored) served
 * by `vite preview`, driven by Playwright's Chromium at a fixed viewport of 1440×900, in UTC with British English
 * dates, in the light and the dark theme (the app follows the system colour scheme). The media list (ids, titles,
 * alt texts, lengths) is website/src/data/media.json, which the website reads too; what each still and scene does is
 * below (STILLS, SCENES).
 *
 * - Stills: PNG at 1440×900 (stills/<id>-<theme>.png, for the README and GitHub) and WebP at 1440 and 720 pixels wide
 *   (web/<id>-<theme>-<width>.webp, for the website).
 * - Animated demos: a scripted scene is played in real time while the page is captured as fast as it goes (about 30
 *   screenshots a second at 1200×750: the page keeps its 1440×900 layout at a device scale factor of 1200/1440), then
 *   resampled to 12 frames a second. A drawn pointer shows where the mouse is (headless screenshots have none).
 *   Encoded twice: an animated GIF (animated/<id>-<theme>.gif, at most 3 MiB, for the README and GitHub) with gifenc
 *   in Node (one palette, unchanged pixels transparent, repeated frames merged), and a VP9 WebM
 *   (animated/<id>-<theme>.webm, for the website's <video>) with the browser's WebCodecs encoder and Mediabunny's
 *   muxer, plus a WebP poster frame (animated/<id>-<theme>-poster.webp) shown before playback and instead of it when
 *   the visitor prefers reduced motion.
 * - Link-preview images: one 1200×630 JPEG per page of the website (social/<id>.jpg) composed from a still: the one
 *   captured in the same run, or else the committed one (stills/<id>-<theme>.png), so a card alone needs no capture.
 *
 * Staleness (scripts/lib/media-core.mjs): the manifest records the shared inputs of the last full run and, with each
 * file, its item's fingerprint (the item's capture code below and its entry's pixel-relevant fields). `--check` names
 * a changed shared input (a full run is due) or an item whose capture changed (`--only` that item is enough).
 *
 * The capture and the encoders are the website package's dev dependencies (playwright, gifenc, pngjs, mediabunny),
 * loaded from there; Chromium is Playwright's own (`pnpm --filter @gcportrait/e2e install-browsers` once).
 * Exit code 0 on success (and with --check when fresh), 1 on a failure or stale media, 2 on a usage error.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  GIF_HOLD,
  MANIFEST,
  MEDIA_DIR,
  assembleGif,
  computeInputs,
  expectedOutputs,
  inputsHash,
  itemFingerprints,
  itemKey,
  outputsByItem,
  paths,
  presentOutputs,
  readConfig,
  resample,
  sha256,
  staleness,
} from './lib/media-core.mjs';

/**
 * @typedef {import('./lib/media-core.mjs').Theme} Theme
 * @typedef {import('./lib/media-core.mjs').MediaConfig} MediaConfig
 * @typedef {import('./lib/media-core.mjs').Manifest} Manifest
 * @typedef {import('./lib/media-core.mjs').OutputEntry} OutputEntry
 * @typedef {import('./lib/media-core.mjs').GifEncoderApi} GifEncoderApi
 * @typedef {{ sync: { read: (data: Buffer) => { width: number, height: number, data: Buffer } } }} PngApi
 */

/**
 * The part of Playwright's API this script uses, declared here: Playwright is a dependency of the website package,
 * loaded from there at run time, so its own type declarations are not visible from scripts/. Code that runs in the
 * page is passed as a string expression (`page.evaluate('…')`), so no DOM types are needed here either.
 *
 * @typedef {{ x: number, y: number, width: number, height: number }} Box
 * @typedef {{ state?: 'attached' | 'visible' | 'hidden', timeout?: number }} WaitOptions
 * @typedef {{
 *   boundingBox: () => Promise<Box | null>,
 *   click: () => Promise<void>,
 *   waitFor: (options?: WaitOptions) => Promise<void>,
 *   first: () => Locator,
 *   locator: (selector: string) => Locator,
 *   getByRole: (role: string, options?: { name?: string, exact?: boolean, level?: number }) => Locator,
 *   and: (other: Locator) => Locator,
 *   filter: (options: { has: Locator }) => Locator,
 * }} Locator
 * @typedef {{
 *   move: (x: number, y: number, options?: { steps?: number }) => Promise<void>,
 *   down: () => Promise<void>,
 *   up: () => Promise<void>,
 *   wheel: (deltaX: number, deltaY: number) => Promise<void>,
 *   dblclick: (x: number, y: number, options?: { delay?: number }) => Promise<void>,
 * }} Mouse
 * @typedef {{ request: () => { url: () => string }, fulfill: (response: { body: string | Buffer, contentType: string }) => Promise<void> }} Route
 * @typedef {{
 *   goto: (url: string) => Promise<unknown>,
 *   evaluate: (expression: string) => Promise<unknown>,
 *   waitForFunction: (expression: string) => Promise<unknown>,
 *   waitForURL: (url: RegExp, options?: { timeout?: number }) => Promise<void>,
 *   screenshot: (options: { type: 'png' } | { type: 'jpeg', quality: number }) => Promise<Buffer>,
 *   setContent: (html: string) => Promise<void>,
 *   route: (url: string, handler: (route: Route) => Promise<void>) => Promise<void>,
 *   locator: (selector: string) => Locator,
 *   getByRole: (role: string, options?: { name?: string, exact?: boolean, level?: number }) => Locator,
 *   mouse: Mouse,
 *   keyboard: { press: (key: string) => Promise<void>, type: (text: string) => Promise<void> },
 *   clock: { setFixedTime: (time: Date) => Promise<void> },
 * }} Page
 * @typedef {{
 *   newPage: () => Promise<Page>,
 *   addInitScript: (script: string) => Promise<void>,
 *   close: () => Promise<void>,
 * }} BrowserContext
 * @typedef {{
 *   viewport?: { width: number, height: number }, deviceScaleFactor?: number, colorScheme?: Theme,
 *   timezoneId?: string, locale?: string, reducedMotion?: 'no-preference' | 'reduce',
 * }} ContextOptions
 * @typedef {{ newContext: (options?: ContextOptions) => Promise<BrowserContext>, close: () => Promise<void> }} Browser
 * @typedef {{ launch: () => Promise<Browser> }} Chromium
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, MEDIA_DIR);
const APP_DIR = path.join(ROOT, 'out', 'media', 'app');
const FRONTEND = path.join(ROOT, 'frontend');
/** The source link the demo build carries (its footer's "Source (MIT)"), fixed so the bundle hash is stable. */
const SOURCE_URL = 'https://github.com/florianchrometz/gcportrait';
/** The origin the encoder page is served from (answered by a Playwright route, nothing listens there). */
const ENCODER_ORIGIN = 'http://localhost:9';

const requireFromWebsite = createRequire(path.join(ROOT, 'website', 'package.json'));

/** A dependency of the website package (see the typedefs below for what is used of each). @returns {unknown} */
function websiteRequire(/** @type {string} */ name) {
  /** @type {unknown} */
  const module = requireFromWebsite(name);
  return module;
}

/** JSON.parse, typed as what it is: unknown until checked. @returns {unknown} */
function parseJson(/** @type {string} */ text) {
  /** @type {unknown} */
  const value = JSON.parse(text);
  return value;
}

/** A dependency's folder as pnpm links it for the website package (some packages export no package.json). */
function packageDir(/** @type {string} */ name) {
  const dir = path.join(ROOT, 'website', 'node_modules', name);
  if (!existsSync(path.join(dir, 'package.json'))) {
    throw new Error(`media: ${name} is not installed for the website package; run \`pnpm install\``);
  }
  return dir;
}

class UsageError extends Error {}

/** @param {string} name */
function toolVersion(name) {
  const manifest = /** @type {{ version?: unknown }} */ (
    parseJson(readFileSync(path.join(packageDir(name), 'package.json'), 'utf8'))
  );
  return typeof manifest.version === 'string' ? manifest.version : 'unknown';
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @param {string} message */
function log(message) {
  process.stdout.write(`media: ${message}\n`);
}

// ---------------------------------------------------------------------------------------------------------------
// The demo app: a production build in demo mode, served by vite preview.

function viteBin() {
  const frontendRequire = createRequire(path.join(FRONTEND, 'package.json'));
  return path.join(path.dirname(frontendRequire.resolve('vite/package.json')), 'bin', 'vite.js');
}

function buildApp() {
  log('building the app in demo mode (out/media/app)');
  execFileSync(
    process.execPath,
    [viteBin(), 'build', '--outDir', APP_DIR, '--emptyOutDir', '--logLevel', 'error'],
    {
      cwd: FRONTEND,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, VITE_DEMO: '1', VITE_SOURCE_URL: SOURCE_URL },
    },
  );
}

/** @returns {Promise<number>} */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

/** @returns {Promise<{ url: string, stop: () => void }>} */
async function startPreview() {
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [
      viteBin(),
      'preview',
      '--outDir',
      APP_DIR,
      '--port',
      String(port),
      '--strictPort',
      '--host',
      '127.0.0.1',
    ],
    { cwd: FRONTEND, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, VITE_DEMO: '1' } },
  );
  const url = `http://127.0.0.1:${String(port)}`;
  const stop = () => {
    if (child.exitCode === null) child.kill('SIGTERM');
  };
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${url}/`);
      if (response.ok) return { url, stop };
    } catch {
      // not listening yet
    }
    if (child.exitCode !== null) break;
    await sleep(100);
  }
  stop();
  throw new Error(`vite preview did not answer on ${url}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Capturing.

/**
 * A drawn pointer for the animated demos (a headless screenshot shows no mouse): an arrow that follows mousemove
 * and a ring on mousedown. Above everything, never hit by the pointer itself.
 */
const POINTER_SCRIPT = `(() => {
  const install = () => {
    if (document.getElementById('media-pointer')) return;
    const pointer = document.createElement('div');
    pointer.id = 'media-pointer';
    pointer.setAttribute('aria-hidden', 'true');
    pointer.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:24px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);will-change:transform';
    pointer.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M3 2 L3 19 L7.5 14.8 L10.6 21.5 L13.6 20.2 L10.6 13.6 L16.8 13.6 Z" fill="#202124" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const ring = document.createElement('div');
    ring.setAttribute('aria-hidden', 'true');
    ring.style.cssText = 'position:fixed;left:0;top:0;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;border:3px solid #1a73e8;background:rgba(26,115,232,0.18);z-index:2147483646;pointer-events:none;opacity:0;transform:translate(-100px,-100px)';
    document.body.append(ring, pointer);
    let x = -100;
    let y = -100;
    let timer = 0;
    window.addEventListener('mousemove', (event) => {
      x = event.clientX;
      y = event.clientY;
      pointer.style.transform = 'translate(' + (x - 2) + 'px,' + (y - 1) + 'px)';
    }, true);
    window.addEventListener('mousedown', () => {
      ring.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      ring.style.opacity = '1';
      clearTimeout(timer);
      timer = setTimeout(() => { ring.style.opacity = '0'; }, 260);
    }, true);
  };
  if (document.body) install(); else document.addEventListener('DOMContentLoaded', install);
})();`;

/**
 * Opens a view of the app and waits until the diagram is drawn (both workers answered) and the fonts are in.
 * @param {Page} page
 * @param {string} url
 * @param {string} view
 */
async function openView(page, url, view) {
  await page.goto(`${url}${view}`);
  if (view.startsWith('/diagram')) await diagramReady(page);
  await page.evaluate('document.fonts.ready.then(() => true)');
}

/** @param {Page} page */
async function diagramReady(page) {
  await page
    .locator('svg.dg-canvas[data-diagram-ready="true"]')
    .waitFor({ state: 'visible', timeout: 60_000 });
}

/** The time the snapshots still stores the demo snapshots at: the morning of the demo's snapshot day. */
const STORED_AT = new Date('2026-10-08T09:30:00Z');

/** A spot of the page that reacts to nothing: the timeline bar's empty right end. */
const RESTING = Object.freeze({ x: 1100, y: 868 });

/** @param {Page} page @param {string} selector @returns {Promise<{ x: number, y: number, width: number, height: number }>} */
async function boxOf(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (box === null) throw new Error(`media: ${selector} is not on screen`);
  return box;
}

/** @param {{ x: number, y: number, width: number, height: number }} box */
function centre(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Zooms the diagram with the mouse wheel at a point, as a person does (each notch about ×1.15).
 * @param {Page} page @param {{ x: number, y: number }} at @param {number} notches
 */
async function zoomAt(page, at, notches) {
  await page.mouse.move(at.x, at.y);
  for (let notch = 0; notch < notches; notch += 1) {
    await page.mouse.wheel(0, -100);
    await sleep(60);
  }
  await sleep(700);
}

/**
 * Drags the canvas by (dx, dy) from a spot near its left edge: a drag pans the diagram, and d3-zoom does not count it
 * as a click, so the selection stays.
 * @param {Page} page @param {number} dx @param {number} dy
 */
async function panBy(page, dx, dy) {
  const start = { x: 40, y: 160 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
  await page.mouse.up();
  await sleep(500);
}

/**
 * Zooms in on a node and pans the canvas so the node's centre lands on `target`.
 * @param {Page} page @param {string} selector @param {number} notches @param {{ x: number, y: number }} target
 */
async function frameNode(page, selector, notches, target) {
  await zoomAt(page, centre(await boxOf(page, selector)), notches);
  const at = centre(await boxOf(page, selector));
  await panBy(page, target.x - at.x, target.y - at.y);
}

/** @param {string} id */
function nodeSelector(id) {
  return `svg.dg-canvas [data-id="${id}"]`;
}

const DEMO = Object.freeze({
  bastion: '//compute.googleapis.com/projects/demo-vm-1/zones/europe-west3-a/instances/bastion',
  httpsRule: '//compute.googleapis.com/projects/demo-web-1/global/forwardingRules/web-https-fr',
  webManager:
    '//compute.googleapis.com/projects/demo-web-1/zones/europe-west3-a/instanceGroupManagers/web-mig',
  retailWeb: '//cloudresourcemanager.googleapis.com/projects/10000000009',
  retailBatch: '//cloudresourcemanager.googleapis.com/projects/10000000013',
  sharedVpcHost: '//cloudresourcemanager.googleapis.com/projects/10000000001',
});

/**
 * What each still shows; each starts on a fresh page (`page`) of the theme's context and ends with the screen to keep.
 * @type {Record<string, (page: Page, url: string) => Promise<void>>}
 */
const STILLS = {
  // The landing page's hero: demo S's whole organisation in the Overview lens, as the app fits it to the canvas
  // (nothing cut off: every zone, the Shared VPC, the title block and the legend).
  hero: async (page, url) => {
    await openView(page, url, '/diagram#snapshot=demo:S');
    await page.mouse.move(RESTING.x, RESTING.y);
    await sleep(400);
  },
  // The result of a lens switch: demo M in the Networking lens, its networks open, zoomed onto the Shared VPC host.
  lenses: async (page, url) => {
    await openView(page, url, '/diagram#snapshot=demo:M&lens=networking&detail=networks');
    await frameNode(page, nodeSelector(DEMO.sharedVpcHost), 4, { x: 520, y: 430 });
    await page.mouse.move(RESTING.x, RESTING.y);
    await sleep(400);
  },
  // The selection trace on a load balancer: the global HTTPS forwarding rule of the web project, selected, then the
  // camera fitted to its trace beside the details drawer: as many wheel notches as leave 48 px of canvas around it
  // (the room the app keeps around a node it glides to), and a pan that centres it.
  trace: async (page, url) => {
    await openView(page, url, '/diagram#snapshot=demo:M&lens=load-balancing&detail=all');
    await frameNode(page, nodeSelector(DEMO.httpsRule), 6, { x: 420, y: 360 });
    await page.locator(nodeSelector(DEMO.httpsRule)).click();
    await page.getByRole('complementary', { name: 'Details' }).waitFor({ state: 'visible' });
    await page.mouse.move(RESTING.x, RESTING.y);
    await sleep(800);
    // The screen box of the selected rule, the resources its trace reaches and its traced lines. The pointer rests off
    // the canvas, so no hover preview stands in for the selection's trace.
    const traced = async () =>
      /** @type {Box} */ (
        await page.evaluate(`(() => {
          const rects = [...document.querySelectorAll('svg.dg-canvas :is(.is-selected, .is-reached, .dg-edges-top > *)')]
            .map((element) => element.getBoundingClientRect())
            .filter((rect) => rect.width > 0 || rect.height > 0);
          const x = Math.min(...rects.map((rect) => rect.left));
          const y = Math.min(...rects.map((rect) => rect.top));
          return {
            x,
            y,
            width: Math.max(...rects.map((rect) => rect.right)) - x,
            height: Math.max(...rects.map((rect) => rect.bottom)) - y,
          };
        })()`)
      );
    const canvas = await boxOf(page, 'svg.dg-canvas');
    const room = 48;
    const trace = await traced();
    const fits = Math.min((canvas.width - 2 * room) / trace.width, (canvas.height - 2 * room) / trace.height);
    // A wheel notch scales by 2^0.2 (d3-zoom's default for a delta of 100 pixels).
    await zoomAt(page, centre(trace), Math.floor(Math.log2(fits) / 0.2));
    await page.mouse.move(RESTING.x, RESTING.y);
    await sleep(400);
    const at = centre(await traced());
    const middle = centre(canvas);
    await panBy(page, middle.x - at.x, middle.y - at.y);
    await page.mouse.move(RESTING.x, RESTING.y);
    await sleep(800);
  },
  // The details drawer of the bastion VM.
  drawer: async (page, url) => {
    await openView(page, url, '/diagram#snapshot=demo:M&lens=compute&detail=all');
    await frameNode(page, nodeSelector(DEMO.bastion), 6, { x: 420, y: 380 });
    await page.locator(nodeSelector(DEMO.bastion)).click();
    await page.getByRole('complementary', { name: 'Details' }).waitFor({ state: 'visible' });
    await page.mouse.move(RESTING.x, RESTING.y);
    await sleep(800);
  },
  // A day compared with the day before: 23 to 24 September, the web group's scale-out.
  timeline: async (page, url) => {
    await openView(page, url, '/diagram#snapshot=demo:M&tick=2026-09-23&lens=compute&detail=all');
    await scrubToDay(page, '2026-09-24', 6);
    await page.locator('svg.dg-canvas .dg-ghost').first().waitFor({ state: 'attached', timeout: 60_000 });
    await diagramReady(page);
    await frameNode(page, nodeSelector(DEMO.webManager), 7, { x: 560, y: 420 });
    await page.mouse.move(RESTING.x, RESTING.y);
    await sleep(800);
  },
  // The Export menu over demo S.
  export: async (page, url) => {
    await openView(page, url, '/diagram#snapshot=demo:S');
    await page.getByRole('banner').getByRole('button', { name: 'Export' }).click();
    await page.getByRole('menu', { name: 'Export' }).waitFor({ state: 'visible' });
    await sleep(300);
  },
  // The Snapshots page with demo S and M stored in this browser ("Try the demo" stores them; a link does not),
  // scrolled (only the page's own box, <main>, scrolls) until the import area's drop zone ends 8 px above the
  // footer: the stored snapshots with their actions, each scope's timeline and the whole import area in one frame,
  // the page's heading and lead scrolled away. The page's clock is pinned, so the "Stored" column shows the same time
  // in every run.
  snapshots: async (page, url) => {
    await page.clock.setFixedTime(STORED_AT);
    await page.goto(`${url}/`);
    for (const size of ['S', 'M']) {
      const card = page
        .getByRole('region', { name: 'Demo mode' })
        .getByRole('listitem')
        .filter({ has: page.getByRole('heading', { name: 'Demo organisations' }) });
      await card.getByRole('radio', { name: size, exact: true }).click();
      await card.getByRole('button', { name: 'Try the demo' }).click();
      await page.waitForURL(new RegExp(`/diagram#snapshot=demo:${size}$`), { timeout: 60_000 });
      await diagramReady(page);
      await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Connect' }).click();
    }
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Snapshots' }).click();
    await page.getByRole('heading', { level: 1, name: 'Snapshots' }).waitFor({ state: 'visible' });
    await sleep(600);
    await page.evaluate(`(() => {
      const zone = document.querySelector('[data-testid="snapshot-drop-zone"]').getBoundingClientRect();
      const footer = document.querySelector('footer').getBoundingClientRect();
      document.querySelector('main').scrollTop += zone.bottom + 8 - footer.top;
    })()`);
    await sleep(300);
  },
};

/**
 * Drags the timeline's thumb to a day's marker.
 * @param {Page} page @param {string} day @param {number} steps
 */
async function scrubToDay(page, day, steps) {
  const bar = page.getByRole('region', { name: 'Timeline' });
  await bar.and(page.locator('[data-ready="true"]')).waitFor({ state: 'visible', timeout: 60_000 });
  const thumb = await bar.getByRole('slider', { name: 'Timeline' }).boundingBox();
  const marker = await bar.locator(`[data-day="${day}"]`).boundingBox();
  if (thumb === null || marker === null) throw new Error('media: the timeline is not laid out');
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await page.mouse.down();
  await page.mouse.move(marker.x + marker.width / 2, thumb.y + thumb.height / 2, { steps });
  await page.mouse.up();
}

/**
 * The scripted pointer of a scene: moves glide in small steps in real time, so the capture sees them.
 */
class Director {
  /** @param {Page} page */
  constructor(page) {
    this.page = page;
    /** @type {number} */
    this.x = RESTING.x;
    /** @type {number} */
    this.y = RESTING.y;
  }

  /** @param {number} x @param {number} y */
  async place(x, y) {
    this.x = x;
    this.y = y;
    await this.page.mouse.move(x, y);
  }

  /** Moves the pointer to (x, y) over `ms`, easing in and out. @param {number} x @param {number} y @param {number} ms */
  async glide(x, y, ms) {
    const fromX = this.x;
    const fromY = this.y;
    const start = performance.now();
    // Positions follow the clock, not a step count, so a glide takes `ms` however slow each move is.
    for (;;) {
      const t = Math.min(1, (performance.now() - start) / ms);
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      await this.page.mouse.move(fromX + (x - fromX) * eased, fromY + (y - fromY) * eased);
      if (t >= 1) break;
      await sleep(12);
    }
    this.x = x;
    this.y = y;
  }

  /** @param {string} selector @param {number} ms */
  async glideTo(selector, ms) {
    const point = centre(await boxOf(this.page, selector));
    await this.glide(point.x, point.y, ms);
  }

  async click() {
    await this.page.mouse.down();
    await sleep(70);
    await this.page.mouse.up();
  }

  /** Both clicks at once, as a person double-clicks: a chip's first click must not re-lay out the canvas first. */
  async doubleClick() {
    await this.page.mouse.dblclick(this.x, this.y);
  }

  /** @param {number} ms */
  async pause(ms) {
    await sleep(ms);
  }

  /** Zooms in with the wheel at the pointer, `notches` notches spread over `ms`. @param {number} notches @param {number} ms */
  async wheel(notches, ms) {
    for (let notch = 0; notch < notches; notch += 1) {
      await this.page.mouse.wheel(0, -100);
      await sleep(ms / notches);
    }
  }
}

/**
 * Each scene: `prepare` opens the view (not recorded), `play` is recorded in real time.
 * @type {Record<string, { prepare: (page: Page, url: string) => Promise<void>, play: (director: Director) => Promise<void> }>}
 */
const SCENES = {
  // Hover a VM: its path to the root lights up; click: its lines are traced and the console action appears.
  trace: {
    prepare: async (page, url) => {
      await openView(page, url, '/diagram#snapshot=demo:M&lens=compute&detail=all');
      await frameNode(page, nodeSelector(DEMO.bastion), 6, { x: 520, y: 470 });
      await page.mouse.move(RESTING.x, RESTING.y);
      await sleep(500);
    },
    play: async (director) => {
      const vm = nodeSelector(DEMO.bastion);
      await director.place(RESTING.x - 240, 700);
      await director.pause(500);
      await director.glideTo(vm, 1300);
      await director.pause(1900);
      await director.click();
      await director.pause(1600);
      await director.glideTo('svg.dg-canvas .dg-console-action .dg-console-pill', 900);
      await director.pause(2200);
    },
  },
  // Overview → Networking → Load balancing on demo S, through the Lens picker.
  lenses: {
    prepare: async (page, url) => {
      await openView(page, url, '/diagram#snapshot=demo:S');
      await page.mouse.move(RESTING.x, RESTING.y);
      await sleep(400);
    },
    play: async (director) => {
      const page = director.page;
      const picker = page.getByRole('banner').getByRole('combobox', { name: 'Lens' });
      /** @param {string} title */
      const choose = async (title) => {
        const box = await picker.boundingBox();
        if (box === null) throw new Error('media: no Lens picker');
        await director.glide(box.x + box.width / 2, box.y + box.height / 2, 800);
        await director.click();
        const option = page
          .getByRole('listbox', { name: 'Lens' })
          .getByRole('option', { name: title, exact: true });
        await option.waitFor({ state: 'visible' });
        await director.pause(350);
        const target = await option.boundingBox();
        if (target === null) throw new Error(`media: no lens ${title}`);
        await director.glide(target.x + Math.min(60, target.width / 2), target.y + target.height / 2, 600);
        await director.pause(200);
        await director.click();
      };
      await director.place(900, 500);
      await director.pause(800);
      await choose('Networking');
      await director.glide(1320, 470, 600);
      await director.pause(1500);
      await choose('Load balancing');
      await director.glide(1320, 470, 600);
      await director.pause(1400);
    },
  },
  // A click on a project chip expands it in place; a double-click on another project drills into it.
  'drill-in': {
    prepare: async (page, url) => {
      await openView(page, url, '/diagram#snapshot=demo:M');
      await page.mouse.move(RESTING.x, RESTING.y);
      await sleep(400);
    },
    play: async (director) => {
      await director.place(560, 720);
      await director.pause(500);
      await director.glideTo(`svg.dg-canvas .dg-chip[data-id="${DEMO.retailBatch}"]`, 1000);
      await director.pause(400);
      await director.click();
      await director.pause(1800);
      await director.glideTo(`svg.dg-canvas .dg-chip[data-id="${DEMO.retailWeb}"]`, 900);
      await director.pause(400);
      await director.doubleClick();
      await director.pause(600);
      await director.glide(RESTING.x - 200, 760, 700);
      await director.pause(2400);
    },
  },
  // Demo S's Workloads folder through the timeline: three presses on the track jump from 4 September to 8, 14 and
  // 25 September, each day drawn compared with the one before; the last stop (eleven days of history at once) has the
  // most: the decommissioned reporting project as a ghost, a new VM in the web group, more ghosts, amber dots. So that
  // a first-time viewer can read it, the last day is then shown up close: a zoom onto the reporting project's ghost
  // (the largest), back out, and a zoom onto the legend with its "added / removed / changed since" rows. The pointer
  // travels through empty canvas only (right of the drawing, below it), so no resource or zone lights up on the way.
  timeline: {
    prepare: async (page, url) => {
      const workloads = encodeURIComponent('//cloudresourcemanager.googleapis.com/folders/20000000002');
      await openView(page, url, `/diagram#snapshot=demo:S&tick=2026-09-04&root=${workloads}`);
      await page
        .getByRole('region', { name: 'Timeline' })
        .and(page.locator('[data-ready="true"]'))
        .waitFor({ timeout: 60_000 });
      await page.mouse.move(RESTING.x, RESTING.y);
      await sleep(500);
    },
    play: async (director) => {
      const page = director.page;
      const bar = page.getByRole('region', { name: 'Timeline' });
      const thumb = await bar.getByRole('slider', { name: 'Timeline' }).boundingBox();
      if (thumb === null) throw new Error('media: the timeline is not laid out');
      const y = thumb.y + thumb.height / 2;
      // Each stop: the day pressed on the track, then a hold while its markers and legend rows are on screen.
      const stops = [
        { day: '2026-09-08', from: '2026-09-04', glide: 900, hold: 1100 },
        { day: '2026-09-14', from: '2026-09-08', glide: 550, hold: 1100 },
        { day: '2026-09-25', from: '2026-09-14', glide: 550, hold: 600 },
      ];
      // From the empty canvas below the reporting project, clear of the legend and of every node.
      await director.place(1180, 600);
      await director.pause(300);
      for (const stop of stops) {
        const marker = await bar.locator(`[data-day="${stop.day}"]`).boundingBox();
        if (marker === null) throw new Error(`media: no timeline marker for ${stop.day}`);
        await director.glide(marker.x + marker.width / 2, y, stop.glide);
        await director.pause(100);
        await director.click();
        // Drawn once the legend compares with the day before ("added since 2026-09-04").
        await page
          .locator(`svg.dg-canvas text:has-text("since ${stop.from}")`)
          .first()
          .waitFor({ state: 'attached', timeout: 60_000 });
        await director.pause(stop.hold);
      }
      // The screen boxes of the canvas, its largest ghost (the reporting project) and the legend.
      const boxes =
        /** @type {Record<'canvas' | 'ghost' | 'legend', { x: number, y: number, width: number, height: number } | null>} */ (
          await page.evaluate(`(() => {
            const box = (element) => {
              if (element === null) return null;
              const rect = element.getBoundingClientRect();
              return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
            };
            const ghosts = [...document.querySelectorAll('svg.dg-canvas .dg-ghost')].map(box);
            const area = (item) => (item === null ? 0 : item.width * item.height);
            return {
              canvas: box(document.querySelector('svg.dg-canvas')),
              ghost: ghosts.reduce((best, item) => (area(item) > area(best) ? item : best), null),
              legend: box(document.querySelector('svg.dg-canvas .dg-legend')),
            };
          })()`)
        );
      const { canvas, ghost, legend } = boxes;
      if (canvas === null || ghost === null || legend === null)
        throw new Error('media: no canvas, ghost or legend on the last day');
      // Four wheel notches, each ×1.15, about a point chosen so the enlarged box keeps a margin on the canvas.
      const notches = 4;
      const scale = 1.15 ** notches;
      /** @param {{ x: number, y: number, width: number, height: number }} box */
      const zoomPoint = (box) => {
        /** @param {number} from @param {number} size @param {number} low @param {number} high */
        const axis = (from, size, low, high) => {
          const least = (scale * (from + size) - high + 16) / (scale - 1);
          const most = (scale * from - low - 16) / (scale - 1);
          return Math.min(Math.max(from + size / 2, least), most);
        };
        return {
          x: axis(box.x, box.width, canvas.x, canvas.x + canvas.width),
          y: axis(box.y, box.height, canvas.y, canvas.y + canvas.height),
        };
      };
      /** @param {number} delta @param {number} ms */
      const wheel = async (delta, ms) => {
        for (let notch = 0; notch < notches; notch += 1) {
          await page.mouse.wheel(0, delta);
          await director.pause(ms / notches);
        }
      };
      const onGhost = zoomPoint(ghost);
      const onLegend = zoomPoint(legend);
      // The empty corridor: down the middle of the ghost's column (right of the drawing), then along the legend's row.
      const corridor = ghost.x + ghost.width / 2;
      const belowGhost = ghost.y + ghost.height + 30;
      const legendRow = legend.y + legend.height / 2;
      await director.glide(corridor, legendRow, 350);
      await director.glide(corridor, belowGhost, 300);
      await director.glide(onGhost.x, onGhost.y, 200);
      await wheel(-100, 480);
      await director.pause(1100);
      await wheel(100, 400);
      await director.glide(corridor, belowGhost, 200);
      await director.glide(corridor, legendRow, 250);
      await director.glide(onLegend.x, onLegend.y, 400);
      await wheel(-100, 480);
      // The pointer steps off to the right of the enlarged legend, leaving its rows clear.
      await director.glide(onLegend.x + scale * (legend.x + legend.width - onLegend.x) + 50, onLegend.y, 250);
      await director.pause(800);
    },
  },
  // `/` opens search; an IP address is typed; Enter lands on the resource.
  search: {
    prepare: async (page, url) => {
      await openView(page, url, '/diagram#snapshot=demo:M');
      await page.mouse.move(RESTING.x, RESTING.y);
      await sleep(400);
    },
    play: async (director) => {
      const page = director.page;
      await director.place(820, 560);
      await director.pause(700);
      await page.keyboard.press('/');
      await director.pause(500);
      for (const character of '10.0.14.5') {
        await page.keyboard.type(character);
        await director.pause(120);
      }
      await page.getByRole('listbox', { name: 'Search assets' }).waitFor({ state: 'visible' });
      await director.pause(1200);
      await page.keyboard.press('Enter');
      await director.pause(3600);
    },
  },
};

/**
 * Each item's capture code, as the source text of its functions: the part of this script its fingerprint holds
 * (scripts/lib/media-core.mjs, itemFingerprints) and the shared hash leaves out. Exported for the tests.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const CAPTURES = Object.freeze({
  ...Object.fromEntries(
    Object.entries(STILLS).map(([id, shoot]) => [itemKey('still', id), [shoot.toString()]]),
  ),
  ...Object.fromEntries(
    Object.entries(SCENES).map(([id, script]) => [
      itemKey('scene', id),
      [script.prepare.toString(), script.play.toString()],
    ]),
  ),
});

/**
 * Plays a scene in real time while capturing screenshots as fast as they come, then resamples them to the frame rate.
 * @param {Page} page @param {(director: Director) => Promise<void>} play @param {number} seconds @param {number} fps
 * @returns {Promise<Buffer[]>}
 */
async function record(page, play, seconds, fps) {
  /** @type {{ t: number, frame: Buffer }[]} */
  const captured = [];
  const state = { recording: true };
  const start = performance.now();
  const capture = (async () => {
    while (state.recording) {
      const t = performance.now() - start;
      const frame = await page.screenshot({ type: 'png' });
      captured.push({ t, frame });
    }
  })();
  const director = new Director(page);
  await play(director);
  const played = (performance.now() - start) / 1000;
  // Keep capturing the end state until the scene's length is reached.
  while ((performance.now() - start) / 1000 < seconds) await sleep(50);
  state.recording = false;
  await capture;
  if (played > seconds + 0.25)
    log(`  the scene ran ${played.toFixed(1)} s, longer than its ${String(seconds)} s; the end is cut`);
  log(`  captured ${String(captured.length)} screenshots in ${played.toFixed(1)} s`);
  return resample(captured, fps, seconds);
}

// ---------------------------------------------------------------------------------------------------------------
// Encoding in the browser: WebP (stills, posters) and VP9 WebM (WebCodecs + Mediabunny's muxer).

const ENCODER_PAGE = `<!doctype html><meta charset="utf-8"><title>media encoder</title>
<script type="module">
import * as Mediabunny from '/mediabunny.mjs';
const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const toBase64 = async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};
const decode = (b64) => createImageBitmap(new Blob([fromBase64(b64)], { type: 'image/png' }));
window.encoder = {
  async webp(png, width, quality) {
    const image = await decode(png);
    const height = Math.round((image.height * width) / image.width);
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);
    return { data: await toBase64(await canvas.convertToBlob({ type: 'image/webp', quality })), width, height };
  },
  async startWebm(width, height, fps, bitrate) {
    const canvas = new OffscreenCanvas(width, height);
    const output = new Mediabunny.Output({ format: new Mediabunny.WebMOutputFormat(), target: new Mediabunny.BufferTarget() });
    const source = new Mediabunny.CanvasSource(canvas, { codec: 'vp9', bitrate, keyFrameInterval: 2 });
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();
    this.video = { canvas, context: canvas.getContext('2d'), output, source, fps };
  },
  async addFrame(png, index) {
    const { canvas, context, source, fps } = this.video;
    context.drawImage(await decode(png), 0, 0, canvas.width, canvas.height);
    await source.add(index / fps, 1 / fps);
  },
  async finishWebm() {
    const { output } = this.video;
    await output.finalize();
    this.video = undefined;
    return toBase64(new Blob([output.target.buffer]));
  },
};
window.encoderReady = true;
</script>`;

/**
 * @param {BrowserContext} context
 * @returns {Promise<Page>}
 */
async function openEncoder(context) {
  const mediabunny = readFileSync(
    path.join(packageDir('mediabunny'), 'dist', 'bundles', 'mediabunny.min.mjs'),
  );
  const page = await context.newPage();
  await page.route(`${ENCODER_ORIGIN}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/mediabunny.mjs')
      await route.fulfill({ body: mediabunny, contentType: 'text/javascript' });
    else await route.fulfill({ body: ENCODER_PAGE, contentType: 'text/html' });
  });
  await page.goto(`${ENCODER_ORIGIN}/encoder.html`);
  await page.waitForFunction('window.encoderReady === true');
  return page;
}

/**
 * @param {Page} encoder @param {Buffer} png @param {number} width @param {number} quality
 * @returns {Promise<{ data: Buffer, width: number, height: number }>}
 */
async function toWebp(encoder, png, width, quality) {
  const result = await encoder.evaluate(
    `window.encoder.webp(${JSON.stringify(png.toString('base64'))}, ${String(width)}, ${String(quality)})`,
  );
  const {
    data,
    width: w,
    height: h,
  } = /** @type {{ data: string, width: number, height: number }} */ (result);
  return { data: Buffer.from(data, 'base64'), width: w, height: h };
}

/**
 * @param {Page} encoder @param {Buffer[]} frames @param {{ width: number, height: number, fps: number, bitrate: number }} options
 * @returns {Promise<Buffer>}
 */
async function toWebm(encoder, frames, { width, height, fps, bitrate }) {
  await encoder.evaluate(
    `window.encoder.startWebm(${String(width)}, ${String(height)}, ${String(fps)}, ${String(bitrate)})`,
  );
  for (const [index, frame] of frames.entries()) {
    await encoder.evaluate(
      `window.encoder.addFrame(${JSON.stringify(frame.toString('base64'))}, ${String(index)})`,
    );
  }
  const data = await encoder.evaluate('window.encoder.finishWebm()');
  if (typeof data !== 'string') throw new Error('media: the WebM encoder returned nothing');
  return Buffer.from(data, 'base64');
}

// ---------------------------------------------------------------------------------------------------------------
// Link-preview images: a still with the page's heading, 1200×630.

/**
 * @param {string} heading @param {string} stillDataUrl @param {{ regular: string, medium: string }} fonts
 */
function cardHtml(heading, stillDataUrl, fonts) {
  const escape = (/** @type {string} */ value) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: Card; src: url(${fonts.regular}) format('woff2'); font-weight: 400; }
@font-face { font-family: Card; src: url(${fonts.medium}) format('woff2'); font-weight: 500; }
html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
body { font-family: Card, sans-serif; background: #f8f9fa; color: #202124; position: relative; }
.text { position: absolute; left: 64px; top: 64px; width: 470px; }
.mark { display: flex; align-items: center; gap: 14px; font-size: 30px; font-weight: 500; }
.mark svg { width: 44px; height: 44px; }
h1 { font-size: 46px; line-height: 1.15; font-weight: 500; margin: 56px 0 0; letter-spacing: -0.01em; }
.host { position: absolute; left: 64px; bottom: 56px; font-size: 24px; color: #185abc; font-weight: 500; }
.shot { position: absolute; left: 590px; top: 70px; width: 720px; height: 450px; border-radius: 14px; overflow: hidden;
  border: 1px solid #dadce0; box-shadow: 0 2px 6px rgba(60,64,67,.15), 0 8px 28px rgba(60,64,67,.18); background: #fff; }
.shot img { width: 720px; height: 450px; object-fit: cover; object-position: left top; display: block; }
</style>
<div class="text"><div class="mark">${MARK_SVG}<span>gcportrait</span></div><h1>${escape(heading)}</h1></div>
<div class="host">gcportrait.app</div>
<div class="shot"><img src="${stillDataUrl}" alt=""></div>`;
}

/** The wordmark's frame: nested zones in the diagram's tints (no Google mark). */
const MARK_SVG =
  '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="3" y="3" width="42" height="42" rx="9" fill="#ffffff" stroke="#1a73e8" stroke-width="3"/><rect x="10" y="11" width="28" height="13" rx="3" fill="#a8c7fa" stroke="#202124" stroke-width="1.6"/><rect x="10" y="28" width="12" height="9" rx="2.5" fill="#ceead6" stroke="#202124" stroke-width="1.6"/><rect x="26" y="28" width="12" height="9" rx="2.5" fill="#ffeebd" stroke="#202124" stroke-width="1.6"/></svg>';

/** @returns {{ regular: string, medium: string }} */
function cardFonts() {
  const dir = path.join(packageDir('@fontsource/roboto'), 'files');
  const read = (/** @type {string} */ weight) =>
    `data:font/woff2;base64,${readFileSync(path.join(dir, `roboto-latin-${weight}-normal.woff2`)).toString('base64')}`;
  return { regular: read('400'), medium: read('500') };
}

// ---------------------------------------------------------------------------------------------------------------
// The run.

/** @returns {Manifest | undefined} */
function readManifest() {
  const file = path.join(OUT, MANIFEST);
  if (!existsSync(file)) return undefined;
  return /** @type {Manifest} */ (parseJson(readFileSync(file, 'utf8')));
}

/** @param {string} file */
function readOutput(file) {
  const full = path.join(OUT, file);
  return existsSync(full) ? readFileSync(full) : undefined;
}

/**
 * @param {Record<string, OutputEntry>} files @param {string} file @param {Buffer | Uint8Array} data
 * @param {Omit<OutputEntry, 'sha256' | 'bytes'>} [extra]
 */
function writeOutput(files, file, data, extra = {}) {
  const full = path.join(OUT, file);
  mkdirSync(path.dirname(full), { recursive: true });
  const buffer = Buffer.from(data);
  writeFileSync(full, buffer);
  files[file] = { sha256: sha256(buffer), bytes: buffer.length, ...extra };
  log(`  wrote ${file} (${(buffer.length / 1024).toFixed(0)} KiB)`);
}

/** @param {readonly string[]} argv */
async function main(argv) {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      check: { type: 'boolean', default: false },
      only: { type: 'string', multiple: true, default: [] },
      theme: { type: 'string', multiple: true, default: [] },
      'skip-build': { type: 'boolean', default: false },
      list: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    process.stdout.write(
      'usage: pnpm media [--check] [--only [still:|scene:|card:]ID]... [--theme light|dark]... [--skip-build] [--list]\n',
    );
    return 0;
  }
  const config = readConfig(ROOT);
  const expected = expectedOutputs(config);
  if (values.list) {
    for (const file of expected) process.stdout.write(`${MEDIA_DIR}/${file}\n`);
    return 0;
  }
  const items = outputsByItem(config);
  const known = new Set([
    ...[...config.stills, ...config.scenes, ...config.cards].map((item) => item.id),
    ...items.keys(),
  ]);
  for (const id of values.only)
    if (!known.has(id)) throw new UsageError(`--only ${id}: no still, scene or card has this id`);
  for (const theme of values.theme) {
    if (theme !== 'light' && theme !== 'dark') throw new UsageError(`--theme ${theme}: light or dark`);
  }
  if (values.check && (values.only.length > 0 || values.theme.length > 0)) {
    throw new UsageError('--check compares everything; it takes no --only or --theme');
  }

  if (!values['skip-build'] || !existsSync(APP_DIR)) buildApp();
  const inputs = computeInputs({ root: ROOT, appDir: APP_DIR, toolVersion, captures: CAPTURES });
  const fingerprints = itemFingerprints(config, CAPTURES);
  const manifest = readManifest();

  if (values.check) {
    const problems = staleness({
      manifest,
      inputs,
      expected,
      readOutput,
      present: presentOutputs(OUT),
      items,
      fingerprints,
    });
    if (problems.length === 0) {
      log(
        `${MEDIA_DIR} is up to date (inputs ${inputsHash(inputs).slice(0, 12)}, ${String(expected.length)} files).`,
      );
      return 0;
    }
    process.stderr.write(`media: ${MEDIA_DIR} is stale; run \`pnpm media\` and commit the result:\n`);
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    return 1;
  }

  const themes = /** @type {Theme[]} */ (values.theme.length > 0 ? values.theme : config.themes);
  /** Whether this run writes the item: no --only, or --only names its id or its kind and id. */
  const wanted = (/** @type {import('./lib/media-core.mjs').ItemKind} */ kind, /** @type {string} */ id) =>
    values.only.length === 0 || values.only.includes(id) || values.only.includes(itemKey(kind, id));
  /** The fingerprint each file of an item is recorded with. @param {import('./lib/media-core.mjs').ItemKind} kind @param {string} id */
  const item = (kind, id) => ({ item: fingerprints[itemKey(kind, id)] ?? '' });
  /** @type {Record<string, OutputEntry>} */
  const files = Object.fromEntries(
    Object.entries(manifest?.files ?? {}).filter(([file]) => expected.includes(file)),
  );

  const playwright = /** @type {{ chromium: Chromium }} */ (websiteRequire('playwright'));
  const gif = /** @type {GifEncoderApi} */ (websiteRequire('gifenc'));
  const png = /** @type {{ PNG: PngApi }} */ (websiteRequire('pngjs')).PNG;

  const preview = await startPreview();
  const browser = await playwright.chromium.launch();
  try {
    const encoderContext = await browser.newContext();
    const encoder = await openEncoder(encoderContext);
    /** @type {Map<string, Buffer>} the light stills, for the link-preview cards */
    const stillsForCards = new Map();

    for (const theme of themes) {
      for (const still of config.stills) {
        if (!wanted('still', still.id)) continue;
        log(`still ${still.id} (${theme})`);
        const context = await browser.newContext({
          viewport: config.viewport,
          deviceScaleFactor: 1,
          colorScheme: theme,
          timezoneId: 'UTC',
          locale: 'en-GB',
          reducedMotion: 'no-preference',
        });
        const page = await context.newPage();
        const shoot = STILLS[still.id];
        if (shoot === undefined)
          throw new Error(`media: no capture for still ${still.id} in scripts/media.mjs`);
        await shoot(page, preview.url);
        const shot = await page.screenshot({ type: 'png' });
        await context.close();
        if (theme === config.social.theme) stillsForCards.set(still.id, shot);
        writeOutput(files, paths.still(still.id, theme), shot, {
          width: config.viewport.width,
          height: config.viewport.height,
          ...item('still', still.id),
        });
        for (const width of config.web.widths) {
          const webp = await toWebp(encoder, shot, width, config.web.quality);
          writeOutput(files, paths.web(still.id, theme, width), webp.data, {
            width: webp.width,
            height: webp.height,
            ...item('still', still.id),
          });
        }
      }

      for (const scene of config.scenes) {
        if (!wanted('scene', scene.id)) continue;
        const script = SCENES[scene.id];
        if (script === undefined)
          throw new Error(`media: no script for scene ${scene.id} in scripts/media.mjs`);
        log(`scene ${scene.id} (${theme})`);
        const scale = config.animated.width / config.viewport.width;
        const context = await browser.newContext({
          viewport: config.viewport,
          deviceScaleFactor: scale,
          colorScheme: theme,
          timezoneId: 'UTC',
          locale: 'en-GB',
          reducedMotion: 'no-preference',
        });
        await context.addInitScript(POINTER_SCRIPT);
        const page = await context.newPage();
        await script.prepare(page, preview.url);
        const frames = await record(page, script.play, scene.seconds, config.animated.fps);
        await context.close();
        const first = png.sync.read(frames[0] ?? Buffer.alloc(0));
        const { width, height } = first;

        let gifBytes;
        for (const colors of [255, 160, 96]) {
          const rgba = frames.map((frame) => new Uint8Array(png.sync.read(frame).data));
          const result = assembleGif({
            frames: rgba,
            width,
            height,
            fps: config.animated.fps,
            colors,
            hold: GIF_HOLD,
            gif,
          });
          gifBytes = result.bytes;
          log(
            `  GIF: ${String(result.written)} distinct frames, ${String(colors)} colours, ${(gifBytes.length / 1048576).toFixed(2)} MiB`,
          );
          if (gifBytes.length <= config.animated.maxGifBytes) break;
        }
        if (gifBytes === undefined || gifBytes.length > config.animated.maxGifBytes) {
          throw new Error(
            `media: the GIF of ${scene.id} (${theme}) stays above ${String(config.animated.maxGifBytes)} bytes`,
          );
        }
        writeOutput(files, paths.gif(scene.id, theme), gifBytes, {
          width,
          height,
          frames: frames.length,
          seconds: scene.seconds,
          ...item('scene', scene.id),
        });
        const webm = await toWebm(encoder, frames, {
          width,
          height,
          fps: config.animated.fps,
          bitrate: config.animated.bitrate,
        });
        writeOutput(files, paths.webm(scene.id, theme), webm, {
          width,
          height,
          frames: frames.length,
          seconds: scene.seconds,
          ...item('scene', scene.id),
        });
        const posterFrame =
          frames[Math.min(frames.length - 1, Math.round(scene.posterAt * config.animated.fps))];
        if (posterFrame === undefined) throw new Error('media: no poster frame');
        const poster = await toWebp(encoder, posterFrame, width, config.web.quality);
        writeOutput(files, paths.poster(scene.id, theme), poster.data, {
          width: poster.width,
          height: poster.height,
          ...item('scene', scene.id),
        });
      }
    }

    // A card is written when it is wanted, or when its still was captured anew in its theme in this run.
    const cards = config.cards.filter((card) => wanted('card', card.id) || stillsForCards.has(card.still));
    if (cards.length > 0 && themes.includes(config.social.theme)) {
      const fonts = cardFonts();
      const context = await browser.newContext({
        viewport: { width: config.social.width, height: config.social.height },
      });
      const page = await context.newPage();
      for (const card of cards) {
        const still =
          stillsForCards.get(card.still) ?? readOutput(paths.still(card.still, config.social.theme));
        if (still === undefined)
          throw new Error(`media: card ${card.id} needs the still ${card.still}; run it first`);
        log(`card ${card.id}`);
        await page.setContent(
          cardHtml(card.heading, `data:image/png;base64,${still.toString('base64')}`, fonts),
        );
        await page.evaluate('document.fonts.ready.then(() => true)');
        const jpeg = await page.screenshot({ type: 'jpeg', quality: config.social.quality });
        writeOutput(files, paths.card(card.id), jpeg, {
          width: config.social.width,
          height: config.social.height,
          ...item('card', card.id),
        });
      }
      await context.close();
    }
    await encoderContext.close();
  } finally {
    await browser.close();
    preview.stop();
  }

  // A file in an output folder that no run writes any more (a renamed card, a removed still) goes.
  for (const file of presentOutputs(OUT)) {
    if (!expected.includes(file)) {
      rmSync(path.join(OUT, file));
      log(`  removed ${file} (no longer in the media list)`);
    }
  }
  const complete = expected.every((file) => files[file] !== undefined);
  const regeneratedAll = values.only.length === 0 && themes.length === config.themes.length;
  /** @type {Manifest} */
  const next = {
    generator: 'scripts/media.mjs (pnpm media)',
    inputsHash: regeneratedAll || manifest === undefined ? inputsHash(inputs) : manifest.inputsHash,
    inputs: regeneratedAll || manifest === undefined ? inputs : manifest.inputs,
    generatedOn:
      regeneratedAll || manifest === undefined ? new Date().toISOString().slice(0, 10) : manifest.generatedOn,
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  };
  writeFileSync(path.join(OUT, MANIFEST), `${JSON.stringify(next, null, 2)}\n`);
  if (!regeneratedAll)
    log(
      'a partial run: the manifest keeps the inputs of the last full run (run `pnpm media` to refresh them).',
    );
  if (!complete)
    log(
      `the manifest lists ${String(Object.keys(files).length)} of ${String(expected.length)} files; run \`pnpm media\` for the rest.`,
    );
  log('done.');
  return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (/** @type {unknown} */ error) => {
      if (error instanceof UsageError) {
        process.stderr.write(`media: ${error.message}\n`);
        process.exitCode = 2;
      } else {
        process.stderr.write(
          `media: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
        );
        process.exitCode = 1;
      }
    },
  );
}
