// SPDX-License-Identifier: MIT
/**
 * The Variables panel of a page's commands (as the website's docs pages have it): each registered variable of the
 * commands given, in the order they first appear, with its label, token, description and a synthetic example, and a
 * text box to fill it in once for every command on the page. The values are the commands' own
 * (commands/useCommandVariables.ts): typing here updates every field, and the other way round. "Clear values" forgets
 * what was typed; the facts the app knows show again.
 */
import { commandVariable, variableTokens, type CommandVariable } from '@gcportrait/model';
import { useId, type ReactElement } from 'react';

import styles from './Commands.module.css';
import { useCommandVariables } from './useCommandVariables';

/** The registered variables of `commands`, each once, in the order they first appear. */
export function variablesOf(commands: readonly string[]): readonly CommandVariable[] {
  const names = [...new Set(commands.flatMap((command) => variableTokens(command)))];
  return names.flatMap((name) => {
    const variable = commandVariable(name);
    return variable === undefined ? [] : [variable];
  });
}

export function VariablesPanel({
  commands,
  heading: Heading = 'h3',
}: {
  readonly commands: readonly string[];
  readonly heading?: 'h2' | 'h3';
}): ReactElement | null {
  const id = useId();
  const variables = useCommandVariables();
  const shown = variablesOf(commands);
  if (shown.length === 0) return null;
  return (
    <div className={styles.panel} role="group" aria-labelledby={`${id}-title`}>
      <Heading id={`${id}-title`} className={styles.panelTitle}>
        Variables
      </Heading>
      <p className={styles.panelIntro}>
        Fill a value in once, here or in any command: every command on this page follows, and Copy copies it
        with your values. They are kept in this tab until it closes
        {shown.some((variable) => variable.secret) ? ', except secrets' : ''}.
      </p>
      <ul className={styles.list}>
        {shown.map((variable) => {
          const field = `${id}-${variable.name}`;
          const invalid = variables.invalid.has(variable.name);
          return (
            <li key={variable.name} className={styles.variable}>
              <div className={styles.name}>
                <label htmlFor={field}>{variable.label}</label>
                <code>{variable.name}</code>
              </div>
              <input
                id={field}
                type={variable.secret ? 'password' : 'text'}
                className={styles.input}
                value={variables.values[variable.name] ?? ''}
                aria-invalid={invalid ? 'true' : undefined}
                aria-describedby={invalid ? `${field}-about ${field}-hint` : `${field}-about`}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(event) => {
                  variables.set(variable.name, event.currentTarget.value);
                }}
                onBlur={() => {
                  variables.check(variable.name);
                }}
              />
              <p id={`${field}-about`} className={styles.about}>
                {variable.description} Example: <code>{variable.example}</code>
              </p>
              {invalid ? (
                <p id={`${field}-hint`} className={styles.hint}>
                  Expected: {variable.hint}.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.clear}
          aria-disabled={variables.typed ? undefined : 'true'}
          onClick={() => {
            if (variables.typed) variables.clear();
          }}
        >
          Clear values
        </button>
      </div>
    </div>
  );
}
