// SPDX-License-Identifier: Apache-2.0
/**
 * The scope picker (a search box over organisations, folders and projects): an editable combobox (`ui/Combobox`)
 * over
 * - the scope name typed by hand, when it is one: `organizations/ID`, `folders/ID`, `projects/ID` (in a
 *   project-only picker, a bare project id too), offered first as "Use …";
 * - the recent scopes from this browser's preferences, while nothing is typed;
 * - the organisations, folders and projects the signed-in person can see that match the text
 *   (`/api/scopes/search`), grouped by kind; with nothing typed, the first of them, to browse.
 *
 * Text that starts like a scope name but is not one gets a hint under the field. Choosing an option hands the
 * choice to `onChange` and empties the field; the choice is shown under it, with a Clear button. Signed out, the
 * picker still takes typed names, and says that searching needs a sign-in.
 */
import { useId, useState, type ReactElement } from 'react';

import { Combobox, type ComboboxOption } from '../ui/Combobox';
import type { SearchProblem } from './api';
import {
  describeScope,
  isProjectRef,
  KIND_LABELS,
  parseScopeName,
  scopeNameProblem,
  type ScopeChoice,
  type ScopeKind,
} from './scopeName';
import styles from './ScopePicker.module.css';
import { useScopeSearch, type ScopeSearchState } from './useScopeSearch';

export interface ScopePickerProps {
  /** The field's accessible name and visible label ("Scope", "Quota project"). */
  readonly label: string;
  readonly value: ScopeChoice | null;
  readonly onChange: (choice: ScopeChoice | null) => void;
  /** The kinds offered; all three by default. `['project']` makes a project picker (a bare id is accepted). */
  readonly kinds?: readonly ScopeKind[];
  readonly placeholder?: string;
  /** Offered while nothing is typed. */
  readonly recent?: readonly ScopeChoice[];
  /** Whether the person is signed in, so the backend can search. */
  readonly searchEnabled: boolean;
  /** An inert picker: the hint says why. */
  readonly disabled?: string | undefined;
  /** A line under the field describing what to pick. */
  readonly description?: string;
}

const TYPED_GROUP = 'Typed';
const RECENT_GROUP = 'Recent';

/** The choice the typed text names, if it names one of the allowed kinds. */
export function typedChoice(text: string, kinds: readonly ScopeKind[]): ScopeChoice | null {
  const trimmed = text.trim();
  const projectsOnly = kinds.length === 1 && kinds[0] === 'project';
  if (projectsOnly && !trimmed.includes('/') && isProjectRef(trimmed)) {
    return { kind: 'project', scope: `projects/${trimmed}`, id: trimmed };
  }
  const parsed = parseScopeName(trimmed);
  return parsed !== null && kinds.includes(parsed.kind) ? parsed : null;
}

function resultOption(choice: ScopeChoice, prefix: string, group: string): ComboboxOption {
  const parent = choice.parent === undefined ? '' : ` · in ${choice.parent}`;
  return {
    key: `${prefix}:${choice.scope}`,
    label: choice.displayName ?? choice.id,
    description: `${choice.scope}${parent}`,
    group,
  };
}

function problemText(problems: readonly SearchProblem[]): string {
  return problems
    .map((problem) => {
      const reason = [problem.upstream.code, problem.upstream.reason]
        .filter((part) => part !== undefined)
        .join(' ');
      return `${KIND_LABELS[problem.kind].many} could not be searched (${reason === '' ? String(problem.upstream.status) : reason}).`;
    })
    .join(' ');
}

function statusText(search: ScopeSearchState, count: number, text: string): string | undefined {
  switch (search.status) {
    case 'idle':
      return undefined;
    case 'searching':
      return 'Searching…';
    case 'signed-out':
      return text.trim() === ''
        ? undefined
        : 'Sign in to search your scopes; a typed scope name still works.';
    case 'error':
      return search.message;
    case 'done': {
      const found =
        count === 0 ? 'No scopes match.' : `${String(count)} ${count === 1 ? 'choice' : 'choices'}.`;
      const more = search.more ? ' More exist: type more of the name to narrow the list.' : '';
      const problems = search.problems.length === 0 ? '' : ` ${problemText(search.problems)}`;
      return `${found}${more}${problems}`;
    }
  }
}

export function ScopePicker({
  label,
  value,
  onChange,
  kinds = ['organization', 'folder', 'project'],
  placeholder,
  recent = [],
  searchEnabled,
  disabled,
  description,
}: ScopePickerProps): ReactElement {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const hintId = useId();
  const search = useScopeSearch(text, {
    kinds,
    enabled: searchEnabled && disabled === undefined,
    active: open,
  });

  const typed = typedChoice(text, kinds);
  const problem = typed === null ? scopeNameProblem(text) : null;
  const choices = new Map<string, ScopeChoice>();
  const options: ComboboxOption[] = [];
  const add = (choice: ScopeChoice, option: ComboboxOption): void => {
    if (choices.has(option.key)) return;
    choices.set(option.key, choice);
    options.push(option);
  };
  if (typed !== null) {
    add(typed, {
      key: `typed:${typed.scope}`,
      label: `Use ${typed.scope}`,
      description: 'The name you typed',
      group: TYPED_GROUP,
    });
  }
  if (text.trim() === '') {
    for (const choice of recent.filter((entry) => kinds.includes(entry.kind))) {
      add(choice, resultOption(choice, 'recent', RECENT_GROUP));
    }
  }
  const current = search.status === 'done' && search.text === text.trim();
  if (search.status === 'done') {
    for (const kind of kinds) {
      for (const choice of search.scopes.filter(
        (entry) => entry.kind === kind && entry.scope !== typed?.scope,
      )) {
        add(choice, resultOption(choice, 'result', KIND_LABELS[kind].many));
      }
    }
  }
  const busy = search.status === 'searching' || (search.status === 'done' && !current);

  return (
    <div
      className={styles.picker}
      onFocus={(event) => {
        // The combobox opens on focus only once something is typed; here an empty field opens too, to offer the
        // recent scopes and the first scopes the person can see.
        if (event.target instanceof HTMLInputElement && disabled === undefined) setOpen(true);
      }}
    >
      {/* The field's own (visually hidden) label carries the same name; this is its visible twin. */}
      <span className={styles.label} aria-hidden="true">
        {label}
      </span>
      {description === undefined ? null : <span className={styles.description}>{description}</span>}
      <Combobox
        label={label}
        value={text}
        onValueChange={setText}
        options={options}
        open={open}
        onOpenChange={setOpen}
        onChoose={(option) => {
          const choice = choices.get(option.key);
          if (choice === undefined) return;
          setText('');
          onChange(choice);
        }}
        {...(placeholder === undefined ? {} : { placeholder })}
        noResults={search.status === 'signed-out' ? 'Sign in to search your scopes' : 'No scopes match'}
        {...(() => {
          const status = statusText(search, options.length, text);
          return status === undefined ? {} : { status };
        })()}
        busy={busy && options.length > 0 && typed === null}
        disabled={disabled}
        className={styles.field}
        listClassName={styles.list}
      />
      <p id={hintId} className={styles.hint} aria-live="polite">
        {problem}
      </p>
      {value === null ? null : (
        <p className={styles.selected}>
          <span className={styles.selectedLabel}>Selected:</span>{' '}
          <span className={styles.selectedName}>{describeScope(value)}</span>{' '}
          <button
            type="button"
            className={styles.clear}
            aria-label={`Clear ${label.toLowerCase()} ${value.scope}`}
            onClick={() => {
              onChange(null);
            }}
          >
            Clear
          </button>
        </p>
      )}
    </div>
  );
}
