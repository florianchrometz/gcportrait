// SPDX-License-Identifier: MIT
/**
 * Storage usage: what the stored snapshots take (the sizes the table lists, summed; those kept in memory
 * apart), the browser's own estimate of what the whole site takes against what it allows
 * (`navigator.storage.estimate()`, when the browser answers; asked again a moment after every change, because the
 * estimate lags behind writes), and "Delete all snapshots" behind a confirmation dialog.
 */
import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react';
import { flushSync } from 'react-dom';

import { cx } from '../classNames';
import controls from '../ui/controls.module.css';
import { Dialog } from '../ui/Dialog';
import { inertProps } from '../ui/dom';
import { JobStatus, type JobState } from './JobStatus';
import { formatBytes, formatCount } from './labels';
import type { StorageUse } from './library';
import type { ListedSnapshot } from './repository';
import { useSnapshotLibrary } from './SnapshotLibraryProvider';
import styles from './Snapshots.module.css';

/** How long after a change the browser's estimate is asked again (it lags behind writes and deletions). */
export const ESTIMATE_AGAIN_MS = 3000;

const IN_MEMORY = 'in memory, until this page is reloaded or closed';

function counted(count: number): string {
  return `${formatCount(count)} ${count === 1 ? 'snapshot' : 'snapshots'}`;
}

/**
 * What the snapshots take, by where they are: "2 snapshots take 1.2 MB in this browser.", and those kept in memory
 * (no IndexedDB, or a demo organisation IndexedDB refused) said apart: "…; 1 more takes 0.3 MB in memory, until this
 * page is reloaded or closed."
 */
export function usageText(snapshots: readonly ListedSnapshot[], persistent: boolean): string {
  if (snapshots.length === 0)
    return `No snapshots are ${persistent ? 'stored in this browser' : 'kept in memory'}.`;
  const sum = (items: readonly ListedSnapshot[]): number =>
    items.reduce((total, { record }) => total + record.meta.bytes, 0);
  const stored = snapshots.filter(({ persisted }) => persisted);
  const kept = snapshots.filter(({ persisted }) => !persisted);
  const takes = (count: number): string => (count === 1 ? 'takes' : 'take');
  if (kept.length === 0)
    return `${counted(stored.length)} ${takes(stored.length)} ${formatBytes(sum(stored))} in this browser.`;
  if (stored.length === 0)
    return `${counted(kept.length)} ${takes(kept.length)} ${formatBytes(sum(kept))} ${IN_MEMORY}.`;
  return (
    `${counted(stored.length)} ${takes(stored.length)} ${formatBytes(sum(stored))} in this browser; ` +
    `${formatCount(kept.length)} more ${takes(kept.length)} ${formatBytes(sum(kept))} ${IN_MEMORY}.`
  );
}

export function StorageUsage({
  snapshots,
  persistent,
  headingRef,
}: {
  readonly snapshots: readonly ListedSnapshot[];
  readonly persistent: boolean;
  /** Where focus goes once everything is deleted (the button it was on is then inert). */
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
}): ReactElement {
  const library = useSnapshotLibrary();
  const [use, setUse] = useState<StorageUse | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<JobState>({ kind: 'idle' });
  const working = useRef(false);
  const total = snapshots.reduce((sum, { record }) => sum + record.meta.bytes, 0);
  const count = snapshots.length;

  useEffect(() => {
    let live = true;
    const ask = (): void => {
      void library.estimate().then((estimate) => {
        if (live) setUse(estimate);
      });
    };
    ask();
    const again = setTimeout(ask, ESTIMATE_AGAIN_MS);
    return () => {
      live = false;
      clearTimeout(again);
    };
  }, [library, snapshots]);

  const clear = (): void => {
    if (working.current) return;
    working.current = true;
    library.clear().then(
      () => {
        working.current = false;
        flushSync(() => {
          setConfirming(false);
        });
        headingRef.current?.focus();
        setState({ kind: 'idle', message: 'Deleted every snapshot stored in this browser.' });
      },
      (error: unknown) => {
        working.current = false;
        setConfirming(false);
        setState({
          kind: 'failed',
          title: 'The snapshots could not be deleted.',
          message: error instanceof Error ? error.message : String(error),
          problems: [],
        });
      },
    );
  };

  const everywhere =
    snapshots.some(({ persisted }) => persisted) && snapshots.some(({ persisted }) => !persisted);
  const where = everywhere
    ? 'kept in this browser and in memory'
    : persistent
      ? 'stored in this browser'
      : 'kept in memory';
  return (
    <div className={styles.stack}>
      <p>{usageText(snapshots, persistent)}</p>
      {use === null || !persistent ? null : (
        <p className={styles.note}>
          The browser estimates that this site uses about {formatBytes(use.usage)} in all, of the{' '}
          {formatBytes(use.quota)} it allows. Its estimate can lag behind recent changes.
        </p>
      )}
      <div className={styles.row}>
        <button
          type="button"
          className={cx(controls.control, styles.danger)}
          aria-haspopup="dialog"
          {...inertProps(count === 0 ? 'There are no snapshots to delete' : undefined)}
          onClick={() => {
            if (count > 0) setConfirming(true);
          }}
        >
          Delete all snapshots…
        </button>
      </div>
      <JobStatus state={state} subject="the snapshots" label="Deleting the snapshots" />
      {confirming ? (
        <Dialog
          open
          title="Delete all snapshots?"
          description={
            count === 1
              ? `The one snapshot ${where} (${formatBytes(total)}) is removed. Files you exported keep it.`
              : `All ${counted(count)} ${where} (${formatBytes(total)}) are removed. Files you exported keep them.`
          }
          onClose={() => {
            setConfirming(false);
          }}
          actions={
            <>
              <button
                type="button"
                className={controls.control}
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Cancel
              </button>
              <button type="button" className={cx(controls.control, styles.danger)} onClick={clear}>
                Delete all
              </button>
            </>
          }
        />
      ) : null}
    </div>
  );
}
