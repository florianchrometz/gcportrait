// SPDX-License-Identifier: Apache-2.0
/**
 * The app store: a tiny hand-written external store (no library), read in React through
 * `useSyncExternalStore` (hooks.ts). It holds the seven slices of slices.ts.
 *
 * **The hash is the source of truth of the view.** The router's location comes in through `syncLocation` (the
 * provider calls it whenever the location changes) and the `view` slice becomes `decodeViewSpec` of its hash, so
 * unknown keys are ignored and a malformed value falls back to its default, field by field. Every view change
 * goes out through `writeView`: the new ViewSpec is encoded (`encodeViewSpec`), the slice mirrors the encoded
 * hash at once (so two writes in one handler build on each other) and the navigator puts it into the URL, as a
 * new history entry for a discrete change (`push`) or in place for a continuous one (`replace`). When the router
 * reports that same hash back, nothing changes. The `selection` slice's selected and highlighted ids are derived
 * from the view; nothing else in the store is ever written to the hash.
 */
import { toggleFlipToken } from '@gcportrait/graph';
import {
  decodeViewSpec,
  encodeViewSpec,
  type DetailLevel,
  type Focus,
  type SnapshotRef,
  type ViewFilters,
  type ViewSpec,
  type ViewSpecInput,
} from '@gcportrait/model';

import { UNAVAILABLE_SESSION } from '../auth/types';
import { IDLE_PREFLIGHT } from '../preflight/state';
import type { JumpMode } from '../diagram/camera';
import { DEMO_CHOICES, snapshotView } from '../diagram/demoChoices';
import { budgetOf } from '../diagram/autoDetail';
import { collapseAllView, expandAllView } from '../diagram/disclosure/flips';
import { DIAGRAM_PATH } from '../routes';
import { stepTarget, withTick } from '../timeline/model';
import { initialTimeline } from '../timeline/state';
import { FALLBACK_VIEWPORT } from './pipeline';
import type {
  AppState,
  ConnectSlice,
  HistoryMode,
  PipelineSlice,
  SelectionSlice,
  SnapshotChoice,
  SnapshotSlice,
  TimelineSlice,
  UiSlice,
  ViewSlice,
} from './slices';
import { selectSceneKey } from './viewKey';

/** Where a view write goes: always the diagram route, with the encoded hash (`''` or `#…`). */
export interface HashTarget {
  readonly pathname: string;
  readonly hash: string;
}

/** Puts a hash into the URL (the provider: the router's `navigate`). */
export type HashNavigator = (target: HashTarget, mode: HistoryMode) => void;

export interface WriteOptions {
  /** Overrides the action's history mode (a filter slider dragged: `replace` while dragging). */
  readonly history?: HistoryMode;
}

/**
 * What the app does to the view. Each call encodes the new ViewSpec into the hash; discrete changes push a
 * history entry, continuous ones (selection, highlight) replace it. Feature code calls these and never the
 * router or the renderer.
 */
export interface ViewActions {
  /** A focus view, or none (push). */
  readonly setFocus: (focus: Focus | null, options?: WriteOptions) => void;
  /** A detail level (push). */
  readonly setDetail: (detail: DetailLevel, options?: WriteOptions) => void;
  /** Changes some filters, or all through a function of the current ones (push). */
  readonly setFilters: (
    filters: Partial<ViewFilters> | ((current: ViewFilters) => ViewFilters),
    options?: WriteOptions,
  ) => void;
  /** Re-roots the view at a container, or back at the organisation with null (push); the selection goes. */
  readonly drillIn: (root: string | null, options?: WriteOptions) => void;
  /** Expands a collapsed zone or collapses an open one: toggles its flip (push). */
  readonly flip: (zoneId: string, options?: WriteOptions) => void;
  /**
   * "Expand all" (push): opens the shallowest collapsed tier of the diagram on screen, the next detail level at
   * which a chip opens, keeping the flips that open zones it still closes (diagram/disclosure/flips.ts). Worked
   * out on the view's own drawing: pressed while another one is on screen, it waits until the view is drawn.
   */
  readonly expandAll: (options?: WriteOptions) => void;
  /**
   * "Collapse all" (push): closes every zone opened by hand, and goes back to `auto` when the level in use is
   * deeper; never opens anything. Waits for the view's own drawing as "Expand all" does.
   */
  readonly collapseAll: (options?: WriteOptions) => void;
  /**
   * Selects a node, or clears the selection (replace); selecting opens the drawer, and closes an open sheet of the top
   * bar (a search result picked in View), which the drawer is never open with (`apart`).
   */
  readonly select: (id: string | null, options?: WriteOptions) => void;
  /** Highlights a node id or a search text, or nothing (replace). */
  readonly highlight: (id: string | null, options?: WriteOptions) => void;
  /**
   * Asks the renderer for a camera glide to a node as soon as it is drawn (no hash, no history): centred, or with
   * `mode: 'reveal'` only panned into view (the details drawer).
   */
  readonly jumpTo: (id: string, options?: { readonly mode?: JumpMode }) => void;
  /** Opens a snapshot on the diagram page, keeping the lens and the detail level (push). */
  readonly setSnapshot: (ref: SnapshotRef, options?: WriteOptions) => void;
  /** Any other change of the view (the timeline's tick, a saved view): `update` maps the current spec (push). */
  readonly setView: (update: (current: ViewSpec) => ViewSpecInput, options?: WriteOptions) => void;
  /**
   * Moves the timeline one daily tick back (-1) or forward (+1): the keys `[` and `]` (style skill §13) and the
   * bar's buttons. Writes `tick` (push; the snapshot's own day as no tick) and answers whether it moved:
   * false without a snapshot, before its timeline is known, and at either end (`stepTarget` of timeline/model.ts
   * says why).
   */
  readonly stepTick: (step: -1 | 1, options?: WriteOptions) => boolean;
}

export interface AppStore {
  readonly getState: () => AppState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Router → store: the location is now this. */
  readonly syncLocation: (location: { readonly pathname: string; readonly hash: string }) => void;
  /** Store → router: how view writes reach the URL (null: they only change the store; tests). */
  readonly connectNavigator: (navigator: HashNavigator | null) => void;
  /** Changes the pipeline slice (the pipeline controller). */
  readonly updatePipeline: (update: (current: PipelineSlice) => PipelineSlice) => void;
  /** Changes the snapshot slice's loading state (the pipeline controller); `ref` always follows the view. */
  readonly updateSnapshot: (update: (current: SnapshotSlice) => Omit<SnapshotSlice, 'ref'>) => void;
  /** The node under the pointer on the canvas (or null). */
  readonly setHovered: (id: string | null) => void;
  /** Changes the ui slice; a sheet it opens closes the details drawer (`apart`). */
  readonly updateUi: (update: (current: UiSlice) => UiSlice) => void;
  /** Changes the connect slice (auth/AuthProvider.tsx, the mode selector). */
  readonly updateConnect: (update: (current: ConnectSlice) => ConnectSlice) => void;
  /**
   * Changes the timeline slice (the timeline controller and playback); an update whose `ref` is not the view's
   * snapshot is dropped.
   */
  readonly updateTimeline: (update: (current: TimelineSlice) => TimelineSlice) => void;
  /** The renderer made the jump numbered `seq`: it is no longer pending. */
  readonly jumpDone: (seq: number) => void;
  readonly actions: ViewActions;
}

/** The two actions worked out on the drawing on screen. */
type Disclosure = 'expand' | 'collapse';

export interface StoreOptions {
  /** The location the app starts at (the router's first location). */
  readonly location?: { readonly pathname: string; readonly hash: string };
  /** What the Snapshot menu offers; the demo organisations by default. */
  readonly available?: readonly SnapshotChoice[];
}

/** The demo organisations the app offers (diagram/demoChoices.ts), as snapshot choices. */
export const DEMO_SNAPSHOTS: readonly SnapshotChoice[] = DEMO_CHOICES.map((choice) => ({
  ref: `demo:${choice.size}`,
  label: choice.label,
}));

function stripHash(hash: string): string {
  return hash.startsWith('#') ? hash.slice(1) : hash;
}

function viewOf(pathname: string, hash: string, prevLastDiagramHash = '#'): ViewSlice {
  const onDiagram = pathname === DIAGRAM_PATH;
  const raw = onDiagram ? stripHash(hash) : '';
  const lastDiagramHash =
    onDiagram && raw.length > 1 ? (hash.startsWith('#') ? hash : `#${raw}`) : prevLastDiagramHash;
  return { hash: raw, spec: decodeViewSpec(raw), onDiagram, lastDiagramHash };
}

const IDLE_PIPELINE: PipelineSlice = {
  key: '',
  result: null,
  pending: null,
  error: null,
  canvas: null,
  viewport: null,
  requests: 0,
};

const INITIAL_UI: UiSlice = { drawerOpen: true, popover: null, sheet: null, jump: null };

/**
 * The ui slice with a sheet of the top bar and the details drawer kept apart (frontend/AGENTS.md, Phones, tablets and desktops): on a phone or
 * a tablet both lie over the canvas, a sheet over up to its upper two thirds and the drawer over its lower half or its
 * right side, and together they would leave next to nothing of it in view. A sheet that opens (View or More, by its
 * button or by `/`) closes the drawer, so the sheet is alone over the canvas; the selection stays, its ring and its
 * trace with it, and the drawer stays closed whatever a pick in the sheet changes of the view (a lens, a filter, a
 * saved view). A node selected opens it again: the same node by a tap or a key on it (`select`), a search result
 * picked in View, which closes the sheet first, or, once the sheet is closed, another node however it is selected (a
 * link, Back; `withView`). On a desktop no sheet ever opens (its folds are in place), so the drawer is never closed
 * this way there.
 */
function apart(ui: UiSlice): UiSlice {
  return ui.sheet !== null && ui.drawerOpen ? { ...ui, drawerOpen: false } : ui;
}

/** Until auth/AuthProvider.tsx has asked the backend: no sign-in, the person's own account. */
const INITIAL_CONNECT: ConnectSlice = {
  backend: { status: 'loading' },
  session: UNAVAILABLE_SESSION,
  mode: 'user',
  scope: null,
  quotaProject: null,
  preflight: IDLE_PREFLIGHT,
};

function selectionOf(spec: ViewSpec, hovered: string | null): SelectionSlice {
  return { selected: spec.selection ?? null, highlighted: spec.highlight ?? null, hovered };
}

/**
 * The state with a new view: the selection follows it, and the snapshot slice's `ref`; a different snapshot
 * resets the snapshot's loading state (unless it is the one already loaded), the hover, a pending jump and the
 * timeline (its playback stops; the chosen interval stays, and so does the choice to play extra ticks).
 */
function withView(state: AppState, view: ViewSlice): AppState {
  const ref = view.spec.snapshot;
  const sameSnapshot = ref === state.snapshot.ref;
  const snapshot: SnapshotSlice = sameSnapshot
    ? state.snapshot
    : {
        ...state.snapshot,
        ref,
        status: state.snapshot.source?.ref === ref && ref !== '' ? 'ready' : 'none',
        stage: null,
        error: null,
      };
  const previous = state.selection;
  const selection = selectionOf(view.spec, sameSnapshot ? previous.hovered : null);
  const kept = sameSnapshot || state.ui.jump === null ? state.ui : { ...state.ui, jump: null };
  // Another node selected opens the drawer that a sheet closed, once no sheet is open (`apart`).
  const reopen = selection.selected !== previous.selected && !kept.drawerOpen && kept.sheet === null;
  return {
    ...state,
    view,
    snapshot,
    selection:
      selection.selected === previous.selected &&
      selection.highlighted === previous.highlighted &&
      selection.hovered === previous.hovered
        ? previous
        : selection,
    ui: reopen ? { ...kept, drawerOpen: true } : kept,
    timeline:
      state.timeline.ref === ref
        ? state.timeline
        : initialTimeline(ref, state.timeline.interval, state.timeline.playExtras),
  };
}

export function createAppStore(options: StoreOptions = {}): AppStore {
  const start = options.location ?? { pathname: '/', hash: '' };
  const view = viewOf(start.pathname, start.hash);
  let state: AppState = {
    view,
    snapshot: {
      ref: view.spec.snapshot,
      status: 'none',
      stage: null,
      source: null,
      error: null,
      available: options.available ?? DEMO_SNAPSHOTS,
    },
    pipeline: IDLE_PIPELINE,
    selection: selectionOf(view.spec, null),
    ui: INITIAL_UI,
    connect: INITIAL_CONNECT,
    timeline: initialTimeline(view.spec.snapshot),
  };
  const listeners = new Set<() => void>();
  let navigator: HashNavigator | null = null;
  let jumps = 0;
  /** "Expand all" or "Collapse all" pressed while the drawing on screen was not yet the view's (`key`). */
  let waiting: { readonly kind: Disclosure; readonly key: string; readonly history: HistoryMode } | null =
    null;

  const set = (next: AppState): void => {
    if (next === state) return;
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const writeView = (next: ViewSpecInput, mode: HistoryMode): void => {
    const hash = encodeViewSpec(next);
    if (state.view.onDiagram && hash === state.view.hash) return;
    const lastDiagramHash = hash.length > 1 ? `#${hash}` : state.view.lastDiagramHash;
    set(withView(state, { hash, spec: decodeViewSpec(hash), onDiagram: true, lastDiagramHash }));
    navigator?.({ pathname: DIAGRAM_PATH, hash: hash === '' ? '' : `#${hash}` }, mode);
  };

  /**
   * "Expand all" or "Collapse all" on the view's own drawing: the drawing on screen may still be the previous
   * view's (a drill-in, a flip or a level just written), whose zones and levels are not this view's; the action
   * then waits for the view's drawing (`flushWaiting`), and is dropped when the view moves on before it arrives.
   */
  const disclose = (kind: Disclosure, history: HistoryMode): void => {
    const result = state.pipeline.result;
    if (result === null) return;
    const key = selectSceneKey(state);
    if (result.key !== key) {
      waiting = { kind, key, history };
      return;
    }
    waiting = null;
    const shown = result.answer;
    const budget = budgetOf(state.pipeline.canvas ?? FALLBACK_VIEWPORT);
    const next =
      kind === 'expand'
        ? expandAllView(state.view.spec, shown)
        : collapseAllView(state.view.spec, shown, budget);
    if (next !== null) writeView(next, history);
  };

  const flushWaiting = (): void => {
    if (waiting === null) return;
    const { kind, key, history } = waiting;
    if (selectSceneKey(state) !== key) {
      waiting = null;
      return;
    }
    if (state.pipeline.result?.key === key) disclose(kind, history);
  };

  const write = (
    update: (current: ViewSpec) => ViewSpecInput,
    mode: HistoryMode,
    options: WriteOptions | undefined,
  ): void => {
    writeView(update(state.view.spec), options?.history ?? mode);
  };

  const actions: ViewActions = {
    setFocus: (focus, options) => {
      write(
        (spec) => {
          const next: ViewSpecInput = { ...spec };
          if (focus === null) delete next.focus;
          else next.focus = focus;
          return next;
        },
        'push',
        options,
      );
    },
    setDetail: (detail, options) => {
      write((spec) => ({ ...spec, detail }), 'push', options);
    },
    setFilters: (filters, options) => {
      write(
        (spec) => ({
          ...spec,
          filters: typeof filters === 'function' ? filters(spec.filters) : { ...spec.filters, ...filters },
        }),
        'push',
        options,
      );
    },
    drillIn: (root, options) => {
      write(
        (spec) => {
          const next: ViewSpecInput = { ...spec };
          if (root === null) delete next.root;
          else next.root = root;
          delete next.selection;
          return next;
        },
        'push',
        options,
      );
    },
    flip: (zoneId, options) => {
      write((spec) => ({ ...spec, flips: toggleFlipToken(spec.flips, zoneId) }), 'push', options);
    },
    expandAll: (options) => {
      disclose('expand', options?.history ?? 'push');
    },
    collapseAll: (options) => {
      disclose('collapse', options?.history ?? 'push');
    },
    select: (id, options) => {
      write(
        (spec) => {
          const next: ViewSpecInput = { ...spec };
          if (id === null) delete next.selection;
          else next.selection = id;
          return next;
        },
        'replace',
        options,
      );
      // Selecting opens the drawer. A node picked in a sheet (a search result in View) closes the sheet first, so the
      // two are never open together and the node lands in the part of the canvas the drawer leaves in view.
      if (id === null) return;
      const ui = state.ui;
      if (ui.sheet !== null) set({ ...state, ui: { ...ui, drawerOpen: true, sheet: null, popover: null } });
      else if (!ui.drawerOpen) set({ ...state, ui: { ...ui, drawerOpen: true } });
    },
    highlight: (id, options) => {
      write(
        (spec) => {
          const next: ViewSpecInput = { ...spec };
          if (id === null) delete next.highlight;
          else next.highlight = id;
          return next;
        },
        'replace',
        options,
      );
    },
    jumpTo: (id, options) => {
      // A reveal (the drawer keeping the selection in view) never replaces a centring jump to the same node that
      // is still waiting for it to be drawn (a search hit behind flips): the centring already shows it.
      const pending = state.ui.jump;
      if (options?.mode === 'reveal' && pending?.id === id && (pending.mode ?? 'centre') === 'centre') return;
      jumps += 1;
      const jump = options?.mode === undefined ? { id, seq: jumps } : { id, seq: jumps, mode: options.mode };
      set({ ...state, ui: { ...state.ui, jump } });
    },
    setSnapshot: (ref, options) => {
      write((spec) => snapshotView(ref, spec), 'push', options);
    },
    setView: (update, options) => {
      write(update, 'push', options);
    },
    stepTick: (step, options) => {
      const target = stepTarget(state.view.spec, state.timeline, step);
      if (!('day' in target)) return false;
      write((spec) => withTick(spec, target.day), 'push', options);
      return true;
    },
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    syncLocation(location) {
      const next = viewOf(location.pathname, location.hash, state.view.lastDiagramHash);
      if (
        next.hash === state.view.hash &&
        next.onDiagram === state.view.onDiagram &&
        next.lastDiagramHash === state.view.lastDiagramHash
      ) {
        return;
      }
      set(withView(state, next));
    },
    connectNavigator(next) {
      navigator = next;
    },
    updatePipeline(update) {
      const pipeline = update(state.pipeline);
      if (pipeline === state.pipeline) return;
      set({ ...state, pipeline });
      flushWaiting();
    },
    updateSnapshot(update) {
      const snapshot = update(state.snapshot);
      if (snapshot === state.snapshot) return;
      set({ ...state, snapshot: { ...snapshot, ref: state.view.spec.snapshot } });
    },
    setHovered(id) {
      if (id === state.selection.hovered) return;
      set({ ...state, selection: { ...state.selection, hovered: id } });
    },
    updateUi(update) {
      const ui = apart(update(state.ui));
      if (ui !== state.ui) set({ ...state, ui });
    },
    updateConnect(update) {
      const connect = update(state.connect);
      if (connect !== state.connect) set({ ...state, connect });
    },
    updateTimeline(update) {
      const next = update(state.timeline);
      // An update made for another snapshot than the view's (a read that ended after a switch) is dropped.
      if (next === state.timeline || next.ref !== state.view.spec.snapshot) return;
      set({ ...state, timeline: next });
    },
    jumpDone(seq) {
      if (state.ui.jump?.seq === seq) set({ ...state, ui: { ...state.ui, jump: null } });
    },
    actions,
  };
}
