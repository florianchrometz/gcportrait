// SPDX-License-Identifier: MIT
/**
 * The worker side of the snapshot protocol (protocol.ts): a plain function of `postMessage`, so the same code
 * runs in the Web Worker (role.ts) and in-process in tests. Jobs run one after another, in order. The demo
 * organisations are not prepared here: the demo generator runs in the diagram's workers only, and a demo
 * worker started for the job answers "Try the demo" (diagram/pipeline/demoRole.ts, demo.ts).
 *
 * - `import`: every `.gcportrait.json` bundle (../bundle.ts) becomes the snapshot it holds, history included; all
 *   other files together are one Cloud Asset Inventory export (one file, or the files of a `uriPrefix` export),
 *   read by `@gcportrait/ingest` with its streaming reader, its scope inferred from the assets (scope.ts) and its
 *   read time the latest asset change (an estimate, skill cai-ingestion §1) unless the lines say. Every imported
 *   snapshot is stored under a new id (`newId`), never the one its file carries: a ref names one stored snapshot
 *   for good, so nothing kept by ref (the diagram's data worker, the view choices, saved views, links) can show
 *   another snapshot under it after a delete and an import (frontend/README.md, "Snapshots").
 * - `check`: a stored record's documents, read in full before export: the snapshot through `migrateSnapshot`, the
 *   history through `parseHistoryOf` (which also checks it against the snapshot), so a damaged record is never
 *   written to a file.
 * - `cancel`: the job it names stops at its next step (before each file, between the chunks of an export's files,
 *   before encoding and before answering) and answers `CANCELLED_JOB`; a job still queued stops before it starts.
 */
import { IngestError, ingest, ulid, type IngestProblem } from '@gcportrait/ingest';
import { migrateSnapshot, SnapshotFormatError, type Snapshot } from '@gcportrait/model';

import { isObject } from '../../guards';
import {
  exportReadTime,
  futureReadTimeNote,
  looksLikeSidecarName,
  MAX_SIDECAR_BYTES,
  namedScope,
  parseSidecar,
  type ExportSidecar,
} from '../../import/sidecar';
import { isBundle } from '../bundle';
import { formatUtc, plural, scopeName } from '../labels';
import { parseBundle, parseHistoryOf, SnapshotFileError } from './parse';
import { prepareSnapshot as prepare, type Report } from './prepare';
import {
  CANCELLED_JOB,
  DAMAGED_RECORD,
  type PreparedSnapshot,
  type SnapshotRequest,
  type SnapshotResponse,
} from './protocol';
import { inferScope } from './scope';

/** How many of a file's problems are listed for the person (the rest are counted). */
export const LISTED_PROBLEMS = 5;

/**
 * How many bytes of an export are read between two pauses that let the worker take its messages (a `cancel`):
 * reading a file's chunks may otherwise run from one microtask to the next without ever yielding to them.
 */
const PAUSE_EVERY_BYTES = 1 << 20;

/** A job the page cancelled: it stops where it is and prepares nothing. */
class JobCancelled extends Error {
  override readonly name = 'JobCancelled';
  constructor() {
    super(CANCELLED_JOB);
  }
}

/** Throws {@link JobCancelled} once the page has cancelled the job; called between its steps. */
type Stop = () => void;

/** A job that cannot finish, with the problems that stopped it. */
class JobError extends Error {
  readonly problems: readonly string[];

  constructor(message: string, problems: readonly string[] = []) {
    super(message);
    this.name = 'JobError';
    this.problems = problems;
  }
}

interface Outcome {
  readonly snapshots: PreparedSnapshot[];
  readonly warnings: string[];
}

/** The ids of one import: those stored before it, those it has given out, and those its bundles carried. */
interface Ids {
  readonly stored: ReadonlySet<string>;
  readonly given: Set<string>;
  /** The ids the bundles read so far carried (for the notes). */
  readonly read: Set<string>;
  /** Milliseconds since the epoch, for new ids. */
  readonly now: number;
}

/** A new ULID that no stored record and no other snapshot of this import has. */
function newId(ids: Ids): string {
  let id = ulid(ids.now, Math.random);
  while (ids.stored.has(id) || ids.given.has(id)) id = ulid(ids.now, Math.random);
  ids.given.add(id);
  return id;
}

/**
 * A bundle's snapshot under a new id, its document's `id` rewritten to match. The id the file carries is never
 * reused, even when it is free: it may have named another snapshot in this browser before (a deleted one), and
 * every demo organisation has the same deterministic id. The note says when the file's snapshot is a copy of one
 * stored already, or of another file of this import.
 */
function renamed(
  snapshot: Snapshot,
  ids: Ids,
  file: string,
): { readonly snapshot: Snapshot; readonly note?: string } {
  const where = ids.stored.has(snapshot.id)
    ? 'is already stored in this browser'
    : ids.read.has(snapshot.id)
      ? 'is also in another file of this import'
      : null;
  ids.read.add(snapshot.id);
  const renamedSnapshot = { ...snapshot, id: newId(ids) };
  if (where === null) return { snapshot: renamedSnapshot };
  return {
    snapshot: renamedSnapshot,
    note: `The snapshot in ${file} ${where}, so it was stored again as a separate copy.`,
  };
}

function describeProblems(problems: readonly IngestProblem[], names: readonly string[]): string[] {
  return problems
    .slice(0, LISTED_PROBLEMS)
    .map((problem) => `${names[problem.part] ?? 'file'}, line ${String(problem.line)}: ${problem.message}`);
}

/** Lets the worker take the messages that came in meanwhile (a `cancel`). */
function pause(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * The bytes of `file` for ingest, as its stream gives them, stopping between two chunks once the job is cancelled
 * and pausing every {@link PAUSE_EVERY_BYTES} so that the `cancel` can arrive.
 */
async function* chunksOf(file: File, stop: Stop): AsyncGenerator<Uint8Array> {
  const reader = file.stream().getReader();
  let drained = false;
  let sincePause = 0;
  try {
    for (;;) {
      stop();
      const result = await reader.read();
      if (result.done) {
        drained = true;
        return;
      }
      yield result.value;
      sincePause += result.value.byteLength;
      if (sincePause >= PAUSE_EVERY_BYTES) {
        sincePause = 0;
        await pause();
      }
    }
  } finally {
    // Stopped early (cancelled, or ingest gave up on the input): the rest of the file is not read.
    if (!drained) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function importBundle(
  file: File,
  ids: Ids,
  report: Report,
  total: number,
  done: number,
  stop: Stop,
): Promise<{ readonly snapshot: PreparedSnapshot; readonly note?: string }> {
  report({ stage: 'read', done, total });
  const text = await file.text();
  stop();
  report({ stage: 'check', done: done + file.size, total });
  try {
    const { snapshot: read, history } = parseBundle(text);
    const { snapshot, note } = renamed(read, ids, file.name);
    stop();
    const prepared = await prepare(
      snapshot,
      history === undefined ? { detail: file.name } : { detail: file.name, history },
      report,
    );
    return note === undefined ? { snapshot: prepared } : { snapshot: prepared, note };
  } catch (error) {
    if (error instanceof SnapshotFileError || error instanceof SnapshotFormatError)
      throw new JobError(`${file.name}: ${error.message}`);
    throw error;
  }
}

async function importExport(
  files: readonly File[],
  ids: Ids,
  report: Report,
  total: number,
  done: number,
  sidecar: ExportSidecar | null,
  typedReadTime: string | undefined,
  stop: Stop,
): Promise<{ readonly snapshot: PreparedSnapshot; readonly warnings: string[] }> {
  const names = files.map((file) => file.name);
  const detail = names.join(', ');
  report({ stage: 'read', done, total });
  // The export's operation.json, when it came along (import/sidecar.ts): the read time it names; else the one
  // the person typed; else ingest's estimate, the latest asset change.
  const chosen = exportReadTime(sidecar, typedReadTime);
  const parts = files.map((file) => chunksOf(file, stop));
  const { snapshot, report: ingestReport } = await ingest(parts, {
    // A placeholder until the assets say (scope.ts); ingest validates the scope it is given.
    scope: { kind: 'organization', id: 'pending' },
    source: { kind: 'export', detail },
    ...(chosen.readTime === undefined || chosen.origin === undefined
      ? {}
      : { readTime: chosen.readTime, readTimeOrigin: chosen.origin }),
    clock: () => ids.now,
    entropy: Math.random,
    progressEveryBytes: 1 << 20,
    onEvent: (event) => {
      if (event.type === 'read')
        report({ stage: 'read', done: done + event.bytes, total, assets: event.assets });
    },
  });
  const problems = describeProblems(ingestReport.problems, names);
  if (snapshot.assets.length === 0) throw new JobError(`No assets were found in ${detail}.`, problems);
  const inferred = inferScope(snapshot.assets);
  if (inferred === undefined)
    throw new JobError(
      `The assets in ${detail} name no organisation, folder or project among their ancestors.`,
    );
  // The sidecar names the scope the export was taken from; otherwise it is the root the assets share.
  const { roots } = inferred;
  const scope = sidecar?.scope === undefined ? inferred.scope : namedScope(sidecar.scope, inferred.scope);
  report({ stage: 'check', done: done + files.reduce((sum, file) => sum + file.size, 0), total });
  const warnings: string[] = [];
  if (ingestReport.malformed > 0)
    warnings.push(
      `${plural(ingestReport.malformed, 'line', 'lines')} could not be read and were left out.`,
      ...problems,
    );
  if (ingestReport.duplicates > 0)
    warnings.push(
      `${plural(ingestReport.duplicates, 'asset was', 'assets were')} listed twice; the newest copy was kept.`,
    );
  if (roots > 1)
    warnings.push(
      `The files hold the assets of ${plural(roots, 'organisation or project', 'different organisations or projects')}, ` +
        `so they are not one export. The snapshot takes the scope most of them share, ${scopeName(scope)}; ` +
        'import the files of each export on their own to keep them apart.',
    );
  if (snapshot.readTimeSource === 'estimated-max-update-time')
    warnings.push(
      `The export does not say when it was taken, so its read time is the latest asset change, ${formatUtc(snapshot.readTime)}.`,
    );
  if (chosen.note !== undefined) warnings.push(chosen.note);
  // A read time later than this clock: the scope's timeline places the snapshot at the present.
  const future = futureReadTimeNote(snapshot.readTime, ids.now);
  if (future !== null) warnings.push(future);
  // Ingest made the id just now (this import's clock, random entropy): new unless it collides.
  const id = ids.stored.has(snapshot.id) || ids.given.has(snapshot.id) ? newId(ids) : snapshot.id;
  ids.given.add(id);
  stop();
  return { snapshot: await prepare({ ...snapshot, scope, id }, { detail }, report), warnings };
}

async function importJob(
  files: readonly File[],
  ids: Ids,
  report: Report,
  typedReadTime: string | undefined,
  stop: Stop,
): Promise<Outcome> {
  if (files.length === 0) throw new JobError('No files were given.');
  const bundles: File[] = [];
  const exports: File[] = [];
  let sidecar: ExportSidecar | null = null;
  for (const file of files) {
    stop();
    const head = await file.slice(0, 512).text();
    if (isBundle(file.name, head)) {
      bundles.push(file);
      continue;
    }
    const found: ExportSidecar | null =
      sidecar === null && looksLikeSidecarName(file.name) && file.size <= MAX_SIDECAR_BYTES
        ? parseSidecar(await file.text())
        : null;
    if (found === null) exports.push(file);
    else sidecar = found;
  }
  if (sidecar !== null && exports.length === 0)
    throw new JobError(
      'operation.json only says when an export was taken: choose it together with the files of the export.',
    );
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const outcome: Outcome = { snapshots: [], warnings: [] };
  let done = 0;
  for (const file of bundles) {
    stop();
    const { snapshot, note } = await importBundle(file, ids, report, total, done, stop);
    outcome.snapshots.push(snapshot);
    if (note !== undefined) outcome.warnings.push(note);
    done += file.size;
  }
  if (exports.length > 0) {
    stop();
    const { snapshot, warnings } = await importExport(
      exports,
      ids,
      report,
      total,
      done,
      sidecar,
      typedReadTime,
      stop,
    );
    outcome.snapshots.push(snapshot);
    outcome.warnings.push(...warnings);
  } else if (typedReadTime !== undefined)
    outcome.warnings.push(
      'The read time typed applies to the files of an export; the snapshot files keep their own read times.',
    );
  return outcome;
}

/** Reads a stored document in full: its JSON, then `read` (the model or the history checks). */
async function readDocument<T>(blob: Blob, what: string, read: (value: unknown) => T): Promise<T> {
  let value: unknown;
  try {
    value = JSON.parse(await blob.text()) as unknown;
  } catch {
    throw new JobError(DAMAGED_RECORD, [`The ${what} is not valid JSON.`]);
  }
  try {
    return read(value);
  } catch (error) {
    if (error instanceof SnapshotFormatError || error instanceof SnapshotFileError)
      throw new JobError(DAMAGED_RECORD, [error.message]);
    throw error;
  }
}

/** A stored record's plain documents, read in full before they are written to a file (nothing is stored). */
async function checkJob(snapshotBlob: Blob, historyBlob: Blob | undefined, report: Report): Promise<Outcome> {
  report({ stage: 'check' });
  const snapshot = await readDocument(snapshotBlob, 'snapshot', migrateSnapshot);
  if (historyBlob !== undefined)
    await readDocument(historyBlob, 'history', (value) => parseHistoryOf(value, snapshot));
  return { snapshots: [], warnings: [] };
}

function isBlob(value: unknown): value is Blob {
  return value instanceof Blob;
}

function isFile(value: unknown): value is File {
  return value instanceof File;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** Parses a message from the page; anything else is answered with an error. */
function parseRequest(message: unknown): SnapshotRequest | { readonly job: number; readonly error: string } {
  const job = isObject(message) && typeof message['job'] === 'number' ? message['job'] : -1;
  if (!isObject(message)) return { job, error: 'a request must be an object' };
  if (message['type'] === 'cancel')
    return job === -1 ? { job, error: 'a cancel names no job' } : { type: 'cancel', job };
  if (message['type'] === 'check') {
    const snapshot: unknown = message['snapshot'];
    const history: unknown = message['history'];
    if (isBlob(snapshot) && (history === undefined || isBlob(history)))
      return history === undefined
        ? { type: 'check', job, snapshot }
        : { type: 'check', job, snapshot, history };
    return { job, error: 'a check names no stored documents' };
  }
  const files: unknown = message['files'];
  const now = message['now'];
  const taken: unknown = message['taken'] ?? [];
  const readTime: unknown = message['readTime'];
  if (
    message['type'] === 'import' &&
    Array.isArray(files) &&
    files.every(isFile) &&
    Array.isArray(taken) &&
    taken.every(isString) &&
    typeof now === 'number' &&
    (readTime === undefined || (typeof readTime === 'string' && Number.isFinite(Date.parse(readTime))))
  )
    return {
      type: 'import',
      job,
      files,
      now,
      taken,
      ...(typeof readTime === 'string' ? { readTime } : {}),
    };
  return { job, error: `unknown request ${JSON.stringify(message['type'])}` };
}

function messageOf(error: unknown): string {
  if (error instanceof JobError || error instanceof IngestError || error instanceof JobCancelled)
    return error.message;
  return `Something went wrong: ${error instanceof Error ? error.message : String(error)}`;
}

export function createSnapshotHandler(
  post: (response: SnapshotResponse) => void,
): (message: unknown) => void {
  let queue: Promise<void> = Promise.resolve();
  // The jobs queued or running, and whether the page has cancelled each.
  const jobs = new Map<number, { cancelled: boolean }>();
  return (message: unknown): void => {
    const request = parseRequest(message);
    if (!('type' in request)) {
      post({ type: 'error', job: request.job, message: request.error, problems: [] });
      return;
    }
    const { job } = request;
    if (request.type === 'cancel') {
      const running = jobs.get(job);
      if (running !== undefined) running.cancelled = true;
      return;
    }
    const state = { cancelled: false };
    jobs.set(job, state);
    const stop: Stop = () => {
      if (state.cancelled) throw new JobCancelled();
    };
    const report: Report = (progress) => {
      if (!state.cancelled) post({ type: 'progress', job, progress });
    };
    queue = queue.then(async () => {
      try {
        stop();
        const outcome =
          request.type === 'check'
            ? await checkJob(request.snapshot, request.history, report)
            : await importJob(
                request.files,
                { stored: new Set(request.taken), given: new Set(), read: new Set(), now: request.now },
                report,
                request.readTime,
                stop,
              );
        stop();
        post({ type: 'done', job, snapshots: outcome.snapshots, warnings: outcome.warnings });
      } catch (error) {
        // A cancelled job answers that it was cancelled, whatever stopped it (ingest may have wrapped the stop).
        post({
          type: 'error',
          job,
          message: state.cancelled ? CANCELLED_JOB : messageOf(error),
          problems: error instanceof JobError && !state.cancelled ? error.problems : [],
        });
      } finally {
        jobs.delete(job);
      }
    });
  };
}
