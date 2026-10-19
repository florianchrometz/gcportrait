// SPDX-License-Identifier: Apache-2.0
/**
 * The details drawer in the app, in jsdom with the real data and layout handlers in-process, on demo
 * organisation S: selecting a VM opens it with the VM's facts, relations grouped by kind, the console link and
 * the raw JSON; a jump link selects its target, first opening the chips around one hidden in them (a locate
 * without offers); the copy buttons report; Escape closes it and gives focus back
 * to the card; the resize handle works with the keyboard and keeps the width in the preferences; on a phone the
 * drawer is a sheet at half height that its handle takes to full height and back (`data-sheet`), its header and
 * details in the one box that scrolls; a container offers "Drill in"; selecting never asks for a new Scene or layout;
 * axe finds nothing.
 */
import { flipIdOf } from '@gcportrait/graph';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createInProcessWorkers } from '../diagram/pipeline/inProcess';
import type { Layout } from '@gcportrait/layout';
import { DataCancelledError } from '../diagram/pipeline/dataClient';
import type { SceneAnswer } from '../diagram/pipeline/protocol';
import type { DiagramWorkers } from '../diagram/pipeline/workers';
import { DiagramSessionProvider } from '../diagram/session';
import type { LocateAnswer, LocateQuery } from '../search/protocol';
import { createAppStore } from '../state';
import { AppStoreContext } from '../state/context';
import { createMemoryPreferenceStore } from '../storage/preferences';
import { expectNoAxeViolations } from '../test/axe';
import { stubClipboard } from '../test/clipboard';
import { DRAW_TIMEOUT, drawn } from '../test/diagram';
import { currentLocation, DRAWING_APP_TIMEOUT, renderApp } from '../test/renderApp';
import { requestLog } from '../test/requests';
import { installViewport } from '../test/viewport';
import { ThemeContext } from '../theme/useTheme';
import { DetailsDrawer } from './DetailsDrawer';

interface DelayedLocate {
  readonly query: LocateQuery;
  readonly signal: AbortSignal | undefined;
  readonly resolve: (answer: LocateAnswer) => void;
  readonly reject: (error: Error) => void;
}

async function delayedJumps() {
  const vm = '//compute.googleapis.com/projects/demo-web-1/zones/europe-west3-a/instances/web-1mnl';
  const store = createAppStore({
    location: {
      pathname: '/diagram',
      hash: `#snapshot=demo:S&lens=compute&detail=folders&selection=${vm}`,
    },
  });
  store.updateSnapshot((snap) => ({
    ...snap,
    status: 'ready',
    source: { ref: 'demo:S', scope: 'demo-s', readTime: '2026-03-01T00:00:00Z', assets: 10 },
  }));
  const requests: DelayedLocate[] = [];
  const factory = (): DiagramWorkers => {
    const workers = createInProcessWorkers();
    workers.data.locate = (query, options) =>
      new Promise<LocateAnswer>((resolve, reject) => {
        requests.push({ query, signal: options?.signal, resolve, reject });
      });
    return workers;
  };
  const rendered = render(
    <AppStoreContext value={store}>
      <ThemeContext value={{ preference: 'light', resolved: 'light', setPreference: () => undefined }}>
        <DiagramSessionProvider factory={factory}>
          <DetailsDrawer model={null} />
        </DiagramSessionProvider>
      </ThemeContext>
    </AppStoreContext>,
  );
  // The relations come with the VM's details, which the in-process data worker answers only after generating
  // organisation S and its graph: a first draw's work without the layout, so a first draw's wait.
  const targets = await waitFor(
    () => {
      const buttons = [...drawer().querySelectorAll<HTMLButtonElement>('[data-kind] button[title]')];
      expect(buttons.length).toBeGreaterThanOrEqual(2);
      return buttons;
    },
    { timeout: DRAW_TIMEOUT },
  );
  const target = (index: number): HTMLButtonElement => {
    const button = targets[index];
    if (button === undefined) throw new Error('no jump link');
    return button;
  };
  const request = (index: number): DelayedLocate => {
    const pending = requests[index];
    if (pending === undefined) throw new Error('no locate request');
    return pending;
  };
  const answer = (index: number, flips: string[]): LocateAnswer => ({
    kind: 'expand',
    view: { ...request(index).query.spec, flips },
    opened: ['Project'],
    context: { label: 'Target', typeName: 'Resource', lensTitle: 'Compute', everythingTitle: 'Everything' },
  });
  return { ...rendered, store, requests, target, request, answer, vm };
}

describe('pending drawer jumps', DRAWING_APP_TIMEOUT, () => {
  it('retries a stale scene with current flips and viewport, then selects the target', async () => {
    const { store, target, request, requests, answer } = await delayedJumps();
    const canvas = { width: 900, height: 700 };
    act(() => {
      store.updatePipeline((pipeline) => ({ ...pipeline, canvas }));
    });
    fireEvent.click(target(0));
    expect(request(0).query.viewport).toEqual(canvas);
    const project = '//cloudresourcemanager.googleapis.com/projects/10000000002';
    const projectFlip = flipIdOf(project);
    const viewport = { width: 1000, height: 800 };
    await act(async () => {
      store.actions.flip(project);
      store.updatePipeline((pipeline) => ({ ...pipeline, viewport }));
      request(0).resolve(answer(0, ['stale-zone']));
      await Promise.resolve();
    });
    expect(requests).toHaveLength(2);
    expect(request(1).query.spec.flips).toEqual([projectFlip]);
    expect(request(1).query.viewport).toEqual(viewport);
    expect(request(1).query.offers).toBe(false);
    await act(async () => {
      request(1).resolve(answer(1, [projectFlip, 'target-zone']));
      await Promise.resolve();
    });
    expect(store.getState().selection.selected).toBe(request(1).query.node);
    expect(store.getState().view.spec.flips).toEqual([projectFlip, 'target-zone']);
  });

  it.each(['answer', 'error'] as const)(
    'keeps the latest of two quick jumps when the older request returns an %s',
    async (completion) => {
      const { store, target, request, requests, answer } = await delayedJumps();
      fireEvent.click(target(0));
      fireEvent.click(target(1));
      expect(request(0).signal?.aborted).toBe(true);
      expect(request(1).signal?.aborted).toBe(false);
      await act(async () => {
        request(1).resolve(answer(1, ['latest-zone']));
        await Promise.resolve();
      });
      await act(async () => {
        if (completion === 'answer') request(0).resolve(answer(0, ['stale-zone']));
        else request(0).reject(new Error('worker failed'));
        await Promise.resolve();
      });
      expect(requests).toHaveLength(2);
      expect(store.getState().selection.selected).toBe(request(1).query.node);
      expect(store.getState().view.spec.flips).toEqual(['latest-zone']);
    },
  );

  it.each(['close', 'selection', 'lens', 'snapshot', 'tick', 'unmount'] as const)(
    'discards a pending jump after %s, even when the old context returns',
    async (change) => {
      const { store, target, request, requests, answer, unmount, vm } = await delayedJumps();
      fireEvent.click(target(0));
      act(() => {
        switch (change) {
          case 'close':
            fireEvent.click(within(drawer()).getByRole('button', { name: 'Close' }));
            store.actions.select(vm);
            break;
          case 'selection':
            store.actions.select('another-node');
            store.actions.select(vm);
            break;
          case 'lens':
            store.actions.setView((view) => ({ ...view, lens: 'networking' }));
            store.actions.setView((view) => ({ ...view, lens: 'compute' }));
            break;
          case 'snapshot':
            store.actions.setSnapshot('demo:M');
            store.actions.setSnapshot('demo:S');
            store.actions.select(vm);
            break;
          case 'tick':
            store.actions.setView((view) => ({ ...view, tick: '2026-09-08' }));
            store.actions.setView((view) => {
              const next = { ...view };
              delete next.tick;
              return next;
            });
            break;
          case 'unmount':
            unmount();
        }
      });
      const expected = store.getState().view.spec;
      expect(request(0).signal?.aborted).toBe(true);
      await act(async () => {
        request(0).resolve(answer(0, ['stale-zone']));
        await Promise.resolve();
      });
      expect(store.getState().view.spec).toEqual(expected);
      expect(requests).toHaveLength(1);
    },
  );

  it('selects the target after three stale answers without applying their flips', async () => {
    const { store, target, request, requests, answer } = await delayedJumps();
    fireEvent.click(target(0));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await act(async () => {
        store.actions.flip(`zone-${String(attempt)}`);
        request(attempt).resolve(answer(attempt, ['stale-zone']));
        await Promise.resolve();
      });
    }
    expect(requests).toHaveLength(3);
    expect(store.getState().selection.selected).toBe(request(0).query.node);
    expect(store.getState().view.spec.flips).toEqual(['zone-0', 'zone-1', 'zone-2'].map(flipIdOf));
  });

  it.each(['cancelled', 'failed'] as const)('handles a %s worker request', async (failure) => {
    const { store, target, request, vm } = await delayedJumps();
    fireEvent.click(target(0));
    await act(async () => {
      request(0).reject(failure === 'cancelled' ? new DataCancelledError(1) : new Error('worker failed'));
      await Promise.resolve();
    });
    expect(store.getState().selection.selected).toBe(failure === 'cancelled' ? vm : request(0).query.node);
    expect(store.getState().view.spec.flips).toEqual([]);
  });
});

/**
 * In-process workers that count the Scene, layout and details requests the app keeps (not one it calls off, as
 * StrictMode's first mount does: src/test/requests.ts).
 */
function countingWorkers(): {
  counts: () => { scene: number; layout: number; details: number };
  factory: () => DiagramWorkers;
} {
  const scenes = requestLog<null>();
  const layouts = requestLog<null>();
  const asked = requestLog<null>();
  const factory = (): DiagramWorkers => {
    const workers = createInProcessWorkers();
    const layout = workers.layout.layout.bind(workers.layout);
    workers.layout.layout = (scene, options, request) =>
      layouts.record(null, request?.signal, layout(scene, options, request));
    const scene = workers.data.scene.bind(workers.data);
    workers.data.scene = (spec, viewport, options) =>
      scenes.record(null, options?.signal, scene(spec, viewport, options));
    const details = workers.data.details.bind(workers.data);
    workers.data.details = (snapshot, node, day, options) =>
      asked.record(null, options?.signal, details(snapshot, node, day, options));
    return workers;
  };
  return {
    counts: () => ({
      scene: scenes.kept().length,
      layout: layouts.kept().length,
      details: asked.kept().length,
    }),
    factory,
  };
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
  it(
    'shows a VM’s facts, relations, console link and raw JSON, and asks only for its details',
    DRAWING_APP_TIMEOUT,
    async () => {
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
      expect(counts().scene).toBe(1);
      expect(counts().layout).toBe(1);
      expect(counts().details).toBe(1);
      await expectNoAxeViolations(aside);
    },
  );

  it(
    'jumps to a relation’s target, copies the name, and closes with Escape back onto the card',
    DRAWING_APP_TIMEOUT,
    async () => {
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
    },
  );

  it(
    'opens the collapsed zones around a jump link’s target: one locate without offers, then the flips',
    DRAWING_APP_TIMEOUT,
    async () => {
      const vm = '//compute.googleapis.com/projects/demo-web-1/zones/europe-west3-a/instances/web-1mnl';
      const offers: boolean[] = [];
      const factory = (): DiagramWorkers => {
        const workers = createInProcessWorkers();
        const locate = workers.data.locate.bind(workers.data);
        workers.data.locate = (query, options) => {
          offers.push(query.offers);
          return locate(query, options);
        };
        return workers;
      };
      // At the folder level the VM's project is a chip; the drawer shows the VM's details all the same.
      const { container } = renderApp(
        `/diagram#snapshot=demo:S&lens=compute&detail=folders&selection=${vm}`,
        {
          diagramWorkers: factory,
        },
      );
      await drawn(container);
      expect(container.querySelector(`svg [data-id="${vm}"]`)).toBeNull();
      const uses = await waitFor(() => {
        const group = drawer().querySelector('[data-kind="uses"]');
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
      // The flips that open the chips around the disk and its selection, written in one step.
      await waitFor(() => {
        const hash = decodeURIComponent(currentLocation(container));
        expect(hash).toContain(`selection=${targetId}`);
        expect(hash).toMatch(/flips=/);
      });
      expect(offers).toEqual([false]);
      await waitFor(() => {
        expect(container.querySelector(`svg [data-id="${targetId}"]`)).not.toBeNull();
      });
    },
  );

  it(
    'resizes with the keyboard between 360 and 420 px and keeps the width',
    DRAWING_APP_TIMEOUT,
    async () => {
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
    },
  );

  it(
    'is a sheet on a phone: half height, taken to full height and back by its handle',
    DRAWING_APP_TIMEOUT,
    async () => {
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
    },
  );

  it('offers "Details" as a container’s primary action', DRAWING_APP_TIMEOUT, async () => {
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
  });

  it('does not query worker details or changes for an unconfirmed large snapshot', () => {
    const vm = '//compute.googleapis.com/projects/demo-web-1/zones/europe-west3-a/instances/web-1mnl';
    const store = createAppStore({
      location: {
        pathname: '/diagram',
        hash: `#snapshot=demo:XL&lens=compute&detail=folders&selection=${vm}`,
      },
    });
    let askedDetails = 0;
    let askedChanges = 0;
    const factory = (): DiagramWorkers => {
      const workers = createInProcessWorkers();
      workers.data.details = () => {
        askedDetails += 1;
        return Promise.resolve(null);
      };
      workers.data.changes = () => {
        askedChanges += 1;
        return Promise.resolve(null);
      };
      return workers;
    };
    render(
      <AppStoreContext value={store}>
        <ThemeContext value={{ preference: 'light', resolved: 'light', setPreference: () => undefined }}>
          <DiagramSessionProvider factory={factory}>
            <DetailsDrawer model={null} />
          </DiagramSessionProvider>
        </ThemeContext>
      </AppStoreContext>,
    );
    expect(askedDetails).toBe(0);
    expect(askedChanges).toBe(0);
  });

  it('uses spec.tick for details and ignores mismatched previous pipeline results', () => {
    const vm = '//compute.googleapis.com/projects/demo-web-1/zones/europe-west3-a/instances/web-1mnl';
    const store = createAppStore({
      location: {
        pathname: '/diagram',
        hash: `#snapshot=demo:M&lens=compute&detail=folders&tick=2026-03-15&selection=${vm}`,
      },
    });
    // The snapshot is loaded and ready for demo:M.
    store.updateSnapshot((snap) => ({
      ...snap,
      ref: 'demo:M',
      status: 'ready',
      source: { ref: 'demo:M', scope: 'demo', readTime: '2026-03-15T00:00:00Z', assets: 50 },
    }));
    // But pipeline.result still holds a stale result from previous snapshot demo:S.
    const staleAnswer = {
      source: {
        ref: 'demo:S',
        scope: 'demo-s',
        readTime: '2026-03-01T00:00:00Z',
        assets: 10,
        tick: '2026-03-01',
      },
      diff: {
        since: { tick: '2026-02-20', readTime: '2026-02-20T00:00:00Z' },
      },
    } as unknown as SceneAnswer;
    store.updatePipeline((pipe) => ({
      ...pipe,
      result: {
        key: 'demo:S-compute',
        answer: staleAnswer,
        layout: {} as unknown as Layout,
      },
    }));

    const details = requestLog<{ snapshot: string; node: string; day: { tick: string | null } }>();
    let askedChanges = 0;
    const factory = (): DiagramWorkers => {
      const workers = createInProcessWorkers();
      workers.data.details = (snapshot, node, day, options) => {
        const promise = Promise.resolve(null);
        return details.record({ snapshot, node, day }, options?.signal, promise);
      };
      workers.data.changes = () => {
        askedChanges += 1;
        return Promise.resolve(null);
      };
      return workers;
    };

    render(
      <AppStoreContext value={store}>
        <ThemeContext value={{ preference: 'light', resolved: 'light', setPreference: () => undefined }}>
          <DiagramSessionProvider factory={factory}>
            <DetailsDrawer model={null} />
          </DiagramSessionProvider>
        </ThemeContext>
      </AppStoreContext>,
    );

    // Queries demo:M with requested spec.tick '2026-03-15' (not demo:S's '2026-03-01').
    expect(details.kept()).toEqual([{ snapshot: 'demo:M', node: vm, day: { tick: '2026-03-15' } }]);
    // Does not query changes with stale demo:S diff.
    expect(askedChanges).toBe(0);
  });
});
