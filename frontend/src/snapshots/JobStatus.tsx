// SPDX-License-Identifier: Apache-2.0
/**
 * What a snapshot job is doing, for the person: a polite live region with the stage (always in the DOM, so a
 * screen reader hears every change), a progress bar while the job runs (with its share of the bytes when files
 * are read) and, under it, Cancel for a job that can be stopped (a file import), and an alert with the problems
 * when it failed. Cancel is a `controls.control`, as tall as a touch target on a phone and a tablet.
 */
import type { ReactElement } from 'react';

import controls from '../ui/controls.module.css';
import { formatBytes, formatCount } from './labels';
import styles from './Snapshots.module.css';
import type { JobProgress } from './worker/protocol';

/** What a job says once the person cancelled it (as a live pull's Cancel says, import/progress.ts). */
export const CANCELLED_MESSAGE = 'Cancelled. Nothing was stored.';

/** The accessible name of a job's Cancel: "Cancel" and what the progress bar names ("Cancel importing the export"). */
function cancelName(label: string): string {
  return `Cancel ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

export type JobState =
  | { readonly kind: 'idle'; readonly message?: string }
  | { readonly kind: 'busy'; readonly progress: JobProgress | null }
  | {
      readonly kind: 'failed';
      readonly title: string;
      readonly message: string;
      readonly problems: readonly string[];
    };

/** The stage in words. `subject` names what is generated or read ("demo organisation M", "export.json"). */
export function stageText(progress: JobProgress | null, subject: string): string {
  if (progress === null) return `Starting with ${subject}…`;
  const assets = progress.assets === undefined ? '' : `, ${formatCount(progress.assets)} assets`;
  switch (progress.stage) {
    case 'generate':
      return `Generating ${subject} and its 35 days of history…`;
    case 'read':
      return progress.total === undefined || progress.done === undefined
        ? `Reading ${subject}${assets}…`
        : `Reading ${subject}: ${formatBytes(progress.done)} of ${formatBytes(progress.total)}${assets}…`;
    case 'check':
      return `Checking ${subject}…`;
    case 'encode':
      return 'Compressing for storage…';
    case 'store':
      return 'Storing in this browser…';
  }
}

export function JobStatus({
  state,
  subject,
  label,
  onCancel,
}: {
  readonly state: JobState;
  readonly subject: string;
  /** The progress bar's accessible name ("Preparing the demo"). */
  readonly label: string;
  /** Stops the job; given, a Cancel button sits under the progress bar while the job runs. */
  readonly onCancel?: (() => void) | undefined;
}): ReactElement {
  const progress = state.kind === 'busy' ? state.progress : null;
  const measured = progress?.total !== undefined && progress.done !== undefined && progress.total > 0;
  return (
    <div className={styles.status}>
      <p role="status" className={styles.note}>
        {state.kind === 'busy'
          ? stageText(progress, subject)
          : state.kind === 'idle'
            ? (state.message ?? '')
            : ''}
      </p>
      {state.kind === 'busy' ? (
        <progress
          className={styles.progress}
          aria-label={label}
          {...(measured
            ? { value: Math.min(progress.done ?? 0, progress.total ?? 0), max: progress.total }
            : {})}
        />
      ) : null}
      {state.kind === 'busy' && onCancel !== undefined ? (
        <div className={styles.row}>
          <button
            type="button"
            className={controls.control}
            aria-label={cancelName(label)}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      ) : null}
      {state.kind === 'failed' ? (
        <div role="alert" className={styles.alert}>
          <p className={styles.alertTitle}>{state.title}</p>
          <p>{state.message}</p>
          {state.problems.length === 0 ? null : (
            <ul className={styles.list}>
              {state.problems.map((problem, index) => (
                <li key={`${String(index)}:${problem}`}>{problem}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
