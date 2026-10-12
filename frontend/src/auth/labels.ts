// SPDX-License-Identifier: MIT
/** Words and small formats of the sign-in surfaces (the Connect page's card, the account menu). */
import type { PublicConfig } from '../api/config';
import type { SessionAccount } from './types';

/** The account's name on screen: its email, or a generic name when Google did not say. */
export function accountName(account: SessionAccount | null): string {
  return account?.email ?? 'Google account';
}

/** The avatar's letter: the email's first letter or digit, upper case; `?` without one. */
export function accountInitial(account: SessionAccount | null): string {
  const first = /[\p{L}\p{N}]/u.exec(account?.email ?? '')?.[0];
  return first === undefined ? '?' : first.toLocaleUpperCase();
}

/** A clock time in the viewer's locale, 24-hour (`14:32`). */
export function clockTime(epochMs: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    new Date(epochMs),
  );
}

/**
 * Who runs this instance: the backend's `hostedBy` line, "Hosted by NAME.", or null when it names nobody. The line
 * carries no non-affiliation statement (ADR 0018: the footer says it on every page); a backend from before 2026-10-12
 * ended it with the short line, which is cut off here.
 */
export function hostedByLine(config: PublicConfig | null): string | null {
  const line = config?.hostedBy?.replace(/\s*Not affiliated with Google\b.*$/su, '').trim() ?? '';
  return line === '' ? null : line;
}

/**
 * What Google will ask, said before sign-in (ADR 0028 §6): the `cloudasset` scope reads like read-write on
 * Google's consent screen, although gcportrait only lists assets with it.
 */
export const CONSENT_NOTE =
  'Google will ask you to let gcportrait view your Google Cloud data and your Cloud Asset Inventory data. ' +
  'Google describes the second as “See, edit, configure, and delete your Google Cloud Asset data”; gcportrait ' +
  'only lists assets with it, and can never read more than your own roles allow. The access token stays in ' +
  'this tab’s memory: it is never stored, and signing out revokes it.';
