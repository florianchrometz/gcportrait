// SPDX-License-Identifier: MIT
/**
 * The top bar's account slot, before the Export menu that ends the app row: once someone has signed in with Google,
 * the account's avatar (its letter) and a button named by its email that opens a small panel (ui/Popover) with the
 * account, how long the sign-in lasts, "Stay signed in" when a silent renewal could not run, and "Sign out". After an
 * expiry the button reads "Session expired" and the panel offers "Sign in again". Nothing shows while signed
 * out (the Connect page has the sign-in) or where there is no sign-in at all, as in a demo build. A polite live
 * region says when the sign-in is about to end or has ended, wherever the person is in the app. On a phone or a
 * tablet the slot is in the More sheet, which "Sign out" closes too: focus starts again at the page, never outside
 * an open sheet.
 */
import { useState, type ReactElement } from 'react';

import styles from '../../auth/Auth.module.css';
import { useAuth } from '../../auth/context';
import { accountInitial, accountName, clockTime } from '../../auth/labels';
import type { SessionState } from '../../auth/types';
import { cx } from '../../classNames';
import actions from '../../snapshots/Snapshots.module.css';
import { useAppState, usePopover, useSheet } from '../../state';
import { Popover } from '../../ui/Popover';
import { MORE_SHEET } from './sheets';

function statusLine(session: SessionState): string {
  if (session.status === 'expired') {
    return 'Your sign-in ended. Sign in again to keep reading your environment; snapshots in this browser stay available.';
  }
  if (session.status === 'signing-in') return 'Waiting for Google’s sign-in window…';
  const until = session.expiresAt === null ? '' : ` until ${clockTime(session.expiresAt)}`;
  if (session.renewal === 'renewing') return `Signed in with Google${until}. Renewing the sign-in…`;
  if (session.renewal === 'needed') {
    return `Signed in with Google${until}. Stay signed in to keep reading your environment after that.`;
  }
  return `Signed in with Google${until}; it renews itself before then. The access token stays in this tab’s memory.`;
}

/** What the live region says: only the two moments that need the person. */
function announcement(session: SessionState): string {
  if (session.status === 'expired') return 'Your Google sign-in ended. Sign in again to continue.';
  if (session.status === 'signed-in' && session.renewal === 'needed' && session.expiresAt !== null) {
    return `Your Google sign-in ends at ${clockTime(session.expiresAt)}. Open the account menu to stay signed in.`;
  }
  return '';
}

export function AccountMenu(): ReactElement | null {
  const session = useAppState((state) => state.connect.session);
  const auth = useAuth();
  const [open, setOpen] = usePopover('account');
  const [, setMoreOpen] = useSheet(MORE_SHEET);
  const [farewell, setFarewell] = useState('');

  const shown = session.account !== null && session.status !== 'signed-out';
  const expired = session.status === 'expired';
  const needed = session.status === 'signed-in' && session.renewal === 'needed';
  const label = expired ? 'Session expired' : accountName(session.account);

  return (
    <div className={styles.slot}>
      <span role="status" className="visually-hidden">
        {session.status === 'signed-out' ? (session.notice ?? farewell) : announcement(session)}
      </span>
      {shown ? (
        <>
          <span className={styles.avatar} aria-hidden="true">
            {accountInitial(session.account)}
          </span>
          <Popover
            label={label}
            title="Account"
            align="end"
            open={open}
            onOpenChange={setOpen}
            adornment={
              needed && session.expiresAt !== null ? (
                <span className={styles.badge}>{` (ends ${clockTime(session.expiresAt)})`}</span>
              ) : null
            }
          >
            {(close) => (
              <div className={styles.panel}>
                <div className={styles.account}>
                  <span className={cx(styles.avatar, styles.avatarLarge)} aria-hidden="true">
                    {accountInitial(session.account)}
                  </span>
                  <div>
                    <p className={styles.accountName}>{accountName(session.account)}</p>
                    <p className={styles.note}>{statusLine(session)}</p>
                  </div>
                </div>
                {session.problem === null || !(needed || expired) ? null : (
                  <p role="alert" className={actions.alert}>
                    {session.problem.message}
                  </p>
                )}
                <div className={styles.row}>
                  {needed ? (
                    <button type="button" className={actions.primary} onClick={auth.renew}>
                      Stay signed in
                    </button>
                  ) : null}
                  {expired ? (
                    <button type="button" className={actions.primary} onClick={auth.signIn}>
                      Sign in again
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => {
                      close();
                      setMoreOpen(false);
                      setFarewell('Signed out of Google.');
                      auth.signOut();
                      // The button that had focus goes away with the account: start again at the page.
                      document.getElementById('main')?.focus({ preventScroll: true });
                    }}
                  >
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </Popover>
        </>
      ) : null}
    </div>
  );
}
