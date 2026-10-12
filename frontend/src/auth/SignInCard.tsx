// SPDX-License-Identifier: MIT
/**
 * The action area of the Connect page's "Your Google Cloud environment" card: "Sign in with Google" when
 * the backend names an OAuth client, the signed-in account with "Sign out", or "Sign in again" after an expiry.
 * Before sign-in it says what Google will ask (ADR 0028 §6) and who runs this instance (`hostedBy`, ADR 0018).
 * Without a backend or an OAuth client the button stays in place, inert, with the reason. While Google's window is
 * open the button still works: a press brings the window back (session.ts), for one lost behind others.
 */
import { useEffect, useId, useRef, type ReactElement } from 'react';

import actions from '../snapshots/Snapshots.module.css';
import { useAppState } from '../state';
import { inertProps } from '../ui/dom';
import styles from './Auth.module.css';
import { useAuth } from './context';
import { accountName, CONSENT_NOTE, hostedByLine } from './labels';

export const SIGN_IN_ACTION = 'Sign in with Google';

const BUSY_NOTE = 'Waiting for Google’s sign-in window… If you cannot find it, press the button again.';

export function SignInCard(): ReactElement {
  const backend = useAppState((state) => state.connect.backend);
  const session = useAppState((state) => state.connect.session);
  const auth = useAuth();
  const noteId = useId();
  const signInRef = useRef<HTMLButtonElement>(null);
  // "Sign out" goes away with the signed-in state: focus moves on to "Sign in with Google" that replaces it.
  const focusAfterSignOut = useRef(false);
  const config = backend.status === 'ready' ? backend.config : null;
  const hostedBy = hostedByLine(config);

  useEffect(() => {
    if (!focusAfterSignOut.current || session.status === 'signed-in') return;
    focusAfterSignOut.current = false;
    signInRef.current?.focus();
  }, [session.status]);

  if (session.status === 'unavailable') {
    const reason =
      backend.status === 'loading'
        ? 'Checking whether this instance offers Google sign-in…'
        : backend.status === 'unavailable'
          ? 'Sign-in needs the backend, which did not answer.'
          : 'Google sign-in is not configured on this instance.';
    return (
      <div className={styles.row}>
        <button type="button" className={actions.primary} {...inertProps(reason)} aria-describedby={noteId}>
          {SIGN_IN_ACTION}
        </button>
        <span id={noteId} className={styles.note}>
          {reason}
        </span>
      </div>
    );
  }

  if (session.status === 'signed-in') {
    return (
      <div className={styles.stack}>
        <p>
          Signed in as <span className={styles.accountName}>{accountName(session.account)}</span>.
        </p>
        <div className={styles.row}>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => {
              focusAfterSignOut.current = true;
              auth.signOut();
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const busy = session.status === 'signing-in';
  const expired = session.status === 'expired' || (busy && session.account !== null);
  return (
    <div className={styles.stack}>
      {expired ? (
        <p>
          Your Google sign-in as <span className={styles.accountName}>{accountName(session.account)}</span>{' '}
          ended. Sign in again to keep reading your environment; snapshots in this browser stay available.
        </p>
      ) : null}
      <p id={noteId} className={styles.note}>
        {CONSENT_NOTE}
      </p>
      <div className={styles.row}>
        <button
          ref={signInRef}
          type="button"
          className={actions.primary}
          aria-describedby={noteId}
          onClick={auth.signIn}
        >
          {expired ? 'Sign in again' : SIGN_IN_ACTION}
        </button>
      </div>
      <p role="status" className={styles.note}>
        {busy ? BUSY_NOTE : (session.notice ?? '')}
      </p>
      {session.problem === null ? null : (
        <div role="alert" className={actions.alert}>
          <p className={actions.alertTitle}>Not signed in</p>
          <p>{session.problem.message}</p>
        </div>
      )}
      {hostedBy === null ? null : <p className={styles.note}>{hostedBy}</p>}
    </div>
  );
}
