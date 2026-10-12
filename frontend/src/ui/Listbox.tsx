// SPDX-License-Identifier: MIT
/**
 * The listbox popup of a combobox (Select.tsx, Combobox.tsx): `role="listbox"` with `option`s whose ids the
 * combobox names in `aria-activedescendant`, since focus stays on the combobox. Presentational: the combobox owns
 * the keys and the active option; here a pointer moving over an option makes it active and a click chooses it
 * (the press does not take focus from the combobox).
 *
 * Options that carry a `group` name (search results by kind) are listed in ARIA groups: each run of
 * consecutive options with the same name is a `role="group"` named by a visible heading row (WAI-ARIA APG
 * "listbox with grouped options"); the keys still move through the options in order, across groups. An option's
 * `icon` is decorative (hidden from assistive technology), before its text. A `busy` listbox (a combobox waiting
 * for the current text's results) is `aria-busy` and greyed.
 */
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';

import { cx } from '../classNames';
import styles from './popup.module.css';

export interface ListboxOption {
  readonly key: string;
  readonly label: string;
  /** A second line (a result's type and project). */
  readonly description?: string;
  /** `aria-selected`: the current choice of a select, the active result of a search. */
  readonly selected: boolean;
  /** The name of the group the option is listed under (consecutive options with one name form a group). */
  readonly group?: string;
  /** A decorative icon before the text (the search results' icons). */
  readonly icon?: ReactNode;
}

interface OptionRun {
  readonly group: string | undefined;
  /** The index of the run's first option. */
  readonly start: number;
  readonly items: readonly { readonly option: ListboxOption; readonly index: number }[];
}

/** The options as runs of consecutive options with the same group name (one run when none has a group). */
function optionRuns(options: readonly ListboxOption[]): OptionRun[] {
  const runs: {
    group: string | undefined;
    start: number;
    items: { option: ListboxOption; index: number }[];
  }[] = [];
  options.forEach((option, index) => {
    const last = runs.at(-1);
    if (last !== undefined && last.group === option.group) last.items.push({ option, index });
    else runs.push({ group: option.group, start: index, items: [{ option, index }] });
  });
  return runs;
}

export interface ListboxProps {
  readonly id: string;
  readonly options: readonly ListboxOption[];
  /** The active option (-1: none). */
  readonly active: number;
  readonly optionId: (index: number) => string;
  /** Named by a visible label (its id) or by text. */
  readonly labelledBy?: string;
  readonly label?: string;
  readonly hidden: boolean;
  readonly align?: 'start' | 'end';
  /** The selected option shows a check mark (a select's current choice). */
  readonly checks?: boolean;
  /** Extra class for the popup (its width, a scroll height). */
  readonly className?: string | undefined;
  /** The options listed are being replaced (`aria-busy`, greyed). */
  readonly busy?: boolean;
  readonly onActivate: (index: number) => void;
  readonly onChoose: (index: number) => void;
}

export function Listbox({
  id,
  options,
  active,
  optionId,
  labelledBy,
  label,
  hidden,
  align = 'start',
  checks = false,
  className,
  busy = false,
  onActivate,
  onChoose,
}: ListboxProps): ReactElement {
  const listRef = useRef<HTMLUListElement>(null);
  // The active option stays in view when the popup scrolls (a long list moved through with the keys).
  useEffect(() => {
    if (hidden || active < 0) return;
    // Options in document order (inside their groups, when grouped).
    const option = listRef.current?.querySelectorAll('[role="option"]')[active];
    if (option instanceof HTMLElement && typeof option.scrollIntoView === 'function') {
      option.scrollIntoView({ block: 'nearest' });
    }
  }, [active, hidden]);
  const renderOption = (option: ListboxOption, index: number): ReactElement => (
    <li
      key={option.key}
      id={optionId(index)}
      role="option"
      aria-selected={option.selected}
      // With a second line, the option is named by its label and described by the second line.
      aria-labelledby={option.description === undefined ? undefined : `${optionId(index)}-label`}
      aria-describedby={option.description === undefined ? undefined : `${optionId(index)}-description`}
      className={cx(styles.item, index === active && styles.active)}
      onPointerMove={() => {
        onActivate(index);
      }}
      onPointerDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        onChoose(index);
      }}
    >
      {option.icon === undefined ? null : (
        <span className={styles.itemIcon} aria-hidden="true">
          {option.icon}
        </span>
      )}
      {option.description === undefined ? (
        option.label
      ) : (
        <span className={styles.itemText}>
          <span id={`${optionId(index)}-label`}>{option.label}</span>
          <span
            id={`${optionId(index)}-description`}
            className={styles.itemDescription}
            title={option.description}
          >
            {option.description}
          </span>
        </span>
      )}
    </li>
  );
  return (
    <ul
      ref={listRef}
      id={id}
      role="listbox"
      aria-labelledby={labelledBy}
      aria-label={labelledBy === undefined ? label : undefined}
      aria-busy={busy || undefined}
      className={cx(
        styles.popup,
        styles.anchored,
        align === 'end' && styles.end,
        checks && styles.checks,
        busy && styles.busy,
        className,
      )}
      hidden={hidden}
    >
      {optionRuns(options).map((run) =>
        run.group === undefined ? (
          run.items.map(({ option, index }) => renderOption(option, index))
        ) : (
          // A run of options with a group name (search results by kind): an ARIA group named by it.
          <li key={`group-${String(run.start)}`} role="presentation">
            <ul role="group" aria-labelledby={`${id}-group-${String(run.start)}`} className={styles.group}>
              <li role="presentation" id={`${id}-group-${String(run.start)}`} className={styles.groupLabel}>
                {run.group}
              </li>
              {run.items.map(({ option, index }) => renderOption(option, index))}
            </ul>
          </li>
        ),
      )}
    </ul>
  );
}
