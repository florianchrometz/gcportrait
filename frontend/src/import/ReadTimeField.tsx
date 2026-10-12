// SPDX-License-Identifier: MIT
/**
 * "When the export was taken" (an export's read time is its operation.json's, or set by the person): an
 * optional text field for an export that came without its operation.json, on the Connect page's export
 * card and the Snapshots page's import. What is typed is read as UTC (`parseTypedReadTime`, sidecar.ts) and checked
 * as it is typed; a time that cannot be used is said under the field (and the import refuses it). The snapshot then
 * has `readTimeSource: user`, and appears at that time as an extra tick on its scope's timeline.
 */
import { useId, useMemo, useState, type ReactElement } from 'react';

import { cx } from '../classNames';
import styles from './Import.module.css';
import { parseTypedReadTime, SIDECAR_FILE_NAME, TYPED_READ_TIME_EXAMPLE } from './sidecar';

export interface TypedReadTime {
  readonly text: string;
  readonly setText: (text: string) => void;
  /** The read time to import with (RFC 3339, UTC), when one was typed and it can be used. */
  readonly readTime: string | undefined;
  /** Why what was typed cannot be used, or null. */
  readonly problem: string | null;
}

/** The field's state: the text, and what it means against this computer's clock. */
export function useTypedReadTime(): TypedReadTime {
  const [text, setText] = useState('');
  const parsed = useMemo(() => parseTypedReadTime(text, Date.now()), [text]);
  return {
    text,
    setText,
    readTime: parsed !== null && 'readTime' in parsed ? parsed.readTime : undefined,
    problem: parsed !== null && 'problem' in parsed ? parsed.problem : null,
  };
}

export function ReadTimeField({ state }: { readonly state: TypedReadTime }): ReactElement {
  const ids = { input: useId(), hint: useId(), problem: useId() };
  return (
    <div className={styles.stack}>
      <label className={styles.label} htmlFor={ids.input}>
        When the export was taken (UTC, optional)
      </label>
      <input
        id={ids.input}
        className={cx(styles.input, styles.short)}
        type="text"
        spellCheck={false}
        autoComplete="off"
        placeholder={TYPED_READ_TIME_EXAMPLE}
        aria-describedby={state.problem === null ? ids.hint : `${ids.hint} ${ids.problem}`}
        aria-invalid={state.problem === null ? undefined : true}
        value={state.text}
        onChange={(event) => {
          state.setText(event.currentTarget.value);
        }}
      />
      <p id={ids.hint} className={styles.note}>
        For an export that came without its {SIDECAR_FILE_NAME}, for example {TYPED_READ_TIME_EXAMPLE}. With{' '}
        {SIDECAR_FILE_NAME} its read time is used; without either, the latest asset change, marked as
        estimated. The snapshot appears at that time on its scope&rsquo;s timeline.
      </p>
      {state.problem === null ? null : (
        <p id={ids.problem} className={styles.inlineError}>
          {state.problem}
        </p>
      )}
    </div>
  );
}
