// SPDX-License-Identifier: MIT
/**
 * The Export menu: inert while nothing is drawn; a WAI-ARIA menu button whose menu holds the options
 * as radio and checkbox items and the four actions; keyboard operable; each action reports its outcome in the
 * status line, the clipboard copy with a plain message where the browser cannot copy images; the draw.io file in the
 * chosen area and theme, with the instance's version in its `agent`.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TAGLINE } from '../../branding';
import { DiagramSessionProvider, useDiagramSession } from '../../diagram/session';
import { modelOf, smallScene } from '../../diagram/testing/scenes';
import { DARK_PALETTE } from '../../diagram/theme/tokens';
import { readDrawioFile } from '../../export/drawio';
import type { ExportSettings } from '../../export/exportDiagram';
import type { PngGeometry } from '../../export/raster';
import type { ExportSource } from '../../export/source';
import { createMemoryPreferenceStore, PreferenceStoreContext } from '../../storage/preferences';
import { installMatchMedia, type SystemSchemeControl } from '../../test/matchMedia';
import { expectInertButFocusable } from '../../test/inert';
import { ThemeProvider } from '../../theme/ThemeProvider';
import {
  COPY_UNSUPPORTED,
  DRAWIO_ACTION,
  ExportMenu,
  NO_DIAGRAM_HINT,
  STATUS_NAME,
  type ExportServices,
} from './ExportMenu';

const FONTS = "@font-face { font-family: 'Roboto'; src: url(data:font/woff2;base64,AAAA) format('woff2'); }";

function Publish({ source }: { readonly source: ExportSource | null }): null {
  const { setExportSource } = useDiagramSession();
  useEffect(() => {
    setExportSource(source);
  }, [source, setExportSource]);
  return null;
}

interface Recorded {
  readonly saved: Array<{ readonly fileName: string; readonly blob: Blob }>;
  readonly copied: Blob[];
  readonly rasterized: Array<{ readonly geometry: PngGeometry; readonly background: string }>;
}

function services(overrides: Partial<ExportServices> = {}): {
  io: Partial<ExportServices>;
  recorded: Recorded;
} {
  const recorded: Recorded = { saved: [], copied: [], rasterized: [] };
  const io: Partial<ExportServices> = {
    fontFaces: () => Promise.resolve(FONTS),
    rasterize: (_text, geometry, background) => {
      recorded.rasterized.push({ geometry, background });
      return Promise.resolve(new Blob(['png'], { type: 'image/png' }));
    },
    save: (blob, fileName) => {
      recorded.saved.push({ blob, fileName });
    },
    canCopy: () => true,
    copy: async (png) => {
      recorded.copied.push(await png);
    },
    ...overrides,
  };
  return { io, recorded };
}

const SOURCE: ExportSource = {
  model: modelOf(smallScene([['run/web', 'run/api', 'routes']])),
  utcOffsetMinutes: 0,
  visibleArea: () => ({ x: 0, y: 0, width: 400, height: 300 }),
};

function renderMenu(
  source: ExportSource | null,
  io: Partial<ExportServices>,
  version?: string,
): ReactElement {
  const element = (
    <PreferenceStoreContext value={createMemoryPreferenceStore()}>
      <ThemeProvider>
        <DiagramSessionProvider>
          <Publish source={source} />
          <ExportMenu services={io} version={version} />
        </DiagramSessionProvider>
      </ThemeProvider>
    </PreferenceStoreContext>
  );
  render(element);
  return element;
}

function exportButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Export' });
}

async function openMenu(): Promise<HTMLElement> {
  await userEvent.click(exportButton());
  return screen.getByRole('menu', { name: 'Export' });
}

function statusText(): string {
  return screen.getByRole('status', { name: STATUS_NAME }).textContent;
}

let scheme: SystemSchemeControl;
beforeEach(() => {
  scheme = installMatchMedia(false);
});
afterEach(() => {
  scheme.uninstall();
});

describe('the Export menu', () => {
  it('is inert, still focusable and named, while no diagram is drawn', async () => {
    renderMenu(null, services().io);
    const button = exportButton();
    expectInertButFocusable(button);
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('title')).toBe(NO_DIAGRAM_HINT);
    await userEvent.click(button);
    button.focus();
    await userEvent.keyboard('{Enter}{ArrowDown}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    // No status line either: pages have their own, and there is nothing to report.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers the options as checked radio and checkbox items in labelled groups, and the four actions', async () => {
    renderMenu(SOURCE, services().io);
    const menu = await openMenu();
    expect(exportButton().getAttribute('aria-expanded')).toBe('true');
    expect(exportButton().getAttribute('aria-controls')).toBe(menu.id);
    const groups = within(menu).getAllByRole('group');
    expect(groups.map((group) => group.textContent)).toEqual([
      'AreaWhole diagramCurrent viewport',
      'ThemeLightDark',
      'PNG resolution2×3×',
      'SVG fileEmbed fonts',
    ]);
    expect(within(menu).getByRole('group', { name: 'Area' })).toBeDefined();
    const checked = (name: string) =>
      (
        within(menu).queryByRole('menuitemradio', { name }) ??
        within(menu).getByRole('menuitemcheckbox', { name })
      ).getAttribute('aria-checked');
    expect(checked('Whole diagram')).toBe('true');
    expect(checked('Current viewport')).toBe('false');
    // The theme follows the app until the person picks one.
    expect(checked('Light')).toBe('true');
    expect(checked('2×')).toBe('true');
    expect(checked('Embed fonts')).toBe('false');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Download SVG', 'Download PNG', DRAWIO_ACTION, 'Copy PNG']);
    expect(within(menu).getAllByRole('separator')).toHaveLength(4);
    // Focus goes to the first item.
    expect(document.activeElement).toBe(within(menu).getByRole('menuitemradio', { name: 'Whole diagram' }));
  });

  it('is operable by keyboard: arrows, Home, End, Escape back to the button, ↑ opening on the last item', async () => {
    renderMenu(SOURCE, services().io);
    exportButton().focus();
    await userEvent.keyboard('{ArrowDown}');
    const menu = screen.getByRole('menu', { name: 'Export' });
    const focused = () => document.activeElement?.textContent;
    expect(focused()).toBe('Whole diagram');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(focused()).toBe('Light');
    await userEvent.keyboard('{End}');
    expect(focused()).toBe('Copy PNG');
    await userEvent.keyboard('{ArrowDown}');
    expect(focused()).toBe('Whole diagram');
    await userEvent.keyboard('{ArrowUp}');
    expect(focused()).toBe('Copy PNG');
    await userEvent.keyboard('{Home}');
    expect(focused()).toBe('Whole diagram');
    // Only the active item is a tab stop (roving tabindex).
    const items = [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
    expect(items).toHaveLength(11);
    expect(items.filter((item) => item.tabIndex === 0)).toHaveLength(1);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(exportButton());
    await userEvent.keyboard('{ArrowUp}');
    expect(focused()).toBe('Copy PNG');
    await userEvent.keyboard('{Tab}');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps the menu open while options change, with Space, Enter or a click', async () => {
    renderMenu(SOURCE, services().io);
    const menu = await openMenu();
    await userEvent.keyboard('{ArrowDown} ');
    expect(
      within(menu).getByRole('menuitemradio', { name: 'Current viewport' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      within(menu).getByRole('menuitemradio', { name: 'Whole diagram' }).getAttribute('aria-checked'),
    ).toBe('false');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(within(menu).getByRole('menuitemradio', { name: 'Dark' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: '3×' }));
    await userEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Embed fonts' }));
    expect(
      within(menu).getByRole('menuitemcheckbox', { name: 'Embed fonts' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(screen.getByRole('menu')).toBe(menu);
  });

  it('downloads the SVG, closes the menu, returns focus and says what it saved', async () => {
    const { io, recorded } = services();
    renderMenu(SOURCE, io);
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Download SVG' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(exportButton());
    await waitFor(() => {
      expect(recorded.saved).toHaveLength(1);
    });
    const [file] = recorded.saved;
    expect(file?.fileName).toBe('gcportrait_example.com_overview_20261008T000000Z.svg');
    const text = (await file?.blob.text()) ?? '';
    expect(text).toContain(TAGLINE);
    expect(text).not.toMatch(/affiliated/i);
    expect(text).toContain('data-theme="light"');
    expect(text).not.toContain('@font-face');
    await waitFor(() => {
      expect(statusText()).toBe('Saved gcportrait_example.com_overview_20261008T000000Z.svg.');
    });
  });

  it('exports in the chosen theme, with the fonts when asked, independent of the app theme', async () => {
    const fontFaces = vi.fn(() => Promise.resolve(FONTS));
    const { io, recorded } = services({ fontFaces });
    renderMenu(SOURCE, io);
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'Dark' }));
    await userEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Embed fonts' }));
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Download SVG' }));
    await waitFor(() => {
      expect(recorded.saved).toHaveLength(1);
    });
    expect(fontFaces).toHaveBeenCalledTimes(1);
    const text = (await recorded.saved[0]?.blob.text()) ?? '';
    expect(text).toContain('data-theme="dark"');
    expect(text).toContain(`fill="${DARK_PALETTE.canvas}"`);
    expect(text).toContain('@font-face');
  });

  it('downloads the PNG at the chosen scale on the theme background and reports its size', async () => {
    const { io, recorded } = services();
    renderMenu(SOURCE, io);
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: '3×' }));
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Download PNG' }));
    await waitFor(() => {
      expect(recorded.saved).toHaveLength(1);
    });
    expect(recorded.saved[0]?.fileName).toBe('gcportrait_example.com_overview_20261008T000000Z.png');
    const geometry = recorded.rasterized[0]?.geometry;
    expect(geometry?.scale).toBe(3);
    expect(recorded.rasterized[0]?.background).toBe('#FFFFFF');
    await waitFor(() => {
      expect(statusText()).toBe(
        `Saved gcportrait_example.com_overview_20261008T000000Z.png (${String(geometry?.width)} × ${String(geometry?.height)} px).`,
      );
    });
  });

  it('downloads the draw.io file in the chosen area and theme, with the instance’s version, and says what it saved', async () => {
    const { io, recorded } = services();
    renderMenu(SOURCE, io, '1.2.3');
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'Dark' }));
    await userEvent.click(within(menu).getByRole('menuitem', { name: DRAWIO_ACTION }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(exportButton());
    await waitFor(() => {
      expect(recorded.saved).toHaveLength(1);
    });
    const [file] = recorded.saved;
    expect(file?.fileName).toBe('gcportrait_example.com_overview_20261008T000000Z.drawio');
    expect(file?.blob.type).toBe('application/vnd.jgraph.mxfile');
    const read = readDrawioFile((await file?.blob.text()) ?? '');
    expect(read.compressed).toBe(true);
    expect(read.attributes.get('agent')).toBe('gcportrait 1.2.3');
    expect(read.attributes.get('modified')).toBe('2026-10-08T00:00:00.000Z');
    // The dark theme's canvas as the page, the title block's three lines, and no affiliation line.
    expect(read.model).toContain(`background="${DARK_PALETTE.canvas.toLowerCase()}"`);
    expect(read.model).toContain(TAGLINE);
    expect(read.model).not.toMatch(/affiliated/i);
    await waitFor(() => {
      expect(statusText()).toBe('Saved gcportrait_example.com_overview_20261008T000000Z.drawio.');
    });
  });

  it('hands the draw.io export the area, the theme and the version, and reports its failure in words', async () => {
    const asked: Array<{ settings: ExportSettings; version: string | undefined }> = [];
    const { io, recorded } = services({
      drawio: (_source, settings, version) => {
        asked.push({ settings, version });
        return Promise.reject(new Error('no memory'));
      },
    });
    renderMenu(SOURCE, io);
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'Current viewport' }));
    await userEvent.click(within(menu).getByRole('menuitem', { name: DRAWIO_ACTION }));
    await waitFor(() => {
      expect(statusText()).toBe('The draw.io export failed: no memory');
    });
    expect(asked).toEqual([{ settings: { area: 'viewport', theme: 'light' }, version: undefined }]);
    expect(recorded.saved).toHaveLength(0);
  });

  it('copies the PNG to the clipboard', async () => {
    const { io, recorded } = services();
    renderMenu(SOURCE, io);
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Copy PNG' }));
    await waitFor(() => {
      expect(statusText()).toMatch(/^Copied the PNG to the clipboard \(\d+ × \d+ px\)\.$/);
    });
    expect(recorded.copied).toHaveLength(1);
    expect(recorded.saved).toHaveLength(0);
  });

  it('says so plainly where the browser cannot copy images', async () => {
    const copy = vi.fn(() => Promise.resolve());
    const { io, recorded } = services({ canCopy: () => false, copy });
    renderMenu(SOURCE, io);
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Copy PNG' }));
    expect(statusText()).toBe(COPY_UNSUPPORTED);
    expect(copy).not.toHaveBeenCalled();
    expect(recorded.rasterized).toHaveLength(0);
  });

  it('reports an impossible PNG frame before rasterizing or saving it', async () => {
    const { io, recorded } = services();
    const source = {
      ...SOURCE,
      model: {
        ...SOURCE.model,
        input: {
          ...SOURCE.model.input,
          layout: {
            ...SOURCE.model.input.layout,
            bounds: { ...SOURCE.model.input.layout.bounds, width: 2_000_000, height: 1_000_000 },
          },
        },
      },
    };
    renderMenu(source, io);
    await userEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Download PNG' }));
    await waitFor(() => {
      expect(statusText()).toBe(
        'The PNG export failed: This diagram cannot fit within the PNG size limits. Export SVG or draw.io, or narrow the view.',
      );
    });
    expect(recorded.rasterized).toHaveLength(0);
    expect(recorded.saved).toHaveLength(0);
  });

  it('reports a failed export and a refused clipboard in words', async () => {
    const { io } = services({
      rasterize: () => Promise.reject(new Error('canvas too large')),
      copy: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
    });
    renderMenu(SOURCE, io);
    await userEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Download PNG' }));
    await waitFor(() => {
      expect(statusText()).toBe('The PNG export failed: canvas too large');
    });
    await userEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Copy PNG' }));
    await waitFor(() => {
      expect(statusText()).toBe('The browser did not allow access to the clipboard.');
    });
  });

  it.each(['Download SVG', DRAWIO_ACTION])(
    'refuses a viewport export with nothing of the diagram in view, saying how to fix it (%s)',
    async (action) => {
      const { io, recorded } = services();
      renderMenu({ ...SOURCE, visibleArea: () => ({ x: -9000, y: -9000, width: 10, height: 10 }) }, io);
      const menu = await openMenu();
      await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'Current viewport' }));
      await userEvent.click(within(menu).getByRole('menuitem', { name: action }));
      await waitFor(() => {
        expect(statusText()).toBe(
          'No part of the diagram is in view. Pan back to it, or export the whole diagram.',
        );
      });
      expect(recorded.saved).toHaveLength(0);
    },
  );

  it('clears its status after a while', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { io } = services({ canCopy: () => false });
      renderMenu(SOURCE, io);
      await userEvent.click(within(await openMenu()).getByRole('menuitem', { name: 'Copy PNG' }));
      expect(statusText()).toBe(COPY_UNSUPPORTED);
      act(() => {
        vi.advanceTimersByTime(10_001);
      });
      expect(statusText()).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });
});
