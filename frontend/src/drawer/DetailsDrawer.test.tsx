// SPDX-License-Identifier: MIT
/**
 * The details drawer in the app, in jsdom with the real data and layout handlers in-process, on demo
 * organisation S: selecting a VM opens it with the VM's facts, relations grouped by kind, the console link and
 * the raw JSON; a jump link selects its target; the copy buttons report; Escape closes it and gives focus back
 * to the card; the resize handle works with the keyboard and keeps the width in the preferences; on a phone the
 * drawer is a sheet at half height that its handle takes to full height and back (`data-sheet`), its header and
 * details in the one box that scrolls; a container offers "Drill in"; selecting never asks for a new Scene or layout;
 * axe finds nothing.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createInProcessWorkers } from '../diagram/pipeline/inProcess';
import type { DiagramWorkers } from '../diagram/pipeline/workers';
import { createMemoryPreferenceStore } from '../storage/preferences';
import { expectNoAxeViolations } from '../test/axe';
import { stubClipboard } from '../test/clipboard';
import { drawn } from '../test/diagram';
import { currentLocation, renderApp } from '../test/renderApp';
import { installViewport } from '../test/viewport';

/** In-process workers that count the Scene, layout and details requests. */
function countingWorkers(): {
  counts: { scene: number; layout: number; details: number };
  factory: () => DiagramWorkers;
} {
  const counts = { scene: 0, layout: 0, details: 0 };
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
    const details = workers.data.details.bind(workers.data);
    workers.data.details = (...args) => {
      counts.details += 1;
      return details(...args);
    };
    return workers;
  };
  return { counts, factory };
}

function drawer(): HTMLElement {
  return screen.getByRole('complementary', { name: 'Details' });
}

async function selectCard(svg: SVGSVGElement, match: (id: string) => boolean): Promise<SVGGElement> {
  const card = [...svg.querySelectorAll<SVGGElement>('.dg-card')].find((element) =>
    match(element.getAttribute('data-id') ?? ''),
  );
  if (card === undefined) throw new Error('no such card');
  await act(async () => {
    fireEvent.click(card.querySelector('text') ?? card);
    await Promise.resolve();
  });
  return card;
}

describe('the details drawer', () => {
  it('shows a VM’s facts, relations, console link and raw JSON, and asks only for its details', async () => {
    const { counts, factory } = countingWorkers();
    const { container } = renderApp('/diagram#snapshot=demo:S&lens=compute&detail=all', {
      diagramWorkers: factory,
    });
    const svg = await drawn(container);
    const card = await selectCard(svg, (id) => id.includes('/instances/'));
    const id = card.getAttribute('data-id') ?? '';
    const aside = drawer();
    expect(within(aside).getByText(id)).toBeDefined();
    await waitFor(() => {
      expect(within(aside).getByRole('heading', { level: 3, name: /^Relations/ })).toBeDefined();
    });
    expect(within(aside).getByText('Compute Engine instance')).toBeDefined();
    expect(within(aside).getByRole('heading', { level: 2 }).textContent).toBe(
      id.slice(id.lastIndexOf('/') + 1),
    );
    // Relations by kind in the model's order: the subnet (attaches) before the disk (uses).
    const groups = [...aside.querySelectorAll('[data-kind]')].map((element) =>
      element.getAttribute('data-kind'),
    );
    expect(groups.indexOf('attaches')).toBeGreaterThanOrEqual(0);
    expect(groups.indexOf('attaches')).toBeLessThan(groups.indexOf('uses'));
    // The console link: the catalog template's page, opening a new tab only when activated.
    const link = within(aside).getByRole('link', { name: 'Open in Cloud Console (opens a new tab)' });
    expect(link.getAttribute('href')).toMatch(
      /^https:\/\/console\.cloud\.google\.com\/compute\/instancesDetail\/zones\/[a-z0-9-]+\/instances\/[a-z0-9-]+\?project=demo-/,
    );
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    // Raw JSON: resource.data, pretty-printed, on request.
    const toggle = within(aside).getByRole('button', { name: 'Show resource.data' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const code = aside.querySelector('pre code');
    expect(code?.textContent).toContain('"kind": "compute#instance"');
    expect(within(aside).getByRole('button', { name: 'Copy JSON' })).toBeDefined();
    expect(counts.scene).toBe(1);
    expect(counts.layout).toBe(1);
    expect(counts.details).toBe(1);
    await expectNoAxeViolations(aside);
  }, 30_000);

  it('jumps to a relation’s target, copies the name, and closes with Escape back onto the card', async () => {
    const writeText = stubClipboard();
    const { container } = renderApp('/diagram#snapshot=demo:S&lens=compute&detail=all', {
      diagramWorkers: createInProcessWorkers,
    });
    const svg = await drawn(container);
    const card = await selectCard(svg, (id) => id.includes('/instances/'));
    const id = card.getAttribute('data-id') ?? '';
    const aside = drawer();

    fireEvent.click(within(aside).getByRole('button', { name: 'Copy resource name' }));
    await waitFor(() => {
      expect(within(aside).getByRole('status').textContent).toBe('Copied the resource name.');
    });
    expect(writeText).toHaveBeenCalledWith(id);

    // The disk the VM uses: a jump link selects it (it is drawn, so no flip is needed).
    const uses = await waitFor(() => {
      const group = aside.querySelector('[data-kind="uses"]');
      if (group === null) throw new Error('no uses group yet');
      return group;
    });
    const target = within(uses as HTMLElement).getAllByRole('button')[0];
    if (target === undefined) throw new Error('no jump link');
    const targetId = target.getAttribute('title') ?? '';
    await act(async () => {
      fireEvent.click(target);
      await Promise.resolve();
    });
    expect(decodeURIComponent(currentLocation(container))).toContain(`selection=${targetId}`);
    await waitFor(() => {
      expect(within(drawer()).getByText(targetId)).toBeDefined();
    });

    // Escape inside the drawer closes it and puts focus on the selected node on the canvas.
    const disk = svg.querySelector<SVGGElement>(`[data-id="${targetId}"]`);
    fireEvent.keyDown(within(drawer()).getByRole('button', { name: 'Close' }), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('complementary', { name: 'Details' })).toBeNull();
    });
    expect(document.activeElement).toBe(disk);
    expect(decodeURIComponent(currentLocation(container))).not.toContain('selection=');
  }, 30_000);

  it('resizes with the keyboard between 360 and 420 px and keeps the width', async () => {
    const preferences = createMemoryPreferenceStore();
    const { container } = renderApp('/diagram#snapshot=demo:S&lens=compute&detail=all', {
      diagramWorkers: createInProcessWorkers,
      preferences,
    });
    const svg = await drawn(container);
    await selectCard(svg, (id) => id.includes('/instances/'));
    const aside = drawer();
    const handle = within(aside).getByRole('separator', { name: 'Resize the details drawer' });
    expect(handle.getAttribute('aria-valuenow')).toBe('360');
    expect(aside.style.width).toBe('360px');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle.getAttribute('aria-valuenow')).toBe('370');
    expect(aside.style.width).toBe('370px');
    fireEvent.keyDown(handle, { key: 'End' });
    expect(handle.getAttribute('aria-valuenow')).toBe('420');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle.getAttribute('aria-valuenow')).toBe('420');
    await waitFor(async () => {
      expect(await preferences.get('drawerWidth')).toBe(420);
    });
    fireEvent.keyDown(handle, { key: 'Home' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle.getAttribute('aria-valuenow')).toBe('360');
    // A drag moves the left edge: leftwards widens.
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 900 });
    fireEvent.pointerMove(handle, { buttons: 1, pointerId: 1, clientX: 870 });
    expect(handle.getAttribute('aria-valuenow')).toBe('390');
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 880 });
    expect(handle.getAttribute('aria-valuenow')).toBe('380');
    await waitFor(async () => {
      expect(await preferences.get('drawerWidth')).toBe(380);
    });
  }, 30_000);

  it('is a sheet on a phone: half height, taken to full height and back by its handle', async () => {
    const viewport = installViewport(375);
    try {
      const project = '//cloudresourcemanager.googleapis.com/projects/10000000002';
      const { container } = renderApp(`/diagram#snapshot=demo:S&detail=folders&selection=${project}`, {
        diagramWorkers: createInProcessWorkers,
      });
      await drawn(container);
      const aside = drawer();
      const handle = within(aside).getByRole('separator', { name: 'Resize the details drawer' });
      expect(handle.getAttribute('aria-orientation')).toBe('horizontal');
      expect(aside.getAttribute('data-sheet')).toBe('half');
      expect(aside.style.height).toBe('50%');
      // The header and the details share one box (what scrolls inside the sheet).
      const heading = within(aside).getByRole('heading', { level: 2 });
      const name = within(aside).getByRole('button', { name: 'Copy resource name' });
      const box = heading.closest('aside > div');
      expect(box?.contains(name)).toBe(true);
      fireEvent.keyDown(handle, { key: 'ArrowUp' });
      expect(handle.getAttribute('aria-valuenow')).toBe('100');
      expect(aside.getAttribute('data-sheet')).toBe('full');
      fireEvent.keyDown(handle, { key: 'Home' });
      expect(aside.getAttribute('data-sheet')).toBe('half');
      // Dragged down, the sheet follows below half; far enough that letting go closes it, it fades; let go there,
      // it closes.
      fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 300 });
      fireEvent.pointerMove(handle, { buttons: 1, pointerId: 1, clientY: 310 });
      expect(aside.style.height).toBe('40%');
      expect(aside.hasAttribute('data-dismissing')).toBe(false);
      fireEvent.pointerMove(handle, { buttons: 1, pointerId: 1, clientY: 900 });
      expect(aside.style.height).toBe('0%');
      expect(aside.hasAttribute('data-dismissing')).toBe(true);
      expect(handle.getAttribute('aria-valuenow')).toBe('50');
      fireEvent.pointerUp(handle, { pointerId: 1, clientY: 900 });
      await waitFor(() => {
        expect(screen.queryByRole('complementary', { name: 'Details' })).toBeNull();
      });
    } finally {
      viewport.uninstall();
    }
  }, 30_000);

  it('offers "Details" as a container’s primary action', async () => {
    const project = '//cloudresourcemanager.googleapis.com/projects/10000000002';
    const { container } = renderApp(`/diagram#snapshot=demo:S&detail=folders&selection=${project}`, {
      diagramWorkers: createInProcessWorkers,
    });
    await drawn(container);
    const drill = await waitFor(() => within(drawer()).getByRole('button', { name: 'Details' }));
    expect(within(drawer()).getByText('Resource Manager project')).toBeDefined();
    await act(async () => {
      fireEvent.click(drill);
      await Promise.resolve();
    });
    expect(decodeURIComponent(currentLocation(container))).toContain(`root=${project}`);
    expect(screen.queryByRole('complementary', { name: 'Details' })).toBeNull();
  }, 30_000);
});
