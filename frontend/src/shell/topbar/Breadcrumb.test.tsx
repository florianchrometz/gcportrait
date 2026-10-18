// SPDX-License-Identifier: MIT
/**
 * The scope breadcrumb with the drill-in trail on demo S: the scope alone at the organisation; the
 * containers above a drill-in root down to the root (`aria-current="location"`), each a button that drills out
 * to it; the scope drills out of the root; a refused root says so; axe. On a phone, where the trail scrolls
 * sideways (useTrailAtItsEnd): it rests at its end; a crumb that takes focus from the keyboard is scrolled into
 * view, whole, and one focused by a pointer is not; while a crumb keeps that focus a change of size keeps it in
 * view, and the end once focus has left.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoAxeViolations } from '../../test/axe';
import { DRAWING_APP_TIMEOUT } from '../../test/renderApp';
import { installViewport, type ViewportControl } from '../../test/viewport';
import { drawn, inTopBar, renderControls } from '../../views/testing/controls';

const FOLDER = '//cloudresourcemanager.googleapis.com/folders/';

function scope(): HTMLElement {
  return inTopBar().getByRole('navigation', { name: 'Scope' });
}

async function crumbs(count: number): Promise<HTMLElement[]> {
  return waitFor(
    () => {
      const items = within(scope()).getAllByRole('listitem');
      expect(items).toHaveLength(count);
      return items;
    },
    { timeout: 20_000 },
  );
}

describe('the scope breadcrumb', () => {
  it(
    'shows "No scope loaded" without a diagram, and the scope alone at the organisation',
    DRAWING_APP_TIMEOUT,
    async () => {
      const app = renderControls('/diagram', { workers: false });
      expect(scope().textContent).toBe('No scope loaded');
      app.unmount();
      const drawnApp = renderControls('/diagram#snapshot=demo:S');
      await drawn(drawnApp.container);
      await waitFor(() => {
        expect(scope().textContent).toBe('example.com');
      });
      expect(within(scope()).queryByRole('button')).toBeNull();
    },
  );

  it(
    'runs the trail from the scope to the drill-in root, and each crumb drills out to its container',
    DRAWING_APP_TIMEOUT,
    async () => {
      const app = renderControls(`/diagram#snapshot=demo:S&root=${FOLDER}20000000004`);
      await drawn(app.container);
      const items = await crumbs(4);
      expect(items.map((item) => item.textContent)).toEqual([
        'example.com',
        'Workloads',
        'Retail',
        'Production',
      ]);
      expect(items[3]?.getAttribute('aria-current')).toBe('location');
      expect(within(items[3] ?? scope()).queryByRole('button')).toBeNull();
      await expectNoAxeViolations(scope());

      await userEvent.click(within(scope()).getByRole('button', { name: 'Retail' }));
      expect(app.hash()).toBe(`snapshot=demo:S&root=${FOLDER}20000000003`);
      expect((await crumbs(3)).map((item) => item.textContent)).toEqual([
        'example.com',
        'Workloads',
        'Retail',
      ]);

      await userEvent.click(within(scope()).getByRole('button', { name: 'example.com' }));
      expect(app.hash()).toBe('snapshot=demo:S');
      await crumbs(1);
    },
  );

  it('follows a drill-in from the node menu', DRAWING_APP_TIMEOUT, async () => {
    const app = renderControls('/diagram#snapshot=demo:S&lens=networking&detail=all');
    const svg = await drawn(app.container);
    const project = svg.querySelector<SVGGElement>('.dg-zone[aria-label^="Project: "]');
    if (project === null) throw new Error('no project zone');
    project.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Details' }));
    expect(app.hash()).toContain(`root=${project.getAttribute('data-id') ?? ''}`);
    const items = await crumbs(3);
    expect(items[0]?.textContent).toBe('example.com');
    expect(items[2]?.getAttribute('aria-current')).toBe('location');
  });

  it(
    'says when the root is not found, and the scope still drills out of it',
    DRAWING_APP_TIMEOUT,
    async () => {
      const app = renderControls(`/diagram#snapshot=demo:S&root=${FOLDER}99999999999`);
      await drawn(app.container);
      const items = await crumbs(2);
      await waitFor(() => {
        expect(items[1]?.textContent).toBe('99999999999 (not found)');
      });
      await userEvent.click(within(scope()).getByRole('button', { name: 'example.com' }));
      expect(app.hash()).toBe('snapshot=demo:S');
    },
  );
});

describe('the scope breadcrumb on a phone, a trail that scrolls sideways', () => {
  /** The trail's width and its box's, which jsdom does not lay out: it rests at 600 - 200 = 400. */
  const TRAIL = { scrollWidth: 600, clientWidth: 200 } as const;
  const isTrail = (element: Element): boolean => element.matches('header nav[aria-label="Scope"]');
  let viewport: ViewportControl | undefined;
  /** Every scrollIntoView call (jsdom has none): the element and its options. */
  let scrolled: { readonly crumb: Element; readonly options: unknown }[] = [];
  /** The ResizeObservers made, what each observes and whether it was disconnected (jsdom has none). */
  let observers: { readonly fire: () => void; readonly targets: Set<Element>; disconnected: boolean }[] = [];
  /**
   * Whether the focused element shows its focus ring (`:focus-visible`), as a browser answers after a key (true) or
   * a tap or a click (false); jsdom's selector engine guesses it from the events it has seen.
   */
  let ring = true;

  beforeEach(() => {
    viewport = installViewport(375);
    scrolled = [];
    observers = [];
    ring = true;
    // The real method, read off its descriptor: it runs with whatever element the spy is called on.
    const matches: unknown = Object.getOwnPropertyDescriptor(Element.prototype, 'matches')?.value;
    if (typeof matches !== 'function') throw new Error('no Element.prototype.matches');
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selectors: string) {
      return selectors === ':focus-visible'
        ? ring && this === this.ownerDocument.activeElement
        : Reflect.apply(matches, this, [selectors]) === true;
    });
    vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(function (this: Element) {
      return isTrail(this) ? TRAIL.scrollWidth : 0;
    });
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      return isTrail(this) ? TRAIL.clientWidth : 0;
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value(this: Element, options?: unknown) {
        scrolled.push({ crumb: this, options });
      },
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private readonly entry: (typeof observers)[number];
        constructor(callback: () => void) {
          this.entry = { fire: callback, targets: new Set(), disconnected: false };
          observers.push(this.entry);
        }
        observe(target: Element): void {
          this.entry.targets.add(target);
        }
        unobserve(target: Element): void {
          this.entry.targets.delete(target);
        }
        disconnect(): void {
          this.entry.disconnected = true;
        }
      },
    );
  });

  afterEach(() => {
    viewport?.uninstall();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  });

  /** Tab from the start of the page until the first crumb has focus. */
  async function tabToTheTrail(): Promise<void> {
    for (let step = 0; step < 20 && !scope().contains(document.activeElement); step += 1)
      await userEvent.tab();
    expect(scope().contains(document.activeElement)).toBe(true);
  }

  /** The trail's box changes size: what its live observer does then. */
  function resized(): void {
    const live = observers.filter((observer) => !observer.disconnected && observer.targets.has(scope()));
    expect(live).toHaveLength(1);
    live[0]?.fire();
  }

  it(
    'rests at its end; a crumb that takes focus from the keyboard scrolls into view, whole, and one a pointer focuses does not',
    DRAWING_APP_TIMEOUT,
    async () => {
      const app = renderControls(`/diagram#snapshot=demo:S&root=${FOLDER}20000000004`);
      await drawn(app.container);
      await crumbs(4);
      const nav = scope();
      await waitFor(() => {
        expect(nav.scrollLeft).toBe(TRAIL.scrollWidth - TRAIL.clientWidth);
      });
      expect(nav.hasAttribute('data-cut')).toBe(true);

      await tabToTheTrail();
      for (const name of ['example.com', 'Workloads', 'Retail']) {
        const crumb = within(nav).getByRole('button', { name });
        expect(document.activeElement).toBe(crumb);
        expect(scrolled.at(-1)).toEqual({ crumb, options: { block: 'nearest', inline: 'nearest' } });
        await userEvent.tab();
      }
      expect(nav.contains(document.activeElement)).toBe(false);

      // Focus without its focus ring, as a tap or a click gives it: the crumb stays where the pointer found it.
      scrolled = [];
      ring = false;
      within(nav).getByRole('button', { name: 'Workloads' }).focus();
      expect(scrolled).toEqual([]);
    },
  );

  it(
    'keeps a crumb with keyboard focus in view when its box changes size, and the end once focus has left',
    DRAWING_APP_TIMEOUT,
    async () => {
      const app = renderControls(`/diagram#snapshot=demo:S&root=${FOLDER}20000000004`);
      await drawn(app.container);
      await crumbs(4);
      const nav = scope();
      await tabToTheTrail();
      await userEvent.tab();
      const crumb = within(nav).getByRole('button', { name: 'Workloads' });
      expect(document.activeElement).toBe(crumb);
      nav.scrollLeft = 120;
      scrolled = [];

      resized();
      expect(scrolled).toEqual([{ crumb, options: { block: 'nearest', inline: 'nearest' } }]);
      expect(nav.scrollLeft).toBe(120);

      crumb.blur();
      resized();
      expect(nav.scrollLeft).toBe(TRAIL.scrollWidth - TRAIL.clientWidth);
    },
  );
});
