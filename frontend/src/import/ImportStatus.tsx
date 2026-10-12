// SPDX-License-Identifier: MIT
/**
 * A live pull's or export read's progress (the stream's progress frames, cai-ingestion skill §4): the stage in a
 * polite live region (it changes only with the stage, so a screen reader is not flooded), the counters (pages,
 * assets, bytes, elapsed) beside it, a progress bar (a share of the bytes when the export's size is known,
 * indeterminate for a pull), Cancel while it runs; then an alert with Google's message, what to do and a link to the
 * permission check, or the notes the import left with "Open the diagram".
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { formatCount } from '../snapshots/labels';
import styles from './Import.module.css';
import { progressCounters, shareRead, stageText, type ImportProgress } from './progress';

export function ImportStatus({
  progress,
  label,
  notes,
  onCancel,
  onRetry,
  onOpen,
}: {
  readonly progress: ImportProgress;
  /** The progress bar's accessible name. */
  readonly label: string;
  readonly notes: readonly string[];
  readonly onCancel: () => void;
  readonly onRetry?: (() => void) | undefined;
  readonly onOpen: () => void;
}): ReactElement {
  const { phase, failure } = progress;
  const running = phase === 'connecting' || phase === 'reading' || phase === 'storing';
  const share = shareRead(progress);
  return (
    <div className={styles.status}>
      <p role="status" className={styles.stage}>
        {stageText(progress)}
      </p>
      {running ? (
        <>
          <progress
            className={styles.bar}
            aria-label={label}
            {...(share === null ? {} : { value: Math.round(share * 1000), max: 1000 })}
          />
          <div className={styles.row}>
            <span className={styles.counters} data-testid="import-counters">
              {progressCounters(progress)}
            </span>
            <button type="button" className={styles.secondary} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      ) : null}
      {phase === 'failed' && failure !== null ? (
        <div role="alert" className={styles.alert}>
          <p className={styles.alertTitle}>{failure.title}</p>
          <p className={styles.message}>{failure.message}</p>
          {failure.advice === undefined ? null : <p>{failure.advice}</p>}
          {failure.command === undefined ? null : <code className={styles.command}>{failure.command}</code>}
          <div className={styles.row}>
            {failure.checkPermissions === true ? <Link to="/permissions">Check permissions</Link> : null}
            {failure.retryable === true && onRetry !== undefined ? (
              <button type="button" className={styles.secondary} onClick={onRetry}>
                Try again
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {phase === 'done' && notes.length > 0 ? (
        <div className={styles.notice}>
          <p>Stored {formatCount(progress.result?.assets ?? progress.assets)} assets, with notes:</p>
          <ul className={styles.list}>
            {notes.map((note, index) => (
              <li key={`${String(index)}:${note}`}>{note}</li>
            ))}
          </ul>
          <div className={styles.row}>
            <button type="button" className={styles.primary} onClick={onOpen}>
              Open the diagram
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
