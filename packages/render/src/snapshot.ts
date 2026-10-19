// SPDX-License-Identifier: Apache-2.0
/**
 * Snapshots to draw, read by the app's own code, so a render shows what the app would show for the same
 * data:
 *
 * - a demo organisation: the data worker's demo loader (`loadDemoSnapshot`), as `pnpm render --fixture`;
 * - a `.gcportrait.json` bundle: the app's bundle reader (`parseBundle`: format, version, `migrateSnapshot`, a
 *   history checked against the snapshot); the snapshot's own day is drawn and a history is ignored;
 * - NDJSON, chunk by chunk: a Cloud Asset Inventory export, a saved `/api/assets/stream` response, or a live pull's
 *   frames as they arrive. The app's import worker handler (`createImportHandler`) reads them, with the settings
 *   the app gives a pull or an export (the scope inferred from the assets' ancestors unless one is given, a pull
 *   refused when it lacks its `done` frame, an export refused without assets), and the snapshot is read back from
 *   the document it prepared for storage, as the app reads a stored snapshot (`decodeJson`, `migrateSnapshot`).
 *
 * Every failure is a {@link SnapshotInputError} whose message is for the person who sent the data.
 */
import {
  createImportHandler,
  decodeJson,
  isBundle,
  loadDemoSnapshot,
  parseBundle,
  SnapshotFileError,
  type ImportResponse,
  type StreamFailure,
} from '@gcportrait/frontend';
import {
  migrateSnapshot,
  renderTooManyAssetsMessage,
  SnapshotFormatError,
  type DemoSize,
  type Snapshot,
  type SnapshotScope,
} from '@gcportrait/model';

export type SnapshotInputCode =
  'INVALID_FILE' | 'EMPTY_SNAPSHOT' | 'TOO_MANY_ASSETS' | 'UPSTREAM' | 'CUT_SHORT' | 'CANCELLED';

/** Data that cannot be drawn; the message is for the person who sent it. */
export class SnapshotInputError extends Error {
  readonly code: SnapshotInputCode;
  /** For `UPSTREAM`: the error frame's Google status, code and reason. */
  readonly upstream?: { readonly status?: number; readonly code?: string; readonly reason?: string };

  constructor(code: SnapshotInputCode, message: string, upstream?: SnapshotInputError['upstream']) {
    super(message);
    this.name = 'SnapshotInputError';
    this.code = code;
    if (upstream !== undefined) this.upstream = upstream;
  }
}

/** The refusal of more than `limit` assets, in the words the backend uses when it stops a pull. */
export function tooManyAssets(limit: number): SnapshotInputError {
  return new SnapshotInputError('TOO_MANY_ASSETS', renderTooManyAssetsMessage(limit));
}

/** Refuses a snapshot with more than `maxAssets` assets or none. */
export function checkAssetCount(snapshot: Snapshot, maxAssets: number): Snapshot {
  if (snapshot.assets.length > maxAssets) throw tooManyAssets(maxAssets);
  if (snapshot.assets.length === 0)
    throw new SnapshotInputError('EMPTY_SNAPSHOT', 'The data holds no assets, so there is nothing to draw.');
  return snapshot;
}

/** The demo organisation `size`, exactly the snapshot `pnpm render --fixture` draws. */
export function snapshotFromDemo(size: DemoSize): Promise<Snapshot> {
  return loadDemoSnapshot(`demo:${size}`, () => undefined);
}

/** The first characters of a file, enough to tell a bundle from NDJSON. */
const HEAD_CHARACTERS = 512;

/** A `.gcportrait.json` bundle's snapshot (its history is not drawn). */
export function snapshotFromBundle(text: string): Snapshot {
  if (!isBundle('', text.slice(0, HEAD_CHARACTERS)))
    throw new SnapshotInputError(
      'INVALID_FILE',
      'The file is not a gcportrait snapshot file (.gcportrait.json). Send an NDJSON export with the source kind ndjson.',
    );
  try {
    return parseBundle(text).snapshot;
  } catch (error) {
    if (error instanceof SnapshotFileError || error instanceof SnapshotFormatError)
      throw new SnapshotInputError('INVALID_FILE', error.message);
    throw error;
  }
}

export interface NdjsonSettings {
  /** `pull`: a live pull's frames (`/api/assets/stream`); `export`: an export file's lines. */
  readonly kind: 'pull' | 'export';
  /** The scope read; null for an export, whose assets' ancestors name it. */
  readonly scope: SnapshotScope | null;
  /** An export's read time (RFC 3339), as an operation's sidecar gives it; a pull's comes from its `done` frame. */
  readonly readTime?: string;
  /** Free text for the snapshot's source (the pull's mode, the file's name). */
  readonly detail: string;
  /** More assets than this end the read with `TOO_MANY_ASSETS`. */
  readonly maxAssets: number;
  /** For the snapshot id (tests pass fixed ones). */
  readonly clock?: () => number;
  readonly entropy?: () => number;
}

export interface SnapshotReader {
  /** Reads the next chunk (any split). */
  push(chunk: Uint8Array): void;
  /** The snapshot, once the last chunk was pushed. */
  end(): Promise<Snapshot>;
  /** Stops reading; `end` then rejects with `CANCELLED`. */
  cancel(): void;
  /** Assets read so far. */
  readonly assets: number;
  /** Why reading stopped early (more assets than allowed, an unreadable file), once it did. */
  readonly failure: SnapshotInputError | undefined;
}

const JOB = 1;

function inputErrorOf(failure: StreamFailure): SnapshotInputError {
  const problems = failure.problems === undefined ? '' : ` ${failure.problems.join(' ')}`;
  switch (failure.kind) {
    case 'upstream':
      return new SnapshotInputError('UPSTREAM', failure.message, {
        ...(failure.status === undefined ? {} : { status: failure.status }),
        ...(failure.code === undefined ? {} : { code: failure.code }),
        ...(failure.reason === undefined ? {} : { reason: failure.reason }),
      });
    case 'cut-short':
      return new SnapshotInputError('CUT_SHORT', failure.message);
    case 'empty':
      return new SnapshotInputError('EMPTY_SNAPSHOT', `${failure.message}${problems}`);
    case 'cancelled':
      return new SnapshotInputError('CANCELLED', failure.message);
    case 'invalid':
      return new SnapshotInputError('INVALID_FILE', `${failure.message}${problems}`);
    case 'internal':
      return new SnapshotInputError('INVALID_FILE', `The data could not be read: ${failure.message}`);
  }
}

/**
 * Reads NDJSON chunk by chunk into a snapshot with the app's import handler (see the module comment). The bytes of
 * an export are checked not to be a bundle first.
 */
export function createSnapshotReader(settings: NdjsonSettings): SnapshotReader {
  let assets = 0;
  let failure: SnapshotInputError | undefined;
  let result: Promise<Snapshot> | undefined;
  let first = true;
  const { promise: ended, resolve: resolveEnd, reject: rejectEnd } = Promise.withResolvers<Snapshot>();
  // A rejection nobody awaits yet (a failure before `end`) must not surface as unhandled.
  ended.catch(() => undefined);

  const stop = (error: SnapshotInputError): void => {
    if (failure !== undefined) return;
    failure = error;
    handle({ type: 'cancel', job: JOB });
    rejectEnd(error);
  };

  const handle = createImportHandler(
    (response: ImportResponse) => {
      switch (response.type) {
        case 'progress':
          assets = response.counts.assets;
          if (assets > settings.maxAssets) stop(tooManyAssets(settings.maxAssets));
          return;
        case 'encoding':
          return;
        case 'done':
          // Progress is reported every 256 KiB, so a smaller input is counted here, at its end.
          if (response.snapshot.meta.assetCount > settings.maxAssets) {
            stop(tooManyAssets(settings.maxAssets));
            return;
          }
          decodeJson(response.snapshot.blob)
            .then((value) => {
              resolveEnd(migrateSnapshot(value));
            })
            .catch((error: unknown) => {
              rejectEnd(error);
            });
          return;
        case 'error':
          if (failure === undefined) {
            failure = inputErrorOf(response.failure);
            rejectEnd(failure);
          }
          return;
      }
    },
    {
      ...(settings.clock === undefined ? {} : { clock: settings.clock }),
      ...(settings.entropy === undefined ? {} : { entropy: settings.entropy }),
    },
  );

  handle({
    type: 'start',
    job: JOB,
    settings: {
      scope: settings.scope,
      source:
        settings.kind === 'pull'
          ? { kind: 'api', detail: settings.detail }
          : { kind: 'export', detail: settings.detail },
      ...(settings.readTime === undefined ? {} : { readTime: settings.readTime, readTimeOrigin: 'user' }),
      requireComplete: settings.kind === 'pull',
    },
  });

  return {
    push(chunk) {
      if (failure !== undefined || result !== undefined) return;
      if (first && settings.kind === 'export') {
        first = false;
        const head = new TextDecoder().decode(chunk.subarray(0, HEAD_CHARACTERS));
        if (isBundle('', head)) {
          stop(
            new SnapshotInputError(
              'INVALID_FILE',
              'The file is a gcportrait snapshot file (.gcportrait.json), not an NDJSON export. Send it with the source kind bundle.',
            ),
          );
          return;
        }
      }
      first = false;
      handle({ type: 'chunk', job: JOB, data: chunk });
    },
    end() {
      if (result === undefined) {
        if (failure === undefined) handle({ type: 'end', job: JOB });
        result = ended;
      }
      return result;
    },
    cancel() {
      stop(new SnapshotInputError('CANCELLED', 'The render was cancelled.'));
    },
    get assets() {
      return assets;
    },
    get failure() {
      return failure;
    },
  };
}
