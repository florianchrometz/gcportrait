// SPDX-License-Identifier: Apache-2.0
/**
 * The large-snapshot guard on every way the app draws a snapshot, in jsdom with the fake snapshot library: the
 * rules (largeSnapshot.ts: the threshold, what is known of a snapshot's size, the words, the session setting);
 * "Try the demo" XL on the Connect page (asked before anything is generated; Cancel stays, generates nothing;
 * "Draw it anyway" generates and opens it without asking again; "Do not ask again in this session" silences the
 * next one; Escape cancels; S, M and L never ask); Load on the Snapshots page; a link straight to the diagram
 * (the pipeline asks the workers for nothing until the person has answered; Cancel leaves for the Snapshots page,
 * or goes back where the person came from after the Snapshot menu); a lens or level change never asks again;
 * and the dialog itself (an alert dialog, focus on Cancel, axe). The Connect page's export import and the
 * streaming reads have their own tests (import/LoadExport.test.tsx, import/run.test.ts, import/PullNow.test.tsx).
 */
import { LARGE_SNAPSHOT_ASSETS } from '@gcportrait/model';
import { act, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createInProcessWorkers } from '../diagram/pipeline/inProcess';
import type { DiagramWorkersFactory } from '../diagram/pipeline/workers';
import { expectNoAxeViolations } from '../test/axe';
import { renderApp } from '../test/renderApp';
import { requestLog } from '../test/requests';
import {
  askingSilenced,
  DRAW_LARGE_KEY,
  isLarge,
  questionText,
  silenceAsking,
  sizeOf,
  type SessionStore,
} from './largeSnapshot';
import { fakeLibrary, storedRecord } from './testing';

const LARGE = '01J9Z3K5Q8XW2V4N6P7R8S9T0A';
const SMALL = '01J9Z3K5Q8XW2V4N6P7R8S9T0B';
const LARGE_LABEL = 'example.com, read 2026-10-07 18:22 UTC, export.json';

function library(): ReturnType<typeof fakeLibrary> {
  return fakeLibrary({
    records: [
      storedRecord(LARGE, {
        source: 'export',
        detail: 'export.json',
        assetCount: 51_242,
        readTime: '2026-10-07T18:22:41Z',
        savedAt: '2026-10-10T12:00:00Z',
      }),
      storedRecord(SMALL, { source: 'export', detail: 'small.json', assetCount: 952 }),
    ],
  });
}

/**
 * Diagram workers that record the snapshots the pipeline asks a Scene of, and never answer: `asked` the requests it
 * kept, `everAsked` every one, a request it called off included (src/test/requests.ts).
 */
function recordingWorkers(): {
  readonly factory: DiagramWorkersFactory;
  readonly asked: () => string[];
  readonly everAsked: () => string[];
} {
  const scenes = requestLog<string>();
  const factory: DiagramWorkersFactory = () => {
    const workers = createInProcessWorkers();
    return {
      ...workers,
      data: {
        ...workers.data,
        scene: (spec, _viewport, options) =>
          scenes.record(spec.snapshot, options?.signal, new Promise<never>(() => undefined)),
      },
    };
  };
  return { factory, asked: scenes.kept, everAsked: scenes.all };
}

function question(): HTMLElement {
  return screen.getByRole('alertdialog', { name: 'Draw a large snapshot?' });
}

function demoCard(): HTMLElement {
  const region = screen.getByRole('region', { name: 'Demo mode' });
  const card = within(region).getByRole('heading', { name: 'Demo organisations' }).closest('li');
  if (card === null) throw new Error('the demo card');
  return card;
}

async function tryDemo(size: 'S' | 'M' | 'L' | 'XL'): Promise<void> {
  const card = demoCard();
  await userEvent.click(within(card).getByRole('radio', { name: size }));
  await userEvent.click(within(card).getByRole('button', { name: 'Try the demo' }));
}

describe('the rules', () => {
  it('ask only above LARGE_SNAPSHOT_ASSETS', () => {
    expect(LARGE_SNAPSHOT_ASSETS).toBe(10_000);
    expect(isLarge(LARGE_SNAPSHOT_ASSETS)).toBe(false);
    expect(isLarge(LARGE_SNAPSHOT_ASSETS + 1)).toBe(true);
  });

  it('know a stored snapshot’s count, a demo organisation’s rough one, and wait for the listing', () => {
    const listed = [...library().records.values()];
    expect(sizeOf(LARGE, listed)).toEqual({ assets: 51_242, approximate: false });
    expect(sizeOf('demo:XL', listed)).toEqual({ assets: 50_000, approximate: true });
    expect(sizeOf('demo:S', null)).toEqual({ assets: 100, approximate: true });
    expect(sizeOf(LARGE, null)).toBe('reading');
    expect(sizeOf('01J9Z3K5Q8XW2V4N6P7R8S9T0C', listed)).toBeNull();
    expect(sizeOf('', listed)).toBeNull();
  });

  it('say how many assets, why it matters and that the diagram still works', () => {
    expect(questionText({ assets: 51_242 })).toEqual({
      title: 'Draw a large snapshot?',
      description:
        'This snapshot has 51,242 assets. Drawing more than 10,000 assets at once is slow and heavy on memory; ' +
        'the diagram will still work.',
    });
    expect(questionText({ assets: 50_000, approximate: true }).description).toMatch(
      /^This snapshot has about 50,000 assets\. /,
    );
    expect(questionText({ assets: 10_500, reading: 'pull' }).description).toBe(
      'This pull has read 10,500 assets so far, and there may be more. Drawing more than 10,000 assets at once ' +
        'is slow and heavy on memory; the diagram will still work. Cancel stops the pull; nothing is stored.',
    );
    expect(questionText({ assets: 10_500, reading: 'export' }).description).toMatch(
      /^This export has 10,500 assets so far, .* Cancel stops reading it; nothing is stored\.$/,
    );
  });

  it('keep "Do not ask again" in the tab’s sessionStorage, and nothing where it refuses', () => {
    expect(askingSilenced(window.sessionStorage)).toBe(false);
    silenceAsking(window.sessionStorage);
    expect(window.sessionStorage.getItem(DRAW_LARGE_KEY)).toBe('draw');
    expect(window.localStorage.getItem(DRAW_LARGE_KEY)).toBeNull();
    expect(askingSilenced(window.sessionStorage)).toBe(true);
    const refusing: SessionStore = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(() => {
      silenceAsking(refusing);
    }).not.toThrow();
    expect(askingSilenced(refusing)).toBe(false);
    expect(askingSilenced(null)).toBe(false);
  });
});

describe('Try the demo on the Connect page', () => {
  it('asks before generating XL; Cancel stays on the Connect page and generates nothing', async () => {
    const snapshots = fakeLibrary();
    const app = renderApp('/', { snapshots });
    await tryDemo('XL');
    const dialog = question();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'This snapshot has about 50,000 assets. Drawing more than 10,000 assets at once is slow and heavy on ' +
        'memory; the diagram will still work.',
    );
    // The least destructive action has focus; the dialog has no Close button of its own.
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(within(dialog).queryByRole('button', { name: 'Close' })).toBeNull();
    expect(within(dialog).getByRole('checkbox', { name: 'Do not ask again in this session' })).toBeDefined();
    await expectNoAxeViolations();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(app.location()).toBe('/');
    expect(snapshots.calls).toEqual([]);
    // Focus is back on the button that asked.
    expect(document.activeElement).toBe(within(demoCard()).getByRole('button', { name: 'Try the demo' }));
  });

  it('Escape cancels too', async () => {
    const snapshots = fakeLibrary();
    const app = renderApp('/', { snapshots });
    await tryDemo('XL');
    expect(question()).toBeDefined();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(app.location()).toBe('/');
    expect(snapshots.calls).toEqual([]);
  });

  it('"Draw it anyway" generates XL and opens it without asking again; the session box silences the next', async () => {
    const snapshots = fakeLibrary();
    const workers = recordingWorkers();
    const app = renderApp('/', { snapshots, diagramWorkers: workers.factory });
    await tryDemo('XL');
    const dialog = question();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Do not ask again in this session' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Draw it anyway' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => {
      expect(snapshots.calls).toEqual(['tryDemo XL']);
    });
    expect(window.sessionStorage.getItem(DRAW_LARGE_KEY)).toBe('draw');
    await act(() => snapshots.answer({ ok: { ref: 'demo:XL', persisted: true } }));
    await waitFor(() => {
      expect(app.location()).toBe('/diagram#snapshot=demo:XL');
    });
    // The diagram page does not ask again: the pipeline asks the workers for it at once.
    await waitFor(() => {
      expect(workers.asked()).toEqual(['demo:XL']);
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('a tab that said "Do not ask again" is not asked; S, M and L never are', async () => {
    const snapshots = fakeLibrary();
    renderApp('/', { snapshots });
    for (const size of ['S', 'M', 'L'] as const) {
      await tryDemo(size);
      expect(screen.queryByRole('alertdialog')).toBeNull();
      await act(() => snapshots.answer({ ok: { ref: `demo:${size}`, persisted: true } }));
      await userEvent.click(screen.getByRole('link', { name: 'Connect' }));
    }
    expect(snapshots.calls).toEqual(['tryDemo S', 'tryDemo M', 'tryDemo L']);
  });

  it('is silenced by the session setting a reload kept', async () => {
    window.sessionStorage.setItem(DRAW_LARGE_KEY, 'draw');
    const snapshots = fakeLibrary();
    renderApp('/', { snapshots });
    await tryDemo('XL');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(snapshots.calls).toEqual(['tryDemo XL']);
  });
});

describe('Load on the Snapshots page', () => {
  it('asks for a large snapshot; Cancel stays on the page, "Draw it anyway" opens it and the diagram does not ask', async () => {
    const workers = recordingWorkers();
    const app = renderApp('/snapshots', { snapshots: library(), diagramWorkers: workers.factory });
    const table = await screen.findByRole('table', { name: 'Snapshots stored in this browser' });
    const load = within(table).getByRole('button', { name: `Load ${LARGE_LABEL}` });
    await userEvent.click(load);
    expect(document.getElementById(question().getAttribute('aria-describedby') ?? '')?.textContent).toMatch(
      /^This snapshot has 51,242 assets\. /,
    );
    await userEvent.click(within(question()).getByRole('button', { name: 'Cancel' }));
    expect(app.location()).toBe('/snapshots');
    expect(document.activeElement).toBe(load);

    await userEvent.click(load);
    await userEvent.click(within(question()).getByRole('button', { name: 'Draw it anyway' }));
    await waitFor(() => {
      expect(app.location()).toBe(`/diagram#snapshot=${LARGE}`);
    });
    await waitFor(() => {
      expect(workers.asked()).toEqual([LARGE]);
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    // Not asked again in this tab: a view change, and a second Load from the page.
    await userEvent.click(screen.getByRole('radio', { name: 'Folders' }));
    expect(app.hash()).toBe(`snapshot=${LARGE}&detail=folders`);
    await userEvent.click(screen.getByRole('link', { name: 'Snapshots' }));
    const again = await screen.findByRole('table', { name: 'Snapshots stored in this browser' });
    await userEvent.click(within(again).getByRole('button', { name: `Load ${LARGE_LABEL}` }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(app.location()).toBe(`/diagram#snapshot=${LARGE}`);
  });

  it('does not ask for a small one', async () => {
    const app = renderApp('/snapshots', { snapshots: library() });
    const table = await screen.findByRole('table', { name: 'Snapshots stored in this browser' });
    await userEvent.click(within(table).getAllByRole('button', { name: /^Load .*small\.json$/ })[0] ?? table);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(app.location()).toBe(`/diagram#snapshot=${SMALL}`);
  });
});

describe('the diagram page, for every other way in', () => {
  it('a link to a large snapshot draws nothing until the person answers; Cancel leaves for the Snapshots page', async () => {
    const workers = recordingWorkers();
    const app = renderApp(`/diagram#snapshot=${LARGE}`, {
      snapshots: library(),
      diagramWorkers: workers.factory,
    });
    expect(await screen.findByRole('alertdialog', { name: 'Draw a large snapshot?' })).toBeDefined();
    expect(workers.everAsked()).toEqual([]);
    await expectNoAxeViolations();
    await userEvent.click(within(question()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(app.location()).toBe('/snapshots');
    });
    expect(workers.everAsked()).toEqual([]);
  });

  it('a link to demo XL asks too; "Draw it anyway" lets the pipeline start', async () => {
    const workers = recordingWorkers();
    renderApp('/diagram#snapshot=demo:XL', { snapshots: fakeLibrary(), diagramWorkers: workers.factory });
    const dialog = await screen.findByRole('alertdialog', { name: 'Draw a large snapshot?' });
    expect(workers.everAsked()).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Draw it anyway' }));
    await waitFor(() => {
      expect(workers.asked()).toEqual(['demo:XL']);
    });
  });

  it('the Snapshot menu asks too, and Cancel goes back to the snapshot on screen', async () => {
    const workers = recordingWorkers();
    const app = renderApp('/diagram#snapshot=demo:M', {
      snapshots: library(),
      diagramWorkers: workers.factory,
    });
    await waitFor(() => {
      expect(workers.asked()).toEqual(['demo:M']);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Snapshot' }));
    await userEvent.click(
      within(screen.getByRole('menu', { name: 'Snapshot' })).getByRole('menuitemradio', {
        name: LARGE_LABEL,
      }),
    );
    expect(await screen.findByRole('alertdialog', { name: 'Draw a large snapshot?' })).toBeDefined();
    await userEvent.click(within(question()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(app.hash()).toBe('snapshot=demo:M');
    });
    expect(workers.everAsked().filter((ref) => ref === LARGE)).toEqual([]);
  });
});
