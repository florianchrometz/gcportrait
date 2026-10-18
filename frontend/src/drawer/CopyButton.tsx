// SPDX-License-Identifier: Apache-2.0
/**
 * A small "Copy" button: writes `value` to the clipboard when activated and reports the outcome in words, which
 * the drawer shows in its status line (a live region). Its accessible name says what it copies ("Copy resource
 * name", "Copy 10.0.14.5") and starts with its visible text.
 */
import type { ReactElement } from 'react';

import { copyFailureMessage, copyText } from '../export/deliver';
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
        void copyText(value).then((outcome) => {
          if (outcome === 'copied') {
            onStatus(`Copied ${what}.`);
          } else {
            onStatus(copyFailureMessage(outcome));
          }
        });
      }}
    >
      Copy
    </button>
  );
}
