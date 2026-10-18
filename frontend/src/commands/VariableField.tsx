// SPDX-License-Identifier: Apache-2.0
/**
 * One variable of a command, filled in place (commands/useCommandVariables.ts): a labelled text box inside the
 * command's text, as wide as what it shows, its token as the placeholder while it is empty. Its description and a
 * synthetic example describe it; a value not of the variable's format is marked when the field is left (`invalid`),
 * never refused. Every field of a variable shows the same value: typing in one updates the others.
 */
import type { CommandVariable } from '@gcportrait/model';
import type { ReactElement } from 'react';

import { cx } from '../classNames';
import styles from './Commands.module.css';

export function variableDescription(variable: CommandVariable): string {
  return `${variable.description} Example: ${variable.example}`;
}

export function VariableField({
  variable,
  value,
  invalid,
  onChange,
  onLeave,
  describedBy,
}: {
  readonly variable: CommandVariable;
  readonly value: string;
  readonly invalid: boolean;
  readonly onChange: (raw: string) => void;
  readonly onLeave: () => void;
  /** An element that says more, such as the command's note on a value of the wrong format. */
  readonly describedBy?: string | undefined;
}): ReactElement {
  const shown = value === '' ? variable.name : value;
  return (
    <input
      type={variable.secret ? 'password' : 'text'}
      className={cx(styles.field, value === '' && styles.unfilled)}
      aria-label={variable.label}
      aria-invalid={invalid ? 'true' : undefined}
      aria-describedby={describedBy}
      title={variableDescription(variable)}
      placeholder={variable.name}
      value={value}
      // As wide as its text in the code's monospaced font; the padding leaves room for the caret.
      style={{ width: `${String(shown.length)}ch` }}
      spellCheck={false}
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      data-variable={variable.name}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
      onBlur={onLeave}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}
