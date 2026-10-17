// SPDX-License-Identifier: MIT
/**
 * The top bar composes one control group per file: the order below is its tab order, the Export menu last; the
 * working popups (Snapshot, Lens) share the store's one-open-popup state; axe finds nothing with either open. The
 * brand mark beside the wordmark is brand/icon.svg as the build writes it, under the build's base path (its size:
 * TopBar.css.test.ts). Narrower than a desktop, the rows fold into the View and More sheets (shell/parity.test.tsx
 * holds every control to every width); a pick in More that changes the view or the theme closes it onto its button,
 * and Copy link and Export's own menu keep it open. On a phone and a tablet opening View or More, by its button or by
 * `/`, closes the details drawer and keeps the selection, a click on the selected node opens the drawer again, and a
 * search result picked in View closes the sheet onto its button and opens the drawer on the result; on a desktop `/`
 * leaves the drawer open.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createInProcessWorkers } from '../../diagram/pipeline/inProcess';
import { fakeLibrary } from '../../snapshots/testing';
import { expectNoAxeViolations } from '../../test/axe';
import { staticDemoConfig, stubBackend } from '../../test/backend';
import { stubClipboard } from '../../test/clipboard';
import { drawn } from '../../test/diagram';
import { renderApp, WHOLE_APP_TIMEOUT, type AppRender } from '../../test/renderApp';
import { installViewport, type ViewportControl } from '../../test/viewport';
import { createSavedViewStore } from '../../views/savedViewStore';

/** A Cloud Run service of demo S, which the search finds as "orders-api". */
const ORDERS_API = '//run.googleapis.com/projects/demo-svc-1/locations/europe-west3/services/orders-api';

/** The banner's tab stops, by role and name (none inside a closed sheet). */
function tabStops(banner: HTMLElement): string[] {
  return [...banner.querySelectorAll<HTMLElement>('a[href], button, input')]
    .filter((element) => element.tabIndex >= 0 && element.closest('[hidden]') === null)
    .map((element) => {
      const role = element.getAttribute('role') ?? element.tagName.toLowerCase();
      const name =
        element.getAttribute('aria-label') ??
        (element.getAttribute('aria-labelledby') === null
          ? element.textContent.replace('▾', '').trim()
          : document.getElementById(element.getAttribute('aria-labelledby') ?? '')?.textContent);
      return `${role}:${name ?? ''}`;
    });
}

describe('TopBar', WHOLE_APP_TIMEOUT, () => {
  it('composes the control groups in their tab order', () => {
    renderApp('/diagram#snapshot=demo:S');
    expect(tabStops(screen.getByRole('banner'))).toEqual([
      'a:gcportrait',
      'a:Connect',
      'a:Diagram',
      'a:Snapshots',
      'a:Permissions',
      'a:Settings',
      'button:Snapshot',
      'button:Saved views',
      'button:Copy link',
      'button:Theme',
      'button:Export',
      'combobox:Lens',
      'button:Focus',
      'button:Filters',
      'radio:Auto',
      'combobox:',
    ]);
    expect(within(screen.getByRole('banner')).getByRole('combobox', { name: 'Search assets' })).toBeDefined();
  });

  it('keeps one popup open at a time, and passes axe with the Lens picker or the Snapshot menu open', async () => {
    renderApp('/diagram#snapshot=demo:S');
    const banner = screen.getByRole('banner');
    const lens = within(banner).getByRole('combobox', { name: 'Lens' });
    await userEvent.click(lens);
    expect(lens.getAttribute('aria-expanded')).toBe('true');
    await expectNoAxeViolations();
    await userEvent.click(within(banner).getByRole('button', { name: 'Snapshot' }));
    expect(screen.getByRole('menu', { name: 'Snapshot' })).toBeDefined();
    expect(lens.getAttribute('aria-expanded')).toBe('false');
    expect(
      within(screen.getByRole('menu', { name: 'Snapshot' }))
        .getAllByRole('menuitemradio')
        .map((item) => item.getAttribute('aria-checked')),
    ).toEqual(['true', 'false', 'false']);
    await expectNoAxeViolations();
  });

  it('ends the app row with the Export menu, after the theme and the account', () => {
    renderApp('/diagram#snapshot=demo:S');
    const banner = screen.getByRole('banner');
    const exportButton = within(banner).getByRole('button', { name: 'Export' });
    // The menu's anchor is the last of the app row's actions, and the actions end the row.
    const actions = exportButton.closest('div')?.parentElement;
    expect(actions?.lastElementChild?.contains(exportButton)).toBe(true);
    expect(actions?.parentElement?.lastElementChild).toBe(actions);
  });

  it.each(['/diagram', '/settings'])('passes axe at rest on %s', async (path) => {
    renderApp(path);
    await expectNoAxeViolations();
  });
});

describe('the brand mark', WHOLE_APP_TIMEOUT, () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** The mark in the banner's home link, which keeps the wordmark as its name. */
  function mark(): HTMLElement {
    const home = within(screen.getByRole('banner')).getByRole('link', { name: 'gcportrait' });
    return within(home).getByTestId('brand-mark');
  }

  it('is brand/icon.svg as an instance serves it, from the root, decorative', async () => {
    renderApp('/');
    const image = mark();
    expect(image.tagName).toBe('IMG');
    expect(image.getAttribute('src')).toBe('/favicon.svg');
    expect(image.getAttribute('alt')).toBe('');
    await expectNoAxeViolations();
  });

  it('comes from the build’s base path in the static demo, /demo/', () => {
    vi.stubEnv('BASE_URL', '/demo/');
    stubBackend();
    renderApp('/settings', { demo: false, staticConfig: staticDemoConfig(), snapshots: fakeLibrary() });
    expect(mark().getAttribute('src')).toBe('/demo/favicon.svg');
  });
});

describe('the top bar narrower than a desktop', WHOLE_APP_TIMEOUT, () => {
  let viewport: ViewportControl | undefined;

  afterEach(() => {
    viewport?.uninstall();
    viewport = undefined;
    vi.restoreAllMocks();
  });

  /** jsdom lays nothing out: every element, the diagram's canvas among them, measures `width` × `height`. */
  function measureEverything(width: number, height: number): void {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height);
  }

  it('on a tablet keeps two rows, the view row’s controls in View and the app row’s in More', async () => {
    viewport = installViewport(820);
    renderApp('/diagram#snapshot=demo:S');
    const banner = screen.getByRole('banner');
    expect(tabStops(banner)).toEqual(['a:gcportrait', 'button:More', 'button:View']);
    expect(within(banner).getByTestId('demo-badge').closest('[role="dialog"]')).toBeNull();
    await userEvent.click(within(banner).getByRole('button', { name: 'View' }));
    const view = within(banner).getByRole('dialog', { name: 'View' });
    expect(within(view).getByRole('combobox', { name: 'Lens' })).toBeDefined();
    expect(within(view).getByRole('combobox', { name: 'Search assets' })).toBeDefined();
    expect(within(view).queryByRole('navigation', { name: 'Scope' })).toBeNull();
    await expectNoAxeViolations();
  });

  it('on a phone is one row: the mark, the breadcrumb, View and More, the demo badge in More', async () => {
    viewport = installViewport(375);
    renderApp('/diagram#snapshot=demo:S');
    const banner = screen.getByRole('banner');
    // The home link keeps the wordmark as its name, for assistive technology only.
    expect(within(banner).getByRole('link', { name: 'gcportrait' })).toBeDefined();
    expect(banner.children).toHaveLength(1);
    expect(within(banner).getByRole('navigation', { name: 'Scope' })).toBeDefined();
    expect(tabStops(banner)).toEqual(['a:gcportrait', 'button:View', 'button:More']);
    await userEvent.click(within(banner).getByRole('button', { name: 'More' }));
    const more = within(banner).getByRole('dialog', { name: 'More' });
    expect(within(more).getByTestId('demo-badge')).toBeDefined();
    expect(within(more).getByRole('navigation', { name: 'Primary' })).toBeDefined();
    expect(within(more).getByRole('button', { name: 'Export' })).toBeDefined();
    await expectNoAxeViolations();
  });

  it('carries the canvas’s height on the diagram page for the sheets over it, and moves the disclosure bar aside while one is open', async () => {
    viewport = installViewport(375);
    measureEverything(375, 380);
    const { container } = renderApp('/diagram#snapshot=demo:S');
    const banner = screen.getByRole('banner');
    // Two thirds of it cap the sheets (TopBar.module.css, `.overCanvas`; TopBar.css.test.ts).
    expect(banner.style.getPropertyValue('--canvas-height')).toBe('380px');
    expect(container.querySelector('[data-top-sheet]')).toBeNull();
    await userEvent.click(within(banner).getByRole('button', { name: 'View' }));
    expect(container.querySelector('[data-top-sheet]')).not.toBeNull();
    await userEvent.click(within(banner).getByRole('button', { name: 'More' }));
    expect(container.querySelector('[data-top-sheet]')).not.toBeNull();
    await userEvent.click(within(banner).getByRole('link', { name: 'Settings' }));
    // No canvas under the sheets on another page.
    expect(banner.style.getPropertyValue('--canvas-height')).toBe('');
    // Back on the diagram page, the height is the canvas's as it is measured again.
    await userEvent.click(within(banner).getByRole('button', { name: 'More' }));
    await userEvent.click(within(banner).getByRole('link', { name: 'Diagram' }));
    expect(banner.style.getPropertyValue('--canvas-height')).toBe('380px');
  });

  it('carries no canvas height on a desktop, where the sheets are in place', () => {
    measureEverything(1440, 800);
    renderApp('/diagram#snapshot=demo:S');
    expect(screen.getByRole('banner').getAttribute('style')).toBeNull();
  });

  it('closes a sheet on a new page, and keeps one sheet open at a time', async () => {
    viewport = installViewport(375);
    renderApp('/diagram#snapshot=demo:S');
    const banner = screen.getByRole('banner');
    await userEvent.click(within(banner).getByRole('button', { name: 'View' }));
    await userEvent.click(within(banner).getByRole('button', { name: 'More' }));
    expect(within(banner).getByRole('button', { name: 'View' }).getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(within(banner).getByRole('link', { name: 'Settings' }));
    expect(within(banner).getByRole('button', { name: 'More' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeDefined();
  });
});

describe('the More sheet on a phone', WHOLE_APP_TIMEOUT, () => {
  let viewport: ViewportControl | undefined;

  afterEach(() => {
    viewport?.uninstall();
    viewport = undefined;
  });

  /** The More button, and its sheet once it has opened. */
  async function openMore(): Promise<{ readonly button: HTMLElement; readonly sheet: HTMLElement }> {
    const banner = screen.getByRole('banner');
    const button = within(banner).getByRole('button', { name: 'More' });
    await userEvent.click(button);
    return { button, sheet: within(banner).getByRole('dialog', { name: 'More' }) };
  }

  /** The sheet closed, with focus back on its button, where Escape leaves it. */
  function expectClosedOnto(button: HTMLElement, sheet: HTMLElement): void {
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(sheet.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
  }

  /** The sheet still open, focus on `control` in it. */
  function expectOpenOn(button: HTMLElement, sheet: HTMLElement, control: HTMLElement): void {
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(sheet.hidden).toBe(false);
    expect(document.activeElement).toBe(control);
  }

  it('closes after a snapshot is picked, focus back on More', async () => {
    viewport = installViewport(375);
    const app = renderApp('/diagram#snapshot=demo:S');
    const { button, sheet } = await openMore();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Snapshot' }));
    await userEvent.click(within(sheet).getByRole('menuitemradio', { name: 'Demo organisation M (medium)' }));
    expect(app.hash()).toMatch(/^snapshot=demo:M\b/);
    expect(screen.queryByRole('menu')).toBeNull();
    expectClosedOnto(button, sheet);
  });

  it('closes after a theme is picked, on any page, focus back on More', async () => {
    viewport = installViewport(375);
    renderApp('/settings');
    const { button, sheet } = await openMore();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Theme' }));
    await userEvent.click(within(sheet).getByRole('menuitemradio', { name: 'Dark' }));
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expectClosedOnto(button, sheet);
  });

  it('closes after a saved view is applied, once its dialog has closed, focus back on More', async () => {
    viewport = installViewport(375);
    const savedViews = createSavedViewStore(Promise.resolve(null));
    await savedViews.save('Networks', 'snapshot=demo:S&lens=networking');
    const app = renderApp('/diagram#snapshot=demo:S', { savedViews });
    const { button, sheet } = await openMore();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Saved views' }));
    const dialog = screen.getByRole('dialog', { name: 'Saved views' });
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Apply Networks' }));
    expect(app.hash()).toBe('snapshot=demo:S&lens=networking');
    expect(screen.queryByRole('dialog', { name: 'Saved views' })).toBeNull();
    expectClosedOnto(button, sheet);
  });

  it('leaves a snapshot picked away from the diagram to the diagram page it opens: a new page, focus at its start', async () => {
    viewport = installViewport(375);
    const app = renderApp('/settings');
    const { button, sheet } = await openMore();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Snapshot' }));
    await userEvent.click(within(sheet).getByRole('menuitemradio', { name: 'Demo organisation S (small)' }));
    expect(app.location()).toMatch(/^\/diagram#snapshot=demo:S\b/);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(sheet.hidden).toBe(true);
    expect(document.activeElement).toBe(document.getElementById('main'));
  });

  it('stays open for Copy link, focus on it', async () => {
    viewport = installViewport(375);
    const writeText = stubClipboard();
    renderApp('/diagram#snapshot=demo:S');
    const { button, sheet } = await openMore();
    const copy = within(sheet).getByRole('button', { name: 'Copy link' });
    await userEvent.click(copy);
    expect(writeText).toHaveBeenCalledOnce();
    await within(sheet).findByText('Link copied to the clipboard.');
    expectOpenOn(button, sheet, copy);
  });

  it('stays open for Export, whose own menu opens inside the sheet and closes with Escape onto it', async () => {
    viewport = installViewport(375);
    const { container } = renderApp('/diagram#snapshot=demo:S', { diagramWorkers: createInProcessWorkers });
    await drawn(container);
    const { button, sheet } = await openMore();
    const exportButton = within(sheet).getByRole('button', { name: 'Export' });
    await waitFor(() => {
      expect(exportButton.getAttribute('aria-disabled')).toBeNull();
    });
    await userEvent.click(exportButton);
    expect(within(sheet).getByRole('menu', { name: 'Export' })).toBeDefined();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    await userEvent.keyboard('{Escape}');
    expect(within(sheet).queryByRole('menu', { name: 'Export' })).toBeNull();
    expectOpenOn(button, sheet, exportButton);
  });
});

describe('the sheets and the details drawer', WHOLE_APP_TIMEOUT, () => {
  let viewport: ViewportControl | undefined;

  afterEach(() => {
    viewport?.uninstall();
    viewport = undefined;
  });

  /** The details drawer while it shows, else null. */
  function details(): HTMLElement | null {
    return screen.queryByRole('complementary', { name: 'Details' });
  }

  /** A click on the node `id` drawn on the canvas (the canvas reads it as a selection, DiagramCanvas.tsx). */
  async function clickNode(container: HTMLElement, id: string): Promise<void> {
    const node = container.querySelector(`svg.dg-canvas [data-id="${id}"]`);
    if (node === null) throw new Error(`${id} is not drawn`);
    await act(async () => {
      fireEvent.click(node.querySelector('text') ?? node);
      await Promise.resolve();
    });
  }

  /** Demo S drawn and its first card selected by a click, the drawer open: the app and the card's id. */
  async function selectACard(): Promise<{ readonly app: AppRender; readonly id: string }> {
    const app = renderApp('/diagram#snapshot=demo:S', { diagramWorkers: createInProcessWorkers });
    const svg = await drawn(app.container);
    const id = svg.querySelector('.dg-card[data-id]')?.getAttribute('data-id') ?? '';
    expect(id).not.toBe('');
    await clickNode(app.container, id);
    expect(details()).not.toBeNull();
    return { app, id };
  }

  it.each([
    ['a phone', 375],
    ['a tablet', 820],
  ])(
    'on %s, View or More opened closes the drawer and keeps the selection, and a click on the node opens it again',
    async (_, width) => {
      viewport = installViewport(width);
      const { app, id } = await selectACard();
      const banner = screen.getByRole('banner');
      const viewButton = within(banner).getByRole('button', { name: 'View' });
      await userEvent.click(viewButton);
      const view = within(banner).getByRole('dialog', { name: 'View' });
      expect(details()).toBeNull();
      expect(app.hash()).toContain(`selection=${id}`);
      expect(app.container.querySelector(`[data-id="${id}"]`)?.getAttribute('aria-pressed')).toBe('true');
      // Focus on the sheet's first control, as whenever it opens.
      expect(document.activeElement).toBe(within(view).getByRole('combobox', { name: 'Lens' }));
      // Closed, the sheet opens nothing again; nor does More, which closes it as well.
      await userEvent.keyboard('{Escape}');
      expect(document.activeElement).toBe(viewButton);
      expect(details()).toBeNull();
      await userEvent.click(within(banner).getByRole('button', { name: 'More' }));
      expect(within(banner).getByRole('dialog', { name: 'More' }).hidden).toBe(false);
      await userEvent.keyboard('{Escape}');
      expect(details()).toBeNull();
      // A click on the selected node opens the drawer again.
      await clickNode(app.container, id);
      expect(details()).not.toBeNull();
      // `/` opens View onto the search box, and closes the drawer too.
      await userEvent.keyboard('/');
      expect(view.hidden).toBe(false);
      await waitFor(() => {
        expect(document.activeElement).toBe(within(view).getByRole('combobox', { name: 'Search assets' }));
      });
      expect(details()).toBeNull();
      expect(app.hash()).toContain(`selection=${id}`);
    },
    30_000,
  );

  it('on a phone, a search result picked in View closes the sheet onto its button and opens the drawer on it', async () => {
    viewport = installViewport(375);
    const app = renderApp('/diagram#snapshot=demo:S', { diagramWorkers: createInProcessWorkers });
    await drawn(app.container);
    const banner = screen.getByRole('banner');
    const viewButton = within(banner).getByRole('button', { name: 'View' });
    await userEvent.click(viewButton);
    const view = within(banner).getByRole('dialog', { name: 'View' });
    const input = within(view).getByRole('combobox', { name: 'Search assets' });
    await userEvent.click(input);
    await userEvent.type(input, 'orders');
    const option = await waitFor(() => screen.getByRole('option', { name: 'orders-api' }), {
      timeout: 10_000,
    });
    await userEvent.click(option);
    // The data worker first locates the node (search/useReveal.ts), in-process here and slow on a busy machine.
    await waitFor(
      () => {
        expect(app.hash()).toContain(`selection=${ORDERS_API}`);
      },
      { timeout: 10_000 },
    );
    expect(view.hidden).toBe(true);
    expect(document.activeElement).toBe(viewButton);
    const drawer = screen.getByRole('complementary', { name: 'Details' });
    expect(within(drawer).getByText(ORDERS_API)).toBeDefined();
  }, 30_000);

  it('on a desktop, where the folds are in place, `/` focuses the search box and leaves the drawer open', async () => {
    const { app, id } = await selectACard();
    await userEvent.keyboard('/');
    expect(document.activeElement).toBe(
      within(screen.getByRole('banner')).getByRole('combobox', { name: 'Search assets' }),
    );
    expect(details()).not.toBeNull();
    expect(app.hash()).toContain(`selection=${id}`);
  }, 30_000);
});
