// SPDX-License-Identifier: MIT
/**
 * "Pull now" on the Connect page (skill cai-ingestion §1): reads the scope picked, in the mode chosen, from Cloud
 * Asset Inventory through the backend's stream, into a snapshot stored in this browser (source `api`, read time as
 * Google reported it), then opens the diagram on it. Inert, with the reason, until the permission check says the
 * scope is ready (target.ts). Progress, Cancel and actionable errors below the button (ImportStatus.tsx).
 */
import { useId, type ReactElement } from 'react';
import { Link } from 'react-router';

import { scopeName } from '../snapshots/labels';
import { useAppState } from '../state';
import { inertProps } from '../ui/dom';
import styles from './Import.module.css';
import { ImportStatus } from './ImportStatus';
import { runLivePull } from './run';
import { pullTargetOf } from './target';
import { useImportJob } from './useImportJob';

export const PULL_ACTION = 'Pull now';

export function PullNow(): ReactElement {
  const connect = useAppState((state) => state.connect);
  const readiness = pullTargetOf(connect);
  const job = useImportJob();
  const hintId = useId();
  const target = 'target' in readiness ? readiness.target : null;
  const blocked = job.running ? 'A pull is running' : 'blocked' in readiness ? readiness.blocked : undefined;

  const pull = (): void => {
    if (target === null || job.running) return;
    job.start((dependencies, dispatch, signal) => runLivePull(dependencies, target, dispatch, signal));
  };

  return (
    <div className={styles.stack}>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.primary}
          aria-describedby={hintId}
          {...inertProps(blocked)}
          onClick={pull}
        >
          {PULL_ACTION}
        </button>
        <span id={hintId} className={styles.note}>
          {target === null
            ? `${blocked ?? ''}.`
            : `Reads ${scopeName(target.scope)} ${target.mode === 'sa' ? 'with the service account' : 'with your account'}` +
              `${target.quotaProject === undefined ? '' : `; requests use the quota of ${target.quotaProject}`}. ` +
              'The diagram shows the inventory as of the pull.'}
        </span>
        {'check' in readiness && !job.running ? <Link to="/permissions">Check permissions</Link> : null}
      </div>
      <ImportStatus
        progress={job.progress}
        label="Pulling from Cloud Asset Inventory"
        notes={job.notes}
        onCancel={job.cancel}
        onRetry={pull}
        onOpen={job.openResult}
      />
    </div>
  );
}
