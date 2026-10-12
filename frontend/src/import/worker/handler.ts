// SPDX-License-Identifier: MIT
/**
 * The worker side of the import protocol (protocol.ts): a plain function of `postMessage`, so the same code runs
 * in the Web Worker (role.ts) and in-process in tests. Each job is one `@gcportrait/ingest` session fed chunk by
 * chunk as the page receives them; at the end the snapshot gets its scope (the one given, or the root its assets
 * share, as for an imported export: ../../snapshots/worker/scope.ts), is checked (a pull must have ended with its
 * `done` frame) and is prepared for storage (../../snapshots/worker/prepare.ts).
 *
 * An `error` frame stops the session (`IngestError('upstream')` with the message, status and code). Its
 * `ErrorInfo` reason, which says what to do about a 403, is read back from the end of the stream, where the frame
 * is: the handler keeps the last bytes it was given, and nothing more.
 */
import { IngestError, createIngestSession, type IngestProblem, type IngestSession } from '@gcportrait/ingest';

import { formatUtc, scopeName } from '../../snapshots/labels';
import { prepareSnapshot } from '../../snapshots/worker/prepare';
import { inferScope } from '../../snapshots/worker/scope';
import { futureReadTimeNote, namedScope } from '../sidecar';
import type { ImportRequest, ImportResponse, StreamFailure, StreamSettings } from './protocol';

/** How much of the stream's end is kept, to read an error frame's reason back. */
const TAIL_BYTES = 64 * 1024;

/** How often the worker reports the bytes it has read (pages and assets are reported as frames arrive). */
const PROGRESS_EVERY_BYTES = 256 * 1024;

/** A placeholder until the assets name the scope; ingest validates the scope it is given. */
const PENDING_SCOPE = { kind: 'organization', id: 'pending' } as const;

/** How many malformed lines are listed for the person (the rest are counted). */
const LISTED_PROBLEMS = 5;

export interface HandlerEnvironment {
  /** Milliseconds since the epoch, for the snapshot id. */
  readonly clock?: () => number;
  /** Numbers in [0, 1), for the snapshot id. */
  readonly entropy?: () => number;
}

interface Job {
  readonly settings: StreamSettings;
  readonly session: IngestSession;
  /** The last chunks received, at most about {@link TAIL_BYTES}. */
  readonly tail: Uint8Array[];
  tailBytes: number;
}

class JobFailure extends Error {
  readonly failure: StreamFailure;

  constructor(failure: StreamFailure) {
    super(failure.message);
    this.failure = failure;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The reason of the error frame at the end of `tail`, if the last line is one. */
export function errorReasonOf(tail: readonly Uint8Array[]): string | undefined {
  const text = new TextDecoder().decode(concat(tail));
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  const last = lines.at(-1);
  if (last === undefined) return undefined;
  try {
    const frame: unknown = JSON.parse(last);
    if (!isRecord(frame) || frame['t'] !== 'error') return undefined;
    const reason = frame['reason'];
    return typeof reason === 'string' && /^[A-Z][A-Z_]{1,63}$/.test(reason) ? reason : undefined;
  } catch {
    return undefined;
  }
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en')} ${count === 1 ? one : many}`;
}

function listed(problems: readonly IngestProblem[]): string[] {
  return problems
    .slice(0, LISTED_PROBLEMS)
    .map((problem) => `Line ${String(problem.line)}: ${problem.message}`);
}

function failureOf(error: unknown, job: Job | undefined): StreamFailure {
  if (error instanceof JobFailure) return error.failure;
  if (error instanceof IngestError) {
    if (error.code === 'upstream') {
      const reason = job === undefined ? undefined : errorReasonOf(job.tail);
      return {
        kind: 'upstream',
        message: error.message,
        ...(error.upstream?.status === undefined ? {} : { status: error.upstream.status }),
        ...(error.upstream?.code === undefined ? {} : { code: error.upstream.code }),
        ...(reason === undefined ? {} : { reason }),
      };
    }
    if (error.code === 'cancelled') return { kind: 'cancelled', message: error.message };
    return { kind: 'invalid', message: error.message };
  }
  return { kind: 'internal', message: error instanceof Error ? error.message : String(error) };
}

async function finish(
  job: Job,
  post: (response: ImportResponse) => void,
  id: number,
  now: number,
): Promise<void> {
  const { snapshot, report } = job.session.finish();
  const { settings } = job;
  if (settings.requireComplete && report.upstream?.complete !== true)
    throw new JobFailure({ kind: 'cut-short', message: 'The stream ended before its last frame.' });
  const problems = listed(report.problems);
  if (snapshot.assets.length === 0 && settings.source.kind === 'export')
    throw new JobFailure({ kind: 'empty', message: 'No assets were found in the export.', problems });
  let { scope } = snapshot;
  const warnings: string[] = [];
  // A scope given without a name (an export's operation.json names it by id) takes the name its assets give it.
  if (settings.scope !== null && settings.scope.displayName === undefined)
    scope = namedScope(settings.scope, inferScope(snapshot.assets)?.scope);
  if (settings.scope === null) {
    const inferred = inferScope(snapshot.assets);
    if (inferred === undefined)
      throw new JobFailure({
        kind: 'invalid',
        message: 'The assets name no organisation, folder or project among their ancestors.',
      });
    scope = inferred.scope;
    if (inferred.roots > 1)
      warnings.push(
        `The export holds the assets of ${plural(inferred.roots, 'organisation or project', 'organisations or projects')}; ` +
          `the snapshot takes the scope most of them share, ${scopeName(scope)}.`,
      );
  }
  if (report.malformed > 0)
    warnings.push(
      `${plural(report.malformed, 'line', 'lines')} could not be read and were left out.`,
      ...problems,
    );
  if (report.duplicates > 0)
    warnings.push(
      `${plural(report.duplicates, 'asset was', 'assets were')} listed twice; the newest copy was kept.`,
    );
  if (snapshot.readTimeSource === 'estimated-max-update-time')
    warnings.push(
      `The export does not say when it was taken, so its read time is the latest asset change, ${formatUtc(snapshot.readTime)}.`,
    );
  // A read time later than this clock: the scope's timeline places the snapshot at the present.
  const future = futureReadTimeNote(snapshot.readTime, now);
  if (future !== null) warnings.push(future);
  post({ type: 'encoding', job: id });
  const prepared = await prepareSnapshot(
    { ...snapshot, scope },
    settings.source.detail === undefined ? {} : { detail: settings.source.detail },
    () => undefined,
  );
  post({ type: 'done', job: id, snapshot: prepared, warnings });
}

function parseRequest(message: unknown): ImportRequest | null {
  if (!isRecord(message) || typeof message['job'] !== 'number') return null;
  const job = message['job'];
  switch (message['type']) {
    case 'start':
      return isRecord(message['settings'])
        ? { type: 'start', job, settings: message['settings'] as unknown as StreamSettings }
        : null;
    case 'chunk': {
      // Any byte view, as this realm's Uint8Array (a chunk made in another realm fails `instanceof`).
      const data = message['data'];
      return ArrayBuffer.isView(data) && !(data instanceof DataView)
        ? { type: 'chunk', job, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }
        : null;
    }
    case 'end':
      return { type: 'end', job };
    case 'cancel':
      return { type: 'cancel', job };
    default:
      return null;
  }
}

export function createImportHandler(
  post: (response: ImportResponse) => void,
  environment: HandlerEnvironment = {},
): (message: unknown) => void {
  const clock = environment.clock ?? (() => Date.now());
  const entropy = environment.entropy ?? Math.random;
  const jobs = new Map<number, Job>();

  const fail = (id: number, error: unknown): void => {
    const job = jobs.get(id);
    jobs.delete(id);
    post({ type: 'error', job: id, failure: failureOf(error, job) });
  };

  return (message: unknown): void => {
    const request = parseRequest(message);
    if (request === null) return;
    const { job: id } = request;
    try {
      switch (request.type) {
        case 'start': {
          const { settings } = request;
          if (jobs.has(id))
            throw new JobFailure({ kind: 'invalid', message: `Job ${String(id)} already runs.` });
          const counts = { pages: 0, assets: 0 };
          const session = createIngestSession({
            scope: settings.scope ?? PENDING_SCOPE,
            source: settings.source,
            ...(settings.readTime === undefined ? {} : { readTime: settings.readTime }),
            ...(settings.readTimeOrigin === undefined ? {} : { readTimeOrigin: settings.readTimeOrigin }),
            progressEveryBytes: PROGRESS_EVERY_BYTES,
            clock,
            entropy,
            onEvent: (event) => {
              if (event.type === 'upstream-progress') counts.pages = Math.max(counts.pages, event.pages);
              if (event.type === 'read' || event.type === 'upstream-progress')
                counts.assets = Math.max(counts.assets, event.assets);
              post({ type: 'progress', job: id, counts: { ...counts } });
            },
          });
          jobs.set(id, { settings, session, tail: [], tailBytes: 0 });
          return;
        }
        case 'chunk': {
          const job = jobs.get(id);
          if (job === undefined) return;
          job.tail.push(request.data);
          job.tailBytes += request.data.byteLength;
          while (job.tail.length > 1 && job.tailBytes - (job.tail[0]?.byteLength ?? 0) >= TAIL_BYTES) {
            job.tailBytes -= job.tail.shift()?.byteLength ?? 0;
          }
          job.session.push(request.data);
          return;
        }
        case 'end': {
          const job = jobs.get(id);
          if (job === undefined) return;
          jobs.delete(id);
          finish(job, post, id, clock()).catch((error: unknown) => {
            post({ type: 'error', job: id, failure: failureOf(error, job) });
          });
          return;
        }
        case 'cancel': {
          if (!jobs.has(id)) return;
          fail(id, new JobFailure({ kind: 'cancelled', message: 'The import was cancelled.' }));
          return;
        }
      }
    } catch (error) {
      fail(id, error);
    }
  };
}
