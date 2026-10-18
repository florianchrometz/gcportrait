// SPDX-License-Identifier: Apache-2.0
/**
 * The optional `operation.json` sidecar of an export (skill cai-ingestion §1 "Export facts"): an
 * export file does not say when it was taken; the long-running operation of `exportAssets` does. Saved next to the
 * export (`gcloud asset operations describe YOUR_OPERATION_NAME --format=json > operation.json`), it gives the
 * snapshot its read time (`readTimeSource: export-sidecar`) and its scope, so neither is guessed from the assets.
 *
 * The operation's `response` (an `ExportAssetsResponse`) carries `readTime` once the export is done; its
 * `metadata` (the `ExportAssetsRequest`) carries `parent` (the scope) and, when the export asked for one, its own
 * `readTime`. Pure: used by the snapshot worker's import (dropped files) and by the Load export panel (a gs:// read).
 *
 * Without a sidecar the person may type the read time instead (`parseTypedReadTime`;
 * `readTimeSource: user`); the sidecar's wins when both are given (`exportReadTime`), and without either the
 * read time is the latest asset change, an estimate. A read time later than the import's clock is said
 * (`futureReadTimeNote`): the timeline places such a snapshot at the present (timeline/extraTicks.ts).
 */
import type { SnapshotScope } from '@gcportrait/model';

import { isRecord } from '../guards';
import { formatUtcMinute } from '../utcTime';

/** What a sidecar tells: at least one of the two. */
export interface ExportSidecar {
  readonly readTime?: string;
  readonly scope?: SnapshotScope;
}

/** The file name gcportrait's guidance gives the sidecar; any `*operation*.json` name is recognised. */
export const SIDECAR_FILE_NAME = 'operation.json';

/** A sidecar is small; anything bigger is an export. */
export const MAX_SIDECAR_BYTES = 256 * 1024;

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const SCOPE = /^(organizations|folders|projects)\/([a-z0-9][a-z0-9.:-]{0,99})$/;
const KINDS = { organizations: 'organization', folders: 'folder', projects: 'project' } as const;

function timestamp(value: unknown): string | undefined {
  return typeof value === 'string' && RFC3339.test(value) && !Number.isNaN(Date.parse(value))
    ? value
    : undefined;
}

function scopeOf(value: unknown): SnapshotScope | undefined {
  if (typeof value !== 'string') return undefined;
  const match = SCOPE.exec(value);
  if (match === null) return undefined;
  const [, collection, id] = match;
  if (collection === undefined || id === undefined) return undefined;
  const kind = KINDS[collection as keyof typeof KINDS];
  if (kind !== 'project' && !/^[1-9]\d*$/.test(id)) return undefined;
  return { kind, id };
}

/** Whether a file's name says it may be the sidecar (the content decides: {@link parseSidecar}). */
export function looksLikeSidecarName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.json') && lower.includes('operation');
}

/**
 * The read time and scope an `exportAssets` operation names, or null when the text is not such an operation (an
 * export line, a bundle, anything else). The operation must be an asset export (`ExportAssets` in its name or
 * types) and finished, or name its read time in its request.
 */
export function parseSidecar(text: string): ExportSidecar | null {
  if (text.length > MAX_SIDECAR_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const { name, metadata, response } = parsed;
  const meta = isRecord(metadata) ? metadata : {};
  const answer = isRecord(response) ? response : {};
  const types = [meta['@type'], answer['@type']].filter((type): type is string => typeof type === 'string');
  const isExport =
    (typeof name === 'string' && name.includes('/operations/ExportAssets')) ||
    types.some(
      (type) =>
        type.endsWith('google.cloud.asset.v1.ExportAssetsRequest') || type.endsWith('ExportAssetsResponse'),
    );
  if (!isExport) return null;
  const readTime = timestamp(answer['readTime']) ?? timestamp(meta['readTime']);
  const scope = scopeOf(meta['parent']);
  if (readTime === undefined && scope === undefined) return null;
  return { ...(readTime === undefined ? {} : { readTime }), ...(scope === undefined ? {} : { scope }) };
}

/**
 * The scope a sidecar names, with the display name the assets give it (the organisation's `displayName`, the
 * project's id) when the export's own root is that scope; the sidecar's scope as it is otherwise.
 */
export function namedScope(given: SnapshotScope, inferred: SnapshotScope | undefined): SnapshotScope {
  return inferred !== undefined && inferred.kind === given.kind && inferred.id === given.id
    ? inferred
    : given;
}

/** How the export card asks for a typed read time, and what its hint shows. */
export const TYPED_READ_TIME_EXAMPLE = '2026-10-05 14:30';

const TYPED_READ_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,9})?\s*(Z|UTC|[+-]\d{2}:\d{2})?$/i;

/**
 * The read time the person typed for an export that came without its operation.json: `2026-10-05 14:30` (UTC, as the
 * field says), with or without seconds, a `T`, `Z`, `UTC` or an offset (`+02:00`). Null for an empty field; a
 * problem in words for text that is no such time, or a time later than `now` (an export cannot be taken later).
 * The read time is written in UTC to the second: `2026-10-05T14:30:00Z`.
 */
export function parseTypedReadTime(
  text: string,
  now: number,
): { readonly readTime: string } | { readonly problem: string } | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const match = TYPED_READ_TIME.exec(trimmed);
  const problem = {
    problem: `Type the read time as ${TYPED_READ_TIME_EXAMPLE} (UTC), or leave it empty.`,
  };
  if (match === null) return problem;
  const [, year, month, day, hour, minute, second = '00', zone = 'Z'] = match;
  const fields = [year, month, day, hour, minute, second].map(Number);
  const [y = 0, mo = 0, d = 0, h = 0, mi = 0, sec = 0] = fields;
  const wall = new Date(Date.UTC(y, mo - 1, d, h, mi, sec));
  // The fields must name a real time (no 30 February, no 25 o'clock): Date.UTC rolls them over, which this catches.
  const real =
    y >= 1970 &&
    wall.getUTCFullYear() === y &&
    wall.getUTCMonth() === mo - 1 &&
    wall.getUTCDate() === d &&
    wall.getUTCHours() === h &&
    wall.getUTCMinutes() === mi &&
    wall.getUTCSeconds() === sec;
  if (!real) return problem;
  const offset = /^[+-]\d{2}:\d{2}$/.exec(zone)?.[0];
  const [offsetHours, offsetRest] =
    offset === undefined ? [0, 0] : [Number(offset.slice(1, 3)), Number(offset.slice(4, 6))];
  const offsetMinutes = (offset?.startsWith('-') === true ? -1 : 1) * (offsetHours * 60 + offsetRest);
  // Offsets on Earth run from -12:00 to +14:00.
  if (offsetRest > 59 || offsetMinutes < -12 * 60 || offsetMinutes > 14 * 60) return problem;
  const ms = wall.getTime() - offsetMinutes * 60_000;
  if (ms > now)
    return {
      problem: `${formatUtcMinute(ms)} is later than this computer's clock: type when the export was taken.`,
    };
  return { readTime: `${new Date(ms).toISOString().slice(0, 19)}Z` };
}

/** Where an export's read time comes from: the sidecar's, else the one typed, else none (the estimate). */
export interface ExportReadTime {
  readonly readTime?: string;
  readonly origin?: 'export-sidecar' | 'user';
  /** Said when the person typed a read time that the sidecar's replaced. */
  readonly note?: string;
}

/** The read time an export is read with: the sidecar's wins over a typed one (and says so when they differ). */
export function exportReadTime(sidecar: ExportSidecar | null, typed: string | undefined): ExportReadTime {
  const fromSidecar = sidecar?.readTime;
  if (fromSidecar !== undefined) {
    const differs = typed !== undefined && Date.parse(typed) !== Date.parse(fromSidecar);
    return {
      readTime: fromSidecar,
      origin: 'export-sidecar',
      ...(differs
        ? {
            note:
              `The export's operation.json names its read time, ${formatUtcMinute(Date.parse(fromSidecar))}, so the time typed, ` +
              `${formatUtcMinute(Date.parse(typed))}, was not used.`,
          }
        : {}),
    };
  }
  return typed === undefined ? {} : { readTime: typed, origin: 'user' };
}

/** Said when a snapshot's read time is later than the import's clock (the timeline then places it at the present). */
export function futureReadTimeNote(readTime: string, now: number): string | null {
  const ms = Date.parse(readTime);
  if (!Number.isFinite(ms) || ms <= now) return null;
  return (
    `Its read time, ${formatUtcMinute(ms)}, is later than this computer's clock; its scope's timeline shows it at ` +
    'the present until then.'
  );
}
