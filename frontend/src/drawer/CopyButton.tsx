// SPDX-License-Identifier: MIT
/**
 * A small "Copy" button: writes `value` to the clipboard when activated and reports the outcome in words, which
 * the drawer shows in its status line (a live region). Its accessible name says what it copies ("Copy resource
 * name", "Copy 10.0.14.5") and starts with its visible text.
 */
import type { ReactElement } from 'react';

import styles from './DetailsDrawer.module.css';

export interface CopyButtonProps {
  readonly value: string;
  /** The accessible name: "Copy resource name". */
  readonly label: string;
  /** What was copied, for the status line: "the resource name". */
  readonly what: string;
  readonly onStatus: (text: string) => void;
}

export function CopyButton({ value, label, what, onStatus }: CopyButtonProps): ReactElement {
  return (
    <button
      type="button"
      className={styles.copy}
      aria-label={label}
      onClick={() => {
        const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
        if (clipboard === undefined) {
          onStatus('Copying is not available here.');
          return;
        }
        clipboard.writeText(value).then(
          () => {
            onStatus(`Copied ${what}.`);
          },
          () => {
            onStatus('The browser did not allow copying.');
          },
        );
      }}
    >
      Copy
    </button>
  );
}
