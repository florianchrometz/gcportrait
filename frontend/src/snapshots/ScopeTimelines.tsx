// SPDX-License-Identifier: MIT
/**
 * The Snapshots page's "Timelines by scope" (docs/timeline.md): for each scope this browser keeps something
 * of, its timeline as stored here, in time order (scopeEntries.ts): its snapshots with a history, its exports and
 * manual pulls (the extra ticks of the scope's timeline, timeline/extraTicks.ts) and the days its timeline read from
 * Cloud Asset Inventory and cached (storage/tickCache.ts), each with its asset count and size, and what they take
 * together: a table per scope, a card per entry on a phone (RowTable.tsx). An extra tick is deleted after a
 * confirmation (it is a stored snapshot: files exported keep it), a cached day at once (the timeline reads it again
 * when the view comes back to it), and "Delete the cached days…" deletes a whole scope's cache after a confirmation.
 * Focus goes to the scope's heading after a delete (to the section's when the scope is gone), and a polite status says
 * what was deleted.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react';
import { flushSync } from 'react-dom';

import { cx } from '../classNames';
import { useDatabaseConnection } from '../storage/connection';
import type { StoredSnapshot, StoredTick } from '../storage/db';
import { createTickCacheStore } from '../storage/tickCache';
import { READ_TIME_SOURCE_WORDS, readTimeSourceOf } from '../timeline/extraTicks';
import controls from '../ui/controls.module.css';
import { Dialog } from '../ui/Dialog';
import { JobStatus, type JobState } from './JobStatus';
import { distinctNames, formatBytes, formatCount, formatUtc, sourceLabel } from './labels';
import type { ListedSnapshot } from './repository';
import { RowTable, type RowColumn, type RowData } from './RowTable';
import { scopeTimelines, type ScopeEntry, type ScopeTimeline } from './scopeEntries';
import { useSnapshotLibrary } from './SnapshotLibraryProvider';
import styles from './Snapshots.module.css';

function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

/** "1 snapshot, 2 extra ticks and 5 cached days: 1.7 MB in this browser." */
export function scopeSummary(timeline: ScopeTimeline): string {
  const count = (kind: ScopeEntry['kind']): number =>
    timeline.entries.filter((entry) => entry.kind === kind).length;
  const parts = [
    count('snapshot') === 0 ? '' : plural(count('snapshot'), 'snapshot', 'snapshots'),
    count('extra') === 0 ? '' : plural(count('extra'), 'extra tick', 'extra ticks'),
    count('day') === 0 ? '' : plural(count('day'), 'cached day', 'cached days'),
  ].filter(Boolean);
  const listed =
    parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;
  const { snapshots, extras, days } = timeline.bytes;
  return `${listed}: ${formatBytes(snapshots + extras + days)} in this browser.`;
}

/** What a snapshot row is: "Snapshot · Demo · 35-day history", "Extra tick · Export file". */
function snapshotWhat(record: StoredSnapshot, extra: boolean): string {
  const history =
    record.meta.historyTicks === undefined ? '' : ` · ${String(record.meta.historyTicks)}-day history`;
  return `${extra ? 'Extra tick' : 'Snapshot'} · ${sourceLabel(record.meta.source)}${history}`;
}

/** The note under an extra tick: where its read time came from, its detail, and copies read in the same second. */
function extraNote(record: StoredSnapshot, shared: number): string {
  const parts = [READ_TIME_SOURCE_WORDS[readTimeSourceOf(record.meta)]];
  if (record.meta.detail !== undefined) parts.push(record.meta.detail);
  if (shared > 0)
    parts.push(
      `read in the same second as ${plural(shared, 'other snapshot', 'other snapshots')}: one tick, the copy stored last`,
    );
  return parts.join(' · ');
}

/** The cached day's own words: its day, and when a latest day was read at "now". */
function dayRead(tick: StoredTick): string {
  return tick.now ? formatUtc(tick.actualReadTime) : formatUtc(tick.readTime);
}

/** Under a read time: "estimated" (the latest asset change: docs/timeline.md) or "entered" (typed in at the import). */
export function ReadTimeNote({ meta }: { readonly meta: StoredSnapshot['meta'] }): ReactElement | null {
  const source = readTimeSourceOf(meta);
  if (source === 'estimated') return <span className={styles.sub}>estimated</span>;
  if (source === 'user') return <span className={styles.sub}>entered</span>;
  return null;
}

/**
 * A scope's timeline's columns: when it was read (a cached day by its day, or the time a latest day was read at
 * "now"), what it is, its asset count and its size (a snapshot kept in memory marked).
 */
const TIMELINE_COLUMNS: readonly RowColumn<ScopeEntry>[] = [
  {
    header: 'Read',
    nowrap: true,
    cell: (entry) => {
      if (entry.kind === 'day') {
        const { tick } = entry;
        return <time dateTime={tick.now ? tick.actualReadTime : tick.readTime}>{dayRead(tick)}</time>;
      }
      const { meta } = entry.listed.record;
      return (
        <>
          <time dateTime={meta.readTime}>{formatUtc(meta.readTime)}</time>
          <ReadTimeNote meta={meta} />
        </>
      );
    },
  },
  {
    header: 'What',
    cell: (entry) => {
      if (entry.kind === 'day')
        return (
          <>
            Cached day
            <span className={styles.sub}>
              read from Cloud Asset Inventory on{' '}
              <time dateTime={entry.tick.fetchedAt} className={styles.nowrap}>
                {formatUtc(entry.tick.fetchedAt)}
              </time>
            </span>
          </>
        );
      const { record } = entry.listed;
      return (
        <>
          {snapshotWhat(record, entry.kind === 'extra')}
          <span className={styles.sub}>
            {entry.kind === 'extra'
              ? extraNote(record, entry.shared)
              : (record.meta.detail ?? 'its days are replayed on its timeline')}
          </span>
        </>
      );
    },
  },
  {
    header: 'Assets',
    numeric: true,
    cell: (entry) =>
      formatCount(entry.kind === 'day' ? entry.tick.assetCount : entry.listed.record.meta.assetCount),
  },
  {
    header: 'Size',
    numeric: true,
    cell: (entry) =>
      entry.kind === 'day' ? (
        formatBytes(entry.tick.bytes)
      ) : (
        <>
          {formatBytes(entry.listed.record.meta.bytes)}
          {entry.listed.persisted ? null : <span className={styles.sub}>in memory</span>}
        </>
      ),
  },
];

function entryKey(entry: ScopeEntry): string {
  return entry.kind === 'day' ? entry.tick.key : entry.listed.record.id;
}

function entryData(entry: ScopeEntry): RowData {
  return entry.kind === 'day'
    ? { 'data-entry': 'day', 'data-day': entry.tick.day }
    : { 'data-entry': entry.kind, 'data-snapshot': entry.listed.record.id };
}

type Confirm =
  | { readonly kind: 'extra'; readonly scope: ScopeTimeline; readonly record: StoredSnapshot }
  | { readonly kind: 'scope'; readonly scope: ScopeTimeline };

export function ScopeTimelines({
  snapshots,
  headingRef,
}: {
  readonly snapshots: readonly ListedSnapshot[];
  /** The section heading, where focus goes when the scope it was in is gone. */
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
}): ReactElement {
  const library = useSnapshotLibrary();
  const { database } = useDatabaseConnection();
  const cache = useMemo(() => createTickCacheStore(database), [database]);
  const [ticks, setTicks] = useState<readonly StoredTick[] | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [state, setState] = useState<JobState>({ kind: 'idle' });
  const working = useRef(false);
  const live = useRef(true);
  const scopeHeadings = useRef(new Map<string, HTMLHeadingElement>());

  const reload = useCallback((): Promise<void> => {
    return cache.list().then((records) => {
      if (live.current) setTicks(records);
    });
  }, [cache]);

  useEffect(() => {
    live.current = true;
    void reload();
    return () => {
      live.current = false;
    };
  }, [reload, snapshots]);

  const timelines = useMemo(() => scopeTimelines(snapshots, ticks ?? []), [snapshots, ticks]);
  const names = useMemo(() => distinctNames(snapshots.map(({ record }) => record)), [snapshots]);
  const labelOf = (record: StoredSnapshot): string => names.get(record.id)?.label ?? record.id;

  /**
   * After a delete: focus the scope's heading while the scope keeps something (`left` entries), else the section's
   * (the scope's part is gone with its last entry); say what was done.
   */
  const done = (scope: ScopeTimeline, left: number, message: string): void => {
    working.current = false;
    flushSync(() => {
      setConfirm(null);
    });
    const heading = left > 0 ? scopeHeadings.current.get(scope.scopePath) : undefined;
    (heading ?? headingRef.current)?.focus();
    setState({ kind: 'idle', message });
  };

  const failed = (title: string, error: unknown): void => {
    working.current = false;
    setConfirm(null);
    setState({
      kind: 'failed',
      title,
      message: error instanceof Error ? error.message : String(error),
      problems: [],
    });
  };

  const deleteExtra = (scope: ScopeTimeline, record: StoredSnapshot): void => {
    if (working.current) return;
    working.current = true;
    const label = labelOf(record);
    library.remove(record.id).then(
      () => {
        done(scope, scope.entries.length - 1, `Deleted the extra tick ${label}.`);
      },
      (error: unknown) => {
        failed('The extra tick could not be deleted.', error);
      },
    );
  };

  const deleteDay = (scope: ScopeTimeline, tick: StoredTick): void => {
    if (working.current) return;
    working.current = true;
    cache
      .remove(tick.key)
      .then(reload)
      .then(
        () => {
          done(scope, scope.entries.length - 1, `Deleted the cached day ${tick.day} of ${scope.name}.`);
        },
        (error: unknown) => {
          failed('The cached day could not be deleted.', error);
        },
      );
  };

  const deleteScope = (scope: ScopeTimeline): void => {
    if (working.current) return;
    working.current = true;
    cache
      .removeScope(scope.scopePath)
      .then(async (count) => {
        await reload();
        return count;
      })
      .then(
        (count) => {
          done(
            scope,
            scope.entries.length - scope.days.length,
            `Deleted ${plural(count, 'cached day', 'cached days')} of ${scope.name}.`,
          );
        },
        (error: unknown) => {
          failed('The cached days could not be deleted.', error);
        },
      );
  };

  if (ticks === null) return <p className={styles.note}>Reading what this browser keeps of each scope…</p>;

  return (
    <div className={styles.stack}>
      {timelines.length === 0 ? (
        <p className={styles.note}>Nothing is kept in this browser yet.</p>
      ) : (
        timelines.map((scope) => {
          const headingId = `scope-timeline-${scope.scopePath.replace(/[^a-z0-9]/gi, '-')}`;
          const named = `${scope.name}${scope.name === scope.kindAndId ? '' : ` (${scope.kindAndId})`}`;
          return (
            <section
              key={scope.scopePath}
              className={styles.scope}
              aria-labelledby={headingId}
              data-scope={scope.scopePath}
            >
              <h3
                id={headingId}
                tabIndex={-1}
                className={styles.scopeTitle}
                ref={(element) => {
                  if (element === null) scopeHeadings.current.delete(scope.scopePath);
                  else scopeHeadings.current.set(scope.scopePath, element);
                }}
              >
                {scope.name}
                {scope.name === scope.kindAndId ? null : (
                  <span className={styles.sub}>{scope.kindAndId}</span>
                )}
              </h3>
              <p className={styles.note}>{scopeSummary(scope)}</p>
              <RowTable
                caption={`Timeline of ${named} kept in this browser`}
                columns={TIMELINE_COLUMNS}
                rows={scope.entries}
                keyOf={entryKey}
                dataOf={entryData}
                actions={(entry) => {
                  if (entry.kind === 'day') {
                    const { tick } = entry;
                    return (
                      <button
                        type="button"
                        className={cx(controls.control, controls.danger)}
                        aria-label={`Delete the cached day ${tick.day} of ${named}`}
                        onClick={() => {
                          deleteDay(scope, tick);
                        }}
                      >
                        Delete
                      </button>
                    );
                  }
                  if (entry.kind !== 'extra') return null;
                  const { record } = entry.listed;
                  return (
                    <button
                      type="button"
                      className={cx(controls.control, controls.danger)}
                      aria-haspopup="dialog"
                      aria-label={`Delete the extra tick ${labelOf(record)}`}
                      onClick={() => {
                        setConfirm({ kind: 'extra', scope, record });
                      }}
                    >
                      Delete
                    </button>
                  );
                }}
              />
              {scope.days.length === 0 ? null : (
                <div className={styles.row}>
                  <button
                    type="button"
                    className={cx(controls.control, controls.danger, styles.wraps)}
                    aria-haspopup="dialog"
                    onClick={() => {
                      setConfirm({ kind: 'scope', scope });
                    }}
                  >
                    Delete the cached days of {named}…
                  </button>
                </div>
              )}
            </section>
          );
        })
      )}
      <JobStatus state={state} subject="the timeline" label="Deleting from the timeline" />
      {confirm === null ? null : (
        <Dialog
          open
          title={confirm.kind === 'extra' ? 'Delete this extra tick?' : 'Delete the cached days?'}
          description={
            confirm.kind === 'extra'
              ? `${labelOf(confirm.record)}, ${formatCount(confirm.record.meta.assetCount)} assets. It is removed ` +
                'from this browser and from the timeline of its scope; files you exported keep it.'
              : `${plural(confirm.scope.days.length, 'day', 'days')} of ${confirm.scope.name} read from Cloud Asset ` +
                `Inventory (${formatBytes(confirm.scope.bytes.days)}) are removed from this browser. The timeline ` +
                'reads a day again when you go back to it.'
          }
          onClose={() => {
            setConfirm(null);
          }}
          actions={
            <>
              <button
                type="button"
                className={controls.control}
                onClick={() => {
                  setConfirm(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className={cx(controls.control, controls.danger)}
                onClick={() => {
                  if (confirm.kind === 'extra') deleteExtra(confirm.scope, confirm.record);
                  else deleteScope(confirm.scope);
                }}
              >
                Delete
              </button>
            </>
          }
        />
      )}
    </div>
  );
}
