// SPDX-License-Identifier: Apache-2.0
/**
 * The Export menu in the app: the diagram page publishes what it draws, the top bar's menu exports
 * it through the browser's download link. Demo S, drawn by the real data and layout handlers in-process: the SVG, and
 * the draw.io file translated from the same drawing, its page named by the view on screen.
 */
import { decodeViewSpec } from '@gcportrait/model';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TAGLINE } from '../branding';
import { createInProcessWorkers } from '../diagram/pipeline/inProcess';
import { drawnViewKey } from '../state/sceneKey';
import type { PreferenceKey, Preferences, PreferenceStore } from '../storage/preferences';
import { drawn } from '../test/diagram';
import { renderApp } from '../test/renderApp';
import { readDrawioFile } from './drawio';
import { diagramIdOf } from './drawio/model';

/** jsdom has no object URLs; the test lends `URL` the two functions the download link needs. */
function lendObjectUrls(blobs: Map<string, Blob>): void {
  Object.assign(URL, {
    createObjectURL: (blob: Blob) => {
      const url = `blob:test/${String(blobs.size)}`;
      blobs.set(url, blob);
      return url;
    },
    revokeObjectURL: () => undefined,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
});

/** A store in which the person has turned the legend and the title block off on the canvas. */
function overlaysOff(): PreferenceStore {
  const values: Partial<Preferences> = { diagramOverlays: false };
  return {
    get: <K extends PreferenceKey>(key: K) => Promise.resolve(values[key] as Preferences[K] | undefined),
    set: () => Promise.resolve(false),
  };
}

describe('exporting the diagram on screen', () => {
  it('turns the inert Export button into a menu once demo S is drawn, and saves its SVG with the legend and the title block the canvas hides', async () => {
    const saved: Array<{ name: string; blob: Blob }> = [];
    const blobs = new Map<string, Blob>();
    lendObjectUrls(blobs);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      const blob = blobs.get(this.href);
      if (blob !== undefined) saved.push({ name: this.download, blob });
    });

    const { container } = renderApp('/diagram#snapshot=demo:S', {
      diagramWorkers: createInProcessWorkers,
      preferences: overlaysOff(),
    });
    const button = within(screen.getByRole('banner')).getByRole('button', { name: 'Export' });
    await drawn(container);
    await waitFor(() => {
      expect(button.getAttribute('aria-disabled')).toBeNull();
    });
    await waitFor(() => {
      expect(container.querySelector('svg.dg-canvas .dg-title-block')).toBeNull();
    });
    expect(container.querySelector('svg.dg-canvas .dg-legend')).toBeNull();
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Download SVG' }));
    await waitFor(() => {
      expect(saved).toHaveLength(1);
    });
    expect(saved[0]?.name).toBe('gcportrait_example.com_overview_20261008T000000Z.svg');
    const text = (await saved[0]?.blob.text()) ?? '';
    expect(text).toContain('class="dg-title-block"');
    expect(text).toContain(TAGLINE);
    // The non-affiliation statement is in the footer only, never in the drawing.
    expect(text).not.toMatch(/affiliated/i);
    expect(text).toContain('class="dg-legend"');
    // The link was temporary.
    expect(document.querySelector('a[download]')).toBeNull();

    // The draw.io file of the same drawing: every zone and node of the canvas a cell, the page named by the view.
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Download draw.io (.drawio)' }));
    await waitFor(() => {
      expect(saved).toHaveLength(2);
    });
    expect(saved[1]?.name).toBe('gcportrait_example.com_overview_20261008T000000Z.drawio');
    const read = readDrawioFile((await saved[1]?.blob.text()) ?? '');
    expect(read.attributes.get('agent')).toBe('gcportrait');
    expect(read.diagram.get('id')).toBe(
      diagramIdOf({
        name: 'gcportrait diagram of example.com, Overview lens',
        modified: '2026-10-08T00:00:00.000Z',
        theme: 'light',
        // The view on screen, as the render library names it for `pnpm render --fixture S`.
        view: drawnViewKey(decodeViewSpec('#snapshot=demo:S')),
      }),
    );
    const canvas = container.querySelector('svg.dg-canvas');
    const groups = [...(canvas?.querySelectorAll('g[data-kind="zone"], g[data-kind="node"]') ?? [])];
    expect(groups.length).toBeGreaterThan(20);
    for (const group of groups) {
      const id = group.getAttribute('data-id') ?? '';
      expect(read.model, id).toContain(`id="${id}"`);
    }
    expect(read.model).toContain(TAGLINE);
    expect(read.model).not.toMatch(/affiliated/i);
  }, 30_000);
});
