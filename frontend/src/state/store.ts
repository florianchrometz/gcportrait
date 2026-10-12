// SPDX-License-Identifier: MIT
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
import { flipIdOf } from '@gcportrait/graph';
import {
  decodeViewSpec,
  encodeViewSpec,
  type DetailLevel,
  type Focus,
  type LensId,
  type SnapshotRef,
  type ViewFilters,
  type ViewSpec,
  type ViewSpecInput,
} from '@gcportrait/model';

import { UNAVAILABLE_SESSION } from '../auth/types';
import { IDLE_PREFLIGHT } from '../preflight/state';
import type { JumpMode } from '../diagram/camera';
import { DEMO_CHOICES, snapshotView } from '../diagram/demoChoices';
import { collapseAllView, expandAllView } from '../diagram/disclosure/flips';
import { DIAGRAM_PATH } from '../routes';
import { stepTarget, withTick } from '../timeline/model';
import { initialTimeline } from '../timeline/state';
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

/** Where a view write goes: always the diagram route, with the encoded hash (`''` or `#…`). */
export interface HashTarget {
  readonly pathname: string;
  readonly hash: string;
}

/** Puts a hash into the URL (the provider: react-router's `navigate`). */
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
  /** Another lens (push). The detail level is kept. */
  readonly setLens: (lens: LensId, options?: WriteOptions) => void;
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
   * "Expand all" (push): opens the shallowest collapsed tier of the diagram on screen, the next detail level
   * that opens anything, keeping the flips that open zones it still closes (diagram/disclosure/flips.ts).
   */
  readonly expandAll: (options?: WriteOptions) => void;
  /** "Collapse all" (push): resets every flip, and goes back to `auto` when the level in use is deeper. */
  readonly collapseAll: (options?: WriteOptions) => void;
  /** Selects a node, or clears the selection (replace); selecting opens the drawer. */
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
  /** Writes a view: encodes it, mirrors the hash in the `view` slice and hands it to the navigator. */
  readonly writeView: (next: ViewSpecInput, mode: HistoryMode) => void;
  /** Changes the pipeline slice (the pipeline controller). */
  readonly updatePipeline: (update: (current: PipelineSlice) => PipelineSlice) => void;
  /** Changes the snapshot slice's loading state (the pipeline controller); `ref` always follows the view. */
  readonly updateSnapshot: (update: (current: SnapshotSlice) => Omit<SnapshotSlice, 'ref'>) => void;
  /** The node under the pointer on the canvas (or null). */
  readonly setHovered: (id: string | null) => void;
  /** Changes the ui slice. */
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

function viewOf(pathname: string, hash: string): ViewSlice {
  const onDiagram = pathname === DIAGRAM_PATH;
  const raw = onDiagram ? stripHash(hash) : '';
  return { hash: raw, spec: decodeViewSpec(raw), onDiagram };
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

const INITIAL_UI: UiSlice = { drawerOpen: true, searchOpen: false, popover: null, jump: null };

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
    ui: sameSnapshot || state.ui.jump === null ? state.ui : { ...state.ui, jump: null },
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

  const set = (next: AppState): void => {
    if (next === state) return;
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const writeView = (next: ViewSpecInput, mode: HistoryMode): void => {
    const hash = encodeViewSpec(next);
    if (state.view.onDiagram && hash === state.view.hash) return;
    set(withView(state, { hash, spec: decodeViewSpec(hash), onDiagram: true }));
    navigator?.({ pathname: DIAGRAM_PATH, hash: hash === '' ? '' : `#${hash}` }, mode);
  };

  const write = (
    update: (current: ViewSpec) => ViewSpecInput,
    mode: HistoryMode,
    options: WriteOptions | undefined,
  ): void => {
    writeView(update(state.view.spec), options?.history ?? mode);
  };

  const actions: ViewActions = {
    setLens: (lens, options) => {
      write((spec) => ({ ...spec, lens }), 'push', options);
    },
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
      const token = flipIdOf(zoneId);
      write(
        (spec) => ({
          ...spec,
          flips: spec.flips.includes(token)
            ? spec.flips.filter((flip) => flip !== token)
            : [...spec.flips, token],
        }),
        'push',
        options,
      );
    },
    expandAll: (options) => {
      const shown = state.pipeline.result?.answer;
      const next = shown === undefined ? null : expandAllView(state.view.spec, shown);
      if (next !== null) writeView(next, options?.history ?? 'push');
    },
    collapseAll: (options) => {
      const shown = state.pipeline.result?.answer;
      const next = shown === undefined ? null : collapseAllView(state.view.spec, shown);
      if (next !== null) writeView(next, options?.history ?? 'push');
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
      if (id !== null && !state.ui.drawerOpen) set({ ...state, ui: { ...state.ui, drawerOpen: true } });
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
      const next = viewOf(location.pathname, location.hash);
      if (next.hash === state.view.hash && next.onDiagram === state.view.onDiagram) return;
      set(withView(state, next));
    },
    connectNavigator(next) {
      navigator = next;
    },
    writeView,
    updatePipeline(update) {
      const pipeline = update(state.pipeline);
      if (pipeline !== state.pipeline) set({ ...state, pipeline });
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
      const ui = update(state.ui);
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
