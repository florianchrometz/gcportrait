// SPDX-License-Identifier: MIT
/**
 * The search box in the whole app (jsdom, the real data and layout handlers in-process, demo S): `/` focuses it;
 * typing lists results grouped by kind with icon, type and project and a result count; choosing one selects it
 * (the hash's selection and highlight, the drawer) and, inside collapsed zones, flips them open first; a node
 * the lens leaves out opens the reveal dialog, whose offer switches the view; only the current text's results can
 * be chosen (Enter pressed before they arrive lands on the new best result, never on an earlier text's); Escape
 * clears the text and the highlight; without a snapshot, and on one that could not be loaded, it says why it is
 * inert. axe finds nothing with the results or the dialog open.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createInProcessWorkers } from '../../diagram/pipeline/inProcess';
import { expectNoAxeViolations } from '../../test/axe';
import { drawn } from '../../test/diagram';
import { renderApp, type AppRender } from '../../test/renderApp';
import { createSavedViewStore } from '../../views/savedViewStore';
import { inTopBar, openUndrawable, renderControls } from '../../views/testing/controls';

const ORDERS_API = '//run.googleapis.com/projects/demo-svc-1/locations/europe-west3/services/orders-api';
const WEB_VM = '//compute.googleapis.com/projects/demo-web-1/zones/europe-west3-a/instances/web-1mnl';
const KMS_KEY =
  '//cloudkms.googleapis.com/projects/demo-sec-1/locations/europe-west3/keyRings/kr-europe-west3/cryptoKeys/cmek-shared';

/**
 * How long a chosen result may take to reach the hash: the data worker first locates the node in the view
 * (search/useReveal.ts), here in-process on the test's own thread, which a busy machine stretches to seconds,
 * past `waitFor`'s default of one.
 */
const LOCATED = { timeout: 10_000 };

function open(path: string): AppRender {
  return renderApp(path, { diagramWorkers: createInProcessWorkers });
}

function searchBox(): HTMLInputElement {
  return within(screen.getByRole('banner')).getByRole<HTMLInputElement>('combobox', {
    name: 'Search assets',
  });
}

async function results(): Promise<HTMLElement> {
  return waitFor(
    () => {
      const list = screen.getByRole('listbox', { name: 'Search assets' });
      if (within(list).queryAllByRole('option').length === 0) throw new Error('no results yet');
      return list;
    },
    { timeout: 10_000 },
  );
}

describe('SearchBox', () => {
  it('focuses with / from anywhere but a text field, and is labelled as a combobox with its shortcut', async () => {
    const app = open('/diagram#snapshot=demo:S');
    await drawn(app.container);
    const input = searchBox();
    expect(input.getAttribute('aria-keyshortcuts')).toBe('/');
    expect(input.getAttribute('aria-disabled')).toBeNull();
    expect(screen.getByRole('search')).toBeDefined();
    within(screen.getByRole('banner')).getByRole('link', { name: 'Settings' }).focus();
    await userEvent.keyboard('/');
    expect(document.activeElement).toBe(input);
    // Typed into the box itself, `/` is text.
    await userEvent.keyboard('a/b');
    expect(input.value).toBe('a/b');
  }, 30_000);

  it('lists grouped results with a count, and choosing one selects it into the hash and the drawer', async () => {
    const app = open('/diagram#snapshot=demo:S');
    await drawn(app.container);
    const input = searchBox();
    await userEvent.click(input);
    await userEvent.type(input, 'orders');
    const list = await results();
    const groups = within(list).getAllByRole('group');
    expect(groups.length).toBeGreaterThan(0);
    const first = within(list).getAllByRole('option')[0];
    expect(first?.textContent).toContain('orders');
    // Each option: its label as its name, its type and project as its description, a decorative icon.
    const option = within(list).getByRole('option', { name: 'orders-api' });
    expect(option.querySelector('svg[aria-hidden="true"][data-icon]')).not.toBeNull();
    expect(document.getElementById(option.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Cloud Run service · demo-svc-1',
    );
    await waitFor(() => {
      expect(within(screen.getByRole('search')).getAllByRole('status')[0]?.textContent).toMatch(
        /^\d+ results?/,
      );
    });
    await expectNoAxeViolations();

    // Down to orders-api, then Enter.
    const options = within(list).getAllByRole('option');
    const index = options.indexOf(option);
    for (let step = 0; step <= index; step += 1) await userEvent.keyboard('{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toBe(option.id);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => {
      expect(app.hash()).toContain(`selection=${ORDERS_API}`);
    }, LOCATED);
    expect(app.hash()).toContain('highlight=orders');
    expect(
      within(screen.getByRole('complementary', { name: 'Details' })).getByText(ORDERS_API),
    ).toBeDefined();
    expect(input.value).toBe('orders');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  }, 30_000);

  it('flips the collapsed zones around a hit open before selecting it', async () => {
    const app = open('/diagram#snapshot=demo:S&detail=folders');
    const svg = await drawn(app.container);
    expect(svg.querySelector(`[data-id="${WEB_VM}"]`)).toBeNull();
    const input = searchBox();
    await userEvent.click(input);
    await userEvent.type(input, '10.0.0.2');
    const list = await results();
    expect(within(list).getAllByRole('option')[0]?.textContent).toContain('web-1mnl');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => {
      expect(app.hash()).toContain(`selection=${WEB_VM}`);
    }, LOCATED);
    expect(app.hash()).toMatch(/flips=[^&]+/);
    await waitFor(
      () => {
        expect(app.container.querySelector(`svg.dg-canvas [data-id="${WEB_VM}"]`)).not.toBeNull();
      },
      { timeout: 20_000 },
    );
    await waitFor(() => {
      expect(app.container.querySelector(`[data-id="${WEB_VM}"]`)?.getAttribute('aria-pressed')).toBe('true');
    });
  }, 30_000);

  it('offers the Everything lens for a node the lens leaves out, and switches only on confirm', async () => {
    const app = open('/diagram#snapshot=demo:S&lens=networking');
    await drawn(app.container);
    const input = searchBox();
    await userEvent.click(input);
    await userEvent.type(input, 'cmek-shared');
    await results();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'cmek-shared is not in this view' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // The results list closed when the result was chosen; only the dialog is open.
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(dialog.getAttribute('aria-describedby') ?? '')?.textContent).toContain(
      'The Networking lens does not draw the type',
    );
    const offers = within(dialog)
      .getAllByRole('button')
      .filter((button) => button.textContent !== 'Close');
    expect(offers.map((button) => button.textContent)).toEqual([
      'Switch to the Everything lens',
      'Include the type Cloud Key Management Service crypto key',
    ]);
    expect(document.activeElement).toBe(offers[0]);
    expect(app.hash()).not.toContain('selection=');
    await expectNoAxeViolations();
    await act(async () => {
      offers[0]?.click();
      await Promise.resolve();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => {
      expect(app.hash()).toContain('lens=everything');
    });
    expect(app.hash()).toContain(`selection=${KMS_KEY}`);
    // Focus is back in the box, and its list stays closed until the person types or presses a key.
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    await userEvent.keyboard('{ArrowDown}');
    expect(input.getAttribute('aria-expanded')).toBe('true');
  }, 30_000);

  it('chooses only from the current text’s results: Enter before they arrive lands on the new best one', async () => {
    const app = open('/diagram#snapshot=demo:S');
    await drawn(app.container);
    const input = searchBox();
    await userEvent.click(input);
    await userEvent.type(input, '10.0.0.2');
    const list = await results();
    expect(within(list).getAllByRole('option')[0]?.textContent).toContain('web-1mnl');
    const status = (): string | null | undefined =>
      within(screen.getByRole('search')).getAllByRole('status')[0]?.textContent;
    await waitFor(() => {
      expect(status()).toMatch(/^\d+ results?/);
    });
    // Paste a new text and press Enter at once: the earlier results are busy, their count is not announced.
    fireEvent.change(input, { target: { value: 'orders-api' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(list.getAttribute('aria-busy')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    expect(status()).toBe('');
    // The new text's search runs in the in-process data worker, on the test's own thread: under load, seconds.
    await waitFor(
      () => {
        expect(app.hash()).toContain(`selection=${ORDERS_API}`);
      },
      { timeout: 10_000 },
    );
    expect(app.hash()).toContain('highlight=orders-api');
    expect(app.hash()).not.toContain(WEB_VM);
    expect(input.value).toBe('orders-api');
  }, 30_000);

  it('keeps a full resource name searched for in the box after the choice', async () => {
    const app = open('/diagram#snapshot=demo:S');
    await drawn(app.container);
    const input = searchBox();
    await userEvent.click(input);
    fireEvent.change(input, { target: { value: ORDERS_API } });
    await results();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => {
      expect(app.hash()).toContain(`selection=${ORDERS_API}`);
    }, LOCATED);
    expect(app.hash()).toContain(`highlight=${ORDERS_API}`);
    expect(input.value).toBe(ORDERS_API);
  }, 30_000);

  it('is inert on a snapshot that could not be loaded', async () => {
    await openUndrawable();
    await waitFor(() => {
      expect(searchBox().getAttribute('aria-disabled')).toBe('true');
    });
    expect(searchBox().title).toBe('The snapshot could not be loaded');
  }, 30_000);

  it('never shows text typed before a choice in a later view without a highlight, nor for another snapshot', async () => {
    // A stale draft such as "orders-db": the text typed before a choice came back whenever the highlight returned
    // to empty (a saved view, a link, Back).
    const savedViews = createSavedViewStore(Promise.resolve(null));
    await savedViews.save('Plain S', 'snapshot=demo:S');
    const app = renderControls('/diagram#snapshot=demo:S', { savedViews });
    await drawn(app.container);
    const input = searchBox();
    await userEvent.click(input);
    await userEvent.type(input, 'orders');
    await results();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => {
      expect(app.hash()).toContain('highlight=orders');
    }, LOCATED);
    expect(input.value).toBe('orders');

    // A view without a highlight (here a saved view; a link or Back alike): the box is empty.
    await userEvent.click(inTopBar().getByRole('button', { name: 'Saved views' }));
    const dialog = screen.getByRole('dialog', { name: 'Saved views' });
    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'Apply Plain S' }, { timeout: 5000 }),
    );
    await waitFor(() => {
      expect(app.hash()).toBe('snapshot=demo:S');
    });
    expect(searchBox().value).toBe('');

    // Text typed for one snapshot is not kept for another.
    await userEvent.click(searchBox());
    await userEvent.type(searchBox(), 'web');
    expect(searchBox().value).toBe('web');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(inTopBar().getByRole('button', { name: 'Snapshot' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: /\(medium\)/ }));
    await waitFor(() => {
      expect(app.hash()).toContain('snapshot=demo:M');
    });
    expect(searchBox().value).toBe('');
    app.unmount();
  }, 40_000);

  it('closes the list with Escape, then clears the text and the highlight', async () => {
    const app = open('/diagram#snapshot=demo:S&highlight=orders');
    await drawn(app.container);
    const input = searchBox();
    expect(input.value).toBe('orders');
    await userEvent.click(input);
    await results();
    await userEvent.keyboard('{Escape}');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    await userEvent.keyboard('{Escape}');
    expect(input.value).toBe('');
    await waitFor(() => {
      expect(app.hash()).not.toContain('highlight=');
    });
  }, 30_000);

  // Shown on the diagram page only, and inert (aria-disabled, read-only) without a snapshot: App.test.tsx ("app shell").
  it('says why it is inert without a snapshot, and / does not reach it there or away from the diagram', () => {
    const away = renderApp('/settings');
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(document.body);
    away.unmount();
    renderApp('/diagram');
    expect(searchBox().title).toBe('Choose a snapshot to search it');
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).not.toBe(searchBox());
  });
});
