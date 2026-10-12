// SPDX-License-Identifier: MIT
/**
 * A live pull or an export read (skill cai-ingestion §1), from the button press to the stored snapshot: ask the
 * backend for the stream with the session's token (`POST /api/assets/stream` or `POST /api/export/read`), hand the
 * body to the import worker as it arrives, store what it prepares through the snapshot library (IndexedDB), and
 * report every step to the progress reducer (progress.ts). Nothing is kept unless the whole stream was read: a pull
 * without its `done` frame, an error frame, a broken connection or a cancel stores nothing.
 */
import type { SnapshotRef, SnapshotScope } from '@gcportrait/model';

import { fetchWithToken, NotSignedInError, type AccessMode, type AuthControls } from '../auth';
import type { SnapshotLibrary } from '../snapshots/library';
import { scopeName } from '../snapshots/labels';
import { describeFailure, type FailureContext, type ImportError } from './errors';
import type { ImportAction, ImportKind } from './progress';
import { exportReadTime, type ExportSidecar } from './sidecar';
import { ImportCancelled, ImportJobFailed, StreamBroken, type ImportClient } from './worker/client';
import type { StreamSettings } from './worker/protocol';

/** What a pull reads: the scope, with which identity, and (user mode) which project's quota it uses. */
export interface PullTarget {
  readonly scope: SnapshotScope;
  readonly mode: AccessMode;
  /** Required in user mode (ADR 0028 §1); never sent in service-account mode. */
  readonly quotaProject?: string;
  /** A past read time (the timeline); now when absent. */
  readonly readTime?: string;
  readonly assetTypes?: readonly string[];
}

export interface ImportDependencies {
  readonly auth: AuthControls;
  /** Where the snapshot read is stored: the snapshot library, or the timeline's tick cache. */
  readonly library: Pick<SnapshotLibrary, 'storePrepared'>;
  /** The import worker's client, started on first use (its code loads then). */
  readonly worker: () => Promise<ImportClient>;
  readonly now?: () => number;
}

export const STREAM_PATH = '/api/assets/stream';
export const EXPORT_PATH = '/api/export/read';

/** The response header that announces an export's size (backend/src/routes/export.ts). */
export const EXPORT_BYTES_HEADER = 'x-gcportrait-export-bytes';

const COLLECTIONS = { organization: 'organizations', folder: 'folders', project: 'projects' } as const;

/** `organizations/123`, as Cloud Asset Inventory names a scope. */
export function scopePathOf(scope: Pick<SnapshotScope, 'kind' | 'id'>): string {
  return `${COLLECTIONS[scope.kind]}/${scope.id}`;
}

/** The body of `POST /api/assets/stream` for a target. */
export function streamRequestOf(target: PullTarget): Record<string, unknown> {
  return {
    scope: scopePathOf(target.scope),
    contentType: 'RESOURCE',
    mode: target.mode,
    ...(target.mode === 'user' && target.quotaProject !== undefined
      ? { quotaProject: target.quotaProject }
      : {}),
    ...(target.readTime === undefined ? {} : { readTime: target.readTime }),
    ...(target.assetTypes === undefined ? {} : { assetTypes: target.assetTypes }),
  };
}

type Dispatch = (action: ImportAction) => void;

/** A stored snapshot and what the person should know about it (lines left out, an estimated read time). */
export interface Imported {
  readonly ref: SnapshotRef;
  readonly warnings: readonly string[];
}

/** A step that failed, with what the person should know. */
class Failed extends Error {
  readonly error: ImportError;

  constructor(error: ImportError) {
    super(error.kind);
    this.error = error;
  }
}

async function messageOf(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string')
      return body.message;
  } catch {
    // Not JSON: say what the status says.
  }
  return `The backend answered HTTP ${String(response.status)}.`;
}

/** Opens the stream; throws {@link Failed} or {@link ImportCancelled}. */
async function open(
  dependencies: ImportDependencies,
  path: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchWithToken(dependencies.auth, path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof NotSignedInError) throw new Failed({ kind: 'signed-out' });
    if (signal.aborted) throw new ImportCancelled();
    throw new Failed({ kind: 'network' });
  }
  if (!response.ok)
    throw new Failed({ kind: 'request', status: response.status, message: await messageOf(response) });
  if (response.body === null) throw new Failed({ kind: 'network' });
  return response;
}

async function run(
  dependencies: ImportDependencies,
  kind: ImportKind,
  request: {
    readonly path: string;
    readonly body: Record<string, unknown>;
    readonly settings: StreamSettings;
  },
  context: FailureContext,
  dispatch: Dispatch,
  signal: AbortSignal,
): Promise<Imported | null> {
  const now = dependencies.now ?? (() => Date.now());
  dispatch({ type: 'start', kind, at: now() });
  // The token the stream is read with: if Google refuses it mid-stream, the session hears so.
  const token = dependencies.auth.accessToken();
  try {
    const response = await open(dependencies, request.path, request.body, signal);
    const total = Number(response.headers.get(EXPORT_BYTES_HEADER) ?? Number.NaN);
    dispatch({ type: 'connected', at: now(), totalBytes: Number.isFinite(total) ? total : null });
    if (response.body === null) throw new Failed({ kind: 'network' });
    const client = await dependencies.worker();
    const { snapshot, warnings } = await client.run(request.settings, response.body, {
      signal,
      onBytes: (bytes) => {
        dispatch({ type: 'received', bytes, at: now() });
      },
      onCounts: (counts) => {
        dispatch({ type: 'counted', pages: counts.pages, assets: counts.assets, at: now() });
      },
      onEncoding: () => {
        dispatch({ type: 'storing', at: now() });
      },
    });
    dispatch({ type: 'storing', at: now() });
    let ref: SnapshotRef;
    try {
      ref = await dependencies.library.storePrepared(snapshot);
    } catch (error) {
      throw new Failed({ kind: 'storage', message: error instanceof Error ? error.message : String(error) });
    }
    dispatch({
      type: 'done',
      at: now(),
      result: { ref, assets: snapshot.meta.assetCount, readTime: snapshot.meta.readTime },
    });
    return { ref, warnings };
  } catch (error) {
    if (error instanceof ImportCancelled || signal.aborted) {
      dispatch({ type: 'cancelled', at: now() });
      return null;
    }
    const failure = importErrorOf(error);
    if (
      failure.kind === 'upstream' &&
      (failure.status === 401 || failure.code === 'UNAUTHENTICATED') &&
      token !== null
    )
      dependencies.auth.rejected(token);
    dispatch({ type: 'failed', at: now(), failure: describeFailure(failure, context) });
    return null;
  }
}

function importErrorOf(error: unknown): ImportError {
  if (error instanceof Failed) return error.error;
  if (error instanceof StreamBroken) return { kind: 'network' };
  if (error instanceof ImportJobFailed) {
    const { failure } = error;
    switch (failure.kind) {
      case 'upstream':
        return {
          kind: 'upstream',
          message: failure.message,
          ...(failure.status === undefined ? {} : { status: failure.status }),
          ...(failure.code === undefined ? {} : { code: failure.code }),
          ...(failure.reason === undefined ? {} : { reason: failure.reason }),
        };
      case 'cut-short':
        return { kind: 'cut-short' };
      case 'empty':
        return { kind: 'empty', problems: failure.problems ?? [] };
      default:
        return {
          kind: 'other',
          message: failure.message,
          ...(failure.problems === undefined ? {} : { problems: failure.problems }),
        };
    }
  }
  return { kind: 'other', message: error instanceof Error ? error.message : String(error) };
}

/** Pulls `target` from Cloud Asset Inventory into a stored snapshot; its ref, or null (failed or cancelled). */
export function runLivePull(
  dependencies: ImportDependencies,
  target: PullTarget,
  dispatch: Dispatch,
  signal: AbortSignal,
): Promise<Imported | null> {
  return run(
    dependencies,
    'pull',
    {
      path: STREAM_PATH,
      body: streamRequestOf(target),
      settings: {
        scope: target.scope,
        source: { kind: 'api', detail: target.mode === 'sa' ? 'live pull, service account' : 'live pull' },
        requireComplete: true,
      },
    },
    {
      kind: 'pull',
      scope: scopeName(target.scope),
      ...(target.mode === 'user' && target.quotaProject !== undefined
        ? { quotaProject: target.quotaProject }
        : {}),
    },
    dispatch,
    signal,
  );
}

/**
 * Reads the export at `uri` (gs://…) into a stored snapshot; its ref, or null (failed or cancelled). Its read time
 * is the sidecar's, else the one the person typed (`typedReadTime`; `readTimeSource: user`), else the latest
 * asset change (an estimate); a typed time the sidecar replaced is said in the notes.
 */
export async function runExportRead(
  dependencies: ImportDependencies,
  uri: string,
  sidecar: ExportSidecar | null,
  dispatch: Dispatch,
  signal: AbortSignal,
  typedReadTime?: string,
): Promise<Imported | null> {
  const chosen = exportReadTime(sidecar, typedReadTime);
  const imported = await run(
    dependencies,
    'export',
    {
      path: EXPORT_PATH,
      body: { gcsUri: uri },
      settings: {
        scope: sidecar?.scope ?? null,
        source: { kind: 'export', detail: uri },
        ...(chosen.readTime === undefined || chosen.origin === undefined
          ? {}
          : { readTime: chosen.readTime, readTimeOrigin: chosen.origin }),
        requireComplete: false,
      },
    },
    { kind: 'export', uri },
    dispatch,
    signal,
  );
  return imported === null || chosen.note === undefined
    ? imported
    : { ...imported, warnings: [chosen.note, ...imported.warnings] };
}
