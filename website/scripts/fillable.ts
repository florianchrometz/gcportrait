// SPDX-License-Identifier: MIT
/**
 * `pnpm --filter @gcportrait/website fillable`: the fillable commands (docs/website.md, "Fillable commands") in real
 * browsers, on the built site (website/dist). Run after `pnpm website:build`. Exit code 0 when clean, 1 with every
 * problem listed, 2 on a usage error.
 *
 * Pages: /docs/self-host/ and the landing page (`--page` for others, repeatable), each in every profile (`--profile`
 * to pick some):
 * - `chromium`: Playwright's Chromium at 1440 and 375 CSS pixels (the latter as a phone: touch, 2×), light and dark;
 *   here also the page without JavaScript, the start without a shift, and axe-core;
 * - `firefox`: Firefox at 1440, light and dark;
 * - `firefox-fallback`: Firefox at 1440 with `contenteditable="plaintext-only"` refused, as Firefox before 136 refuses
 *   it, so the fields fall back to `contenteditable="true"` and the script's own sanitising;
 * - `webkit`: WebKit (Safari) at 1440, light and dark;
 * - `iphone`: an iPhone 15 (WebKit) and `pixel`: a Pixel 7 (Chromium), with their device descriptors (viewport, pixel
 *   ratio, touch, user agent), light and dark, every field and button pressed with a tap.
 *
 * Without JavaScript (chromium): the code shows its tokens as text; nothing is editable, no Copy bar, hint, edit mark
 * or input of the Variables panel shows, and the panel lists the variables.
 * At the start (chromium): the script moves no heading, code block, bar, hint or panel row.
 * The scenario, in every profile:
 * - before any interaction, a field reads as editable: it carries its edit mark (the pencil), the page's first code
 *   block with fields carries the hint (and no other block), and on a desktop a hovered field is ringed;
 * - on a touch screen a tap just above or below a field (on its 44-pixel target) focuses that field;
 * - a click or tap on an unfilled field selects its token; after the caret is moved into the token, what is typed
 *   still replaces all of it; Enter leaves the field;
 * - the value shows in every other field of that variable (in other code blocks and inline code too) and in the
 *   panel's input; a value typed into the panel's input shows in the fields; a block's note counts what is left to fill.
 *   A page where no variable has fields in two code blocks checks the fields it has and says so;
 * - rich text with a line break, copied and pasted with the keyboard, arrives in a field as one plain line;
 * - Copy hands the block's text with the values (an unfilled variable as its token) to the clipboard (Chromium: read
 *   back with navigator.clipboard; WebKit and Firefox, which Playwright gives no clipboard permission: the text the
 *   page passed to the Clipboard API), and the live region says "Copied";
 * - a field is reached with Tab from its code block, a value of the wrong format is marked when the field is left
 *   (aria-invalid, the panel's hint, the block's note) and unmarked once fixed;
 * - after a reload the values are there again (local storage, one key), a variable marked secret excepted; "Clear
 *   values" empties every field and the storage;
 * - axe-core (chromium) finds no violation, unfilled, filled and with the panel unfolded.
 * On /docs/getting-started/ (code, no variables; chromium): no panel, and Copy copies the block as it is.
 *
 *   pnpm --filter @gcportrait/website fillable [--page /docs/self-host/]... [--profile webkit]... [--shots DIR]
 *                                              [--dist DIR]
 *
 * `--shots DIR` saves the page's first code block with fields (the hint's) unedited and edited, the block the scenario
 * edits before, while and after its field is typed into, and the panel, per profile, page, width and theme. Browsers: Chromium from `pnpm --filter @gcportrait/e2e install-browsers`; WebKit and Firefox once per
 * machine with `pnpm --filter @gcportrait/website exec playwright install webkit firefox`. Firefox runs with a
 * throwaway application-data directory (MOZ_APP_DATA), so it never touches a Firefox profile of the user's (and
 * starts where its own lookup of that directory fails: "Could not find profile folder"). axe-core comes from the e2e
 * package (scripts/browser.ts). The header's repository widget is answered by the check with GitHub's 404 for a
 * private repository (scripts/browser.ts), so the header does not change and GitHub is never asked.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

import { commandVariable, splitVariableTokens } from '@gcportrait/model';
import {
  chromium,
  devices,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type BrowserType,
  type Locator,
  type Page,
} from 'playwright';

import { STORAGE_KEY, unfilledNote } from '../src/lib/fillable.js';
import { FIELD_HINT } from '../src/lib/markdown.js';
import {
  KEEP_NAMES_SHIM,
  WEBSITE,
  answerRepositoryRequests,
  axeProblems,
  axeSource,
  settle,
} from './browser.js';
import { serve } from './serve.js';

class UsageError extends Error {}

const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];
const HEIGHT = 900;
/** A value no registered pattern for an id, a region or a host accepts. */
const WRONG = 'Not Valid!';
/**
 * The variable that stands for a secret in the scenario (no registered variable is one): marked secret in the page,
 * so the check sees that its value is never kept.
 */
const SECRET_STAND_IN = 'YOUR_EMAIL';
/** The smallest tap target, in CSS pixels (WCAG 2.5.5's 44; a little rounding allowed). */
const TARGET = 43.5;

/** Firefox before 136: setting `contentEditable = 'plaintext-only'` throws a SyntaxError. */
const REFUSE_PLAINTEXT_ONLY = `(() => {
  const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'contentEditable');
  Object.defineProperty(HTMLElement.prototype, 'contentEditable', {
    configurable: true,
    get() { return own.get.call(this); },
    set(value) {
      if (value === 'plaintext-only') throw new DOMException('An invalid or illegal string was specified', 'SyntaxError');
      own.set.call(this, value);
    },
  });
})();`;

/** Records what the page hands to the clipboard (the Clipboard API, or the copy command of its fallback). */
const CLIPBOARD_RECORDER = `(() => {
  const clipboard = navigator.clipboard;
  if (clipboard !== undefined && typeof clipboard.writeText === 'function') {
    const write = clipboard.writeText.bind(clipboard);
    clipboard.writeText = (text) => { window.__fillableCopied = text; return write(text); };
  }
  const exec = document.execCommand.bind(document);
  document.execCommand = (command, ...rest) => {
    const active = document.activeElement;
    if (command === 'copy' && active instanceof HTMLTextAreaElement) window.__fillableCopied = active.value;
    return exec(command, ...rest);
  };
})();`;

type Profile = {
  readonly id: string;
  readonly label: string;
  readonly engine: BrowserType;
  /** A Playwright device descriptor (a phone); otherwise a desktop window at `widths`. */
  readonly device?: string;
  readonly widths: readonly number[];
  readonly init?: string;
  /** Chromium only: the clipboard can be read back. */
  readonly realClipboard: boolean;
  /** The checks that need run once per page only: no JavaScript, no shift, axe-core, the plain page. */
  readonly full: boolean;
};

const PROFILES: readonly Profile[] = [
  {
    id: 'chromium',
    label: 'Chromium',
    engine: chromium,
    widths: [1440, 375],
    realClipboard: true,
    full: true,
  },
  { id: 'firefox', label: 'Firefox', engine: firefox, widths: [1440], realClipboard: false, full: false },
  {
    id: 'firefox-fallback',
    label: 'Firefox (no plaintext-only)',
    engine: firefox,
    widths: [1440],
    init: REFUSE_PLAINTEXT_ONLY,
    realClipboard: false,
    full: false,
  },
  { id: 'webkit', label: 'WebKit', engine: webkit, widths: [1440], realClipboard: false, full: false },
  {
    id: 'iphone',
    label: 'iPhone 15 (WebKit)',
    engine: webkit,
    device: 'iPhone 15',
    widths: [],
    realClipboard: false,
    full: false,
  },
  {
    id: 'pixel',
    label: 'Pixel 7 (Chromium)',
    engine: chromium,
    device: 'Pixel 7',
    widths: [],
    realClipboard: true,
    full: false,
  },
];

/** One run: a profile at one width (or its device) in one theme. */
type Run = { readonly profile: Profile; readonly width: number | undefined; readonly theme: Theme };

type Check = { readonly problems: string[]; readonly where: string; readonly notes: string[] };

function fail(check: Check, message: string): void {
  check.problems.push(`${check.where}: ${message}`);
}

function touch(run: Run): boolean {
  return run.profile.device !== undefined || (run.width ?? 1440) < 600;
}

function contextOptions(run: Run, javaScript: boolean): BrowserContextOptions {
  if (run.profile.device !== undefined) {
    const device = devices[run.profile.device];
    if (device === undefined) throw new Error(`no Playwright device ${run.profile.device}`);
    return { ...device, colorScheme: run.theme, javaScriptEnabled: javaScript };
  }
  const width = run.width ?? 1440;
  const phone = width < 600;
  return {
    viewport: { width, height: HEIGHT },
    colorScheme: run.theme,
    deviceScaleFactor: phone ? 2 : 1,
    hasTouch: phone,
    isMobile: phone,
    javaScriptEnabled: javaScript,
  };
}

async function newContext(
  browser: Browser,
  base: string,
  run: Run,
  javaScript = true,
): Promise<BrowserContext> {
  const context = await browser.newContext(contextOptions(run, javaScript));
  await context.addInitScript(KEEP_NAMES_SHIM);
  // The header's repository widget: answered here with GitHub's 404 for a private repository (nothing changes), never
  // asked of GitHub.
  await answerRepositoryRequests(context);
  if (run.profile.init !== undefined) await context.addInitScript(run.profile.init);
  if (javaScript) {
    await context.addInitScript(CLIPBOARD_RECORDER);
    if (run.profile.realClipboard)
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  }
  return context;
}

async function open(context: BrowserContext, url: string, javaScript = true): Promise<Page> {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Without JavaScript no animation frame comes; the page is laid out once it has loaded.
  if (javaScript) await settle(page);
  return page;
}

/** Hydrated: the Copy buttons show once the script has run. */
async function hydrated(page: Page): Promise<void> {
  await page.locator('[data-code-copy]').first().waitFor({ state: 'visible', timeout: 10_000 });
  await settle(page);
}

/** A click, or a tap on a touch screen. */
async function press(locator: Locator, run: Run): Promise<void> {
  if (touch(run)) await locator.tap();
  else await locator.click();
}

/** Where the page's landmarks are: headings, code blocks, their bars and hint, the panel's rows (document coordinates). */
function positions(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll('main h2, main pre, .code-bar, .code-hint, [data-var-row], .variables'),
    ].map((element) => {
      const box = element.getBoundingClientRect();
      return `${element.tagName.toLowerCase()} ${String(Math.round(box.top + window.scrollY))} ${String(Math.round(box.height))}`;
    }),
  );
}

/** Unfolds the Variables panel where it is folded (phones). */
async function unfoldPanel(page: Page, run: Run): Promise<void> {
  const toggle = page.locator('[data-disclosure][aria-controls="variables-body"]');
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false') {
    await press(toggle, run);
    await settle(page);
  }
}

/** Fills the panel's input of `name` (scrolled to, unfolded first) and leaves it. */
async function fillPanel(page: Page, run: Run, name: string, value: string): Promise<void> {
  await unfoldPanel(page, run);
  const input = page.locator(`[data-var-input="${name}"]`);
  await input.fill(value);
  await input.blur();
}

type BlockInfo = { readonly index: number; readonly text: string; readonly names: readonly string[] };

/** Every code block of the page: its text as built (tokens) and the variables of its fields. */
function blocksOf(page: Page): Promise<BlockInfo[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-code-block]')].map((block, index) => {
      const names: string[] = [];
      for (const field of block.querySelectorAll<HTMLElement>('[data-var]')) {
        const name = field.dataset.var ?? '';
        if (!names.includes(name)) names.push(name);
      }
      return { index, text: block.querySelector('pre')?.textContent ?? '', names };
    }),
  );
}

/** A block's text with `values` put in for their tokens, as Copy should give it. */
function filled(text: string, values: Readonly<Record<string, string>>): string {
  return splitVariableTokens(text)
    .map((part) => (typeof part === 'string' ? part : (values[part.token] ?? part.token)))
    .join('');
}

function example(name: string): string {
  return commandVariable(name)?.example ?? 'x';
}

async function fieldTexts(page: Page, name: string): Promise<string[]> {
  return page.locator(`span.var[data-var="${name}"]`).allTextContents();
}

async function copiedText(page: Page, run: Run): Promise<string> {
  if (run.profile.realClipboard) return page.evaluate(() => navigator.clipboard.readText());
  return page.evaluate(() => (window as unknown as { __fillableCopied?: string }).__fillableCopied ?? '');
}

async function statusText(page: Page): Promise<string> {
  return (await page.locator('[data-var-status]').textContent())?.trim() ?? '';
}

async function isFocused(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => element === document.activeElement);
}

async function withoutJavaScript(browser: Browser, base: string, pagePath: string, check: Check, run: Run) {
  const context = await newContext(browser, base, run, false);
  const page = await open(context, `${base}${pagePath}`, false);
  const state = await page.evaluate(() => {
    const shown = (element: Element): boolean => getComputedStyle(element).display !== 'none';
    return {
      editable: document.querySelectorAll('[contenteditable]').length,
      bars: [...document.querySelectorAll('.code-bar, .code-hint')].filter(shown).length,
      inputs: [...document.querySelectorAll('[data-var-input]')].filter(shown).length,
      rows: [...document.querySelectorAll('[data-var-row]')].filter(shown).length,
      fields: document.querySelectorAll('span.var[data-var]').length,
      marks: [...document.querySelectorAll('span.var[data-var]')].filter(
        (field) => getComputedStyle(field, '::after').display !== 'none',
      ).length,
      tokensInCode: [...document.querySelectorAll('pre')].some((pre) =>
        /\bYOUR_[A-Z0-9_]+\b/.test(pre.textContent),
      ),
    };
  });
  if (state.editable > 0) fail(check, `without JavaScript ${String(state.editable)} element(s) are editable`);
  if (state.bars > 0) fail(check, `without JavaScript ${String(state.bars)} Copy bar(s) or hint(s) show`);
  if (state.inputs > 0) fail(check, `without JavaScript ${String(state.inputs)} panel input(s) show`);
  if (state.marks > 0) fail(check, `without JavaScript ${String(state.marks)} field(s) show the edit mark`);
  if (state.fields > 0 && state.rows === 0) fail(check, 'without JavaScript the panel lists no variable');
  if (state.fields > 0 && !state.tokensInCode) fail(check, 'without JavaScript the code shows no token');
  await context.close();
}

async function noShift(browser: Browser, base: string, pagePath: string, check: Check, run: Run) {
  const context = await newContext(browser, base, run);
  const held = await context.newPage();
  await held.route(/\/_astro\/Variables[^/]*\.js$/, (route) => route.abort());
  await held.goto(`${base}${pagePath}`, { waitUntil: 'load' });
  await held.evaluate(() => document.fonts.ready.then(() => undefined));
  await settle(held);
  const before = await positions(held);
  const page = await open(context, `${base}${pagePath}`);
  await hydrated(page);
  const after = await positions(page);
  const moved = before.filter((position, index) => after[index] !== position);
  if (before.length !== after.length || moved.length > 0) {
    fail(
      check,
      `the script moved ${String(moved.length)} of ${String(before.length)} landmarks when it started (first: ${moved[0] ?? '?'} → ${after[before.indexOf(moved[0] ?? '')] ?? '?'})`,
    );
  }
  await context.close();
}

/** Before any interaction: the edit mark on every field, the hint on the page's first block with fields only. */
async function affordance(page: Page, check: Check): Promise<void> {
  const state = await page.evaluate(() => {
    const fields = [...document.querySelectorAll<HTMLElement>('span.var[data-var]')];
    const unmarked = fields.filter((field) => {
      const mark = getComputedStyle(field, '::after');
      const mask = mark.getPropertyValue('mask-image') || mark.getPropertyValue('-webkit-mask-image');
      return mark.display === 'none' || parseFloat(mark.width) < 4 || !mask.includes('url(');
    }).length;
    const blocks = [...document.querySelectorAll('[data-code-block]')];
    const firstWithFields = blocks.findIndex((block) => block.querySelector('pre [data-var]') !== null);
    const hints = blocks
      .map((block, index) => ({ index, hint: block.querySelector<HTMLElement>(':scope > .code-hint') }))
      .filter((item) => item.hint !== null);
    const hint = hints[0]?.hint;
    return {
      fields: fields.length,
      unmarked,
      firstWithFields,
      hintBlocks: hints.map((item) => item.index),
      hintText: hint?.textContent.trim() ?? '',
      hintShown: hint !== undefined && hint !== null && hint.getBoundingClientRect().height > 0,
    };
  });
  if (state.unmarked > 0)
    fail(check, `${String(state.unmarked)} of ${String(state.fields)} fields show no edit mark`);
  if (state.firstWithFields >= 0) {
    if (state.hintBlocks.length !== 1 || state.hintBlocks[0] !== state.firstWithFields)
      fail(
        check,
        `the hint is on code block(s) ${JSON.stringify(state.hintBlocks)}, not on the first with fields (${String(state.firstWithFields)})`,
      );
    else if (!state.hintShown || state.hintText !== FIELD_HINT)
      fail(check, `the hint shows "${state.hintText}" (shown: ${String(state.hintShown)})`);
  }
}

/** On a touch screen: a tap on a field's target, just above or below it, focuses that field; a mouse has none. */
async function tapTarget(page: Page, run: Run, field: Locator, check: Check): Promise<void> {
  await field.scrollIntoViewIfNeeded();
  const box = await field.boundingBox();
  if (box === null) {
    fail(check, 'a field has no box');
    return;
  }
  const x = box.x + box.width / 2;
  const points = [box.y - 6, box.y + box.height + 6].map((y) => ({ x, y }));
  const hits = await page.evaluate(
    ({ points: candidates, target }) => {
      const field = document.elementFromPoint(target.x, target.y)?.closest('span.var[data-var]');
      return {
        target: candidates.map((point) => {
          const element = document.elementFromPoint(point.x, point.y);
          return (
            element !== null &&
            element.classList.contains('var-target') &&
            element.previousElementSibling === field
          );
        }),
        height: (() => {
          const own = field?.parentElement?.querySelector('.var-target');
          return own === null || own === undefined ? 0 : own.getBoundingClientRect().height;
        })(),
      };
    },
    { points, target: { x, y: box.y + box.height / 2 } },
  );
  if (!touch(run)) {
    if (hits.target.some(Boolean) || hits.height > 0) fail(check, 'with a mouse a field has a tap target');
    return;
  }
  if (hits.height < TARGET) fail(check, `a field's tap target is ${hits.height.toFixed(1)} px tall, not 44`);
  const at = points.find((_, index) => hits.target[index] === true);
  if (at === undefined) {
    fail(check, 'neither just above nor just below the field is its tap target');
    return;
  }
  await page.touchscreen.tap(at.x, at.y);
  await settle(page);
  if (!(await isFocused(field)))
    fail(check, `a tap ${at.y < box.y ? 'above' : 'below'} the field did not focus it`);
  await field.evaluate((element) => {
    element.blur();
  });
}

async function interact(
  browser: Browser,
  base: string,
  pagePath: string,
  check: Check,
  run: Run,
  axe: string | undefined,
  shots: string | undefined,
) {
  const context = await newContext(browser, base, run);
  // One variable stands for a secret here, to show that a secret is never stored.
  await context.addInitScript(`
    new MutationObserver(() => {
      document.querySelector('[data-var-row="${SECRET_STAND_IN}"]')?.setAttribute('data-secret', '');
    }).observe(document, { childList: true, subtree: true });
  `);
  const page = await open(context, `${base}${pagePath}`);
  await hydrated(page);
  const shot = (name: string): string =>
    path.join(
      shots ?? '',
      `${name}-${run.profile.id}${pagePath === '/' ? '-landing' : pagePath.replaceAll('/', '-').replace(/-$/, '')}-${run.width === undefined ? 'device' : String(run.width)}-${run.theme}.png`,
    );
  if (axe !== undefined)
    for (const problem of await axeProblems(page, axe)) fail(check, `unfilled: ${problem}`);
  await affordance(page, check);
  /** The page's first code block with fields (it carries the hint), from its left edge. */
  const shootHinted = async (name: string): Promise<void> => {
    const hinted = page.locator('[data-code-block]:has(> .code-hint)').first();
    if (shots === undefined || (await hinted.count()) === 0) return;
    await hinted.scrollIntoViewIfNeeded();
    await hinted.locator('pre').evaluate((pre) => {
      pre.scrollLeft = 0;
    });
    await page.mouse.move(0, 0);
    await hinted.screenshot({ path: shot(name) });
  };
  await shootHinted('hint-block-unedited');

  const blocks = await blocksOf(page);
  // The variable with fields in the most code blocks (then: the most fields), and a block that holds it, with
  // another variable if one does.
  const inBlocks = new Map<string, number>();
  for (const block of blocks)
    for (const name of block.names) inBlocks.set(name, (inBlocks.get(name) ?? 0) + 1);
  const fieldCounts = new Map<string, number>();
  for (const name of inBlocks.keys()) fieldCounts.set(name, (await fieldTexts(page, name)).length);
  const [first] = [...inBlocks.keys()].sort(
    (a, b) =>
      (inBlocks.get(b) ?? 0) - (inBlocks.get(a) ?? 0) ||
      (fieldCounts.get(b) ?? 0) - (fieldCounts.get(a) ?? 0),
  );
  if (first === undefined) {
    fail(check, 'no code block has a field');
    await context.close();
    return;
  }
  if ((inBlocks.get(first) ?? 0) < 2)
    check.notes.push(
      `no variable in two code blocks: ${first}'s ${String(fieldCounts.get(first) ?? 0)} field(s) checked`,
    );
  const block =
    blocks.find((item) => item.names.includes(first) && item.names.length > 1) ??
    blocks.find((item) => item.names.includes(first));
  if (block === undefined) return;
  const second = block.names.find((name) => name !== first);
  const values: Record<string, string> = {};
  const blockLocator = page.locator('[data-code-block]').nth(block.index);
  const field = blockLocator.locator(`span.var[data-var="${first}"]`).first();

  // 1. Hover (a mouse) rings the field; a tap beside it reaches it (a touch screen).
  await field.scrollIntoViewIfNeeded();
  if (!touch(run)) {
    await field.hover();
    if ((await field.evaluate((element) => getComputedStyle(element).boxShadow)) === 'none')
      fail(check, 'a hovered field is not ringed');
  }
  await tapTarget(page, run, field, check);
  if (shots !== undefined) {
    await page.mouse.move(0, 0);
    await blockLocator.screenshot({ path: shot('field-unedited') });
  }

  // 2. A click or tap selects the token; typed after the caret moved into it, a value still replaces all of it.
  await press(field, run);
  await settle(page);
  if (!(await isFocused(field)))
    fail(check, `a ${touch(run) ? 'tap' : 'click'} on a field of ${first} did not focus it`);
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
  if (selected !== first)
    fail(check, `a focused unfilled field of ${first} selects "${selected}", not its token`);
  await page.keyboard.press('ArrowRight');
  values[first] = example(first);
  await page.keyboard.type(values[first]);
  if ((await field.textContent()) !== values[first])
    fail(
      check,
      `typing into the field of ${first} gave "${(await field.textContent()) ?? ''}", not "${values[first]}"`,
    );
  if (shots !== undefined) await blockLocator.screenshot({ path: shot('field-editing') });
  await page.keyboard.press('Enter');
  if (await isFocused(field)) fail(check, 'Enter did not leave the field');
  const firstTexts = await fieldTexts(page, first);
  if (firstTexts.some((text) => text !== values[first])) {
    fail(check, `after typing into one field of ${first}, its fields show ${JSON.stringify(firstTexts)}`);
  }
  if ((await page.locator(`[data-var-input="${first}"]`).inputValue()) !== values[first]) {
    fail(check, `the panel's input of ${first} did not follow the field`);
  }

  // 3. Rich text with a line break, copied and pasted with the keyboard, arrives as one plain line; then the value is
  //    typed back over it.
  await page.evaluate(() => {
    const source = document.createElement('div');
    source.id = 'fillable-paste-source';
    source.contentEditable = 'true';
    source.style.cssText = 'position: fixed; top: 0; left: 0; z-index: 100; background: Canvas;';
    source.innerHTML = '<b>pasted-</b><br><i>line</i>';
    document.body.append(source);
  });
  await page.locator('#fillable-paste-source').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+C');
  await page.evaluate(() => document.getElementById('fillable-paste-source')?.remove());
  const selectField = (): Promise<void> =>
    field.evaluate((element) => {
      element.focus();
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  await field.scrollIntoViewIfNeeded();
  await selectField();
  await page.keyboard.press('ControlOrMeta+V');
  await settle(page);
  const pasted = await field.evaluate((element) => ({
    text: element.textContent,
    elements: element.childElementCount,
  }));
  if (pasted.text !== 'pasted-line' || pasted.elements > 0)
    fail(
      check,
      `a paste left ${JSON.stringify(pasted.text)} (${String(pasted.elements)} element(s)), not "pasted-line"`,
    );
  if ((await fieldTexts(page, first)).some((text) => text !== 'pasted-line'))
    fail(check, `after a paste ${first}'s fields show ${JSON.stringify(await fieldTexts(page, first))}`);
  await selectField();
  await page.keyboard.type(values[first]);
  await page.keyboard.press('Enter');
  if ((await fieldTexts(page, first)).some((text) => text !== values[first]))
    fail(
      check,
      `typed back over the paste, ${first}'s fields show ${JSON.stringify(await fieldTexts(page, first))}`,
    );

  // 4. Fill another variable in the panel: its fields follow.
  if (second !== undefined) {
    values[second] = example(second);
    await fillPanel(page, run, second, values[second]);
    const secondTexts = await fieldTexts(page, second);
    if (secondTexts.some((text) => text !== values[second])) {
      fail(
        check,
        `after filling the panel's input of ${second}, its fields show ${JSON.stringify(secondTexts)}`,
      );
    }
  }
  const note = (await blockLocator.locator('[data-code-note]').textContent()) ?? '';
  const expectedNote = unfilledNote(block.names.filter((name) => values[name] === undefined).length);
  if (note !== expectedNote) fail(check, `the block's note says "${note}", not "${expectedNote}"`);
  if (shots !== undefined) {
    await blockLocator.scrollIntoViewIfNeeded();
    await blockLocator.locator('pre').evaluate((pre) => {
      pre.scrollLeft = 0;
    });
    await blockLocator.screenshot({ path: shot('field-edited') });
  }

  await shootHinted('hint-block-edited');

  // 5. Copy: the block with the values, the unfilled ones as their tokens.
  await press(blockLocator.locator('[data-code-copy]'), run);
  await page
    .waitForFunction(
      () => document.querySelector('[data-var-status]')?.textContent.includes('Copied'),
      undefined,
      {
        timeout: 5000,
      },
    )
    .catch(() => undefined);
  const copied = await copiedText(page, run);
  const expected = filled(block.text, values);
  if (copied !== expected)
    fail(check, `Copy gave ${JSON.stringify(copied)}, not ${JSON.stringify(expected)}`);
  if (!(await statusText(page)).startsWith('Copied'))
    fail(check, `the live region says "${await statusText(page)}"`);
  if ((await blockLocator.locator('[data-copy-label]').textContent()) !== 'Copied') {
    fail(check, 'the Copy button does not say "Copied"');
  }
  if (axe !== undefined)
    for (const problem of await axeProblems(page, axe)) fail(check, `filled: ${problem}`);

  // 6. A value of the wrong format: marked on leaving the field, unmarked once fixed; reached with Tab. A variable
  //    that is not the secret's stand-in where there is one (a page that asks for three values has none other left).
  const checkable = [...inBlocks.keys()].filter((name) => {
    const variable = commandVariable(name);
    return (
      variable !== undefined && values[name] === undefined && !new RegExp(variable.pattern, 'u').test(WRONG)
    );
  });
  const checked = checkable.find((name) => name !== SECRET_STAND_IN) ?? checkable[0];
  if (checked !== undefined) {
    const wrongBlock = page
      .locator('[data-code-block]')
      .filter({ has: page.locator(`span.var[data-var="${checked}"]`) })
      .first();
    const pre = wrongBlock.locator('pre');
    await pre.scrollIntoViewIfNeeded();
    await pre.focus();
    // Tab from the code block reaches its fields, the unfilled one among them.
    let focused = '';
    for (let step = 0; step < 8 && focused !== checked; step += 1) {
      await page.keyboard.press('Tab');
      focused = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.var ?? '');
      if (focused === '') break;
    }
    const wrongField = wrongBlock.locator(`span.var[data-var="${focused}"]`).first();
    if (focused === '') fail(check, 'Tab from a code block does not reach its field');
    else {
      await page.keyboard.type(WRONG);
      await page.keyboard.press('Tab');
      const variable = commandVariable(focused);
      const filledBefore = values[focused] !== undefined;
      const rejects = variable !== undefined && !new RegExp(variable.pattern, 'u').test(WRONG);
      if (rejects && !filledBefore) {
        if ((await wrongField.getAttribute('aria-invalid')) !== 'true')
          fail(check, `${focused}: a wrong value is not marked`);
        await unfoldPanel(page, run);
        if (!(await page.locator(`#var-${focused}-hint`).isVisible()))
          fail(check, `${focused}: the panel's hint does not show`);
        if (!((await wrongBlock.locator('[data-code-note]').textContent()) ?? '').startsWith('Check '))
          fail(check, `${focused}: the block's note does not say what to check`);
        await page.locator(`[data-var-input="${focused}"]`).fill(example(focused));
        if ((await wrongField.getAttribute('aria-invalid')) !== null)
          fail(check, `${focused}: the mark stays once fixed`);
        await page.locator(`[data-var-input="${focused}"]`).blur();
      } else {
        await fillPanel(page, run, focused, example(focused));
      }
      // The secret's value is never kept (step 7), so it is not among the values a reload brings back.
      if (focused !== SECRET_STAND_IN) values[focused] = example(focused);
    }
  }

  // 7. A secret is never stored; the other values are, under one key.
  if ((await page.locator(`[data-var-input="${SECRET_STAND_IN}"]`).count()) > 0)
    await fillPanel(page, run, SECRET_STAND_IN, example(SECRET_STAND_IN));
  const stored = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  const kept = stored === null ? {} : (JSON.parse(stored) as Record<string, unknown>);
  for (const [name, value] of Object.entries(values)) {
    if (kept[name] !== value)
      fail(check, `local storage keeps ${JSON.stringify(kept[name])} for ${name}, not "${value}"`);
  }
  if (SECRET_STAND_IN in kept) fail(check, 'a secret variable was stored');

  if (shots !== undefined) {
    await unfoldPanel(page, run);
    const panel = page.locator('section.variables');
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: shot('panel') });
  }

  // 8. A reload fills them in again; Clear values empties everything.
  await page.reload({ waitUntil: 'load' });
  await hydrated(page);
  for (const [name, value] of Object.entries(values)) {
    const texts = await fieldTexts(page, name);
    if (texts.some((text) => text !== value))
      fail(check, `after a reload ${name}'s fields show ${JSON.stringify(texts)}`);
  }
  if ((await page.locator(`[data-var-input="${SECRET_STAND_IN}"]`).count()) > 0) {
    const texts = await fieldTexts(page, SECRET_STAND_IN);
    if (texts.some((text) => text !== SECRET_STAND_IN)) fail(check, 'after a reload the secret is filled in');
  }
  await unfoldPanel(page, run);
  if (axe !== undefined)
    for (const problem of await axeProblems(page, axe)) fail(check, `panel open: ${problem}`);
  await press(page.locator('[data-var-clear]'), run);
  for (const name of inBlocks.keys()) {
    const texts = await fieldTexts(page, name);
    if (texts.some((text) => text !== name))
      fail(check, `after Clear values ${name}'s fields show ${JSON.stringify(texts)}`);
  }
  if ((await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)) !== null) {
    fail(check, 'Clear values left the storage key');
  }
  if ((await statusText(page)) !== 'Values cleared.')
    fail(check, `after Clear values the live region says "${await statusText(page)}"`);
  await context.close();
}

/** A page with code but no variables: no panel, Copy copies the block as it is. */
async function plainPage(browser: Browser, base: string, check: Check, run: Run): Promise<void> {
  const context = await newContext(browser, base, run);
  const page = await open(context, `${base}/docs/getting-started/`);
  await hydrated(page);
  if ((await page.locator('section.variables').count()) > 0)
    fail(check, 'a page without variables shows the panel');
  if ((await page.locator('.code-hint').count()) > 0) fail(check, 'a page without variables shows the hint');
  const block = page.locator('[data-code-block]').first();
  const text = (await block.locator('pre').textContent()) ?? '';
  await block.locator('[data-code-copy]').click();
  await page.waitForTimeout(200);
  if ((await copiedText(page, run)) !== text) fail(check, 'Copy did not copy the block as it is');
  if ((await statusText(page)) !== 'Copied.') fail(check, `the live region says "${await statusText(page)}"`);
  await context.close();
}

function scriptSize(dist: string): string {
  const dir = path.join(dist, '_astro');
  const file = readdirSync(dir).find((name) => /^Variables\.astro_astro_type_script.*\.js$/.test(name));
  if (file === undefined) return 'the script was not found in _astro/';
  const bytes = readFileSync(path.join(dir, file));
  return `${String(bytes.length)} bytes, ${String(gzipSync(bytes, { level: 9 }).length)} gzipped (_astro/${file})`;
}

function report(check: Check): void {
  const state = check.problems.length === 0 ? 'ok' : `${String(check.problems.length)} problem(s)`;
  console.log(
    `fillable ${check.where.padEnd(56)} ${state}${check.notes.length > 0 ? ` (${check.notes.join('; ')})` : ''}`,
  );
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      page: { type: 'string', multiple: true, default: [] },
      profile: { type: 'string', multiple: true, default: [] },
      shots: { type: 'string' },
      dist: { type: 'string', default: path.join(WEBSITE, 'dist') },
    },
  });
  const dist = path.resolve(values.dist);
  const pages = values.page.length > 0 ? values.page : ['/docs/self-host/', '/'];
  for (const pagePath of pages) {
    if (pagePath !== '/' && !/^\/docs\/[^/]+\/$/.test(pagePath))
      throw new UsageError(`--page ${pagePath}: a docs page (/docs/…/) or the landing page (/)`);
  }
  for (const id of values.profile) {
    if (!PROFILES.some((profile) => profile.id === id))
      throw new UsageError(`--profile ${id}: one of ${PROFILES.map((profile) => profile.id).join(', ')}`);
  }
  if (!existsSync(path.join(dist, 'index.html'))) {
    console.error(`website fillable: no built site in ${dist}; run \`pnpm website:build\` first`);
    return 1;
  }
  const shots = values.shots === undefined ? undefined : path.resolve(values.shots);
  if (shots !== undefined) mkdirSync(shots, { recursive: true });
  const axe = axeSource();
  const profiles = PROFILES.filter(
    (profile) => values.profile.length === 0 || values.profile.includes(profile.id),
  );
  const firefoxData = mkdtempSync(path.join(tmpdir(), 'gcportrait-fillable-firefox-'));
  const { base, close } = await serve(dist);
  const problems: string[] = [];
  try {
    for (const profile of profiles) {
      if (!existsSync(profile.engine.executablePath())) {
        problems.push(
          `${profile.label}: the browser is not installed; run \`pnpm --filter @gcportrait/website exec playwright install ${profile.engine.name()}\``,
        );
        continue;
      }
      const browser = await profile.engine.launch(
        profile.engine === firefox
          ? { env: { ...process.env, MOZ_APP_DATA: firefoxData, MOZ_LOCAL_APP_DATA: firefoxData } }
          : {},
      );
      try {
        for (const pagePath of pages) {
          for (const width of profile.device === undefined ? profile.widths : [undefined]) {
            for (const theme of THEMES) {
              const run: Run = { profile, width, theme };
              const size = width === undefined ? 'device' : `${String(width)} px`;
              const check: Check = {
                problems: [],
                notes: [],
                where: `${profile.label} ${pagePath} ${size} ${theme}`,
              };
              if (profile.full) {
                await withoutJavaScript(browser, base, pagePath, check, run);
                await noShift(browser, base, pagePath, check, run);
              }
              await interact(browser, base, pagePath, check, run, profile.full ? axe : undefined, shots);
              report(check);
              problems.push(...check.problems);
            }
          }
        }
        if (profile.full) {
          const plain: Check = { problems: [], notes: [], where: `${profile.label} /docs/getting-started/` };
          await plainPage(browser, base, plain, { profile, width: profile.widths[0], theme: 'light' });
          report(plain);
          problems.push(...plain.problems);
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    await close();
    rmSync(firefoxData, { recursive: true, force: true });
  }
  console.log(`client script: ${scriptSize(dist)}`);
  if (problems.length > 0) {
    console.error(`\nwebsite fillable: ${String(problems.length)} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }
  console.log(
    `\nwebsite fillable: OK (${profiles.map((profile) => profile.label).join(', ')} on ${pages.join(' and ')}: edit marks and hint; tap targets; fields selected, typed over, in step with the panel and each other; pastes as plain text; Copy; format hints; storage, secrets and Clear values${profiles.some((profile) => profile.full) ? '; no JavaScript, no shift at start, axe at 1440 and 375 px, light and dark' : ''}).`,
  );
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof UsageError) {
      console.error(`website fillable: ${error.message}`);
      process.exitCode = 2;
    } else {
      console.error(error);
      process.exitCode = 1;
    }
  },
);
