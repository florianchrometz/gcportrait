// SPDX-License-Identifier: MIT
/**
 * A copy-ready command (docs/permissions.md): the text in a code block,
 * each registered variable in it (`YOUR_ORG_ID`, COMMAND_VARIABLES in `@gcportrait/model`) a labelled field filled in
 * place (commands/VariableField.tsx), and a Copy button that writes the command with the values to the clipboard and
 * says so in a polite live region. Every field of a variable on the page shows one value, prefilled from what the
 * app knows and kept for the tab's session (commands/useCommandVariables.ts). An unfilled variable is copied as its
 * token; the button is described by a note that says how many are still to fill, or which value is not of its
 * variable's format. The button is named after what the command does, read from the text with the values in.
 */
import { commandVariable, splitVariableTokens } from '@gcportrait/model';
import { useId, useState, type ReactElement } from 'react';

import { cx } from '../classNames';
import { useCommandVariables } from '../commands/useCommandVariables';
import { copiedMessage, resolveCommand, unfilledNote } from '../commands/values';
import { VariableField } from '../commands/VariableField';
import styles from './Preflight.module.css';

export interface CommandBlockProps {
  /** The command, its variables as their tokens. */
  readonly command: string;
  /** Said after what the command does in the Copy button's name, to tell like blocks apart: "reference". */
  readonly context?: string;
}

export function CommandBlock({ command, context }: CommandBlockProps): ReactElement {
  const [status, setStatus] = useState('');
  const noteId = useId();
  const variables = useCommandVariables();
  const parts = splitVariableTokens(command);
  const resolved = resolveCommand(command, variables.values);
  const invalid = parts
    .map((part) => (typeof part === 'string' ? undefined : commandVariable(part.token)))
    .find((variable) => variable !== undefined && variables.invalid.has(variable.name));
  const note =
    invalid === undefined
      ? unfilledNote(resolved.unfilled.length)
      : `Check ${invalid.label}: ${invalid.hint}.`;
  const purpose = purposeOf(resolved.text);
  return (
    <div className={styles.command}>
      <pre className={styles.commandText}>
        <code>
          {parts.map((part, index) => {
            if (typeof part === 'string') return part;
            const variable = commandVariable(part.token);
            // An unregistered token stays text (commands/commands.test.ts keeps the app's commands free of them).
            if (variable === undefined) return part.token;
            return (
              <VariableField
                // The parts of one command never change order while it is shown.
                key={index}
                variable={variable}
                value={variables.values[variable.name] ?? ''}
                invalid={variables.invalid.has(variable.name)}
                describedBy={variables.invalid.has(variable.name) ? noteId : undefined}
                onChange={(raw) => {
                  variables.set(variable.name, raw);
                }}
                onLeave={() => {
                  variables.check(variable.name);
                }}
              />
            );
          })}
        </code>
      </pre>
      <button
        type="button"
        className={styles.copy}
        aria-label={`Copy the command that ${purpose}${context === undefined ? '' : ` (${context})`}`}
        aria-describedby={note === '' ? undefined : noteId}
        onClick={() => {
          const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
          if (clipboard === undefined) {
            setStatus('Copying is not available here; select the command instead.');
            return;
          }
          const { text, unfilled } = resolved;
          clipboard.writeText(text).then(
            () => {
              setStatus(copiedMessage(unfilled));
            },
            () => {
              setStatus('The browser did not allow copying; select the command instead.');
            },
          );
        }}
      >
        Copy
      </button>
      <span id={noteId} className={cx(styles.copyNote, invalid !== undefined && styles.copyNoteInvalid)}>
        {note}
      </span>
      <span role="status" className={styles.copyStatus}>
        {status}
      </span>
    </div>
  );
}

/** What a command does, read from its text, for the Copy button's name. */
export function purposeOf(command: string): string {
  const role = /--role="([^"]+)"/.exec(command)?.[1];
  const target = /add-iam-policy-binding (\S+)/.exec(command)?.[1];
  if (role !== undefined) return target === undefined ? `grants ${role}` : `grants ${role} on ${target}`;
  const project = /^gcloud services enable \S+ --project=(\S+)$/.exec(command)?.[1];
  if (project !== undefined) return `enables the Cloud Asset API in ${project}`;
  if (command.startsWith('gcloud asset export ')) return 'exports the scope’s assets to Cloud Storage';
  if (command.startsWith('gcloud asset operations describe ')) return 'saves the export’s operation';
  if (command.startsWith('gcloud storage cp ')) return 'copies the export to this computer';
  return 'is shown';
}
