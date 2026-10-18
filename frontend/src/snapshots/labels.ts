// SPDX-License-Identifier: Apache-2.0
/**
 * How the snapshot pages name and format what they list (page side, also used by the snapshot worker for its
 * notes; plain functions, no React).
 */
import type { DemoSize } from '@gcportrait/model';

import { DEMO_CHOICES } from '../diagram/demoChoices';
import type { SnapshotMeta } from '../storage/db';
import { formatUtcMinute } from '../utcTime';

/**
 * The demo sizes the demo entry offers, smallest first, with what each one is like. The numbers restate the
 * profiles of `@gcportrait/demo-data` (its README, "Sizes"); labels.test.ts generates every size and fails when
 * they drift.
 */
export const DEMO_SIZE_INFO: ReadonlyArray<{
  readonly size: DemoSize;
  readonly name: string;
  /** Roughly how many assets the organisation has. */
  readonly assets: number;
  /** Business-unit folders under Workloads. */
  readonly businessUnits: number;
  readonly note?: string;
}> = [
  { size: 'S', name: 'small', assets: 100, businessUnits: 1 },
  { size: 'M', name: 'medium', assets: 1_000, businessUnits: 3 },
  { size: 'L', name: 'large', assets: 6_000, businessUnits: 10 },
  {
    size: 'XL',
    name: 'extra large',
    assets: 50_000,
    businessUnits: 30,
    note: 'it takes a while to generate and store',
  },
];

/** "Demo organisation XL (extra large)": the name the Snapshot menu gives S, M and L (DEMO_CHOICES), for every size. */
export function demoLabel(size: DemoSize): string {
  const listed = DEMO_CHOICES.find((choice) => choice.size === size);
  if (listed !== undefined) return listed.label;
  const info = DEMO_SIZE_INFO.find((entry) => entry.size === size);
  return `Demo organisation ${size}${info === undefined ? '' : ` (${info.name})`}`;
}

/** "about 1,000 assets, 3 business units": what demo organisation `size` is like. */
export function demoAbout(size: DemoSize): string {
  const info = DEMO_SIZE_INFO.find((entry) => entry.size === size);
  if (info === undefined) return '';
  const units = `${formatCount(info.businessUnits)} business ${info.businessUnits === 1 ? 'unit' : 'units'}`;
  return `about ${formatCount(info.assets)} assets, ${units}${info.note === undefined ? '' : `; ${info.note}`}`;
}

const SCOPE_KINDS: Readonly<Record<SnapshotMeta['scope']['kind'], string>> = {
  organization: 'Organisation',
  folder: 'Folder',
  project: 'Project',
};

/** The scope's name ("example.com"), or its kind and id when it has none ("Organisation 123"). */
export function scopeName(scope: SnapshotMeta['scope']): string {
  return scope.displayName ?? `${SCOPE_KINDS[scope.kind]} ${scope.id}`;
}

/** "Organisation 30000000001": the scope's kind and id. */
export function scopeKindAndId(scope: SnapshotMeta['scope']): string {
  return `${SCOPE_KINDS[scope.kind]} ${scope.id}`;
}

const SOURCES: Readonly<Record<SnapshotMeta['source'], string>> = {
  demo: 'Demo',
  export: 'Export file',
  api: 'API pull',
};

export function sourceLabel(source: SnapshotMeta['source']): string {
  return SOURCES[source];
}

/** "2026-10-08 00:00 UTC": a timestamp to the minute, at UTC, so every viewer reads the same time. */
export function formatUtc(timestamp: string): string {
  const instant = Date.parse(timestamp);
  if (Number.isNaN(instant)) return timestamp;
  return formatUtcMinute(instant);
}

/** "1.2 MB": bytes in decimal units (1 kB = 1000 bytes, as `pnpm size` counts). */
export function formatBytes(bytes: number): string {
  const units = ['bytes', 'kB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit] ?? ''}`;
}

/** "1,234": a count with thousands separators. */
export function formatCount(count: number): string {
  return count.toLocaleString('en');
}

/** "1 asset" or "1,234 assets": the count, then `one` when it is exactly 1 and `many` otherwise. */
export function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

/** The longest source detail a label repeats (an export of many files lists them all in its detail). */
const LABEL_DETAIL_LENGTH = 60;

function shortDetail(detail: string): string {
  return detail.length <= LABEL_DETAIL_LENGTH ? detail : `${detail.slice(0, LABEL_DETAIL_LENGTH - 1)}…`;
}

/**
 * A stored snapshot's name: "example.com, read 2026-10-08 00:00 UTC, demo:M", with the source detail (the demo
 * size or the file names), so the demo organisations, which share their scope and read time, read differently.
 */
export function snapshotLabel(meta: Pick<SnapshotMeta, 'scope' | 'readTime' | 'detail'>): string {
  const name = `${scopeName(meta.scope)}, read ${formatUtc(meta.readTime)}`;
  return meta.detail === undefined || meta.detail === '' ? name : `${name}, ${shortDetail(meta.detail)}`;
}

/** The ids whose labels another id shares, grouped by label, in the given order. */
function shared(labels: ReadonlyMap<string, string>): string[][] {
  const groups = new Map<string, string[]>();
  for (const [id, label] of labels) groups.set(label, [...(groups.get(label) ?? []), id]);
  return [...groups.values()].filter((ids) => ids.length > 1);
}

/** A stored record's name among the others. */
export interface RecordName {
  /** Its label, no two alike (`distinctNames`). */
  readonly label: string;
  /** Its number among copies of one file stored in the same minute, the first stored 1; the table shows it. */
  readonly copy?: number;
}

/**
 * Every record's name, told apart: `snapshotLabel`, and for records that share it (copies of one file) also when
 * each was stored ("…, stored 2026-10-10 12:00 UTC"), then, if that is shared too, its number among them in the
 * order they were stored ("copy 2"). The table's buttons and the Snapshot menu use these labels, so no two of them
 * have the same accessible name, and the table shows the copy number, so no two rows look the same either.
 */
export function distinctNames(
  records: ReadonlyArray<{ readonly id: string; readonly meta: SnapshotMeta }>,
): ReadonlyMap<string, RecordName> {
  const labels = new Map(records.map((record) => [record.id, snapshotLabel(record.meta)]));
  const savedAt = new Map(records.map((record) => [record.id, record.meta.savedAt]));
  for (const ids of shared(labels))
    for (const id of ids)
      labels.set(id, `${labels.get(id) ?? ''}, stored ${formatUtc(savedAt.get(id) ?? '')}`);
  const copies = new Map<string, number>();
  for (const ids of shared(labels)) {
    const stored = [...ids].sort(
      (a, b) => (savedAt.get(a) ?? '').localeCompare(savedAt.get(b) ?? '') || a.localeCompare(b),
    );
    stored.forEach((id, index) => {
      copies.set(id, index + 1);
      labels.set(id, `${labels.get(id) ?? ''}, copy ${String(index + 1)}`);
    });
  }
  return new Map(
    [...labels].map(([id, label]) => {
      const copy = copies.get(id);
      return [id, copy === undefined ? { label } : { label, copy }];
    }),
  );
}

/** The labels of `distinctNames` alone (the Snapshot menu's entries). */
export function distinctLabels(
  records: ReadonlyArray<{ readonly id: string; readonly meta: SnapshotMeta }>,
): ReadonlyMap<string, string> {
  return new Map([...distinctNames(records)].map(([id, { label }]) => [id, label]));
}
