// SPDX-License-Identifier: MIT
/**
 * The Connect page's mode selector: read with the person's own account (user mode, the default) or, when the
 * backend offers it, through this instance's service account, with the gate explained (agents.md, Security
 * and privacy, The service-account gate). The choice is the store's `connect.mode`; the scope picker,
 * the preflight and "Pull now" read it from there.
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { useAppState, useAppStore } from '../state';
import { SegmentedControl, type SegmentedOption } from '../ui/SegmentedControl';
import styles from './Auth.module.css';
import type { AccessMode } from './types';

const MODE_OPTIONS: readonly SegmentedOption<AccessMode>[] = [
  { value: 'user', label: 'Your account' },
  { value: 'sa', label: 'Service account' },
];

const USER_MODE_NOTE =
  'Your own Google account: gcportrait reads what your roles allow, and the requests count against a quota ' +
  'project of yours.';

export function ModeSelector({ disabled }: { readonly disabled?: string | undefined }): ReactElement {
  const store = useAppStore();
  const backend = useAppState((state) => state.connect.backend);
  const mode = useAppState((state) => state.connect.mode);
  const config = backend.status === 'ready' ? backend.config : null;

  if (config === null || !config.saMode) {
    return (
      <div className={styles.field}>
        <p className={styles.fieldLabel}>Read with</p>
        <p className={styles.note}>{USER_MODE_NOTE} This instance does not offer service-account mode.</p>
      </div>
    );
  }

  const account = config.backendServiceAccount;
  return (
    <div className={styles.field}>
      <SegmentedControl
        label="Read with"
        options={MODE_OPTIONS}
        value={mode}
        disabled={disabled}
        onChange={(next) => {
          store.updateConnect((connect) => (connect.mode === next ? connect : { ...connect, mode: next }));
        }}
      />
      {mode === 'user' ? (
        <p className={styles.note}>{USER_MODE_NOTE}</p>
      ) : (
        <div className={styles.stack}>
          <p className={styles.note}>
            The scope is read by this instance’s service account
            {account === null ? null : (
              <>
                {' '}
                <span className={styles.code}>{account}</span>
              </>
            )}
            , not by a person’s account, and the requests count against this instance’s project. You must
            still be able to see the scope yourself: before every read the backend checks that with your own
            sign-in
            {config.saStrictExposure === true
              ? ', and it refuses a scope whose details the service account can see on its own.'
              : '.'}
          </p>
          <p className={styles.note}>
            Anyone who can see a scope and sign in here can read its whole inventory through this account.
            Grant it <span className={styles.code}>roles/cloudasset.viewer</span> only, preferably on folders
            or projects rather than the whole organisation.{' '}
            <Link to="/permissions">How service-account mode works</Link>
          </p>
        </div>
      )}
    </div>
  );
}
