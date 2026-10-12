// SPDX-License-Identifier: MIT
/**
 * The stored snapshots as a table: scope, read time, source, asset count, size and when
 * it was stored, with three actions per row: Load (the snapshot's ref into the hash, on the diagram page:
 * `actions.setSnapshot`), Export (the `.gcportrait.json` file, bundle.ts, once the snapshot worker has read the
 * record in full; a progress line meanwhile) and Delete (after a confirmation dialog). Each action's accessible name
 * starts with its visible word and adds the row's label ("Load example.com, read 2026-10-08 00:00 UTC, demo:M";
 * labels.ts `distinctNames`, which also tells copies of one file apart), so no two buttons share a name; copies
 * stored in the same minute also show their number under the stored time, so no two rows look alike.
 */
import { useMemo, useRef, useState, type ReactElement, type RefObject } from 'react';
import { flushSync } from 'react-dom';

import { cx } from '../classNames';
import { saveFile } from '../export/deliver';
import { useDiagramActions } from '../state';
import type { StoredSnapshot } from '../storage/db';
import controls from '../ui/controls.module.css';
import { Dialog } from '../ui/Dialog';
import { JobStatus, type JobState } from './JobStatus';
import {
  distinctNames,
  formatBytes,
  formatCount,
  formatUtc,
  scopeKindAndId,
  scopeName,
  sourceLabel,
} from './labels';
import type { ListedSnapshot } from './repository';
import { refOf } from './library';
import { useSnapshotLibrary } from './SnapshotLibraryProvider';
import styles from './Snapshots.module.css';
import { SnapshotJobError } from './worker/client';

function sourceDetail(record: StoredSnapshot): string {
  const parts: string[] = [];
  if (record.meta.detail !== undefined) parts.push(record.meta.detail);
  if (record.meta.historyTicks !== undefined) parts.push(`${String(record.meta.historyTicks)}-day history`);
  return parts.join(' · ');
}

export function SnapshotTable({
  snapshots,
  headingRef,
}: {
  readonly snapshots: readonly ListedSnapshot[];
  /** The section heading, where focus goes when the row it was on is deleted. */
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
}): ReactElement {
  const library = useSnapshotLibrary();
  const { setSnapshot } = useDiagramActions();
  const [confirm, setConfirm] = useState<StoredSnapshot | null>(null);
  const [state, setState] = useState<JobState>({ kind: 'idle' });
  const [subject, setSubject] = useState('the snapshot');
  const working = useRef(false);
  const exporting = useRef(false);
  const names = useMemo(() => distinctNames(snapshots.map(({ record }) => record)), [snapshots]);
  const labelOf = (record: StoredSnapshot): string => names.get(record.id)?.label ?? record.id;

  const fail = (title: string, error: unknown): void => {
    setState({
      kind: 'failed',
      title,
      message: error instanceof Error ? error.message : String(error),
      problems: error instanceof SnapshotJobError ? error.problems : [],
    });
  };

  const exportRecord = (record: StoredSnapshot): void => {
    if (exporting.current) return;
    exporting.current = true;
    const label = labelOf(record);
    setSubject(label);
    setState({ kind: 'busy', progress: null });
    library
      .exportFile(record.id, (progress) => {
        setState({ kind: 'busy', progress });
      })
      .then(
        ({ blob, fileName }) => {
          exporting.current = false;
          saveFile(blob, fileName);
          setState({ kind: 'idle', message: `Exported ${label} as ${fileName}.` });
        },
        (error: unknown) => {
          exporting.current = false;
          fail('The snapshot could not be exported.', error);
        },
      );
  };

  const remove = (record: StoredSnapshot): void => {
    if (working.current) return;
    working.current = true;
    const label = labelOf(record);
    library.remove(record.id).then(
      () => {
        working.current = false;
        flushSync(() => {
          setConfirm(null);
        });
        headingRef.current?.focus();
        setState({ kind: 'idle', message: `Deleted ${label}.` });
      },
      (error: unknown) => {
        working.current = false;
        setConfirm(null);
        fail('The snapshot could not be deleted.', error);
      },
    );
  };

  return (
    <div className={styles.stack}>
      {snapshots.length === 0 ? (
        <p className={styles.note}>
          No snapshots are stored in this browser yet. Try the demo on the Connect page, or import a file
          below.
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className="visually-hidden">Snapshots stored in this browser</caption>
            <thead>
              <tr>
                <th scope="col">Scope</th>
                <th scope="col">Read</th>
                <th scope="col">Source</th>
                <th scope="col" className={styles.number}>
                  Assets
                </th>
                <th scope="col" className={styles.number}>
                  Size
                </th>
                <th scope="col">Stored</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map(({ record, persisted }) => {
                const label = labelOf(record);
                const copy = names.get(record.id)?.copy;
                const { scope } = record.meta;
                return (
                  <tr key={record.id} data-snapshot={record.id}>
                    <th scope="row">
                      {scopeName(scope)}
                      {scope.displayName === undefined ? null : (
                        <span className={styles.sub}>{scopeKindAndId(scope)}</span>
                      )}
                    </th>
                    <td className={styles.nowrap}>
                      <time dateTime={record.meta.readTime}>{formatUtc(record.meta.readTime)}</time>
                      {record.meta.estimatedReadTime === true ||
                      record.meta.readTimeSource === 'estimated-max-update-time' ? (
                        <span className={styles.sub}>estimated from the latest change</span>
                      ) : record.meta.readTimeSource === 'user' ? (
                        <span className={styles.sub}>entered when it was imported</span>
                      ) : null}
                    </td>
                    <td>
                      {sourceLabel(record.meta.source)}
                      <span className={styles.sub}>{sourceDetail(record)}</span>
                    </td>
                    <td className={styles.number}>{formatCount(record.meta.assetCount)}</td>
                    <td className={styles.number}>
                      {formatBytes(record.meta.bytes)}
                      {persisted ? null : <span className={styles.sub}>in memory</span>}
                    </td>
                    <td className={styles.nowrap}>
                      <time dateTime={record.meta.savedAt}>{formatUtc(record.meta.savedAt)}</time>
                      {copy === undefined ? null : <span className={styles.sub}>copy {String(copy)}</span>}
                    </td>
                    <td>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={controls.control}
                          aria-label={`Load ${label}`}
                          onClick={() => {
                            const ref = refOf(record.id);
                            if (ref !== null) setSnapshot(ref);
                          }}
                        >
                          Load
                        </button>
                        <button
                          type="button"
                          className={controls.control}
                          aria-label={`Export ${label}`}
                          onClick={() => {
                            exportRecord(record);
                          }}
                        >
                          Export
                        </button>
                        <button
                          type="button"
                          className={cx(controls.control, styles.danger)}
                          aria-haspopup="dialog"
                          aria-label={`Delete ${label}`}
                          onClick={() => {
                            setConfirm(record);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <JobStatus state={state} subject={subject} label="Working on the snapshot" />
      {confirm === null ? null : (
        <Dialog
          open
          title="Delete this snapshot?"
          description={
            `${labelOf(confirm)}, ${formatCount(confirm.meta.assetCount)} assets. It is removed from ` +
            'this browser; files you exported keep it.'
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
                className={cx(controls.control, styles.danger)}
                onClick={() => {
                  remove(confirm);
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
