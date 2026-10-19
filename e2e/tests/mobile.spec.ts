// SPDX-License-Identifier: Apache-2.0
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

import { ALL_SCOPES, stubGoogle, TEST_CLIENT_ID, TOKENINFO_URL } from '../fixtures/gis.js';
import { stubConfig, test } from '../fixtures/live.js';
import { LIVE_URL } from '../fixtures/servers.js';
import { fold, openSheet, TABLET_FROM, TARGET, type Fold } from './handheldSupport.js';
import {
  boxOf,
  cameraSettled,
  DEFAULT_SOURCE_URL,
  demoCaiExport,
  detailsDrawer,
  expectNoAxeViolations,
  exportOperation,
  openDiagram,
  viewParam,
  type Box,
} from './support.js';
import {
  coveredByThumbRing,
  focusRingShown,
  keyToDrawnDay,
  markersCoveredByThumbRing,
  timelineBar,
} from './timelineSupport.js';
import { Fingers } from './touchSupport.js';

/**
 * The app's phone and tablet check: the `mobile` project of playwright.config.ts, run with
 * `pnpm --filter @gcportrait/frontend mobile`. Chromium emulates touch at 2×; SIZES and SIDEWAYS name the
 * portrait and landscape viewports. Pages and diagrams run in light and dark, with demo S and M.
 * Normal-mode pages use fixtures/live.ts and fixtures/gis.ts to stand in for the backend and Google:
 * Connect signed out and in, Permissions, legal pages and the Account panel with a long work address.
 * Snapshots is also checked with an imported snapshot and a cached day, so its tables contain rows.
 * Diagram states include View and More, their menus and dialogs, search results and the details drawer.
 *
 * layoutProblems checks overflow, squeezed text, chrome geometry and touch targets; hiddenControls checks
 * focused controls remain visible and tappable. canvasRoom, rowProblems and sheetRoom measure the space
 * left for the drawing. Their comments and assertions hold the conditions and exceptions; expectClean
 * combines the probes with axe. The tests below cover timeline focus rings and phone interactions:
 * sheets and focus, the breadcrumb, the drawer's handle and camera framing.
 * pagesAndDiagrams documents the order: light pages and diagrams, tests with their own sizes, then dark
 * pages and diagrams. Accessibility coverage and per-state checks are defined beside the tests.
 */

const SIZES = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 820, height: 1180 },
] as const;
const SIDEWAYS = [
  { width: 568, height: 320 },
  { width: 640, height: 360 },
  { width: 667, height: 375 },
  { width: 844, height: 390 },
] as const;
const PAGES = [
  { path: '/', heading: 'Connect' },
  { path: '/snapshots', heading: 'Snapshots' },
  { path: '/settings', heading: 'Settings' },
] as const;
const DIAGRAMS = ['/diagram#snapshot=demo:S', '/diagram#snapshot=demo:M'] as const;
/** Demo M drilled in to a project five levels down: a trail longer than a phone's top bar. */
const DEEP_TRAIL = `/diagram#snapshot=demo:M&root=${encodeURIComponent('//cloudresourcemanager.googleapis.com/projects/10000000025')}`;
/** A legal text with what a phone has to wrap: a long address, a long word, inline code, a list. */
const LEGAL_TEXT = [
  '# Impressum',
  '',
  'Example Ltd., 1 Example Street, 10115 Example City. Contact: legal@example.com, https://www.example.com/legal/contact-and-imprint-information-for-this-instance.',
  '',
  '## Responsible for the content',
  '',
  '- Ada Example, `Telecommunications-Digital-Services-Act` Section 5',
  '- Supervisory authority: Datenschutzaufsichtsbehörde Musterstadt',
].join('\n');
/** A live instance with Google sign-in and service-account mode, as the sign-in spec configures it. */
const LIVE_CONFIG = {
  sourceUrl: DEFAULT_SOURCE_URL,
  oauthClientId: TEST_CLIENT_ID,
  saMode: true,
  backendServiceAccount: 'gcportrait-backend@example.com',
  hostedBy: 'Hosted by Example Ltd.',
} as const;
/** A work account's long address, for the Account panel. */
const LONG_EMAIL = 'firstname.middlename.lastname@platform-engineering.example-company.example.com';
/** The stand-in for Google's sign-in hands out this fake token. */
const FAKE_TOKEN = 'e2e-fake-access-token-mobile-4d2e';
/**
 * What the scope search answers, of the kinds asked for. Signed in, a scope picker searches as soon as it has focus,
 * which the walk of every control's focus gives it (the scope's picker asks for every kind, the quota project's for
 * projects).
 */
const SCOPES = [
  { kind: 'organization', scope: 'organizations/30000000001', id: '30000000001', displayName: 'example.com' },
  {
    kind: 'folder',
    scope: 'folders/20000000001',
    id: '20000000001',
    displayName: 'Web shop',
    parent: 'organizations/30000000001',
  },
  {
    kind: 'project',
    scope: 'projects/demo-web-1',
    id: 'demo-web-1',
    displayName: 'Web front end',
    parent: 'folders/20000000001',
  },
] as const;
/**
 * A phone's canvas shorter than this hides the disclosure bar's row while the details sheet is open at half height
 * (20.25rem at a 16-pixel rem, `CONTAINER.shortCanvas` of frontend/src/ui/screen.ts).
 */
const SHORT_CANVAS = 20.25 * 16;
/** When the export of demo organisation S was taken, as its operation.json says. */
const EXPORT_READ_TIME = '2026-10-05T14:30:00Z';

test.use({ isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

/** This worker's export of demo organisation S and its operation.json, once written. */
let exported: readonly string[] | undefined;

/**
 * Demo organisation S on 5 October as an export of `organizations/30000000001` (`demoCaiExport`, as extra-ticks.spec.ts
 * takes demo M's) and its operation.json, written once per worker under the test output: imported, it is a stored
 * snapshot and an extra tick on its scope's timeline, a row in each of the Snapshots page's tables.
 */
function demoExport(testInfo: TestInfo): readonly string[] {
  if (exported !== undefined) return exported;
  const lines = demoCaiExport(testInfo, 'S', '2026-10-05');
  const operation = path.join(path.dirname(lines), 'operation.json');
  writeFileSync(operation, exportOperation('organizations/30000000001', EXPORT_READ_TIME));
  exported = [lines, operation];
  return exported;
}

/**
 * A day of demo organisation S's scope as its timeline caches a day read from Cloud Asset Inventory (the tick cache of
 * the app's IndexedDB, storage/tickCache.ts): a cached day on the scope's timeline on the Snapshots page, and its
 * "Delete the cached days of …" button, which names the scope.
 */
function cacheADay(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const opening = indexedDB.open('gcportrait');
        opening.onerror = () => {
          reject(opening.error ?? new Error('IndexedDB did not open'));
        };
        opening.onsuccess = () => {
          const db = opening.result;
          const scope = 'organizations/30000000001';
          const readTime = '2026-10-04T00:00:00Z';
          const writing = db.transaction('tickCache', 'readwrite');
          writing.objectStore('tickCache').put({
            key: JSON.stringify([scope, readTime, 'RESOURCE', '*']),
            scope,
            readTime,
            day: '2026-10-04',
            contentType: 'RESOURCE',
            now: false,
            actualReadTime: readTime,
            fetchedAt: '2026-10-06T09:00:00.000Z',
            assetCount: 40,
            bytes: 1_000,
            blob: new Blob(['{}']),
          });
          writing.oncomplete = () => {
            db.close();
            resolve();
          };
          writing.onerror = () => {
            db.close();
            reject(writing.error ?? new Error('the tick cache refused the day'));
          };
        };
      }),
  );
}

/**
 * Overflow, squeezed text, the top bar's items, touch targets: the problems of the page as it is now.
 * Keep in step with its twin, website/scripts/mobile.ts (layoutProblems).
 */
function layoutProblems(page: Page): Promise<string[]> {
  const size = page.viewportSize();
  if (size === null) throw new Error('no viewport');
  return page.evaluate(
    ({ minimum, screen }) => {
      const problems: string[] = [];
      const width = document.documentElement.clientWidth;
      const name = (element: Element): string => {
        const label = element.getAttribute('aria-label') ?? element.textContent;
        const text = label.trim().replace(/\s+/g, ' ').slice(0, 30);
        const role = element.getAttribute('role');
        return `<${element.tagName.toLowerCase()}${role === null ? '' : ` role=${role}`}>${text === '' ? '' : ` "${text}"`}`;
      };
      // Laid out, visible, and not in the folded part of a closed <details> (whose content keeps a box, unrendered).
      const shown = (element: Element): boolean => {
        const box = element.getBoundingClientRect();
        return (
          box.width > 0 &&
          box.height > 0 &&
          getComputedStyle(element).visibility !== 'hidden' &&
          element.checkVisibility()
        );
      };
      // Text for assistive technology only (.visually-hidden): absolutely placed and clipped to nothing.
      const visuallyHidden = (element: Element): boolean => {
        for (let at: Element | null = element; at !== null; at = at.parentElement) {
          const style = getComputedStyle(at);
          const clip = style.getPropertyValue('clip');
          if (
            style.position === 'absolute' &&
            ((clip !== '' && clip !== 'auto') || style.clipPath !== 'none')
          )
            return true;
        }
        return false;
      };
      const scrolledOrClipped = (element: Element): boolean => {
        for (
          let parent = element.parentElement;
          parent !== null && parent !== document.body;
          parent = parent.parentElement
        ) {
          if (getComputedStyle(parent).overflowX !== 'visible') return true;
        }
        return false;
      };
      // The drawing itself (the diagram's nodes and lines) is the canvas's, not the chrome's.
      const inDrawing = (element: Element): boolean => element.closest('svg.dg-canvas') !== null;

      const scrollWidth = document.documentElement.scrollWidth;
      if (scrollWidth > width)
        problems.push(`the page scrolls sideways (${String(scrollWidth)} > ${String(width)} px)`);
      // A phone lays a page out as wide as what reaches furthest right, then zooms out or lets it slide: the layout is
      // then wider than the window, and the page's own scroll widths agree with it.
      if (window.innerWidth > screen.width + 0.5)
        problems.push(
          `the page is laid out wider than the window (${String(window.innerWidth)} > ${String(screen.width)} px)`,
        );
      // The shell is as tall as the window and its page scrolls inside it: the document scrolling up and down means
      // something lies outside the box that scrolls the page (text for assistive technology only, placed where the page
      // box would have clipped it), and a swipe moves the top bar and the footer off screen.
      const root = document.scrollingElement ?? document.documentElement;
      if (root.scrollHeight > root.clientHeight + 1)
        problems.push(
          `the page itself scrolls up and down (${String(root.scrollHeight)} > ${String(root.clientHeight)} px)`,
        );
      const outside: string[] = [];
      for (const element of document.body.querySelectorAll('*')) {
        const box = element.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue;
        if (box.left >= -0.5 && box.right <= width + 0.5) continue;
        if (visuallyHidden(element) || scrolledOrClipped(element) || inDrawing(element)) continue;
        outside.push(`${name(element)} at ${String(Math.round(box.left))}–${String(Math.round(box.right))}`);
      }
      if (outside.length > 0) {
        problems.push(
          `${String(outside.length)} element(s) reach past the viewport (0–${String(width)}): ${outside.slice(0, 4).join('; ')}`,
        );
      }
      // A box that scrolls sideways where nothing is meant to (a code block or a table may).
      const sideways: string[] = [];
      for (const element of document.body.querySelectorAll('*')) {
        const overflow = getComputedStyle(element).overflowX;
        if (overflow !== 'auto' && overflow !== 'scroll') continue;
        if (
          element.closest('pre, table, svg') !== null ||
          element.querySelector(':scope > table, :scope > pre') !== null ||
          element.matches('header nav[aria-label="Scope"]')
        )
          continue;
        if (!shown(element)) continue;
        if (element.scrollWidth > element.clientWidth + 1)
          sideways.push(
            `${name(element)} (${String(element.scrollWidth)} > ${String(element.clientWidth)} px)`,
          );
      }
      if (sideways.length > 0)
        problems.push(
          `${String(sideways.length)} box(es) scroll sideways: ${sideways.slice(0, 4).join('; ')}`,
        );

      // Text squeezed into a column a few characters wide: broken inside its words onto more lines than it has words, in
      // a box narrower than 6 em (its first box that is not inline: a code block in a table's cell).
      const squeezed: string[] = [];
      const texts = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = texts.nextNode(); node !== null; node = texts.nextNode()) {
        const text = (node.textContent ?? '').trim();
        const parent = node.parentElement;
        if (
          text.length < 12 ||
          parent === null ||
          !shown(parent) ||
          visuallyHidden(parent) ||
          inDrawing(parent)
        )
          continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const lines = new Set([...range.getClientRects()].map((line) => Math.round(line.top))).size;
        if (lines <= text.split(/\s+/).length + 1) continue;
        let block: Element = parent;
        while (block.parentElement !== null && /^(inline|contents)/.test(getComputedStyle(block).display))
          block = block.parentElement;
        const style = getComputedStyle(block);
        const room = block.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        if (room < 6 * parseFloat(getComputedStyle(parent).fontSize))
          squeezed.push(
            `${name(block)} ${String(Math.round(room))} px wide: "${text.slice(0, 24)}" on ${String(lines)} lines`,
          );
      }
      if (squeezed.length > 0)
        problems.push(
          `${String(squeezed.length)} text(s) squeezed into a narrow column: ${squeezed.slice(0, 4).join('; ')}`,
        );

      // The top bar's own items (not those of an open sheet, which lies over the bar's lower edge by design).
      const items = [...document.querySelectorAll('header a[href], header button, header input')].filter(
        (item) => shown(item) && !visuallyHidden(item) && item.closest('[role="dialog"]') === null,
      );
      items.forEach((item, index) => {
        const a = item.getBoundingClientRect();
        if (a.left < -0.5 || a.right > width + 0.5) {
          if (!scrolledOrClipped(item)) problems.push(`the top bar's ${name(item)} leaves the viewport`);
        }
        for (const other of items.slice(index + 1)) {
          if (item.contains(other) || other.contains(item)) continue;
          const b = other.getBoundingClientRect();
          const overlap =
            Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
            Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
          if (overlap > 1) problems.push(`the top bar's ${name(item)} and ${name(other)} overlap`);
        }
      });

      // The details drawer lies over the canvas: neither it nor what it holds reaches past the canvas, but what a box
      // inside it scrolls (and clips) and its handle, a strip centred on its edge.
      const drawer = document.querySelector('aside[aria-label="Details"]:not([hidden])');
      const canvas = document.getElementById('diagram-canvas')?.getBoundingClientRect();
      if (drawer !== null && canvas !== undefined && shown(drawer)) {
        const clippedInside = (element: Element): boolean => {
          for (let at = element.parentElement; at !== null && at !== drawer; at = at.parentElement) {
            const style = getComputedStyle(at);
            if (style.overflowX !== 'visible' || style.overflowY !== 'visible') return true;
          }
          return false;
        };
        const past: string[] = [];
        for (const element of [drawer, ...drawer.querySelectorAll('*')]) {
          if (element !== drawer && clippedInside(element)) continue;
          const box = element.getBoundingClientRect();
          if (box.width === 0 && box.height === 0) continue;
          if (
            box.left < canvas.left - 0.5 ||
            box.right > canvas.right + 0.5 ||
            box.top < canvas.top - 0.5 ||
            box.bottom > canvas.bottom + 0.5
          )
            past.push(
              `${name(element)} at ${[box.left, box.top, box.right, box.bottom].map((n) => String(Math.round(n))).join(',')}`,
            );
        }
        if (past.length > 0)
          problems.push(
            `the drawer reaches past the canvas (${[canvas.left, canvas.top, canvas.right, canvas.bottom].map((n) => String(Math.round(n))).join(',')}): ${past.slice(0, 4).join('; ')}`,
          );
      }

      // The timeline bar's parts lie side by side or one under the other, never over each other, and inside the bar: the
      // slider (its thumb's touch box, the day markers under its track and the dates at its ends, which may touch each
      // other), the bar's title, each line of the readout, each button and radio button.
      const timeline = document.querySelector('section[aria-label="Timeline"]');
      if (timeline !== null && shown(timeline)) {
        const bar = timeline.getBoundingClientRect();
        const slider = timeline.querySelector('[role="slider"]');
        const parts: { readonly group: Element; readonly label: string; readonly box: DOMRect }[] = [];
        const add = (group: Element, label: string, box: DOMRect): void => {
          if (box.width > 0 && box.height > 0) parts.push({ group, label, box });
        };
        if (slider !== null) {
          add(slider, name(slider), slider.getBoundingClientRect());
          for (const marker of timeline.querySelectorAll('[data-day]'))
            add(
              slider,
              `the marker of ${marker.getAttribute('data-day') ?? '?'}`,
              marker.getBoundingClientRect(),
            );
        }
        // Text shown for the eye only: the dates at the slider's ends (with the slider) and the title.
        for (const text of timeline.querySelectorAll('[aria-hidden="true"]')) {
          const words = text.textContent.trim();
          if (words === '' || text.closest('button') !== null || !shown(text)) continue;
          add(
            /\d/.test(words) && slider !== null ? slider : text,
            `"${words}"`,
            text.getBoundingClientRect(),
          );
        }
        const readout = timeline.querySelector('[data-testid="timeline-readout"]');
        if (readout !== null) {
          const text = document.createRange();
          text.selectNodeContents(readout);
          for (const line of text.getClientRects())
            add(readout, `the readout "${readout.textContent.slice(0, 30)}"`, line);
        }
        for (const control of timeline.querySelectorAll('button, [role="radio"]'))
          if (shown(control)) add(control, name(control), control.getBoundingClientRect());
        const over: string[] = [];
        parts.forEach((part, index) => {
          const { box } = part;
          if (
            box.top < bar.top - 0.5 ||
            box.bottom > bar.bottom + 0.5 ||
            box.left < bar.left - 0.5 ||
            box.right > bar.right + 0.5
          )
            over.push(`${part.label} leaves the bar`);
          for (const other of parts.slice(index + 1)) {
            if (other.group === part.group) continue;
            const area =
              Math.max(0, Math.min(box.right, other.box.right) - Math.max(box.left, other.box.left)) *
              Math.max(0, Math.min(box.bottom, other.box.bottom) - Math.max(box.top, other.box.top));
            if (area > 1) over.push(`${part.label} and ${other.label}`);
          }
        });
        if (over.length > 0)
          problems.push(`the timeline bar's parts overlap: ${[...new Set(over)].slice(0, 4).join('; ')}`);
      }

      // A segmented control (ui/SegmentedControl, a radio group) wraps its segments onto more rows where one row is too
      // narrow for them: a segment that starts a row, its left edge on the group's inner left edge, draws no border at
      // its left, which would stand there as a stray divider beside the group's own outline. (Its size is a target's,
      // checked below.)
      const strayDividers: string[] = [];
      for (const group of document.querySelectorAll('[role="radiogroup"]')) {
        if (!shown(group)) continue;
        const label = document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent;
        const inner = group.getBoundingClientRect().left + group.clientLeft;
        for (const segment of group.querySelectorAll('[role="radio"]')) {
          if (!shown(segment) || Math.abs(segment.getBoundingClientRect().left - inner) > 0.5) continue;
          const style = getComputedStyle(segment);
          const drawn =
            parseFloat(style.borderLeftWidth) > 0 &&
            !['none', 'hidden'].includes(style.borderLeftStyle) &&
            !/^(transparent|rgba\(.*,\s*0\))$/.test(style.borderLeftColor);
          if (drawn)
            strayDividers.push(
              `${name(segment)} of ${label === undefined ? name(group) : `"${label}"`} (${style.borderLeftWidth} ${style.borderLeftStyle})`,
            );
        }
      }
      if (strayDividers.length > 0)
        problems.push(
          `${String(strayDividers.length)} segment(s) start a row with a divider at their left: ${strayDividers.slice(0, 4).join('; ')}`,
        );

      const TARGETS = [
        'a[href]',
        'button',
        'summary',
        'input:not([type="hidden"])',
        'select',
        'textarea',
        '[role="slider"]',
        '[role="separator"][tabindex]',
        '[role="radio"]',
        '[role="menuitem"]',
        '[role="menuitemradio"]',
        '[role="menuitemcheckbox"]',
        '[role="option"]',
        '[role="checkbox"]',
        '[role="switch"]',
        '[role="tab"]',
      ].join(', ');
      const small: string[] = [];
      const seen = new Set<Element>();
      for (const element of document.querySelectorAll(TARGETS)) {
        // A checkbox or a radio button is pressed through its label.
        const input =
          element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio');
        const target = input ? (element.closest('label') ?? element) : element;
        if (seen.has(target)) continue;
        seen.add(target);
        if (!shown(target) || visuallyHidden(target) || inDrawing(target)) continue;
        // A skip link shows only while it has focus.
        if (target.matches('a[href^="#"]') && target.getBoundingClientRect().bottom <= 0) continue;
        // Text: a link in a sentence, a field in a line of code (a fillable command, whose value the Variables panel's
        // own field also takes).
        if (getComputedStyle(target).display === 'inline' || target.closest('pre, code') !== null) continue;
        const box = target.getBoundingClientRect();
        if (box.width < minimum || box.height < minimum) {
          small.push(`${name(target)} ${String(Math.round(box.width))}×${String(Math.round(box.height))}`);
        }
      }
      if (small.length > 0) {
        problems.push(`${String(small.length)} target(s) under 44 × 44 px: ${small.slice(0, 6).join('; ')}`);
      }
      return problems;
    },
    { minimum: TARGET, screen: size },
  );
}

/**
 * Every box that scrolls sideways, a table's and a code block's included (which `layoutProblems` lets scroll), but the
 * breadcrumb, which rests at its end: for a page where nothing is meant to.
 */
function sidewaysBoxes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    for (const element of document.body.querySelectorAll('*')) {
      const overflow = getComputedStyle(element).overflowX;
      if (overflow !== 'auto' && overflow !== 'scroll') continue;
      if (element.matches('header nav[aria-label="Scope"]')) continue;
      if (element.scrollWidth > element.clientWidth + 1)
        found.push(
          `<${element.tagName.toLowerCase()} class="${element.className}"> (${String(element.scrollWidth)} > ${String(element.clientWidth)} px)`,
        );
    }
    return found;
  });
}

/**
 * The controls one reaches with Tab (not the drawing's own nodes) that are out of sight when focused or cannot be
 * tapped. Inside the innermost open dialog or sheet when there is one (their focus trap keeps Tab there), else on the
 * whole page: each is focused, which scrolls the boxes it is in (the page, the drawer, the breadcrumb) to it, and then
 * its whole target, not only its middle, must be in sight: each of its boxes (a link in a sentence may wrap onto two
 * lines) lies wholly inside the viewport and, for a control over the diagram's canvas (in the canvas, or in a panel
 * over it: the details drawer, the View or More sheet), wholly inside the canvas, so a 44-pixel target that the
 * timeline bar or the top bar cuts by a pixel fails. The point at its centre and the points just inside the middle of
 * each of its edges must be the control (or its label) rather than something lying over it (the drawer over the
 * drawing, its handle over the top of its own content, the disclosure bar above the sheet, the View button beside the
 * breadcrumb) or the box it scrolls in, clipped (a crumb half out of the trail's box). Focus and every box's scroll
 * position are put back afterwards.
 */
async function hiddenControls(page: Page): Promise<string[]> {
  // A key pressed first: focus moved from script then shows as keyboard focus does (`:focus-visible`), skip links
  // included.
  await page.keyboard.press('Shift');
  return page.evaluate(() => {
    const problems: string[] = [];
    // Laid out, visible, and not in the folded part of a closed <details> (whose content keeps a box, unrendered).
    const shown = (element: Element): boolean => {
      const box = element.getBoundingClientRect();
      return (
        box.width > 0 &&
        box.height > 0 &&
        getComputedStyle(element).visibility !== 'hidden' &&
        element.checkVisibility()
      );
    };
    const visuallyHidden = (element: Element): boolean => {
      for (let at: Element | null = element; at !== null; at = at.parentElement) {
        const style = getComputedStyle(at);
        const clip = style.getPropertyValue('clip');
        if (style.position === 'absolute' && ((clip !== '' && clip !== 'auto') || style.clipPath !== 'none'))
          return true;
      }
      return false;
    };
    const name = (element: Element): string => {
      const label = element.getAttribute('aria-label') ?? element.textContent;
      const text = label.trim().replace(/\s+/g, ' ').slice(0, 30);
      const role = element.getAttribute('role');
      return `<${element.tagName.toLowerCase()}${role === null ? '' : ` role=${role}`}>${text === '' ? '' : ` "${text}"`}`;
    };
    const before = document.activeElement;
    const scrolled = [
      document.scrollingElement ?? document.documentElement,
      ...document.querySelectorAll('*'),
    ]
      .filter((box) => box.scrollWidth > box.clientWidth || box.scrollHeight > box.clientHeight)
      .map((box) => ({ box, left: box.scrollLeft, top: box.scrollTop }));
    const dialogs = [...document.querySelectorAll('[role="dialog"], dialog[open]')].filter(shown);
    const innermost = dialogs.filter(
      (dialog) => !dialogs.some((other) => other !== dialog && dialog.contains(other)),
    );
    const scope = innermost.at(-1) ?? document.body;
    const tabbable = scope.querySelectorAll<HTMLElement>(
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]',
    );
    // The diagram's canvas, while it shows: what lies over it (in it, or in a panel over it) stays inside it.
    const canvasElement = document.getElementById('diagram-canvas');
    const canvas =
      canvasElement !== null && shown(canvasElement) ? canvasElement.getBoundingClientRect() : null;
    // One of the screen's pixels and layout's rounding: the scroll position focus sets snaps to the screen's pixels,
    // which can leave a control scrolled into view that much past the edge of the box it scrolls in.
    const ROUNDING = 1 / window.devicePixelRatio + 0.05;
    const px = (n: number): string => String(Math.round(n * 10) / 10);
    /** How far `part` reaches past each edge of `frame` that it crosses, in words. */
    const past = (part: DOMRect, frame: DOMRect, what: string): string[] =>
      (
        [
          ['left', frame.left - part.left],
          ['top', frame.top - part.top],
          ['right', part.right - frame.right],
          ['bottom', part.bottom - frame.bottom],
        ] as const
      )
        .filter(([, by]) => by > ROUNDING)
        .map(([edge, by]) => `${px(by)} px past the ${what}'s ${edge} edge`);
    const viewport = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    for (const element of tabbable) {
      if (element.tabIndex < 0 || element.closest('svg.dg-canvas, [inert]') !== null) continue;
      if ((element instanceof HTMLButtonElement || element instanceof HTMLInputElement) && element.disabled)
        continue;
      if (!shown(element)) continue;
      element.focus();
      // Text for assistive technology only (a skip link shows once focused, and is checked then).
      if (visuallyHidden(element)) continue;
      const label = element instanceof HTMLInputElement ? element.closest('label') : null;
      const over =
        canvas !== null &&
        (canvasElement?.contains(element) === true || element.closest('[data-canvas-overlay]') !== null);
      // Each of its boxes (a link in a sentence may wrap onto two lines), whole.
      for (const part of element.getClientRects()) {
        if (part.width <= 0 || part.height <= 0) continue;
        const at = `${name(element)} at ${[part.left, part.top, part.right, part.bottom].map(px).join(',')}`;
        const outside = [...past(part, viewport, 'window'), ...(over ? past(part, canvas, 'canvas') : [])];
        if (outside.length > 0) {
          problems.push(`${at} reaches ${outside.join(' and ')} when focused`);
          break;
        }
        // Its middle and just inside the middle of each edge: a point there is the control, not what covers or clips it.
        const inset = (size: number): number => Math.min(2, size / 4);
        const x = part.left + part.width / 2;
        const y = part.top + part.height / 2;
        const points = [
          ['middle', x, y],
          ['top', x, part.top + inset(part.height)],
          ['bottom', x, part.bottom - inset(part.height)],
          ['left', part.left + inset(part.width), y],
          ['right', part.right - inset(part.width), y],
        ] as const;
        const covered = points
          .map(([where, left, top]) => ({ where, hit: document.elementFromPoint(left, top) }))
          .find(({ hit }) => hit === null || !(element.contains(hit) || label?.contains(hit) === true));
        if (covered !== undefined) {
          problems.push(
            `${at} is ${covered.hit === null ? 'out of sight' : `under ${name(covered.hit)}`} at its ${covered.where} when focused`,
          );
          break;
        }
      }
    }
    if (before instanceof HTMLElement || before instanceof SVGElement) before.focus();
    else (document.activeElement as HTMLElement | null)?.blur();
    for (const { box, left, top } of scrolled) {
      box.scrollLeft = left;
      box.scrollTop = top;
    }
    return problems;
  });
}

/** How much of the canvas the window shows, and how much of it the open drawer leaves in view (fractions). */
function canvasRoom(page: Page): Promise<{ readonly ofWindow: number; readonly uncovered: number }> {
  return page.evaluate(() => {
    const canvas = document.getElementById('diagram-canvas')?.getBoundingClientRect();
    if (canvas === undefined || canvas.height <= 0) return { ofWindow: 0, uncovered: 0 };
    const drawer = document
      .querySelector('aside[aria-label="Details"]:not([hidden])')
      ?.getBoundingClientRect();
    const covered =
      drawer === undefined
        ? 0
        : Math.max(0, Math.min(canvas.right, drawer.right) - Math.max(canvas.left, drawer.left)) *
          Math.max(0, Math.min(canvas.bottom, drawer.bottom) - Math.max(canvas.top, drawer.top));
    return {
      ofWindow: canvas.height / window.innerHeight,
      uncovered: 1 - covered / (canvas.width * canvas.height),
    };
  });
}

/**
 * The state on screen has no layout problem, no axe violation (unless `axe` is false: a state checked at another
 * size already; scoped to `axeScope` when given) and, with `focus`, no control out of sight or untappable (a state
 * with nothing open that focus would close: not a list or a menu, which close when focus leaves them).
 */
async function expectClean(
  page: Page,
  where: string,
  {
    axe = true,
    axeScope,
    focus = false,
  }: {
    readonly axe?: boolean | undefined;
    readonly axeScope?: string | undefined;
    readonly focus?: boolean | undefined;
  } = {},
): Promise<void> {
  expect(await layoutProblems(page), where).toEqual([]);
  if (focus) expect(await hiddenControls(page), `${where}: controls out of sight or untappable`).toEqual([]);
  if (axe) await expectNoAxeViolations(page, axeScope);
}

async function closeSheet(page: Page, name: Fold): Promise<void> {
  const { button, sheet } = fold(page, name);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(button).toBeFocused();
}

/** Selects the first card (or, at the folder level, zone) drawn inside the canvas through the address, which opens the
 * details drawer. */
async function selectACard(page: Page, svg: Locator): Promise<void> {
  const id = await svg.evaluate((element) => {
    const canvas = element.getBoundingClientRect();
    for (const node of element.querySelectorAll('.dg-card[data-id], .dg-zone[data-id]')) {
      const box = node.getBoundingClientRect();
      if (
        box.top >= canvas.top &&
        box.bottom <= canvas.bottom &&
        box.left >= canvas.left &&
        box.right <= canvas.right
      )
        return node.getAttribute('data-id');
    }
    return element.querySelector('.dg-card[data-id], .dg-zone[data-id]')?.getAttribute('data-id') ?? null;
  });
  expect(id).not.toBeNull();
  await page.evaluate((selection) => {
    window.location.hash = `${window.location.hash.slice(1)}&selection=${encodeURIComponent(selection)}`;
  }, id ?? '');
  await expect(detailsDrawer(page)).toBeVisible();
}

/**
 * At each of the five sizes in one theme: the Connect, Permissions, Snapshots and Settings pages, a live instance's
 * Impressum and Privacy pages, and the diagrams of demo S and M, this spec's slow tests. The light theme's come first
 * in the file and the dark theme's last, with the tests that set their own sizes in between. CI's phones and tablets
 * legs each take every other test of the listing (scripts/leg.ts), so each runs one of the two diagrams at every size
 * in both themes.
 */
function pagesAndDiagrams(theme: 'light' | 'dark'): void {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    for (const size of SIZES) {
      const axeAtSize = theme === 'light' || size.width === 375 || size.width === 820;
      test.describe(`${String(size.width)} × ${String(size.height)}`, () => {
        test.use({ viewport: size });

        test('the Connect, Permissions, Snapshots and Settings pages flow without sideways scrolling', async ({
          page,
        }) => {
          for (const { path, heading } of PAGES) {
            await page.goto(path);
            await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
            await page.evaluate(async () => {
              await document.fonts.ready;
            });
            await expectClean(page, `${path} at rest`, { axe: axeAtSize, focus: true });
            await openSheet(page, 'More', 'click');
            await expectClean(page, `${path} with More open`, {
              axe: size.width === 375 || size.width === 820,
              focus: true,
            });
            await closeSheet(page, 'More');
            await expect(page.getByRole('contentinfo')).toBeInViewport();
          }
        });

        test('the Impressum and Privacy pages of an instance that serves them flow without sideways scrolling', async ({
          page,
        }) => {
          await stubConfig(page, {
            sourceUrl: DEFAULT_SOURCE_URL,
            legal: { impressum: true, privacy: true, impressumUrl: null, privacyUrl: null },
          });
          await page.route('**/api/legal', (route) =>
            route.fulfill({
              json: { impressum: LEGAL_TEXT, privacy: LEGAL_TEXT.replace('Impressum', 'Privacy') },
            }),
          );
          for (const id of ['impressum', 'privacy'] as const) {
            await page.goto(`${LIVE_URL}/${id}`);
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
            await expect(
              page.getByRole('contentinfo').getByRole('navigation', { name: 'Legal' }),
            ).toBeVisible();
            await page.evaluate(async () => {
              await document.fonts.ready;
            });
            await expectClean(page, `/${id}`, { axe: axeAtSize, focus: true });
          }
        });

        for (const address of DIAGRAMS) {
          test(`the diagram ${address.slice(address.indexOf('#'))}: at rest, with View, More and the drawer open`, async ({
            page,
          }) => {
            // Axe runs over the diagram states (the popup states scoped to their popup, the dark theme at two
            // sizes), seven of them after a walk of every control's focus and tap: up to 15 s on a moderately
            // busy machine.
            test.slow();
            const svg = await openDiagram(page, address);
            const room = await canvasRoom(page);
            expect(room.ofWindow, 'the canvas’s share of the window').toBeGreaterThanOrEqual(0.25);
            await expectClean(page, 'at rest', { axe: axeAtSize, focus: true });
            const view = await openSheet(page, 'View', 'click');
            await expectClean(page, 'with View open', { axe: axeAtSize, focus: true });
            // The sheet's own popups open inside it: the Lens list, the Filters panel.
            await view.getByRole('combobox', { name: 'Lens' }).click();
            await expect(page.getByRole('listbox')).toBeVisible();
            await expectClean(page, 'with the Lens list open', {
              axe: axeAtSize,
              axeScope: '[role="listbox"]',
            });
            await page.keyboard.press('Escape');
            await expect(view).toBeVisible();
            await view.getByRole('button', { name: /^Focus/ }).click();
            await expect(view.getByRole('dialog', { name: /^Focus/ })).toBeVisible();
            await expectClean(page, 'with the Focus panel open', { axe: axeAtSize, focus: true });
            await page.keyboard.press('Escape');
            await view.getByRole('button', { name: /^Filters/ }).click();
            await expect(view.getByRole('dialog', { name: 'Filters' })).toBeVisible();
            await expectClean(page, 'with the Filters panel open', { axe: axeAtSize, focus: true });
            await page.keyboard.press('Escape');
            // The search's results open under the field, in the sheet.
            const search = view.getByRole('combobox', { name: 'Search assets' });
            await search.fill('a');
            await expect(view.getByRole('listbox')).toBeVisible();
            await expectClean(page, 'with the search results open', {
              axe: axeAtSize,
              axeScope: '[role="listbox"]',
            });
            await search.fill('');
            await expect(view.getByRole('listbox')).toBeHidden();
            await closeSheet(page, 'View');
            const more = await openSheet(page, 'More', 'click');
            await expectClean(page, 'with More open', { axe: axeAtSize, focus: true });
            // Each menu of More opens inside the sheet, its longest item (the Snapshot menu's "Open: …" line) wrapping.
            for (const menu of ['Snapshot', 'Theme', 'Export']) {
              await more.getByRole('button', { name: menu, exact: true }).click();
              await expect(page.getByRole('menu', { name: menu })).toBeVisible();
              await expectClean(page, `with the ${menu} menu open`, {
                axe: axeAtSize,
                axeScope: '[role="menu"]',
              });
              await page.keyboard.press('Escape');
              await expect(page.getByRole('menu', { name: menu })).toBeHidden();
            }
            await more.getByRole('button', { name: 'Saved views', exact: true }).click();
            await expect(page.getByRole('dialog', { name: 'Saved views' })).toBeVisible();
            await expectClean(page, 'with the Saved views dialog open', {
              axe: axeAtSize,
              axeScope: '[role="dialog"][aria-modal="true"]',
              focus: true,
            });
            await page.keyboard.press('Escape');
            await expect(more.getByRole('button', { name: 'Saved views', exact: true })).toBeFocused();
            await closeSheet(page, 'More');
            await selectACard(page, svg);
            const open = await canvasRoom(page);
            expect(
              open.uncovered,
              'the share of the canvas the drawer leaves in view',
            ).toBeGreaterThanOrEqual(1 / 3);
            await expectClean(page, 'with the drawer open', { axe: axeAtSize, focus: true });
          });
        }
      });
    }
  });
}

pagesAndDiagrams('light');

for (const size of SIDEWAYS) {
  test(`a phone turned sideways, ${String(size.width)} × ${String(size.height)}: the diagram keeps room for the canvas`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    const svg = await openDiagram(page, DIAGRAMS[1]);
    expect((await canvasRoom(page)).ofWindow).toBeGreaterThanOrEqual(0.25);
    await expectClean(page, 'at rest', { focus: true });
    await selectACard(page, svg);
    expect((await canvasRoom(page)).uncovered).toBeGreaterThanOrEqual(1 / 3);
    // Expand all and Collapse all: above the half-height sheet, inside the canvas, or (a canvas too short for them
    // there) hidden until the sheet closes.
    const expand = page.getByRole('button', { name: 'Expand all', exact: true });
    const canvas = await page.locator('#diagram-canvas').boundingBox();
    if (await expand.isVisible()) {
      expect((await expand.boundingBox())?.y ?? -Infinity).toBeGreaterThanOrEqual(canvas?.y ?? Infinity);
    } else {
      expect(canvas?.height ?? Infinity).toBeLessThan(SHORT_CANVAS);
    }
    // The drawer's Close button as the drawer opens, before any focus scrolls it: whole inside the canvas, and a tap
    // anywhere on it reaches it. On a phone the timeline bar keeps one line meanwhile (its slider and the step and play
    // buttons), its readout and playback options hidden until the sheet closes, so the canvas above it holds the
    // half-height sheet's header.
    const details = detailsDrawer(page);
    const close = details.getByRole('button', { name: 'Close', exact: true });
    const readout = page.getByTestId('timeline-readout');
    const speed = page.getByRole('radiogroup', { name: 'Speed' });
    expect(await close.evaluate(wholeAndTappable)).toEqual([]);
    const bar = await timelineBar(page);
    for (const name of ['Previous day', 'Play through the days', 'Next day']) {
      await expect(bar.getByRole('button', { name })).toBeVisible();
    }
    await expect(bar.getByRole('slider')).toBeVisible();
    if (size.width < TABLET_FROM) {
      await expect(readout).toBeHidden();
      await expect(speed).toBeHidden();
    } else {
      await expect(readout).toBeVisible();
    }
    await expectClean(page, 'with the drawer open', { focus: true });
    await close.click();
    await expect(details).toBeHidden();
    await expect(expand).toBeVisible();
    await expect(readout).toBeVisible();
    await expect(speed).toBeVisible();
  });
}

/**
 * What is wrong with the disclosure bar's row while the details show the card `id`: on a phone the row is hidden only
 * on a canvas too short for it above the half-height sheet (`SHORT_CANVAS`); where it shows, the card's body lies clear
 * of it, and the drawer and the row together leave at least a third of the canvas in view. Run in the page.
 */
function rowProblems([id, short, tabletFrom]: readonly [string, number, number]): string[] {
  const px = (n: number): string => String(Math.round(n * 10) / 10);
  const canvas = document.getElementById('diagram-canvas')?.getBoundingClientRect();
  const drawer = document.querySelector('aside[aria-label="Details"]:not([hidden])')?.getBoundingClientRect();
  const card = document.querySelector(`svg.dg-canvas .dg-card[data-id="${CSS.escape(id)}"]`);
  const body = (card?.querySelector('.dg-body') ?? card)?.getBoundingClientRect();
  if (canvas === undefined || drawer === undefined || body === undefined)
    return ['no canvas, drawer or card'];
  const panel = document.querySelector('#diagram-canvas [role="group"][aria-label="Expand and collapse"]');
  if (panel?.checkVisibility({ visibilityProperty: true }) !== true)
    return window.innerWidth < tabletFrom && canvas.height < short
      ? []
      : [`the row is hidden over a canvas ${px(canvas.width)} × ${px(canvas.height)} px`];
  const row = panel.getBoundingClientRect();
  const problems: string[] = [];
  const box = (rect: DOMRect): string => [rect.left, rect.top, rect.right, rect.bottom].map(px).join(',');
  const overlap = (a: DOMRect, b: DOMRect): number =>
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  if (overlap(body, row) > 0.25) problems.push(`the card at ${box(body)} lies under the row at ${box(row)}`);
  const covered = overlap(drawer, canvas) + overlap(row, canvas) - overlap(drawer, row);
  const uncovered = 1 - covered / (canvas.width * canvas.height);
  if (uncovered < 1 / 3)
    problems.push(`the drawer and the row leave ${px(uncovered * 100)} % of the canvas in view`);
  return problems;
}

for (const size of SIDEWAYS) {
  test(`a phone turned sideways, ${String(size.width)} × ${String(size.height)}: with the details open, the disclosure bar's row is hidden, or the card the details are of lies clear of it`, async ({
    page,
  }) => {
    // Up to all of demo S's cards selected in turn where the row shows (a tablet's layout).
    test.slow();
    await page.setViewportSize(size);
    const view = DIAGRAMS[0].slice(DIAGRAMS[0].indexOf('#'));
    const svg = await openDiagram(page, DIAGRAMS[0]);
    const cards = await svg.evaluate((element) =>
      [...element.querySelectorAll('.dg-card[data-id]')].map((card) => card.getAttribute('data-id') ?? ''),
    );
    expect(cards.length).toBeGreaterThan(0);
    // A tap on a card in the canvas's lower half, which the details then cover on a phone: the camera reveals it.
    const tap = await svg.evaluate((element) => {
      const canvas = element.getBoundingClientRect();
      const cardAt = (x: number, y: number): Element | null => {
        const hit = document.elementFromPoint(x, y);
        if (hit === null || !element.contains(hit)) return null;
        if (hit.closest('[data-ghost], .dg-console-action, .dg-collapse, .dg-chip') !== null) return null;
        return hit.closest('.dg-card[data-id]');
      };
      const middle = canvas.top + canvas.height / 2;
      for (const [from, to] of [
        [middle, canvas.bottom - 4],
        [canvas.top + 4, middle],
      ] as const) {
        for (let y = from; y < to; y += 2) {
          for (let x = canvas.left + 4; x < canvas.right - 4; x += 2) {
            const card = cardAt(x, y);
            if (card !== null) return { x, y, id: card.getAttribute('data-id') ?? '' };
          }
        }
      }
      return null;
    });
    if (tap === null) throw new Error('no card to tap');
    await page.touchscreen.tap(tap.x, tap.y);
    const details = detailsDrawer(page);
    await expect(details).toBeVisible();
    await expect(svg.locator(`.dg-card[data-id="${tap.id}"]`)).toHaveAttribute('aria-pressed', 'true');
    await cameraSettled(svg);
    const where = (id: string): string => `${String(size.width)} × ${String(size.height)}, ${id}`;
    expect(
      await page.evaluate(rowProblems, [tap.id, SHORT_CANVAS, TABLET_FROM] as const),
      where(tap.id),
    ).toEqual([]);
    // Where the row shows, every other card selected in turn through the address, each revealed by the camera.
    const row = page.getByRole('group', { name: 'Expand and collapse' });
    if (!(await row.isVisible())) return;
    const problems: string[] = [];
    for (const id of cards.filter((card) => card !== tap.id)) {
      await page.evaluate(
        ([hash, selection]) => {
          window.location.hash = `${hash.slice(1)}&selection=${encodeURIComponent(selection)}`;
        },
        [view, id] as const,
      );
      await expect(svg.locator(`.dg-card[data-id="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
      await expect(details).toBeVisible();
      await cameraSettled(svg);
      problems.push(
        ...(await page.evaluate(rowProblems, [id, SHORT_CANVAS, TABLET_FROM] as const)).map(
          (problem) => `${where(id)}: ${problem}`,
        ),
      );
    }
    expect(problems).toEqual([]);
  });
}

/**
 * What keeps a control from being whole and tappable where it is, unscrolled: the parts of its box past the canvas's
 * edges, or a point (its middle, and just inside the middle of each edge) where something else lies over it or a box
 * clips it. For a control in a panel over the canvas (the details drawer), run in the page.
 */
function wholeAndTappable(element: Element): string[] {
  const canvas = document.getElementById('diagram-canvas')?.getBoundingClientRect();
  const box = element.getBoundingClientRect();
  if (canvas === undefined) return ['no canvas'];
  // One of the screen's pixels and layout's rounding.
  const rounding = 1 / window.devicePixelRatio + 0.05;
  const problems: string[] = [];
  const px = (n: number): string => String(Math.round(n * 10) / 10);
  if (box.top < canvas.top - rounding) problems.push(`${px(canvas.top - box.top)} px above the canvas`);
  if (box.bottom > canvas.bottom + rounding)
    problems.push(`${px(box.bottom - canvas.bottom)} px below the canvas`);
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  for (const [where, left, top] of [
    ['middle', x, y],
    ['top', x, box.top + 2],
    ['bottom', x, box.bottom - 2],
    ['left', box.left + 2, y],
    ['right', box.right - 2, y],
  ] as const) {
    const hit = document.elementFromPoint(left, top);
    if (hit === null || !element.contains(hit))
      problems.push(`its ${where} is under <${hit?.tagName.toLowerCase() ?? 'nothing'}>`);
  }
  return problems;
}

/**
 * How much of the canvas the open sheet leaves in view, the disclosure bar's row counted with the sheet while it shows
 * (a fraction of the canvas's area), and how far above the canvas's foot the sheet ends (a fraction of its height).
 */
function sheetRoom(sheet: Locator): Promise<{ readonly uncovered: number; readonly below: number }> {
  return sheet.evaluate((element) => {
    const canvas = document.getElementById('diagram-canvas')?.getBoundingClientRect();
    if (canvas === undefined || canvas.height <= 0) return { uncovered: 0, below: 0 };
    type Box = readonly [left: number, top: number, right: number, bottom: number];
    const meet = (a: Box, b: Box): Box => [
      Math.max(a[0], b[0]),
      Math.max(a[1], b[1]),
      Math.min(a[2], b[2]),
      Math.min(a[3], b[3]),
    ];
    const area = (box: Box): number => Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1]);
    const inCanvas = (rect: DOMRect): Box =>
      meet(
        [canvas.left, canvas.top, canvas.right, canvas.bottom],
        [rect.left, rect.top, rect.right, rect.bottom],
      );
    const box = element.getBoundingClientRect();
    const sheet = inCanvas(box);
    const panel = document.querySelector('#diagram-canvas [role="group"][aria-label="Expand and collapse"]');
    const row =
      panel?.checkVisibility({ visibilityProperty: true }) === true
        ? inCanvas(panel.getBoundingClientRect())
        : null;
    const covered = area(sheet) + (row === null ? 0 : area(row) - area(meet(sheet, row)));
    return {
      uncovered: 1 - covered / (canvas.width * canvas.height),
      below: (canvas.bottom - box.bottom) / canvas.height,
    };
  });
}

async function expectSheetRoom(sheet: Locator, where: string): Promise<void> {
  await expect
    .poll(async () => (await sheetRoom(sheet)).uncovered, {
      timeout: 15_000,
      message: `${where}: the share of the canvas in view after the resized canvas height reaches the sheet`,
    })
    .toBeGreaterThanOrEqual(1 / 3);
  await expect
    .poll(async () => (await sheetRoom(sheet)).below, {
      timeout: 15_000,
      message: `${where}: the canvas below the sheet after the resized canvas height reaches the sheet`,
    })
    .toBeGreaterThanOrEqual(1 / 4);
}

for (const size of [...SIZES, ...SIDEWAYS]) {
  test(`${String(size.width)} × ${String(size.height)}: an open View or More sheet leaves at least a third of the canvas in view, in both themes, and View closes the open drawer`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    for (const address of DIAGRAMS) {
      const hash = address.slice(address.indexOf('#'));
      const svg = await openDiagram(page, address);
      for (const theme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: theme });
        for (const name of ['View', 'More'] as const) {
          const where = `${hash}, ${theme} theme, ${name} open`;
          await expectSheetRoom(await openSheet(page, name, 'click'), where);
          await expectClean(page, where, { axe: false, focus: true });
          await closeSheet(page, name);
        }
        // The drawer open (on a phone at half height), then View opened: the drawer closes, so the sheet is alone over
        // the canvas, and stays closed when the sheet does; the selection stays.
        const where = `${hash}, ${theme} theme, View opened over the drawer`;
        await selectACard(page, svg);
        const details = detailsDrawer(page);
        if (size.width < TABLET_FROM) await expect(details).toHaveAttribute('data-sheet', 'half');
        const view = await openSheet(page, 'View', 'click');
        await expect(details, `${where}: the drawer`).toBeHidden();
        await expectSheetRoom(view, where);
        await closeSheet(page, 'View');
        await expect(details, `${where}: the drawer once View is closed`).toBeHidden();
        expect(await page.evaluate(() => window.location.hash)).toContain('selection=');
        // Back to the view without a selection, for the next theme's.
        await page.evaluate((view) => {
          window.location.hash = view;
        }, hash);
        await expect(svg.locator('[aria-pressed="true"]')).toHaveCount(0);
      }
    }
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`on a tablet, the disclosure bar and its changing notice stay clear of the fitted drawing (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    let svg = await openDiagram(page, DIAGRAMS[0]);
    const row = page.getByRole('group', { name: 'Expand and collapse' });
    const bar = row.locator('..');
    const transform = svg.locator('.dg-viewport');
    const atRest = await transform.getAttribute('transform');
    if (atRest === null) throw new Error('no camera');
    await expect(bar).not.toHaveAttribute('data-canvas-overlay');
    for (const name of ['View', 'More'] as const) {
      const sheet = await openSheet(page, name, 'click');
      await expect(bar).toHaveAttribute('data-canvas-overlay', '');
      await cameraSettled(svg);
      const drawing = await boxOf(svg.locator('.dg-background'));
      for (const overlay of [sheet, bar]) {
        const box = await boxOf(overlay);
        const overlapWidth =
          Math.min(drawing.x + drawing.width, box.x + box.width) - Math.max(drawing.x, box.x);
        const overlapHeight =
          Math.min(drawing.y + drawing.height, box.y + box.height) - Math.max(drawing.y, box.y);
        expect(
          Math.min(overlapWidth, overlapHeight),
          `${name}: drawing clear of overlay`,
        ).toBeLessThanOrEqual(0.5);
      }
      await expect(transform).not.toHaveAttribute('transform', atRest);
      await closeSheet(page, name);
      await expect(bar).not.toHaveAttribute('data-canvas-overlay');
      await expect(transform).toHaveAttribute('transform', atRest);
    }

    const project = '//cloudresourcemanager.googleapis.com/projects/10000000002';
    const flips = Array.from({ length: 48 }, (_, index) => `t${String(index)}`);
    svg = await openDiagram(
      page,
      `/diagram#snapshot=demo:S&detail=folders&selection=${project}&flips=${flips.join(',')}`,
    );
    const details = detailsDrawer(page);
    await expect(details).toBeVisible();
    const fittedAboveBar = async (): Promise<void> => {
      await cameraSettled(svg);
      const canvas = await boxOf(svg);
      const drawer = await boxOf(details);
      const disclosure = await boxOf(bar);
      const drawing = await boxOf(svg.locator('.dg-background'));
      const width = drawer.x - canvas.x;
      const height = disclosure.y - canvas.y;
      expect(drawing.x + drawing.width / 2).toBeCloseTo(canvas.x + width / 2, 0);
      expect(drawing.y + drawing.height / 2).toBeCloseTo(canvas.y + height / 2, 0);
      expect(drawing.y + drawing.height).toBeLessThanOrEqual(disclosure.y + 0.5);
      expect(Math.max(drawing.width / (width - 32), drawing.height / (height - 32))).toBeCloseTo(1, 2);
    };
    await fittedAboveBar();
    const beforeNotice = await svg.locator('.dg-viewport').getAttribute('transform');
    await page.evaluate(
      (nextFlips) => {
        window.location.hash = window.location.hash.replace(/flips=[^&]*/, `flips=${nextFlips.join(',')}`);
      },
      [...flips.slice(1), 't48'],
    );
    await expect(page.getByText(/At most 48 zones/)).toBeVisible();
    await fittedAboveBar();
    if (beforeNotice === null) throw new Error('no camera');
    await expect(svg.locator('.dg-viewport')).not.toHaveAttribute('transform', beforeNotice);
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(page.getByText(/At most 48 zones/)).toBeHidden();
    await fittedAboveBar();
    await expect(svg.locator('.dg-viewport')).toHaveAttribute('transform', beforeNotice);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`at rest on a phone and a tablet, \`+\` keeps the focused card clear of the disclosure bar, whose fit stays the whole canvas (${theme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    for (const size of [SIZES[0], { width: 820, height: 1180 }] as const) {
      await page.setViewportSize(size);
      // A fresh document per size: a camera the previous size's keys moved does not carry over.
      await page.goto('about:blank');
      const where = `${String(size.width)} × ${String(size.height)}, ${theme} theme`;
      const svg = await openDiagram(page, DIAGRAMS[0]);
      await cameraSettled(svg);
      const bar = page.getByRole('group', { name: 'Expand and collapse' });
      await expect(bar, where).toBeVisible();
      // The bar at rest floats over the canvas's foot: no panel marker, so the fit still fills the whole canvas.
      const marker = page.locator('#diagram-canvas [data-canvas-jump]');
      await expect(marker, where).toHaveCount(1);
      await expect(marker, where).not.toHaveAttribute('data-canvas-overlay');
      const canvas = await boxOf(svg);
      const drawing = await boxOf(svg.locator('.dg-background'));
      expect(drawing.y, where).toBeGreaterThanOrEqual(canvas.y - 0.5);
      expect(drawing.y + drawing.height, where).toBeLessThanOrEqual(canvas.y + canvas.height + 0.5);
      // The skip link puts focus on the drawing's tab stop: `+` zooms about that card, the row at rest counted as room.
      await page.getByRole('link', { name: 'Skip to the diagram' }).focus();
      await page.keyboard.press('Enter');
      const focused = svg.locator('.dg-node:focus');
      await expect(focused, where).toHaveCount(1);
      const id = await focused.getAttribute('data-id');
      if (id === null) throw new Error('no focused card');
      const card = svg.locator(`.dg-node[data-id="${id}"]`);
      const top = canvas.y;
      for (let step = 1; step <= 6; step += 1) {
        await page.keyboard.press('+');
        await cameraSettled(svg);
        await expect(card, where).toBeFocused();
        const body = await boxOf(card.locator('.dg-body').first());
        // The marker's box is what the directed moves keep clear of: the row and its notice above it.
        const row = await boxOf(marker);
        const at = `${where}, after ${String(step)} × +: the card from ${body.y.toFixed(1)} to ${(body.y + body.height).toFixed(1)}, the row from ${row.y.toFixed(1)}`;
        if (body.height <= row.y - top) {
          // It fits the band above the row: it lies inside it, none of it under the bar.
          expect(body.y, at).toBeGreaterThanOrEqual(top - 1);
          expect(body.y + body.height, at).toBeLessThanOrEqual(row.y + 1);
        } else {
          // Taller than the band: centred in it.
          expect(Math.abs(body.y + body.height / 2 - (top + row.y) / 2), at).toBeLessThan(1);
        }
      }
    }
  });
}

test('the Snapshots page with a snapshot stored and a day cached: a card per row on a phone, its tables whole on a tablet, nothing scrolling sideways, at every size and in both themes', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await page.setViewportSize(SIZES[1]);
  await page.goto('/snapshots');
  await expect(page.getByRole('heading', { level: 1, name: 'Snapshots' })).toBeVisible();
  await page
    .getByTestId('snapshot-drop-zone')
    .locator('input[type="file"]')
    .setInputFiles([...demoExport(testInfo)]);
  await expect(page.getByText(/^Imported example\.com, read /)).toBeVisible({ timeout: 60_000 });
  await cacheADay(page);
  const stored = 'Snapshots stored in this browser';
  const timeline = /^Timeline of /;
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const size of [...SIZES, ...SIDEWAYS]) {
      const where = `/snapshots with a snapshot stored, ${theme}, ${String(size.width)} × ${String(size.height)}`;
      await page.setViewportSize(size);
      await page.reload();
      await expect(
        page.getByRole('button', {
          name: 'Delete the cached days of example.com (Organisation 30000000001)…',
        }),
        where,
      ).toBeVisible();
      if (size.width < TABLET_FROM) {
        // One card per row: the stored export; on its scope's timeline the cached day and the export's extra tick. No
        // table.
        const card = page.getByRole('list', { name: stored }).getByRole('listitem');
        await expect(card, where).toHaveCount(1);
        await expect(page.getByRole('list', { name: timeline }).getByRole('listitem'), where).toHaveCount(2);
        await expect(page.getByRole('table'), where).toHaveCount(0);
        await expect(card.getByRole('term'), where).toHaveText([
          'Scope',
          'Read',
          'Source',
          'Assets',
          'Size',
          'Stored',
        ]);
        for (const action of ['Load', 'Export', 'Delete'])
          await expect(
            card.getByRole('button', { name: new RegExp(`^${action} example\\.com, read `) }),
            where,
          ).toBeVisible();
      } else {
        await expect(page.getByRole('table', { name: stored }), where).toBeVisible();
        await expect(page.getByRole('table', { name: timeline }), where).toBeVisible();
        await expect(page.getByRole('list', { name: stored }), where).toHaveCount(0);
      }
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      // Not even a box of its own: a row reads without scrolling sideways, and a tablet's page holds its tables whole.
      expect(await sidewaysBoxes(page), where).toEqual([]);
      await expectClean(page, where, { axe: size.width === 375 || size.width === 820, focus: true });
      await expect(page.getByRole('contentinfo'), where).toBeInViewport();
    }
  }
});

for (const theme of ['light', 'dark'] as const) {
  for (const size of [...SIZES, { width: 1024, height: 768 }]) {
    test(`${theme} theme, ${String(size.width)} × ${String(size.height)}: a live instance's Connect page signed out and signed in, and the Account panel inside More; Sign out closes the sheet`, async ({
      page,
    }) => {
      const axeAtSize = theme === 'light' || size.width === 375 || size.width === 820;
      await page.setViewportSize(size);
      await page.emulateMedia({ colorScheme: theme });
      await stubConfig(page, LIVE_CONFIG);
      await page.route('**/api/scopes/search', (route) => {
        const { kinds } = route.request().postDataJSON() as { readonly kinds?: readonly string[] };
        const scopes = SCOPES.filter((scope) => kinds === undefined || kinds.includes(scope.kind));
        return route.fulfill({ json: { scopes, problems: [] } });
      });
      await stubGoogle(page, { tokens: [FAKE_TOKEN] });
      // A long work address: the account's button and its panel wrap it.
      await page.route(TOKENINFO_URL, (route) =>
        route.fulfill({
          json: {
            aud: TEST_CLIENT_ID,
            azp: TEST_CLIENT_ID,
            email: LONG_EMAIL,
            scope: ALL_SCOPES,
            expires_in: '3599',
          },
        }),
      );
      await page.goto(LIVE_URL);
      await expect(page.getByRole('heading', { level: 1, name: 'Connect' })).toBeVisible();
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await expectClean(page, 'the Connect page, signed out', { axe: axeAtSize, focus: true });
      await page
        .getByRole('region', { name: 'Choose a source' })
        .getByRole('button', { name: 'Sign in with Google' })
        .click();
      // Signed in: focus moves on to the next step's heading.
      await expect(page.getByRole('heading', { name: 'Read your environment' })).toBeFocused();
      const more = await openSheet(page, 'More', 'click');
      const account = more.getByRole('button', { name: LONG_EMAIL, exact: true });
      await expect(account).toBeVisible();
      await closeSheet(page, 'More');
      await expectClean(page, 'the Connect page, signed in', { axe: axeAtSize, focus: true });
      await openSheet(page, 'More', 'click');
      await expectClean(page, 'signed in, with More open', { axe: false, focus: true });
      await account.click();
      const panel = more.getByRole('dialog', { name: 'Account' });
      await expect(panel).toBeVisible();
      await expect(panel.getByText(/^Signed in with Google/)).toBeVisible();
      await expectClean(page, 'with the Account panel open', { axe: axeAtSize, focus: true });
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      await expect(account).toBeFocused();
      await account.click();
      await panel.getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect(fold(page, 'More').sheet).toBeHidden();
      await expect(page.locator('#main')).toBeFocused();
      await expect(fold(page, 'More').button).toBeVisible();
    });
  }
}

for (const size of SIZES) {
  test(`${String(size.width)} × ${String(size.height)}: the timeline thumb's focus ring from the keyboard, at the last day and at the first, covers neither date at the track's ends nor the readout`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await openDiagram(page, DIAGRAMS[0]);
    const bar = await timelineBar(page);
    const thumb = bar.getByRole('slider', { name: 'Timeline' });
    await thumb.focus();
    for (const [key, day] of [
      ['End', '34'],
      ['Home', '0'],
    ] as const) {
      await page.keyboard.press(key);
      await expect(thumb).toHaveAttribute('aria-valuenow', day);
      await expect.poll(() => focusRingShown(thumb)).toBe(true);
      // The ring goes round the thumb's dot; the touch target stays 44 × 44.
      const target = await boxOf(thumb);
      expect(Math.min(target.width, target.height)).toBeGreaterThanOrEqual(TARGET);
      expect(await coveredByThumbRing(bar), `${key}: what the ring covers`).toEqual([]);
    }
  });
}

for (const size of SIZES) {
  test(`${String(size.width)} × ${String(size.height)}: the timeline thumb's focus ring from the keyboard covers no day marker, the current day's under the thumb included`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await openDiagram(page, DIAGRAMS[0]);
    const bar = await timelineBar(page);
    const thumb = bar.getByRole('slider', { name: 'Timeline' });
    await thumb.focus();
    for (const key of ['End', 'ArrowLeft', 'Home']) {
      const day = await keyToDrawnDay(bar, key);
      await expect.poll(() => focusRingShown(thumb)).toBe(true);
      expect(await markersCoveredByThumbRing(bar), `${key} (${day}): the markers the ring covers`).toEqual(
        [],
      );
    }
  });
}

test.describe('on a phone, 375 × 667', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('a menu inside More closes with Escape alone, leaving the sheet open; `/` opens View onto the focused search', async ({
    page,
  }) => {
    await openDiagram(page, DIAGRAMS[0]);
    const more = await openSheet(page, 'More', 'click');
    await more.getByRole('button', { name: 'Theme', exact: true }).click();
    await expect(page.getByRole('menu', { name: 'Theme' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'Theme' })).toBeHidden();
    await expect(more).toBeVisible();
    await closeSheet(page, 'More');
    await page.locator('body').press('/');
    await expect(page.getByRole('combobox', { name: 'Search assets' })).toBeFocused();
    await expect(fold(page, 'View').sheet).toBeVisible();
  });

  test('a tap on the timeline’s thumb focuses it without the focus ring, and a key on an external keyboard shows the ring', async ({
    page,
  }) => {
    await openDiagram(page, DIAGRAMS[0]);
    const thumb = (await timelineBar(page)).getByRole('slider', { name: 'Timeline' });
    await thumb.tap();
    await expect(thumb).toBeFocused();
    expect(await focusRingShown(thumb)).toBe(false);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => focusRingShown(thumb)).toBe(true);
  });

  test('a long drill-in trail rests at its current level; a swipe brings its first crumb into view, and a tap drills out to it', async ({
    page,
  }) => {
    await openDiagram(page, DEEP_TRAIL);
    const nav = page.getByRole('banner').getByRole('navigation', { name: 'Scope' });
    const crumbs = nav.getByRole('listitem');
    await expect(crumbs).toHaveCount(5);
    const top = nav.getByRole('button', { name: 'example.com', exact: true });
    const within = async (crumb: Locator): Promise<boolean> => {
      const [box, room] = await Promise.all([crumb.boundingBox(), nav.boundingBox()]);
      return (
        box !== null &&
        room !== null &&
        box.x >= room.x - 0.5 &&
        box.x + box.width <= room.x + room.width + 0.5
      );
    };
    // At rest: the current level in full, the top of the trail scrolled out of view on the left.
    await expect.poll(() => within(crumbs.last())).toBe(true);
    expect(await within(top)).toBe(false);
    // Every crumb, focused, is in sight and can be tapped.
    expect(await hiddenControls(page)).toEqual([]);
    // The edge where crumbs are cut fades out.
    await expect(nav).toHaveAttribute('data-cut', '');
    const room = await nav.boundingBox();
    if (room === null) throw new Error('no breadcrumb');
    const fingers = await Fingers.on(page);
    const y = room.y + room.height / 2;
    await fingers.drag({ x: room.x + 8, y }, { x: room.x + 8 + 12 * 40, y }, { steps: 12 });
    await expect
      .poll(() => within(top), {
        timeout: 15_000,
        message: 'The breadcrumb swipe finishes scrolling when browser frames are delayed under load.',
      })
      .toBe(true);
    const box = await top.boundingBox();
    if (box === null) throw new Error('no crumb');
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => viewParam(page, 'root')).toBeNull();
    await expect(crumbs).toHaveCount(1);
  });

  test('a tap on a node opens the drawer over the lower half of the canvas, the disclosure bar above it; its handle takes it to full height and back, and closes it', async ({
    page,
  }) => {
    const svg = await openDiagram(page, DIAGRAMS[0]);
    const card = await svg.evaluate((element) => {
      const canvas = element.getBoundingClientRect();
      for (const node of element.querySelectorAll('.dg-card[data-id], .dg-zone[data-id]')) {
        const box = node.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + Math.min(box.height / 2, 6);
        if (x > canvas.left && x < canvas.right && y > canvas.top && y < canvas.top + canvas.height / 2)
          return { x, y };
      }
      return null;
    });
    expect(card).not.toBeNull();
    await page.touchscreen.tap(card?.x ?? 0, card?.y ?? 0);
    const drawer = detailsDrawer(page);
    await expect(drawer).toBeVisible();
    const canvas = await page.locator('#diagram-canvas').boundingBox();
    const half = await drawer.boundingBox();
    if (canvas === null || half === null) throw new Error('no canvas or drawer');
    expect(half.height).toBeCloseTo(canvas.height / 2, -1);
    // The disclosure bar rides above the sheet and its handle, its buttons in sight and tappable.
    const expand = page.getByRole('button', { name: 'Expand all', exact: true });
    await expect(expand).toBeVisible();
    const bar = await expand.boundingBox();
    expect((bar?.y ?? Infinity) + (bar?.height ?? 0)).toBeLessThanOrEqual(half.y - 22);
    await expectClean(page, 'the sheet at half height', { axe: false, focus: true });

    const handle = drawer.getByRole('separator', { name: 'Resize the details drawer' });
    await expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
    await handle.focus();
    await page.keyboard.press('ArrowUp');
    await expect(handle).toHaveAttribute('aria-valuenow', '100');
    await expect(drawer).toHaveAttribute('data-sheet', 'full');
    // Full height: the sheet covers the canvas but for the strip its handle stands in, and what the canvas holds is
    // out of sight and out of reach.
    expect((await drawer.boundingBox())?.height ?? 0).toBeCloseTo(canvas.height - 22, -1);
    await expect(expand).toBeHidden();
    await expect(svg).toBeHidden();
    await expectClean(page, 'the sheet at full height', { focus: true });
    await page.keyboard.press('Home');
    await expect(handle).toHaveAttribute('aria-valuenow', '50');
    await expect(expand).toBeVisible();

    // By a finger: dragged up past the middle it settles at full height, a little down it settles back at half, and
    // well below half it closes.
    const fingers = await Fingers.on(page);
    const drag = async (from: number, to: number, lift = true): Promise<void> => {
      const edge = await handle.boundingBox();
      if (edge === null) throw new Error('no handle');
      const x = edge.x + edge.width / 2;
      const y = edge.y + edge.height / 2;
      await fingers.drag({ x, y: y + from }, { x, y: y + to }, { steps: 8, lift });
    };
    await drag(0, -canvas.height * 0.3);
    await expect(handle).toHaveAttribute('aria-valuenow', '100');
    await drag(0, canvas.height * 0.3);
    await expect(handle).toHaveAttribute('aria-valuenow', '50');
    // Held well below half: the sheet follows the finger down and fades, as letting go there closes it.
    await drag(0, canvas.height * 0.4, false);
    await expect(drawer).toHaveAttribute('data-dismissing', '');
    expect((await drawer.boundingBox())?.height ?? Infinity).toBeLessThan(canvas.height * 0.2);
    await fingers.lift();
    await expect(drawer).toBeHidden();
  });

  test('with the drawer open, `+` on an external keyboard keeps the focused card in the part of the canvas above it and the disclosure bar', async ({
    page,
  }) => {
    const svg = await openDiagram(page, DIAGRAMS[0]);
    // The skip link puts focus on the drawing's tab stop, and Enter selects it: the drawer opens over the canvas's
    // lower half, and focus stays on the card.
    await page.getByRole('link', { name: 'Skip to the diagram' }).focus();
    await page.keyboard.press('Enter');
    const focused = svg.locator('.dg-node:focus');
    await expect(focused).toHaveCount(1);
    const id = await focused.getAttribute('data-id');
    if (id === null) throw new Error('no focused card');
    const card = svg.locator(`.dg-node[data-id="${id}"]`);
    await page.keyboard.press('Enter');
    const drawer = detailsDrawer(page);
    await expect(drawer).toBeVisible();
    await expect(card).toBeFocused();
    await cameraSettled(svg);
    const canvas = await boxOf(svg);
    // The part of the canvas the drawer leaves in view, from the canvas's top edge down to the drawer's, more than a
    // third of it; the disclosure bar's row rides in it, above the drawer, so the room is the band above the row.
    const top = canvas.y;
    expect((await boxOf(drawer)).y - top).toBeGreaterThan(canvas.height / 3);
    const bottom = (await boxOf(page.getByRole('group', { name: 'Expand and collapse' }))).y;
    let steps = 0;
    for (; steps < 16; steps += 1) {
      await page.keyboard.press('+');
      await cameraSettled(svg);
      await expect(card).toBeFocused();
      const body = await boxOf(card.locator('.dg-body').first());
      const where = `after ${String(steps + 1)} × +: the card from ${body.y.toFixed(1)} to ${(body.y + body.height).toFixed(1)}, the room from ${top.toFixed(1)} to ${bottom.toFixed(1)}`;
      if (body.height <= bottom - top) {
        // It fits: it lies inside the room, none of it under the row or the drawer.
        expect(body.y, where).toBeGreaterThanOrEqual(top - 1);
        expect(body.y + body.height, where).toBeLessThanOrEqual(bottom + 1);
      } else {
        // Taller than the room: centred in it.
        expect(Math.abs(body.y + body.height / 2 - (top + bottom) / 2), where).toBeLessThan(1);
      }
      if (body.height > canvas.height) break;
    }
    // The steps went on until the card was taller than the whole canvas.
    expect(steps).toBeLessThan(16);
  });

  test('with the drawer open, `0` on an external keyboard fits the drawing to the part of the canvas above it and the disclosure bar', async ({
    page,
  }) => {
    const svg = await openDiagram(page, DIAGRAMS[0]);
    // As above: the skip link, Enter onto the drawing's tab stop, Enter to select it, the drawer over the lower half.
    await page.getByRole('link', { name: 'Skip to the diagram' }).focus();
    await page.keyboard.press('Enter');
    const focused = svg.locator('.dg-node:focus');
    await expect(focused).toHaveCount(1);
    await page.keyboard.press('Enter');
    const drawer = detailsDrawer(page);
    await expect(drawer).toBeVisible();
    await expect(focused).toHaveCount(1);
    // Closer in first, so that the fit has a camera to undo.
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    await cameraSettled(svg);
    await page.keyboard.press('0');
    await cameraSettled(svg);
    await expect(focused).toHaveCount(1);
    const canvas = await boxOf(svg);
    const top = canvas.y;
    // The disclosure bar's row rides above the drawer: the room is the band of the canvas above the row.
    const bottom = (await boxOf(page.getByRole('group', { name: 'Expand and collapse' }))).y;
    expect(bottom).toBeLessThan((await boxOf(drawer)).y);
    // The drawing's frame (its background) lies whole in that part of the canvas.
    const drawing = await boxOf(svg.locator('.dg-background'));
    const where = `the drawing from ${drawing.y.toFixed(1)} to ${(drawing.y + drawing.height).toFixed(1)}, the room from ${top.toFixed(1)} to ${bottom.toFixed(1)}`;
    expect(drawing.y, where).toBeGreaterThanOrEqual(top - 0.5);
    expect(drawing.y + drawing.height, where).toBeLessThanOrEqual(bottom + 0.5);
    expect(drawing.x).toBeGreaterThanOrEqual(canvas.x - 0.5);
    expect(drawing.x + drawing.width).toBeLessThanOrEqual(canvas.x + canvas.width + 0.5);
    // And fills it: the drawing's height is the band above the bar, less 16 px on each side (the band is the
    // narrow side on a phone). The fit keeps the drawing's aspect and never enlarges it past 1:1, so on the short
    // band a phone leaves once its footer has two rows, the drawing may land a few pixels either side of the
    // padded height while it stays clear of the bar (asserted above); allow a fifth.
    const room = bottom - top - 32;
    expect(drawing.height, where).toBeGreaterThanOrEqual(room * 0.8);
    expect(drawing.height, where).toBeLessThanOrEqual(room * 1.2);
  });

  test('the View sheet fits the drawing below it, a lens picked in it draws its view whole there, and closing View fits the drawing to the canvas again', async ({
    page,
  }) => {
    const svg = await openDiagram(page, DIAGRAMS[0]);
    const canvas = await boxOf(svg);
    // The drawing's frame (its background) lies whole in `room` and fills it, as a fit fills the canvas: as wide as
    // the room or as tall, less 16 px on each side.
    const expectFittedTo = async (room: Box, where: string): Promise<void> => {
      await cameraSettled(svg);
      const drawing = await boxOf(svg.locator('.dg-background'));
      const at = `${where}: the drawing from (${drawing.x.toFixed(1)}, ${drawing.y.toFixed(1)}) to (${(drawing.x + drawing.width).toFixed(1)}, ${(drawing.y + drawing.height).toFixed(1)}), the room from (${room.x.toFixed(1)}, ${room.y.toFixed(1)}) to (${(room.x + room.width).toFixed(1)}, ${(room.y + room.height).toFixed(1)})`;
      expect(drawing.x, at).toBeGreaterThanOrEqual(room.x - 0.5);
      expect(drawing.y, at).toBeGreaterThanOrEqual(room.y - 0.5);
      expect(drawing.x + drawing.width, at).toBeLessThanOrEqual(room.x + room.width + 0.5);
      expect(drawing.y + drawing.height, at).toBeLessThanOrEqual(room.y + room.height + 0.5);
      const fill = Math.max(drawing.width / (room.width - 32), drawing.height / (room.height - 32));
      expect(fill, at).toBeCloseTo(1, 2);
    };
    await expectFittedTo(canvas, 'at rest');
    const { button, sheet } = fold(page, 'View');
    // The part of the canvas below the open sheet, the canvas's width.
    const belowTheSheet = async (): Promise<Box> => {
      const box = await boxOf(sheet);
      const top = box.y + box.height;
      expect(top).toBeLessThan(canvas.y + canvas.height);
      return { x: canvas.x, y: top, width: canvas.width, height: canvas.y + canvas.height - top };
    };
    await button.tap();
    await expect(sheet).toBeVisible();
    await expectFittedTo(await belowTheSheet(), 'View opened');
    await sheet.getByRole('combobox', { name: 'Lens' }).tap();
    await page
      .getByRole('listbox', { name: 'Lens' })
      .getByRole('option', { name: 'Networking', exact: true })
      .tap();
    await expect(page.locator('svg.dg-canvas > title')).toHaveText(
      'gcportrait diagram of example.com, Networking lens',
      { timeout: 30_000 },
    );
    await expect(sheet).toBeVisible();
    await expectFittedTo(await belowTheSheet(), 'the Networking lens picked in View');
    await button.tap();
    await expect(sheet).toBeHidden();
    await expectFittedTo(canvas, 'View closed');
  });
});

pagesAndDiagrams('dark');
