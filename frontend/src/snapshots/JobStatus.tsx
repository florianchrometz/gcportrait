// SPDX-License-Identifier: MIT
/**
 * What a snapshot job is doing, for the person: a polite live region with the stage (always in the DOM, so a
 * screen reader hears every change), a progress bar while the job runs (with its share of the bytes when files
 * are read), and an alert with the problems when it failed.
 */
import type { ReactElement } from 'react';

import { formatBytes, formatCount } from './labels';
import styles from './Snapshots.module.css';
import type { JobProgress } from './worker/protocol';

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
}: {
  readonly state: JobState;
  readonly subject: string;
  /** The progress bar's accessible name ("Preparing the demo"). */
  readonly label: string;
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
