// SPDX-License-Identifier: MIT
/**
 * The header's repository widget, live, in the visitor's browser (src/components/Header.astro runs it on every page;
 * the parts without a DOM are in src/lib/star-count.ts). The build has written its facts (the latest release's
 * version, the stars and the forks) into the page, so they are there at first paint; this script only refreshes them,
 * and never before the page has loaded:
 *
 * - After the `load` event, when the browser is idle (requestIdleCallback; where there is none, a short timeout), it
 *   reads sessionStorage (`gcportrait.repository`). If the browser asked GitHub less than an hour ago, it does not ask
 *   again: it shows the facts it got then, or, after a failure, nothing. Otherwise it first notes in sessionStorage
 *   that it is asking (where that cannot be written, storage being blocked or full, it does not ask at all), then asks
 *   GitHub (two anonymous GETs to api.github.com, made together, 4 s at most) and, on facts, keeps them in place of
 *   the note. So a tab asks at most once an hour, whatever GitHub answers and even when the visitor leaves the page
 *   before the answer.
 * - The facts go into the widget, the counts abbreviated as the build abbreviates them, and into the link's accessible
 *   name. A version GitHub did not give (no release, or that request failed) leaves the build's version in place.
 *   Where the build had no facts, their box (in the page, hidden) is shown.
 * - Nothing moves for it (no layout shift): the facts are shown only where every other item of the header keeps its
 *   box, the header its height and the link its place (it may only get wider or narrower at its end, where there is
 *   room after it). Each count keeps room for any count from 0 to 9.9k and the digits are tabular, so facts of the
 *   same length as the build's always fit, and so does any count to 9.9k where the build had one (999 becoming 1k,
 *   1.9k becoming 2k). Facts that would push the demo button aside (a box where the build had none, on most widths,
 *   9.9k becoming 10k, or a longer version) leave the link as it was until the next build brings them. The change and
 *   its undoing happen before the next frame is painted, so a change taken back is never seen.
 * - On any failure (a 403, 404 or 429, offline, the timeout) nothing changes: the build's facts, or none, stay, and
 *   the note keeps the tab from asking again within the hour. Nothing is logged.
 * - Where the build's own request found the repository not public (GitHub's 404, or an answer marked private), the
 *   link carries `data-repository-not-public` and the script asks nothing at all: an anonymous request would only get
 *   the same 404, and would still send the visitor's address to GitHub. A site built before the repository goes public
 *   shows no live facts until the next build (the website workflow rebuilds daily).
 */
import { PRODUCT_NAME } from '../site.js';
import {
  currentRepositoryFacts,
  formatCount,
  repositoryLinkLabel,
  type RepositoryFacts,
} from './star-count.js';

/**
 * Where the header's items are: the header's box, the link's position (not its size), and the box of every element of
 * the header that neither holds the link nor is inside it.
 */
function places(header: Element, link: Element): number[] {
  const values: number[] = [];
  const add = (element: Element, size: boolean): void => {
    const box = element.getBoundingClientRect();
    values.push(box.x, box.y);
    if (size) values.push(box.width, box.height);
  };
  add(header, true);
  add(link, false);
  for (const element of header.querySelectorAll('*')) {
    if (!element.contains(link) && !link.contains(element)) add(element, true);
  }
  return values;
}

const FACT_NAMES = ['version', 'stars', 'forks'] as const;

/**
 * Shows `facts` in the header's repository link: each fact's text, the facts where they were hidden, and the link's
 * name. Returns false, with the link as it was, when a fact's element is missing or showing them would move anything
 * else in the header (see the module comment).
 */
export function showRepositoryFacts(link: HTMLAnchorElement, facts: RepositoryFacts): boolean {
  const box = link.querySelector<HTMLElement>('.repo-facts');
  if (box === null) return false;
  const elements = FACT_NAMES.map((name) => {
    const fact = box.querySelector<HTMLElement>(`.repo-fact[data-fact="${name}"]`);
    const value = fact?.querySelector<HTMLElement>('.fact-value') ?? null;
    return fact === null || value === null ? undefined : { fact, value };
  });
  const [version, stars, forks] = elements;
  if (version === undefined || stars === undefined || forks === undefined) return false;
  const header = link.closest('header') ?? link;
  const was = {
    box: box.hidden,
    counted: link.classList.contains('has-facts'),
    facts: [version, stars, forks].map(({ fact, value }) => ({
      hidden: fact.hidden,
      text: value.textContent,
    })),
  };
  // A version GitHub did not give now: the build's stays (the version element as the build wrote it).
  const shown: RepositoryFacts = {
    ...facts,
    version: facts.version ?? (version.fact.hidden ? null : version.value.textContent),
  };
  const before = places(header, link);
  const texts = [shown.version ?? '', formatCount(shown.stars), formatCount(shown.forks)];
  [version, stars, forks].forEach(({ fact, value }, index) => {
    value.textContent = texts[index] ?? '';
    fact.hidden = value.textContent === '';
  });
  box.hidden = false;
  link.classList.add('has-facts');
  const after = places(header, link);
  const kept = (value: number, index: number): boolean =>
    Math.abs(value - (before[index] ?? Number.NaN)) <= 0.5;
  if (after.length !== before.length || !after.every(kept)) {
    [version, stars, forks].forEach(({ fact, value }, index) => {
      value.textContent = was.facts[index]?.text ?? '';
      fact.hidden = was.facts[index]?.hidden ?? true;
    });
    box.hidden = was.box;
    link.classList.toggle('has-facts', was.counted);
    return false;
  }
  link.setAttribute('aria-label', repositoryLinkLabel(PRODUCT_NAME, shown));
  return true;
}

/** Starts the refresh for the header's repository link, if the page has one that names its repository. */
export function startRepositoryFacts(): void {
  const link = document.querySelector<HTMLAnchorElement>('a.header-github[data-repository]');
  const slug = link?.dataset.repository;
  if (link === null || slug === undefined) return;
  // GitHub told the build the repository is not public: the visitor's browser would get the same 404.
  if (link.hasAttribute('data-repository-not-public')) return;
  const refresh = (): void => {
    void currentRepositoryFacts(slug, () => window.sessionStorage).then((facts) => {
      if (facts !== undefined) showRepositoryFacts(link, facts);
    });
  };
  const whenIdle = (): void => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(refresh, { timeout: 2000 });
    else setTimeout(refresh, 200);
  };
  if (document.readyState === 'complete') whenIdle();
  else window.addEventListener('load', whenIdle, { once: true });
}
