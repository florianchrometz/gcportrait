// SPDX-License-Identifier: MIT
/**
 * The progress of a live pull or an export read (skill cai-ingestion §1, §4), as one pure reducer: what the page
 * shows while the stream runs (pages, assets, bytes, elapsed time), then how it ended. The page feeds it the bytes it
 * hands to the import worker, the worker's counts (pages and assets read), a clock tick each second, and the outcome.
 *
 * Rules: counters never go back; elapsed time runs from `start` to the end and then stays; once the import has
 * ended (done, failed, cancelled), nothing but a new `start` changes it.
 */
import { formatBytes, formatCount } from '../snapshots/labels';

export type ImportKind = 'pull' | 'export';

export type ImportPhase = 'idle' | 'connecting' | 'reading' | 'storing' | 'done' | 'failed' | 'cancelled';

/** Why an import failed, in words for the screen (errors.ts). */
export interface ImportFailure {
  readonly title: string;
  /** Google's or the backend's message, verbatim, when there is one. */
  readonly message: string;
  /** What to do about it. */
  readonly advice?: string;
  /** A command that fixes it, ready to copy. */
  readonly command?: string;
  /** Whether the permission check (the Permissions page) can tell more. */
  readonly checkPermissions?: boolean;
  /** Whether trying again later may work. */
  readonly retryable?: boolean;
}

export interface ImportResult {
  readonly ref: string;
  readonly assets: number;
  readonly readTime: string;
}

export interface ImportProgress {
  readonly phase: ImportPhase;
  readonly kind: ImportKind | null;
  /** When the import started and the latest clock reading (milliseconds since the epoch). */
  readonly startedAt: number | null;
  readonly now: number | null;
  /** When it ended; elapsed time stops there. */
  readonly endedAt: number | null;
  /** Pages of `assets.list` read (pulls only). */
  readonly pages: number;
  /** Assets read so far. */
  readonly assets: number;
  /** Bytes received from the backend. */
  readonly bytes: number;
  /** The export's size, when the backend announced it; null for pulls. */
  readonly totalBytes: number | null;
  readonly failure: ImportFailure | null;
  readonly result: ImportResult | null;
}

export const IDLE_PROGRESS: ImportProgress = {
  phase: 'idle',
  kind: null,
  startedAt: null,
  now: null,
  endedAt: null,
  pages: 0,
  assets: 0,
  bytes: 0,
  totalBytes: null,
  failure: null,
  result: null,
};

export type ImportAction =
  | { readonly type: 'start'; readonly kind: ImportKind; readonly at: number }
  /** The backend answered and the stream is open; `totalBytes` for an export read. */
  | { readonly type: 'connected'; readonly at: number; readonly totalBytes?: number | null }
  /** More bytes arrived (the running total). */
  | { readonly type: 'received'; readonly bytes: number; readonly at: number }
  /** The worker's counts so far. */
  | { readonly type: 'counted'; readonly pages?: number; readonly assets?: number; readonly at: number }
  | { readonly type: 'storing'; readonly at: number }
  | { readonly type: 'done'; readonly result: ImportResult; readonly at: number }
  | { readonly type: 'failed'; readonly failure: ImportFailure; readonly at: number }
  | { readonly type: 'cancelled'; readonly at: number }
  | { readonly type: 'tick'; readonly at: number };

const ENDED: ReadonlySet<ImportPhase> = new Set(['idle', 'done', 'failed', 'cancelled']);

/** Whether an import is under way. */
export function isRunning(progress: ImportProgress): boolean {
  return !ENDED.has(progress.phase);
}

function later(at: number, current: number | null): number {
  return current === null ? at : Math.max(at, current);
}

export function importProgressReducer(state: ImportProgress, action: ImportAction): ImportProgress {
  if (action.type === 'start')
    return { ...IDLE_PROGRESS, phase: 'connecting', kind: action.kind, startedAt: action.at, now: action.at };
  if (!isRunning(state)) return state;
  const now = later(action.at, state.now);
  switch (action.type) {
    case 'connected':
      return {
        ...state,
        phase: state.phase === 'connecting' ? 'reading' : state.phase,
        now,
        totalBytes: action.totalBytes ?? state.totalBytes,
      };
    case 'received':
      return { ...state, now, bytes: Math.max(state.bytes, action.bytes) };
    case 'counted':
      return {
        ...state,
        now,
        pages: Math.max(state.pages, action.pages ?? 0),
        assets: Math.max(state.assets, action.assets ?? 0),
      };
    case 'storing':
      return { ...state, phase: 'storing', now };
    case 'done':
      return {
        ...state,
        phase: 'done',
        now,
        endedAt: now,
        assets: Math.max(state.assets, action.result.assets),
        result: action.result,
      };
    case 'failed':
      return { ...state, phase: 'failed', now, endedAt: now, failure: action.failure };
    case 'cancelled':
      return { ...state, phase: 'cancelled', now, endedAt: now };
    case 'tick':
      return now === state.now ? state : { ...state, now };
  }
}

/** Milliseconds from the start to now, or to the end once it ended. */
export function elapsedMs(progress: ImportProgress): number {
  if (progress.startedAt === null) return 0;
  const until = progress.endedAt ?? progress.now ?? progress.startedAt;
  return Math.max(0, until - progress.startedAt);
}

/** "0:04", "12:30", "1:02:03": elapsed time in whole seconds. */
export function formatElapsed(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${String(minutes)}:${rest}`;
}

function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

/** "12 pages · 5,400 assets · 3.2 MB · 0:04": the counters, as the page shows them under the bar. */
export function progressCounters(progress: ImportProgress): string {
  const parts: string[] = [];
  if (progress.kind === 'pull') parts.push(plural(progress.pages, 'page', 'pages'));
  parts.push(plural(progress.assets, 'asset', 'assets'));
  parts.push(
    progress.totalBytes === null
      ? formatBytes(progress.bytes)
      : `${formatBytes(progress.bytes)} of ${formatBytes(progress.totalBytes)}`,
  );
  parts.push(formatElapsed(elapsedMs(progress)));
  return parts.join(' · ');
}

/** The stage in words, for the live region (it changes only when the stage does). */
export function stageText(progress: ImportProgress): string {
  const source = progress.kind === 'export' ? 'the export from Cloud Storage' : 'Cloud Asset Inventory';
  switch (progress.phase) {
    case 'idle':
      return '';
    case 'connecting':
      return progress.kind === 'export'
        ? 'Looking up the export in Cloud Storage…'
        : 'Asking Cloud Asset Inventory…';
    case 'reading':
      return `Reading ${source}…`;
    case 'storing':
      return 'Storing the snapshot in this browser…';
    case 'done':
      return progress.result === null
        ? 'Done.'
        : `Read ${plural(progress.result.assets, 'asset', 'assets')} in ${formatElapsed(elapsedMs(progress))}; opening the diagram.`;
    case 'failed':
      // The alert below says it; a screen reader hears the alert.
      return '';
    case 'cancelled':
      return 'Cancelled. Nothing was stored.';
  }
}

/** The share read, 0 to 1, when the total is known (export reads); null otherwise. */
export function shareRead(progress: ImportProgress): number | null {
  if (progress.totalBytes === null || progress.totalBytes <= 0) return null;
  return Math.min(1, progress.bytes / progress.totalBytes);
}
