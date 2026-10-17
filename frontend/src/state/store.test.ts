// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * The app store on its own (no React, no router): the view slice mirrors the hash (decodeViewSpec), every view
 * action writes a hash that decodes to exactly the view the store then holds, discrete changes push and
 * continuous ones replace, unknown hash keys are ignored, and nothing outside the view ever reaches the hash.
 */
import { flipIdOf } from '@gcportrait/graph';
import { decodeViewSpec, encodeViewSpec, type ViewSpec } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import type { HistoryMode } from './slices';
import { createAppStore, type AppStore, type HashTarget } from './store';

interface Written {
  readonly target: HashTarget;
  readonly mode: HistoryMode;
}

/** A store at `/diagram#<hash>` whose navigator records every write (and, like the router, reports it back). */
function storeAt(hash: string, pathname = '/diagram'): { store: AppStore; written: Written[] } {
  const store = createAppStore({ location: { pathname, hash } });
  const written: Written[] = [];
  store.connectNavigator((target, mode) => {
    written.push({ target, mode });
    store.syncLocation(target);
  });
  return { store, written };
}

/** The hash the last write put into the URL, without `#`. */
function lastHash(written: readonly Written[]): string {
  const last = written.at(-1);
  if (last === undefined) throw new Error('nothing was written');
  return last.target.hash.replace(/^#/, '');
}

/** The round trip: the written hash decodes to the store's view, and the store's view encodes to it. */
function expectRoundTrip(store: AppStore, written: readonly Written[]): void {
  const hash = lastHash(written);
  const { view } = store.getState();
  expect(view.hash).toBe(hash);
  expect(view.spec).toEqual(decodeViewSpec(hash));
  expect(encodeViewSpec(view.spec)).toBe(hash);
  expect(written.at(-1)?.target.pathname).toBe('/diagram');
}

const BASE = 'snapshot=demo:M&lens=networking';

describe('the view slice', () => {
  it('starts from the location and mirrors the hash exactly, on /diagram only', () => {
    const { store } = storeAt(`#${BASE}&selection=a`);
    const { view, selection, snapshot } = store.getState();
    expect(view).toEqual({
      hash: `${BASE}&selection=a`,
      spec: decodeViewSpec(`${BASE}&selection=a`),
      onDiagram: true,
    });
    expect(selection).toEqual({ selected: 'a', highlighted: null, hovered: null });
    expect(snapshot.ref).toBe('demo:M');
    const away = createAppStore({ location: { pathname: '/settings', hash: `#${BASE}` } });
    expect(away.getState().view).toEqual({ hash: '', spec: decodeViewSpec(''), onDiagram: false });
  });

  it('ignores unknown hash keys (and keeps the raw hash until the next write drops them)', () => {
    const { store, written } = storeAt('#foo=bar&lens=security&zzz&detail=all');
    expect(store.getState().view.spec).toEqual(decodeViewSpec('lens=security&detail=all'));
    expect(store.getState().view.hash).toBe('foo=bar&lens=security&zzz&detail=all');
    store.actions.setDetail('projects');
    expect(lastHash(written)).toBe('lens=security&detail=projects');
    expectRoundTrip(store, written);
  });

  it('follows the router: a new location replaces the view, the same one changes nothing', () => {
    const { store } = storeAt(`#${BASE}`);
    const before = store.getState();
    store.syncLocation({ pathname: '/diagram', hash: `#${BASE}` });
    expect(store.getState()).toBe(before);
    store.syncLocation({ pathname: '/diagram', hash: '#snapshot=demo:S&highlight=10.0.0.2' });
    expect(store.getState().view.spec.snapshot).toBe('demo:S');
    expect(store.getState().selection.highlighted).toBe('10.0.0.2');
    expect(store.getState().snapshot.ref).toBe('demo:S');
    store.syncLocation({ pathname: '/settings', hash: '' });
    expect(store.getState().view.onDiagram).toBe(false);
    expect(store.getState().view.spec.snapshot).toBe('');
  });

  it('notifies subscribers on a change, and not on a write of the same hash', () => {
    const { store } = storeAt(`#${BASE}`);
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.actions.setLens('networking');
    expect(calls).toBe(0);
    store.actions.setLens('security');
    expect(calls).toBe(1);
    unsubscribe();
    store.actions.setLens('data');
    expect(calls).toBe(1);
  });
});

describe('the view actions: hash round trip, push or replace', () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly act: (store: AppStore) => void;
    readonly mode: HistoryMode;
    readonly expect: (spec: ViewSpec) => void;
  }> = [
    {
      name: 'setLens',
      act: (store) => {
        store.actions.setLens('load-balancing');
      },
      mode: 'push',
      expect: (spec) => {
        expect(spec.lens).toBe('load-balancing');
        expect(spec.detail).toBe('all');
      },
    },
    {
      name: 'setFocus',
      act: (store) => {
        store.actions.setFocus({ kind: 'shared-vpc', params: { host: 'demo-net' } });
      },
      mode: 'push',
      expect: (spec) => {
        expect(spec.focus).toEqual({ kind: 'shared-vpc', params: { host: 'demo-net' } });
      },
    },
    {
      name: 'setFocus(null)',
      act: (store) => {
        store.actions.setFocus(null);
      },
      mode: 'push',
      expect: (spec) => {
        expect(spec.focus).toBeUndefined();
      },
    },
    {
      name: 'setDetail',
      act: (store) => {
        store.actions.setDetail('networks');
      },
      mode: 'push',
      expect: (spec) => {
        expect(spec.detail).toBe('networks');
      },
    },
    {
      name: 'setFilters (a patch)',
      act: (store) => {
        store.actions.setFilters({ hideEmptyProjects: true, regions: ['us-central1', 'europe-west3'] });
      },
      mode: 'push',
      expect: (spec) => {
        expect(spec.filters).toEqual({
          hideEmptyProjects: true,
          hideEmptyFolders: false,
          hideDisconnected: true,
          regions: ['europe-west3', 'us-central1'],
        });
      },
    },
    {
      name: 'setFilters (a function), continuous',
      act: (store) => {
        store.actions.setFilters((filters) => ({ ...filters, depth: 3 }), { history: 'replace' });
      },
      mode: 'replace',
      expect: (spec) => {
        expect(spec.filters.depth).toBe(3);
      },
    },
    {
      name: 'drillIn',
      act: (store) => {
        store.actions.drillIn('//cloudresourcemanager.googleapis.com/folders/20000000001');
      },
      mode: 'push',
      expect: (spec) => {
        expect(spec.root).toBe('//cloudresourcemanager.googleapis.com/folders/20000000001');
        expect(spec.selection).toBeUndefined();
      },
    },
    {
      name: 'drillIn(null)',
      act: (store) => {
        store.actions.drillIn(null);
      },
      mode: 'push',
      expect: (spec) => {
        expect(spec.root).toBeUndefined();
      },
    },
    {
      name: 'flip (open)',
      act: (store) => {
        store.actions.flip('//compute.googleapis.com/projects/demo-net/global/networks/vpc-a');
      },
      mode: 'push',
      expect: (spec) => {
        expect(spec.flips).toEqual([
          'k3x9a1',
          flipIdOf('//compute.googleapis.com/projects/demo-net/global/networks/vpc-a'),
        ]);
      },
    },
    {
      name: 'select',
      act: (store) => {
        store.actions.select('//compute.googleapis.com/projects/demo-web/zones/z/instances/web-1');
      },
      mode: 'replace',
      expect: (spec) => {
        expect(spec.selection).toBe('//compute.googleapis.com/projects/demo-web/zones/z/instances/web-1');
      },
    },
    {
      name: 'select(null)',
      act: (store) => {
        store.actions.select(null);
      },
      mode: 'replace',
      expect: (spec) => {
        expect(spec.selection).toBeUndefined();
      },
    },
    {
      name: 'highlight',
      act: (store) => {
        store.actions.highlight('web & api, v2+3 = 100% #1');
      },
      mode: 'replace',
      expect: (spec) => {
        expect(spec.highlight).toBe('web & api, v2+3 = 100% #1');
      },
    },
    {
      name: 'setSnapshot',
      act: (store) => {
        store.actions.setSnapshot('demo:L');
      },
      mode: 'push',
      expect: (spec) => {
        expect(spec).toEqual(decodeViewSpec('snapshot=demo:L&lens=networking&detail=all'));
      },
    },
    {
      name: 'setView (the timeline tick)',
      act: (store) => {
        store.actions.setView((spec) => ({ ...spec, tick: '2026-09-20' }));
      },
      mode: 'push',
      expect: (spec) => {
        expect(spec.tick).toBe('2026-09-20');
      },
    },
  ];

  it.each(cases)('$name writes a hash that decodes to the store view ($mode)', (row) => {
    const { store, written } = storeAt(
      `#${BASE}&detail=all&hide=disconnected&flips=k3x9a1&focus=project&focus.project=demo-web&root=x&selection=y`,
    );
    row.act(store);
    expect(written).toHaveLength(1);
    expect(written[0]?.mode).toBe(row.mode);
    expectRoundTrip(store, written);
    row.expect(store.getState().view.spec);
  });

  it('flips a zone back with a second flip', () => {
    const { store, written } = storeAt(`#${BASE}`);
    store.actions.flip('zone-a');
    store.actions.flip('zone-a');
    expect(store.getState().view.spec.flips).toEqual([]);
    expect(written.map((entry) => entry.mode)).toEqual(['push', 'push']);
    expectRoundTrip(store, written);
  });

  it('lets two writes in one handler build on each other, before the router reports back', () => {
    const store = createAppStore({ location: { pathname: '/diagram', hash: `#${BASE}` } });
    const written: Written[] = [];
    store.connectNavigator((target, mode) => {
      written.push({ target, mode });
    });
    store.actions.setLens('data');
    store.actions.setDetail('projects');
    expect(lastHash(written)).toBe('snapshot=demo:M&lens=data&detail=projects');
    // The router renders once, with the last location: the store already holds it.
    const after = store.getState();
    store.syncLocation({ pathname: '/diagram', hash: '#snapshot=demo:M&lens=data&detail=projects' });
    expect(store.getState()).toBe(after);
  });

  it('derives the selection slice from the hash, and opens the drawer on select', () => {
    const { store } = storeAt(`#${BASE}`);
    store.updateUi((ui) => ({ ...ui, drawerOpen: false }));
    store.actions.select('node-1');
    expect(store.getState().selection).toEqual({ selected: 'node-1', highlighted: null, hovered: null });
    expect(store.getState().ui.drawerOpen).toBe(true);
    store.actions.highlight('node-2');
    expect(store.getState().selection.highlighted).toBe('node-2');
    store.actions.select(null);
    expect(store.getState().selection.selected).toBeNull();
  });

  it('writes the view to the diagram route from any page (the Snapshot menu on Settings)', () => {
    const { store, written } = storeAt('', '/settings');
    store.actions.setSnapshot('demo:S');
    expect(written).toEqual([{ target: { pathname: '/diagram', hash: '#snapshot=demo:S' }, mode: 'push' }]);
    expect(store.getState().view.onDiagram).toBe(true);
  });

  it('only changes the store when no navigator is connected', () => {
    const store = createAppStore({ location: { pathname: '/diagram', hash: '' } });
    store.actions.setLens('kubernetes');
    expect(store.getState().view.hash).toBe('lens=kubernetes');
  });
});

describe('the other slices never touch the hash', () => {
  it('hover, ui, pipeline and snapshot changes write nothing and keep the view', () => {
    const { store, written } = storeAt(`#${BASE}&selection=a`);
    const view = store.getState().view;
    store.setHovered('node-9');
    expect(store.getState().selection).toEqual({ selected: 'a', highlighted: null, hovered: 'node-9' });
    store.updateUi((ui) => ({ ...ui, popover: 'filters', searchOpen: true, drawerOpen: false }));
    store.updatePipeline((pipeline) => ({ ...pipeline, canvas: { width: 1280, height: 624 } }));
    store.updateSnapshot((snapshot) => ({ ...snapshot, status: 'loading', stage: 'ingest' }));
    store.actions.jumpTo('node-9');
    expect(written).toEqual([]);
    expect(store.getState().view).toBe(view);
    expect(store.getState().snapshot).toMatchObject({ ref: 'demo:M', status: 'loading', stage: 'ingest' });
  });

  it('keeps one pending jump, numbered, until the renderer reports it', () => {
    const { store } = storeAt(`#${BASE}`);
    store.actions.jumpTo('a');
    store.actions.jumpTo('b');
    const jump = store.getState().ui.jump;
    expect(jump).toEqual({ id: 'b', seq: 2 });
    store.jumpDone(1);
    expect(store.getState().ui.jump).toEqual(jump);
    store.jumpDone(2);
    expect(store.getState().ui.jump).toBeNull();
  });

  it('keeps a pending centring jump when a reveal of the same node follows it', () => {
    const { store } = storeAt(`#${BASE}`);
    store.actions.jumpTo('a');
    store.actions.jumpTo('a', { mode: 'reveal' });
    expect(store.getState().ui.jump).toEqual({ id: 'a', seq: 1 });
    // Another node's reveal, or a reveal once the centring is done, is a jump of its own.
    store.actions.jumpTo('b', { mode: 'reveal' });
    expect(store.getState().ui.jump).toEqual({ id: 'b', seq: 2, mode: 'reveal' });
    store.jumpDone(2);
    store.actions.jumpTo('b', { mode: 'reveal' });
    expect(store.getState().ui.jump).toEqual({ id: 'b', seq: 3, mode: 'reveal' });
  });

  it('drops the hover and a pending jump when another snapshot is opened', () => {
    const { store } = storeAt(`#${BASE}`);
    store.setHovered('n');
    store.actions.jumpTo('n');
    store.actions.setLens('data');
    expect(store.getState().selection.hovered).toBe('n');
    expect(store.getState().ui.jump).not.toBeNull();
    store.actions.setSnapshot('demo:S');
    expect(store.getState().selection.hovered).toBeNull();
    expect(store.getState().ui.jump).toBeNull();
    expect(store.getState().snapshot).toMatchObject({ ref: 'demo:S', status: 'none' });
  });

  it('finds the snapshot it drew ready again when the view comes back to it from another page', () => {
    const { store } = storeAt(`#${BASE}`);
    store.updateSnapshot((snapshot) => ({
      ...snapshot,
      status: 'ready',
      source: { ref: 'demo:M', scope: 'example.com', readTime: '2026-10-08T00:00:00Z', assets: 952 },
    }));
    store.syncLocation({ pathname: '/settings', hash: '' });
    expect(store.getState().snapshot).toMatchObject({ ref: '', status: 'none' });
    store.syncLocation({ pathname: '/diagram', hash: `#${BASE}` });
    expect(store.getState().snapshot).toMatchObject({ ref: 'demo:M', status: 'ready' });
  });

  it('offers the demo organisations as snapshots', () => {
    const { store } = storeAt('');
    expect(store.getState().snapshot.available.map((choice) => choice.ref)).toEqual([
      'demo:S',
      'demo:M',
      'demo:L',
    ]);
  });
});

describe('the top bar’s sheets and the details drawer', () => {
  it('a sheet that opens closes the drawer and keeps the selection; a pick that changes the view opens nothing again', () => {
    const { store, written } = storeAt(`#${BASE}&selection=a`);
    expect(store.getState().ui.drawerOpen).toBe(true);
    store.updateUi((ui) => ({ ...ui, sheet: 'view', popover: null }));
    expect(store.getState().ui).toMatchObject({ sheet: 'view', drawerOpen: false });
    expect(store.getState().selection.selected).toBe('a');
    expect(written).toEqual([]);
    // Nothing opens the drawer while the sheet is open, but a node selected.
    store.updateUi((ui) => ({ ...ui, drawerOpen: true }));
    expect(store.getState().ui.drawerOpen).toBe(false);
    store.actions.setLens('data');
    store.actions.highlight('web');
    store.updateUi((ui) => ({ ...ui, sheet: null }));
    expect(store.getState().ui).toMatchObject({ sheet: null, drawerOpen: false });
    expect(store.getState().selection).toMatchObject({ selected: 'a', highlighted: 'web' });
    // The other sheet does the same.
    store.actions.select('a');
    expect(store.getState().ui.drawerOpen).toBe(true);
    store.updateUi((ui) => ({ ...ui, sheet: 'more', popover: null }));
    expect(store.getState().ui).toMatchObject({ sheet: 'more', drawerOpen: false });
  });

  it('a node selected while a sheet is open (a search result in View) closes the sheet and its popup, and opens the drawer', () => {
    const { store } = storeAt(`#${BASE}&selection=a`);
    store.updateUi((ui) => ({ ...ui, sheet: 'view', popover: 'filters' }));
    store.actions.select('b');
    expect(store.getState().ui).toMatchObject({ sheet: null, popover: null, drawerOpen: true });
    expect(store.getState().selection.selected).toBe('b');
    // Clearing the selection leaves an open sheet as it is.
    store.updateUi((ui) => ({ ...ui, sheet: 'view', popover: 'lens' }));
    store.actions.select(null);
    expect(store.getState().ui).toMatchObject({ sheet: 'view', popover: 'lens', drawerOpen: false });
  });

  it('another node selected through the hash (a link, Back) opens the drawer a sheet closed, once no sheet is open', () => {
    const { store } = storeAt(`#${BASE}&selection=a`);
    store.updateUi((ui) => ({ ...ui, sheet: 'more', popover: null }));
    // A saved view applied from More, with a selection of its own: the sheet is still open.
    store.actions.setView(() => ({ ...decodeViewSpec(BASE), selection: 'b' }));
    expect(store.getState().ui.drawerOpen).toBe(false);
    store.updateUi((ui) => ({ ...ui, sheet: null }));
    expect(store.getState().ui.drawerOpen).toBe(false);
    // The same node through the hash leaves it closed; another one opens it.
    store.syncLocation({ pathname: '/diagram', hash: '#snapshot=demo:M&lens=data&selection=b' });
    expect(store.getState().ui.drawerOpen).toBe(false);
    store.syncLocation({ pathname: '/diagram', hash: `#${BASE}&selection=c` });
    expect(store.getState().ui.drawerOpen).toBe(true);
    expect(store.getState().selection.selected).toBe('c');
  });

  it('without a sheet (a desktop, whose folds are in place) a popup leaves the drawer open, and selecting keeps the popup', () => {
    const { store } = storeAt(`#${BASE}&selection=a`);
    const before = store.getState().ui;
    store.updateUi((ui) => ({ ...ui, popover: 'filters', searchOpen: true }));
    expect(store.getState().ui).toEqual({ ...before, popover: 'filters', searchOpen: true });
    store.actions.select('b');
    expect(store.getState().ui).toMatchObject({ popover: 'filters', drawerOpen: true, sheet: null });
  });
});

describe('the timeline keys’ action', () => {
  it('changes nothing while the snapshot’s timeline is not known', () => {
    const { store, written } = storeAt(`#${BASE}&tick=2026-10-01`);
    const before = store.getState();
    expect(store.actions.stepTick(-1)).toBe(false);
    expect(store.actions.stepTick(1)).toBe(false);
    expect(store.getState()).toBe(before);
    expect(written).toEqual([]);
  });

  it('moves the tick one day (push), writes the snapshot’s own day as no tick, and stops at both ends', () => {
    const days = Array.from({ length: 35 }, (_, index) =>
      new Date(Date.UTC(2026, 8, 4 + index)).toISOString().slice(0, 10),
    );
    const { store, written } = storeAt(`#${BASE}&tick=2026-10-07`);
    store.updateTimeline((current) => ({
      ...current,
      info: { kind: 'history', today: '2026-10-08', days },
      today: '2026-10-08',
    }));
    expect(store.actions.stepTick(-1)).toBe(true);
    expect(store.getState().view.spec.tick).toBe('2026-10-06');
    expect(written.at(-1)?.mode).toBe('push');
    expect(store.actions.stepTick(1)).toBe(true);
    expect(store.actions.stepTick(1)).toBe(true);
    // The last day is the snapshot itself: the hash names no tick.
    expect(store.getState().view.spec.tick).toBeUndefined();
    expect(lastHash(written)).toBe(BASE);
    expect(store.actions.stepTick(1)).toBe(false);
    store.actions.setView((spec) => ({ ...spec, tick: '2026-09-04' }));
    expect(store.actions.stepTick(-1)).toBe(false);
    expect(store.getState().view.spec.tick).toBe('2026-09-04');
  });

  it('forgets the timeline when the snapshot changes, and drops updates made for another snapshot', () => {
    const { store } = storeAt(`#${BASE}`);
    store.updateTimeline((current) => ({ ...current, today: '2026-10-08', interval: 2000 }));
    expect(store.getState().timeline.today).toBe('2026-10-08');
    store.actions.setSnapshot('demo:S');
    expect(store.getState().timeline).toMatchObject({ ref: 'demo:S', today: null, interval: 2000 });
    store.updateTimeline((current) => ({ ...current, ref: 'demo:M', today: '2026-10-08' }));
    expect(store.getState().timeline.today).toBeNull();
  });
});
