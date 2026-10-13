// SPDX-License-Identifier: MIT
/**
 * The push-based ingest core. A session takes chunks of one or more input parts (files), splits them into
 * lines, recognises the dialect of each line, normalises assets, and on `finish()` assembles the Snapshot
 * (the model's `SnapshotSchema`) and a report. Everything is synchronous, so a worker can feed it straight from
 * its message handler; {@link ingest} drives it from streams, blobs and strings.
 *
 * Two dialects, recognised line by line, may be mixed freely:
 * - **CAI NDJSON**: one asset object per line, as `exportAssets` writes it (snake_case envelope keys) or as
 *   `assets.list` returns it (camelCase); see normalise.ts.
 * - **Backend stream frames** (skill cai-ingestion §4, docs/api.md): objects with a `t` field and no `name`.
 *   `{"t":"page","assets":[…]}` carries assets, `{"t":"progress","pages":n,"assets":m}` and
 *   `{"t":"done","assets":m,"readTime":"…"}` become events, and `{"t":"error","message":"…"}` stops the
 *   session with the upstream message. An object with a `name` is always an asset, whatever else it holds,
 *   so an asset is never mistaken for a frame and dropped (agents.md, Product rules).
 */
import {
  SNAPSHOT_SCHEMA_VERSION,
  SnapshotScopeSchema,
  SnapshotSourceSchema,
  TimestampSchema,
  type Asset,
  type ProjectIndex,
  type Snapshot,
  type SnapshotReadTimeSource,
  type SnapshotScope,
  type SnapshotSource,
} from '@gcportrait/model';
import { IngestError, type IngestProblem, type IngestProblemCode } from './errors.js';
import { LineSplitter } from './lines.js';
import { isRecord, normaliseAsset } from './normalise.js';
import { compareText, compareTimestamps } from './order.js';
import { summariseProjects, type UnresolvedProjects } from './project-index.js';
import { ulid } from './ulid.js';

/** The default longest line, 64 MiB: well above a 25 MiB backend page frame and any single asset. */
export const DEFAULT_MAX_LINE_BYTES = 64 * 1024 * 1024;
/** The default spacing of `read` progress events, in input bytes. */
export const DEFAULT_PROGRESS_EVERY_BYTES = 4 * 1024 * 1024;
/** How many problems the report keeps; `malformed` still counts all of them. */
export const MAX_REPORTED_PROBLEMS = 20;
/** The latest time `Date#toISOString` writes in RFC 3339 form (9999-12-31T23:59:59.999Z). */
const MAX_CLOCK = 253_402_300_799_999;

/** The serialisable part of the options: what a worker `start` message carries. */
export interface IngestSettings {
  /** The scope the input was read from; the caller knows it (the scope picker or the export command). */
  readonly scope: SnapshotScope;
  /** Where the input came from: `api`, `export` or `demo`, with free-text detail (file names, URI). */
  readonly source: SnapshotSource;
  /**
   * The Cloud Asset Inventory read time, when known (an export's operation metadata, the timeline tick).
   * Default: the latest `readTime` of the input's `done` frames, else the latest `updateTime` of any asset
   * (an estimate: skill cai-ingestion §1, "Export facts"), else the clock. `report.readTimeSource` says which.
   */
  readonly readTime?: string;
  /**
   * Where the `readTime` option came from, recorded as the snapshot's `readTimeSource`: `api` (the time a live
   * pull asked for), `export-sidecar` (an export's operation metadata) or `user`. Only with `readTime`.
   * Default: `api` for an `api` source, `export-sidecar` for an `export` source, `user` otherwise.
   */
  readonly readTimeOrigin?: ReadTimeOrigin;
  /** Throw on the first malformed line or asset instead of counting and skipping it. Default false. */
  readonly strict?: boolean;
  /** The longest line read, in bytes (for text input: UTF-16 code units). Default {@link DEFAULT_MAX_LINE_BYTES}. */
  readonly maxLineBytes?: number;
  /** Emit a `read` event each time this many more input bytes were read. Default {@link DEFAULT_PROGRESS_EVERY_BYTES}. */
  readonly progressEveryBytes?: number;
}

/** Everything an ingest needs. The package reads no clock and no random source of its own. */
export interface IngestOptions extends IngestSettings {
  /** Milliseconds since the Unix epoch; called once, in `finish()`, for the snapshot id (and readTime fallback). */
  readonly clock: () => number;
  /** Numbers in [0, 1), like `Math.random`; supplies the snapshot id's 80 random bits. */
  readonly entropy: () => number;
  /** Receives progress events as the input is read. */
  readonly onEvent?: (event: IngestEvent) => void;
}

/** Progress while reading. */
export type IngestEvent =
  /** Local progress, every `progressEveryBytes` bytes: totals so far (`assets` counts distinct names). */
  | {
      readonly type: 'read';
      readonly bytes: number;
      readonly lines: number;
      readonly assets: number;
      readonly malformed: number;
    }
  /** A backend `progress` frame. */
  | { readonly type: 'upstream-progress'; readonly pages: number; readonly assets: number }
  /** A backend `done` frame: the backend's own asset count and the read time it used. */
  | { readonly type: 'upstream-done'; readonly assets: number; readonly readTime?: string };

/**
 * Where `snapshot.readTime` came from: the `readTime` option, the backend's `done` frame, the latest asset
 * `updateTime` (an estimate: the UI says so), or the clock (an input without assets and no other hint).
 */
export type ReadTimeSource = 'option' | 'upstream' | 'max-update-time' | 'clock';

/** Where a caller's `readTime` option came from (the model's `SnapshotReadTimeSource` minus the estimate). */
export type ReadTimeOrigin = Exclude<SnapshotReadTimeSource, 'estimated-max-update-time'>;

const READ_TIME_ORIGINS: readonly ReadTimeOrigin[] = ['api', 'export-sidecar', 'user'];

function isReadTimeOrigin(value: unknown): value is ReadTimeOrigin {
  return READ_TIME_ORIGINS.some((origin) => origin === value);
}

/** What the backend frames in the input said, when there were any. */
export interface UpstreamSummary {
  /** `page` frames read. */
  readonly pages: number;
  /** Whether a `done` frame was read. A frame stream without one was cut short. */
  readonly complete: boolean;
  /** The asset count of the last `done` frame. */
  readonly reportedAssets?: number;
  /** The latest `readTime` of the `done` frames. */
  readonly readTime?: string;
}

/** How the input went. */
export interface IngestReport {
  /** Input parts (files) read. */
  readonly parts: number;
  /** Lines read, blank ones included. */
  readonly lines: number;
  /** Empty and whitespace-only lines, which are skipped. */
  readonly blankLines: number;
  /** Lines in the CAI NDJSON dialect (one asset per line). */
  readonly assetLines: number;
  /** Lines in the backend frame dialect. */
  readonly frameLines: number;
  /** Lines and frame items skipped as malformed; `problems` holds the first {@link MAX_REPORTED_PROBLEMS}. */
  readonly malformed: number;
  readonly problems: readonly IngestProblem[];
  /**
   * Assets whose name was already seen. One asset per name is kept: the one with the latest `updateTime`,
   * the first one on a tie, at the position where the name first appeared.
   */
  readonly duplicates: number;
  readonly readTimeSource: ReadTimeSource;
  /** Present when the input contained backend frames. */
  readonly upstream?: UpstreamSummary;
  /**
   * The snapshot's project index (the model `ProjectIndex`, from its Project assets): equal to
   * `buildProjectIndex(snapshot.assets)` of `@gcportrait/model`.
   */
  readonly projects: ProjectIndex;
  /** Project numbers and ids the index could not pair, with hints; see {@link UnresolvedProjects}. */
  readonly unresolvedProjects: UnresolvedProjects;
}

/** A finished ingest. Plain data: it survives `postMessage` and JSON. */
export interface IngestResult {
  readonly snapshot: Snapshot;
  readonly report: IngestReport;
}

/** A push-based ingest. After `finish()`, or after any call threw, every further call throws. */
export interface IngestSession {
  /** Reads the next chunk of the current part. */
  push(chunk: Uint8Array | string): void;
  /** Ends the current part: its last line is complete even without a final newline; the next push starts a new part. */
  endPart(): void;
  /** Ends the last part if it has input and returns the snapshot and the report. */
  finish(): IngestResult;
}

/** Starts an ingest session. Throws `invalid-options` for invalid options. */
export function createIngestSession(options: IngestOptions): IngestSession {
  return new Session(options);
}

interface ValidatedSettings {
  readonly scope: SnapshotScope;
  readonly source: SnapshotSource;
  readonly readTime: string | undefined;
  readonly readTimeOrigin: ReadTimeOrigin | undefined;
  readonly strict: boolean;
  readonly maxLineBytes: number;
  readonly progressEveryBytes: number;
}

/** Validates settings that may come from an untyped caller or a worker message. */
function validateSettings(value: unknown): ValidatedSettings {
  if (!isRecord(value)) throw invalidOptions('The options must be an object.');
  const scope = SnapshotScopeSchema.safeParse(value['scope']);
  if (!scope.success) throw invalidOptions(`scope: ${firstIssue(scope.error.issues)}`);
  const source = SnapshotSourceSchema.safeParse(value['source']);
  if (!source.success) throw invalidOptions(`source: ${firstIssue(source.error.issues)}`);
  const readTime = value['readTime'];
  if (
    readTime !== undefined &&
    !(typeof readTime === 'string' && TimestampSchema.safeParse(readTime).success)
  ) {
    throw invalidOptions('readTime: must be an RFC 3339 timestamp.');
  }
  const readTimeOrigin = value['readTimeOrigin'];
  if (readTimeOrigin !== undefined && !isReadTimeOrigin(readTimeOrigin)) {
    throw invalidOptions(`readTimeOrigin: must be one of ${READ_TIME_ORIGINS.join(', ')}.`);
  }
  if (readTimeOrigin !== undefined && readTime === undefined) {
    throw invalidOptions('readTimeOrigin: says where the readTime option came from, so it needs readTime.');
  }
  const strict = value['strict'] ?? false;
  if (typeof strict !== 'boolean') throw invalidOptions('strict: must be a boolean.');
  return {
    scope: scope.data,
    source: source.data,
    readTime,
    readTimeOrigin,
    strict,
    maxLineBytes: positiveInteger(value, 'maxLineBytes', DEFAULT_MAX_LINE_BYTES),
    progressEveryBytes: positiveInteger(value, 'progressEveryBytes', DEFAULT_PROGRESS_EVERY_BYTES),
  };
}

function positiveInteger(options: Record<string, unknown>, key: string, fallback: number): number {
  const value = options[key] ?? fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw invalidOptions(`${key}: must be a positive integer.`);
  }
  return value;
}

function invalidOptions(message: string): IngestError {
  return new IngestError('invalid-options', message);
}

function firstIssue(issues: readonly { path: readonly PropertyKey[]; message: string }[]): string {
  const [issue] = issues;
  if (issue === undefined) return 'invalid';
  return issue.path.length === 0 ? issue.message : `${issue.path.map(String).join('.')}: ${issue.message}`;
}

class Session implements IngestSession {
  readonly #settings: ValidatedSettings;
  readonly #clock: () => number;
  readonly #entropy: () => number;
  readonly #onEvent: ((event: IngestEvent) => void) | undefined;
  readonly #splitter: LineSplitter;
  readonly #assets: Asset[] = [];
  /** Asset name → its index in #assets. */
  readonly #positions = new Map<string, number>();
  readonly #problems: IngestProblem[] = [];
  #malformed = 0;
  #lines = 0;
  #blankLines = 0;
  #assetLines = 0;
  #frameLines = 0;
  #duplicates = 0;
  #latestUpdate: string | undefined;
  #frames = false;
  #pages = 0;
  #doneFrames = 0;
  #reportedAssets: number | undefined;
  #upstreamReadTime: string | undefined;
  #partHasInput = false;
  #nextProgressAt: number;
  #state: 'open' | 'finished' | 'failed' = 'open';
  #failure: unknown;

  constructor(options: IngestOptions) {
    const settings = validateSettings(options);
    if (typeof options.clock !== 'function') throw invalidOptions('clock: must be a function.');
    if (typeof options.entropy !== 'function') throw invalidOptions('entropy: must be a function.');
    const onEvent: unknown = options.onEvent;
    if (onEvent !== undefined && typeof onEvent !== 'function')
      throw invalidOptions('onEvent: must be a function.');
    this.#settings = settings;
    this.#clock = options.clock;
    this.#entropy = options.entropy;
    this.#onEvent = options.onEvent;
    this.#nextProgressAt = settings.progressEveryBytes;
    this.#splitter = new LineSplitter(
      {
        line: (text, part, line) => {
          this.#readLine(text, part, line);
        },
        problem: (code, part, line, message) => {
          this.#problem(code, part, line, message, undefined);
        },
      },
      settings.maxLineBytes,
    );
  }

  push(chunk: Uint8Array | string): void {
    this.#guard(() => {
      const value: unknown = chunk;
      if (typeof value !== 'string' && !(value instanceof Uint8Array)) {
        throw new IngestError('invalid-source', 'A chunk must be a Uint8Array or a string.');
      }
      this.#partHasInput = true;
      this.#splitter.push(value);
      this.#reportProgress();
    });
  }

  endPart(): void {
    this.#guard(() => {
      this.#endPart();
    });
  }

  finish(): IngestResult {
    return this.#guard(() => {
      if (this.#partHasInput) this.#endPart();
      const time = this.#clock();
      if (!Number.isInteger(time) || time < 0 || time > MAX_CLOCK) {
        throw invalidOptions(`clock: returned ${String(time)}, not a time in milliseconds.`);
      }
      const id = ulid(time, this.#entropy);
      const [readTime, readTimeSource] = this.#readTime(time);
      const snapshotReadTimeSource = this.#snapshotReadTimeSource(readTimeSource);
      // Built over the kept assets only, so a duplicate that lost to a newer copy contributes nothing.
      const projects = summariseProjects(this.#assets);
      const snapshot: Snapshot = {
        id,
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        scope: this.#settings.scope,
        readTime,
        ...(snapshotReadTimeSource === undefined ? {} : { readTimeSource: snapshotReadTimeSource }),
        source: this.#settings.source,
        contentType: 'RESOURCE',
        assets: this.#assets,
        stats: { count: this.#assets.length, byType: countByType(this.#assets), bytes: this.#splitter.bytes },
      };
      const report: IngestReport = {
        parts: this.#splitter.part,
        lines: this.#lines,
        blankLines: this.#blankLines,
        assetLines: this.#assetLines,
        frameLines: this.#frameLines,
        malformed: this.#malformed,
        problems: this.#problems,
        duplicates: this.#duplicates,
        readTimeSource,
        ...(this.#frames ? { upstream: this.#upstreamSummary() } : {}),
        projects: projects.index,
        unresolvedProjects: projects.unresolved,
      };
      this.#state = 'finished';
      return { snapshot, report };
    });
  }

  #endPart(): void {
    this.#splitter.endPart();
    this.#partHasInput = false;
  }

  #guard<T>(body: () => T): T {
    if (this.#state === 'failed') throw this.#failure;
    if (this.#state === 'finished')
      throw new IngestError('closed', 'The ingest session has already finished.');
    try {
      return body();
    } catch (error) {
      this.#state = 'failed';
      this.#failure = error;
      throw error;
    }
  }

  #readLine(text: string, part: number, line: number): void {
    this.#lines += 1;
    if (text.length === 0) {
      this.#blankLines += 1;
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      if (text.trim().length === 0) {
        this.#blankLines += 1;
      } else {
        this.#problem('invalid-json', part, line, `Not valid JSON: ${messageOf(error)}`, undefined);
      }
      return;
    }
    if (!isRecord(value)) {
      this.#problem(
        'not-an-object',
        part,
        line,
        `Expected a JSON object, found ${describeJson(value)}.`,
        undefined,
      );
      return;
    }
    if ('t' in value && !('name' in value)) {
      this.#frameLines += 1;
      this.#readFrame(value, part, line);
    } else {
      this.#assetLines += 1;
      this.#readAsset(value, part, line, undefined);
    }
  }

  #readFrame(frame: Record<string, unknown>, part: number, line: number): void {
    this.#frames = true;
    const kind = frame['t'];
    switch (kind) {
      case 'page': {
        const assets: unknown = frame['assets'];
        if (!Array.isArray(assets)) {
          this.#problem('invalid-frame', part, line, 'A page frame needs an "assets" array.', undefined);
          return;
        }
        this.#pages += 1;
        const items: readonly unknown[] = assets;
        items.forEach((raw, item) => {
          this.#readAsset(raw, part, line, item);
        });
        return;
      }
      case 'progress': {
        const pages = frame['pages'];
        const assets = frame['assets'];
        if (!isCount(pages) || !isCount(assets)) {
          this.#problem(
            'invalid-frame',
            part,
            line,
            'A progress frame needs "pages" and "assets" counts.',
            undefined,
          );
          return;
        }
        this.#emit({ type: 'upstream-progress', pages, assets });
        return;
      }
      case 'done': {
        const assets = frame['assets'];
        const readTime = frame['readTime'];
        if (!isCount(assets)) {
          this.#problem('invalid-frame', part, line, 'A done frame needs an "assets" count.', undefined);
          return;
        }
        if (
          readTime !== undefined &&
          !(typeof readTime === 'string' && TimestampSchema.safeParse(readTime).success)
        ) {
          this.#problem(
            'invalid-frame',
            part,
            line,
            'A done frame\'s "readTime" must be an RFC 3339 timestamp.',
            undefined,
          );
          return;
        }
        this.#doneFrames += 1;
        this.#reportedAssets = assets;
        if (readTime !== undefined) this.#upstreamReadTime = later(this.#upstreamReadTime, readTime);
        this.#emit({ type: 'upstream-done', assets, ...(readTime === undefined ? {} : { readTime }) });
        return;
      }
      case 'error':
        throw upstreamError(frame);
      default:
        this.#problem(
          'unknown-frame',
          part,
          line,
          typeof kind === 'string'
            ? `Unknown frame type "${kind.slice(0, 40)}".`
            : `A frame's "t" must be a string, found ${describeJson(kind)}.`,
          undefined,
        );
    }
  }

  #readAsset(raw: unknown, part: number, line: number, item: number | undefined): void {
    const result = normaliseAsset(raw);
    if (!result.ok) {
      this.#problem('invalid-asset', part, line, result.message, item);
      return;
    }
    const asset = result.asset;
    // Every copy counts here: the copy a name keeps always has its latest updateTime (first on a tie), so the
    // maximum over all copies is the maximum over the kept ones.
    this.#latestUpdate = later(this.#latestUpdate, asset.updateTime);
    const position = this.#positions.get(asset.name);
    if (position === undefined) {
      this.#positions.set(asset.name, this.#assets.length);
      this.#assets.push(asset);
      return;
    }
    this.#duplicates += 1;
    const kept = this.#assets[position];
    if (kept !== undefined && compareTimestamps(asset.updateTime, kept.updateTime) > 0) {
      this.#assets[position] = asset;
    }
  }

  #problem(
    code: IngestProblemCode,
    part: number,
    line: number,
    message: string,
    item: number | undefined,
  ): void {
    const problem: IngestProblem =
      item === undefined ? { code, part, line, message } : { code, part, line, item, message };
    this.#malformed += 1;
    if (this.#problems.length < MAX_REPORTED_PROBLEMS) this.#problems.push(problem);
    if (this.#settings.strict) {
      const where = `part ${String(part)}, line ${String(line)}${item === undefined ? '' : `, item ${String(item)}`}`;
      throw new IngestError('malformed', `Malformed input at ${where}: ${message}`, { problem });
    }
  }

  #emit(event: IngestEvent): void {
    this.#onEvent?.(event);
  }

  #reportProgress(): void {
    const bytes = this.#splitter.bytes;
    if (this.#onEvent === undefined || bytes < this.#nextProgressAt) return;
    const step = this.#settings.progressEveryBytes;
    this.#nextProgressAt = (Math.floor(bytes / step) + 1) * step;
    this.#emit({
      type: 'read',
      bytes,
      lines: this.#lines,
      assets: this.#assets.length,
      malformed: this.#malformed,
    });
  }

  #readTime(time: number): [string, ReadTimeSource] {
    if (this.#settings.readTime !== undefined) return [this.#settings.readTime, 'option'];
    if (this.#upstreamReadTime !== undefined) return [this.#upstreamReadTime, 'upstream'];
    if (this.#latestUpdate !== undefined) return [this.#latestUpdate, 'max-update-time'];
    return [new Date(time).toISOString(), 'clock'];
  }

  /** The model's `Snapshot.readTimeSource` for where the read time came from; none for the clock fallback. */
  #snapshotReadTimeSource(source: ReadTimeSource): SnapshotReadTimeSource | undefined {
    switch (source) {
      case 'option': {
        const kind = this.#settings.source.kind;
        return (
          this.#settings.readTimeOrigin ??
          (kind === 'api' ? 'api' : kind === 'export' ? 'export-sidecar' : 'user')
        );
      }
      case 'upstream':
        return 'api';
      case 'max-update-time':
        return 'estimated-max-update-time';
      case 'clock':
        return undefined;
    }
  }

  #upstreamSummary(): UpstreamSummary {
    return {
      pages: this.#pages,
      complete: this.#doneFrames > 0,
      ...(this.#reportedAssets === undefined ? {} : { reportedAssets: this.#reportedAssets }),
      ...(this.#upstreamReadTime === undefined ? {} : { readTime: this.#upstreamReadTime }),
    };
  }
}

function upstreamError(frame: Record<string, unknown>): IngestError {
  const message = frame['message'];
  const status = frame['status'];
  const code = frame['code'];
  return new IngestError(
    'upstream',
    typeof message === 'string' && message !== ''
      ? message
      : 'The asset stream reported an error without a message.',
    {
      upstream: {
        ...(typeof status === 'number' && Number.isInteger(status) ? { status } : {}),
        ...(typeof code === 'string' && code !== '' ? { code } : {}),
      },
    },
  );
}

function countByType(assets: readonly Asset[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const asset of assets) counts.set(asset.assetType, (counts.get(asset.assetType) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([left], [right]) => compareText(left, right)));
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeJson(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

/** The later of a kept timestamp and a new one; the kept one on a tie. */
function later(kept: string | undefined, candidate: string): string {
  return kept === undefined || compareTimestamps(candidate, kept) > 0 ? candidate : kept;
}
