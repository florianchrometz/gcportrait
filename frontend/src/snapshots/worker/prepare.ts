// SPDX-License-Identifier: Apache-2.0
/**
 * A snapshot made ready to store (`PreparedSnapshot`, protocol.ts): its documents encoded for IndexedDB (../codec.ts)
 * and its listing metadata. Shared by the snapshot worker's imports (handler.ts) and the demo job
 * (diagram/pipeline/demo.ts, run by the demo worker, demoRole.ts), which prepares the demo organisations because the
 * demo generator runs in the diagram's workers only (AGENTS.md, Architecture and code). Each step is reported as
 * it starts.
 */
import type { DemoHistory } from '@gcportrait/demo-data';
import type { IngestProblem, IngestReport } from '@gcportrait/ingest';
import type { Snapshot } from '@gcportrait/model';

import { futureReadTimeNote } from '../../import/sidecar';
import { encodeJson } from '../codec';
import { formatUtc, plural, scopeName } from '../labels';
import type { JobProgress, PreparedSnapshot } from './protocol';

export type Report = (progress: JobProgress) => void;

/** How many malformed lines are listed for the person (the rest are counted). */
export const LISTED_PROBLEMS = 5;

/** Note templates for read time sources when importing an export. */
export const READ_TIME_SOURCE_NOTE: Readonly<Record<string, (readTime: string) => string>> = {
  'estimated-max-update-time': (readTime: string) =>
    `The export does not say when it was taken, so its read time is the latest asset change, ${formatUtc(readTime)}.`,
};

export function describeProblems(problems: readonly IngestProblem[], names?: readonly string[]): string[] {
  return problems
    .slice(0, LISTED_PROBLEMS)
    .map((problem) =>
      names !== undefined
        ? `${names[problem.part] ?? 'file'}, line ${String(problem.line)}: ${problem.message}`
        : `Line ${String(problem.line)}: ${problem.message}`,
    );
}

export function metaOf(
  snapshot: Snapshot,
  bytes: number,
  detail: string | undefined,
  historyTicks?: number,
): PreparedSnapshot['meta'] {
  return {
    scope: snapshot.scope,
    readTime: snapshot.readTime,
    source: snapshot.source.kind,
    assetCount: snapshot.assets.length,
    bytes,
    schemaVersion: snapshot.schemaVersion,
    ...(detail === undefined ? {} : { detail }),
    ...(snapshot.readTimeSource === 'estimated-max-update-time' ? { estimatedReadTime: true } : {}),
    // Where an export's or a pull's read time came from (the timeline marks an estimate on its extra tick). A
    // demo organisation's is fixed by the generator, so its record keeps none.
    ...(snapshot.readTimeSource === undefined || snapshot.source.kind === 'demo'
      ? {}
      : { readTimeSource: snapshot.readTimeSource }),
    ...(historyTicks === undefined ? {} : { historyTicks }),
  };
}

export interface PrepareOptions {
  /** The record's ref: `demo:<size>` for a generated demo organisation, else the snapshot's id. */
  readonly id?: string;
  readonly detail?: string;
  readonly history?: DemoHistory;
}

export async function prepareSnapshot(
  snapshot: Snapshot,
  options: PrepareOptions,
  report: Report = () => undefined,
): Promise<PreparedSnapshot> {
  report({ stage: 'encode' });
  const blob = await encodeJson(snapshot);
  const history = options.history === undefined ? undefined : await encodeJson(options.history);
  const meta = metaOf(
    snapshot,
    blob.size + (history?.size ?? 0),
    options.detail,
    options.history?.ticks.length,
  );
  const id = options.id ?? snapshot.id;
  return history === undefined ? { id, meta, blob } : { id, meta, blob, history };
}

export interface ExportNotesOptions {
  /** The roots count inferred from the assets, if multi-root warning should be checked. */
  readonly roots?: number | undefined;
  /** File names to describe problems with line numbers, if available. */
  readonly names?: readonly string[] | undefined;
  /** Extra note, e.g. when sidecar overrides typed read time. */
  readonly extraNote?: string | undefined;
  /** Extra notes, if multiple. */
  readonly extraNotes?: readonly string[] | undefined;
}

export function exportNotes(
  report: IngestReport,
  snapshot: Pick<Snapshot, 'readTime' | 'readTimeSource' | 'scope'>,
  now: number,
  options: ExportNotesOptions = {},
): string[] {
  const warnings: string[] = [];
  if (report.malformed > 0)
    warnings.push(
      `${plural(report.malformed, 'line', 'lines')} could not be read and were left out.`,
      ...describeProblems(report.problems, options.names),
    );
  if (report.duplicates > 0)
    warnings.push(
      `${plural(report.duplicates, 'asset was', 'assets were')} listed twice; the newest copy was kept.`,
    );
  if (options.roots !== undefined && options.roots > 1)
    warnings.push(
      `The export holds the assets of ${plural(options.roots, 'organisation or project', 'organisations or projects')}; ` +
        `the snapshot takes the scope most of them share, ${scopeName(snapshot.scope)}.`,
    );
  const template =
    snapshot.readTimeSource === undefined ? undefined : READ_TIME_SOURCE_NOTE[snapshot.readTimeSource];
  if (template !== undefined) warnings.push(template(snapshot.readTime));
  if (options.extraNote !== undefined) warnings.push(options.extraNote);
  if (options.extraNotes !== undefined) warnings.push(...options.extraNotes);
  const future = futureReadTimeNote(snapshot.readTime, now);
  if (future !== null) warnings.push(future);
  return warnings;
}

export interface ExportSnapshotOptions extends PrepareOptions, ExportNotesOptions {
  readonly now: number;
  readonly report: IngestReport;
}

export async function exportReadToSnapshot(
  snapshot: Snapshot,
  options: ExportSnapshotOptions,
  report: Report = () => undefined,
): Promise<{ readonly snapshot: PreparedSnapshot; readonly warnings: string[] }> {
  const warnings = exportNotes(options.report, snapshot, options.now, options);
  const prepared = await prepareSnapshot(snapshot, options, report);
  return { snapshot: prepared, warnings };
}
