// SPDX-License-Identifier: MIT
/**
 * The diagram page end to end in jsdom, with the real data and layout handlers running in-process: the demo
 * organisation S is loaded, laid out and drawn from the URL hash; hover and selection only paint (the layout
 * and the Scene are asked for exactly once, whatever the pointer does); selection opens the details drawer and
 * goes into the hash; a lens change asks for a new Scene and a new layout.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createMemoryPreferenceStore } from '../storage/preferences';
import { drawn } from '../test/diagram';
import { currentLocation, renderApp } from '../test/renderApp';
import { createInProcessWorkers } from './pipeline/inProcess';
import type { DiagramWorkers } from './pipeline/workers';

/** In-process workers that count the Scene and layout requests. */
function countingWorkers(): { counts: { scene: number; layout: number }; factory: () => DiagramWorkers } {
  const counts = { scene: 0, layout: 0 };
  const factory = (): DiagramWorkers => {
    const workers = createInProcessWorkers();
    const layout = workers.layout.layout.bind(workers.layout);
    workers.layout.layout = (...args) => {
      counts.layout += 1;
      return layout(...args);
    };
    const scene = workers.data.scene.bind(workers.data);
    workers.data.scene = (...args) => {
      counts.scene += 1;
      return scene(...args);
    };
    return workers;
  };
  return { counts, factory };
}

// `drawn`: the canvas once it is drawn, fitted and interactive (`data-diagram-ready`). State the page sets in its
// own passive effects (the breadcrumb's scope, a setting read from the store) may arrive in a later render: wait for
// it with the same generous timeout.

describe('the diagram page', () => {
  it('draws demo S from the hash: named and described with no affiliation line, with the legend, fitted, the scope in the breadcrumb', async () => {
    // The title block's lines are titleBlock.test.ts's and the baselines'. The canvas's <title> and <desc> are drawn
    // by DiagramCanvas itself, outside the Drawing, so the placement rule (ADR 0018) on the live canvas is checked
    // here.
    const { counts, factory } = countingWorkers();
    const { container } = renderApp('/diagram#snapshot=demo:S', { diagramWorkers: factory });
    const svg = await drawn(container);
    expect(counts).toEqual({ scene: 1, layout: 1 });
    expect(svg.getAttribute('role')).toBe('graphics-document');
    expect(svg.querySelector('title')?.textContent).toBe('gcportrait diagram of example.com, Overview lens');
    expect(svg.querySelector('desc')?.textContent).toMatch(
      /^example\.com, Overview lens, read 2026-10-0\dT[\d:]+[+-][\d:]+\. Drawn with gcportrait\.$/,
    );
    expect(svg.textContent).not.toMatch(/affiliated/i);
    expect(svg.querySelector('.dg-legend')?.textContent).toContain('routes — traffic path');
    // The canvas was fitted: the viewport group carries a d3-zoom transform.
    expect(svg.querySelector('.dg-viewport')?.getAttribute('transform')).toMatch(
      /^translate\(.+\) scale\(.+\)$/,
    );
    await waitFor(
      () => {
        expect(
          within(screen.getByRole('navigation', { name: 'Scope' })).getByText('example.com'),
        ).toBeDefined();
      },
      { timeout: 20_000 },
    );
  }, 30_000);

  it('paints hover without asking for a new Scene or layout, and selects into the hash and the drawer', async () => {
    const { counts, factory } = countingWorkers();
    const { container } = renderApp('/diagram#snapshot=demo:S', { diagramWorkers: factory });
    const svg = await drawn(container);
    const cards = [...svg.querySelectorAll<SVGGElement>('.dg-card')];
    expect(cards.length).toBeGreaterThan(10);
    // A traced line goes on top only while it is traced, keyed `<from> -<kind>-> <to>` by its rects.
    expect(svg.querySelectorAll('.dg-edge-top')).toHaveLength(0);
    let focusedLines = 0;
    for (const card of cards) {
      const id = card.getAttribute('data-id') ?? '';
      fireEvent.pointerOver(card.querySelector('text') ?? card);
      expect(card.classList.contains('is-path')).toBe(true);
      // A card has nothing inside it: its own lines are traced, and beyond them only its routes/connects
      // chain; the rest stay hidden.
      const focused = [...svg.querySelectorAll('.dg-edge-top.is-focus')].map(
        (element) => element.getAttribute('data-edge') ?? '',
      );
      for (const key of focused) {
        const own = key.startsWith(`${id} -`) || key.endsWith(`-> ${id}`);
        expect(own || / -(routes|connects)-> /.test(key), key).toBe(true);
      }
      expect(focused).toHaveLength(svg.querySelectorAll('.dg-edge-top').length);
      focusedLines += focused.length;
    }
    expect(focusedLines).toBeGreaterThan(0);
    fireEvent.pointerLeave(svg);
    expect(svg.querySelectorAll('.is-path, .dg-edge-top')).toHaveLength(0);
    expect(counts).toEqual({ scene: 1, layout: 1 });

    const target = cards[2];
    const id = target?.getAttribute('data-id') ?? '';
    await act(async () => {
      fireEvent.click(target?.querySelector('text') ?? svg);
      await Promise.resolve();
    });
    const drawer = screen.getByRole('complementary', { name: 'Details' });
    expect(within(drawer).getByText(id)).toBeDefined();
    expect(decodeURIComponent(currentLocation(container))).toContain(`selection=${id}`);
    expect(target?.getAttribute('aria-pressed')).toBe('true');
    expect(svg.querySelector('.dg-select-ring')?.getAttribute('display')).toBeNull();
    expect(counts).toEqual({ scene: 1, layout: 1 });

    fireEvent.keyDown(svg, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('complementary', { name: 'Details' })).toBeNull();
    });
    expect(counts).toEqual({ scene: 1, layout: 1 });
  }, 30_000);

  it('keeps the selection trace through a hover preview, never asking for a new Scene or layout', async () => {
    const { counts, factory } = countingWorkers();
    const { container } = renderApp('/diagram#snapshot=demo:S&lens=load-balancing', {
      diagramWorkers: factory,
    });
    const svg = await drawn(container);
    const rule = svg.querySelector<SVGGElement>('.dg-card[data-id*="/global/forwardingRules/"]');
    expect(rule).not.toBeNull();
    const id = rule?.getAttribute('data-id') ?? '';
    await act(async () => {
      fireEvent.click(rule?.querySelector('text') ?? svg);
      await Promise.resolve();
    });
    const traced = (): string[] =>
      [...svg.querySelectorAll('.dg-edge-top.is-focus')].map(
        (element) => element.getAttribute('data-edge') ?? '',
      );
    const chain = traced();
    // The forwarding rule's chain runs on through its proxy and URL map to the backends.
    expect(chain.filter((key) => key.includes(' -routes-> ')).length).toBeGreaterThan(2);
    expect(svg.querySelectorAll('.is-reached').length).toBeGreaterThan(2);
    expect(svg.querySelectorAll('.dg-zone.is-path').length).toBeGreaterThan(1);
    // Hovering another card previews its trace; leaving brings the selection's back.
    const other = [...svg.querySelectorAll<SVGGElement>('.dg-card')].find(
      (element) => element.getAttribute('data-id') !== id,
    );
    fireEvent.pointerOver(other?.querySelector('text') ?? svg);
    fireEvent.pointerLeave(svg);
    expect(traced()).toEqual(chain);
    // The console action of the selected card is placed in its top-right corner, a tab stop, and nothing was
    // opened.
    const action = svg.querySelector('.dg-console-action');
    expect(action?.getAttribute('href')).toMatch(/^https:\/\/console\.cloud\.google\.com\//);
    expect(action?.getAttribute('tabindex')).toBe('0');
    expect(counts).toEqual({ scene: 1, layout: 1 });
  }, 30_000);

  it('opens the node menu with Enter on the selected card: console link, copy, never a new layout', async () => {
    const { counts, factory } = countingWorkers();
    const { container } = renderApp('/diagram#snapshot=demo:S', { diagramWorkers: factory });
    const svg = await drawn(container);
    const stop = svg.querySelector<SVGGElement>('.dg-node[tabindex="0"]');
    if (stop === null) throw new Error('no tab stop');
    fireEvent.keyDown(stop, { key: 'Enter' });
    await waitFor(() => {
      expect(stop.getAttribute('aria-pressed')).toBe('true');
    });
    fireEvent.keyDown(stop, { key: 'Enter' });
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toContain('Copy resource name');
    const link = items.find((item) => item.tagName === 'A');
    if (link !== undefined) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });
    expect(document.activeElement).toBe(stop);
    // Shift+F10 opens it too.
    fireEvent.keyDown(stop, { key: 'F10', shiftKey: true });
    expect(await screen.findByRole('menu')).toBeDefined();
    expect(counts).toEqual({ scene: 1, layout: 1 });
  }, 30_000);

  it('opens a node with Enter, and asks for a new Scene and layout when the lens changes', async () => {
    const { counts, factory } = countingWorkers();
    const { container } = renderApp('/diagram#snapshot=demo:S', { diagramWorkers: factory });
    const svg = await drawn(container);
    // One tab stop in the drawing: the first card, chip or card-sized zone.
    const stops = svg.querySelectorAll<SVGGElement>('.dg-node[tabindex="0"]');
    expect(stops).toHaveLength(1);
    fireEvent.keyDown(stops[0] ?? svg, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByRole('complementary', { name: 'Details' })).toBeDefined();
    });

    const lens = within(screen.getByRole('banner')).getByRole('combobox', { name: 'Lens' });
    await waitFor(() => {
      expect(lens.textContent).toContain('Overview');
    });
    await userEvent.click(lens);
    await userEvent.click(screen.getByRole('option', { name: 'Load balancing' }));
    expect(currentLocation(container)).toContain('lens=load-balancing');
    await waitFor(
      () => {
        expect(counts).toEqual({ scene: 2, layout: 2 });
        expect(container.querySelector('svg.dg-canvas title')?.textContent).toContain('Load balancing lens');
      },
      { timeout: 20_000 },
    );
  }, 30_000);

  it('leaves the legend and the title block off the canvas when the setting says so', async () => {
    const preferences = createMemoryPreferenceStore();
    await preferences.set('diagramOverlays', false);
    const { factory } = countingWorkers();
    const { container } = renderApp('/diagram#snapshot=demo:S', { diagramWorkers: factory, preferences });
    const svg = await drawn(container);
    await waitFor(
      () => {
        expect(svg.querySelector('.dg-legend')).toBeNull();
      },
      { timeout: 20_000 },
    );
    expect(svg.querySelector('.dg-title-block')).toBeNull();
  }, 30_000);

  it('offers the demo organisations on the empty canvas and in the Snapshot menu', async () => {
    const { container } = renderApp('/settings');
    const banner = screen.getByRole('banner');
    await userEvent.click(within(banner).getByRole('button', { name: 'Snapshot' }));
    const menu = screen.getByRole('menu', { name: 'Snapshot' });
    expect(
      within(menu)
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent),
    ).toEqual(['Demo organisation S (small)', 'Demo organisation M (medium)', 'Demo organisation L (large)']);
    expect(document.activeElement).toBe(within(menu).getAllByRole('menuitemradio')[0]);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(currentLocation(container)).toBe('/diagram#snapshot=demo:M');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes the Snapshot menu with Escape and returns focus to its button', async () => {
    renderApp('/diagram');
    const button = within(screen.getByRole('banner')).getByRole('button', { name: 'Snapshot' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeDefined();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    const canvas = screen.getByRole('region', { name: 'Diagram canvas' });
    expect(
      within(canvas).getByRole('link', { name: 'Demo organisation M (medium)' }).getAttribute('href'),
    ).toBe('/diagram#snapshot=demo:M');
  });

  it('works the Lens picker with the keyboard: arrows move, Enter chooses, Escape closes', async () => {
    const { container } = renderApp('/diagram#snapshot=demo:S');
    const lens = within(screen.getByRole('banner')).getByRole('combobox', { name: 'Lens' });
    lens.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(lens.getAttribute('aria-expanded')).toBe('true');
    const active = lens.getAttribute('aria-activedescendant');
    expect(document.getElementById(active ?? '')?.textContent).toContain('Overview');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(lens.getAttribute('aria-expanded')).toBe('false');
    expect(currentLocation(container)).toBe('/diagram#snapshot=demo:S&lens=networking');
    await userEvent.keyboard('{End}');
    expect(document.getElementById(lens.getAttribute('aria-activedescendant') ?? '')?.textContent).toBe(
      'Everything',
    );
    await userEvent.keyboard('{Escape}');
    expect(lens.getAttribute('aria-expanded')).toBe('false');
    expect(currentLocation(container)).toBe('/diagram#snapshot=demo:S&lens=networking');
  });

  it('says when a link names no snapshot, rather than that there is nothing to draw', () => {
    renderApp('/diagram#snapshot=demo:Q&lens=networking');
    expect(screen.getByRole('heading', { level: 2, name: 'This link names no snapshot' })).toBeDefined();
    expect(screen.getByRole('alert').textContent).toContain('“demo:Q” is not a snapshot');
    // The demo organisations are still offered.
    expect(screen.getByRole('link', { name: 'Demo organisation M (medium)' })).toBeDefined();
  });

  it('shows why a view cannot be drawn', async () => {
    const { factory } = countingWorkers();
    renderApp('/diagram#snapshot=01J9Z3K5Q8XW2V4N6P7R8S9T0A', { diagramWorkers: factory });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('No snapshot "01J9Z3K5Q8XW2V4N6P7R8S9T0A" is available yet.');
  });
});
