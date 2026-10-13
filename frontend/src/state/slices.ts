// SPDX-License-Identifier: MIT
/**
 * The application state (the URL hash holds everything that defines a view; agents.md, Product rules), in exactly
 * seven slices. Plain data, no behaviour: `store.ts` changes it, `hooks.ts` reads it in React.
 *
 * | Slice | What | Source of truth |
 * |---|---|---|
 * | `view` | the ViewSpec | the URL hash on /diagram; the slice mirrors it (decodeViewSpec) |
 * | `snapshot` | which snapshot is loaded, loading stage, errors, what can be chosen | the pipeline's answers |
 * | `pipeline` | Scene and Layout of the view, request status, the measured canvas | the two workers |
 * | `selection` | selected, highlighted (both from the hash) and hovered (the canvas) ids | hash; canvas |
 * | `ui` | drawer, search, the open popover, a pending camera jump | the page only, never the hash |
 * | `connect` | the backend's public config, the sign-in session (never the token), the access mode | auth/ |
 * | `timeline` | the snapshot's timeline, its live days' reads, playback (the `tick` itself is in the view) | timeline/ |
 */
import type { Layout } from '@gcportrait/layout';
import type { SnapshotRef, ViewSpec } from '@gcportrait/model';

import type { AccessMode, BackendState, SessionState } from '../auth/types';
import type { PreflightState } from '../preflight/state';
import type { ScopeChoice } from '../scope/scopeName';
import type { JumpMode } from '../diagram/camera';
import type { DataStage, SceneAnswer, SceneSource, Viewport } from '../diagram/pipeline/protocol';
import type { TimelineSlice } from '../timeline/state';

export type { TimelineSlice } from '../timeline/state';

/** How a view change enters the browser history: a new entry (discrete) or in place (continuous). */
export type HistoryMode = 'push' | 'replace';

export interface ViewSlice {
  /** The view's URL hash without `#`, exactly as in the address bar; `''` away from the diagram route. */
  readonly hash: string;
  /** `decodeViewSpec(hash)`: the store never holds a view the hash does not say. */
  readonly spec: ViewSpec;
  /** Whether the location is the diagram route, the only place where the hash is a ViewSpec. */
  readonly onDiagram: boolean;
}

/** A snapshot the person can open: a demo organisation or a snapshot stored in IndexedDB. */
export interface SnapshotChoice {
  readonly ref: SnapshotRef;
  readonly label: string;
}

/** The stages of loading a snapshot in the data worker (before its Scene is built). */
export type SnapshotStage = Extract<DataStage, 'generate' | 'ingest' | 'graph'>;

export interface SnapshotSlice {
  /** The snapshot the view names (`view.spec.snapshot`); `''` when none is chosen. */
  readonly ref: SnapshotRef;
  /** `none`: nothing chosen or not asked for yet; `loading`; `ready`: its Graph is built; `error`. */
  readonly status: 'none' | 'loading' | 'ready' | 'error';
  /** The loading stage while `loading` and known. */
  readonly stage: SnapshotStage | null;
  /** The loaded snapshot (scope, read time, asset count), once the data worker has answered for `ref`. */
  readonly source: SceneSource | null;
  /** Why it could not be loaded. */
  readonly error: string | null;
  /** What the Snapshot menu offers. */
  readonly available: readonly SnapshotChoice[];
}

export interface PipelineResult {
  /** The view (without selection and highlight) this result draws: `sceneKey(spec)`. */
  readonly key: string;
  readonly answer: SceneAnswer;
  readonly layout: Layout;
}

export interface PipelineError {
  readonly message: string;
  /** The Scene nodes a refused layout named (skill gcp-diagram-layout §2 rule 5). */
  readonly ids: readonly string[];
}

export interface PipelineSlice {
  /** The scene key of the view being drawn or prepared; `''` when there is none. */
  readonly key: string;
  /** What is on screen. A new view of the same snapshot keeps the previous result until it is ready. */
  readonly result: PipelineResult | null;
  /** What is being prepared, when something is. */
  readonly pending: { readonly ref: SnapshotRef; readonly stage: DataStage | 'layout' } | null;
  readonly error: PipelineError | null;
  /** The canvas as measured (ResizeObserver; null until measured or when it has no size). */
  readonly canvas: Viewport | null;
  /** The canvas size the current result (or the pending request) was asked for at. */
  readonly viewport: Viewport | null;
  /** Scene requests started since the store was created (a superseded one counts too). */
  readonly requests: number;
}

export interface SelectionSlice {
  /** `view.spec.selection`. */
  readonly selected: string | null;
  /** `view.spec.highlight` (a node id or search text). */
  readonly highlighted: string | null;
  /** The node under the pointer on the canvas; never in the hash. */
  readonly hovered: string | null;
}

export interface UiSlice {
  /** The details drawer shows while something is selected and this is true. */
  readonly drawerOpen: boolean;
  readonly searchOpen: boolean;
  /** The one open top-bar popup ('lens', 'snapshot', 'filters', …), if any. */
  readonly popover: string | null;
  /**
   * A camera glide the renderer has not made yet: to node `id` (`seq` tells repeated jumps apart), centring it
   * or (`mode: 'reveal'`, the details drawer's) only panning it into view; absent `mode` is `centre`.
   */
  readonly jump: { readonly id: string; readonly seq: number; readonly mode?: JumpMode } | null;
}

/**
 * The Connect page's shared state, read by the Connect page, the top bar's AccountMenu and the live-import
 * steps. Written by auth/AuthProvider.tsx (`backend`, `session`) and the mode selector (`mode`). The access token
 * is never in the store: ask `useAuth().accessToken()` (src/auth) for it when a request needs it.
 */
export interface ConnectSlice {
  /** GET /api/config as fetched once per page load (live mode); `demo` in demo mode. */
  readonly backend: BackendState;
  /** The Google sign-in session: status, account, expiry, renewal (auth/types.ts). */
  readonly session: SessionState;
  /** How Cloud Asset Inventory is read; always `user` unless the backend offers service-account mode. */
  readonly mode: AccessMode;
  /** The scope picked (scope/ScopePicker.tsx), or null. */
  readonly scope: ScopeChoice | null;
  /** User mode: the quota project picked, or null (the preflight then tries the scope itself only). */
  readonly quotaProject: string | null;
  /** The last permission check of the scope (preflight/usePreflight.ts). */
  readonly preflight: PreflightState;
}

export interface AppState {
  readonly view: ViewSlice;
  readonly snapshot: SnapshotSlice;
  readonly pipeline: PipelineSlice;
  readonly selection: SelectionSlice;
  readonly ui: UiSlice;
  readonly connect: ConnectSlice;
  /** The timeline (timeline/state.ts); its `tick` is the view's. */
  readonly timeline: TimelineSlice;
}
