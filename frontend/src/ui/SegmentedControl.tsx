// SPDX-License-Identifier: MIT
/**
 * A segmented control (WAI-ARIA radio group): `role="radiogroup"` named by its visible label, one `role="radio"`
 * button per option with `aria-checked`; the checked one is the group's only tab stop. ← → (and ↑ ↓) move to the
 * previous or next option and choose it (wrapping), Home and End the first and last; a click chooses. The
 * checked option is filled and carries a check mark, so colour never carries the state alone. Inert
 * (`disabled`): announced unavailable, focusable, chooses nothing.
 */
import { useId, useRef, type KeyboardEvent, type ReactElement } from 'react';

import { cx } from '../classNames';
import controls from './controls.module.css';
import { inertProps, isInert, type Inert } from './dom';
import styles from './SegmentedControl.module.css';

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface SegmentedControlProps<T extends string> {
  /** The visible label that names the group. */
  readonly label: string;
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly disabled?: Inert;
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: SegmentedControlProps<T>): ReactElement {
  const labelId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const inert = isInert(disabled);
  const checked = options.findIndex((option) => option.value === value);
  const stop = checked < 0 ? 0 : checked;

  const choose = (index: number, focus: boolean): void => {
    const option = options[index];
    if (option === undefined) return;
    if (focus) refs.current[index]?.focus();
    if (!inert && option.value !== value) onChange(option.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const count = options.length;
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowDown: index + 1,
      ArrowLeft: index - 1,
      ArrowUp: index - 1,
      Home: 0,
      End: count - 1,
    };
    const target = moves[event.key];
    if (target === undefined || count === 0) return;
    event.preventDefault();
    choose(((target % count) + count) % count, true);
  };

  return (
    <span className={controls.field}>
      <span id={labelId} className={controls.fieldLabel}>
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className={cx(styles.group, inert && styles.inert)}
        {...inertProps(disabled)}
      >
        {options.map((option, index) => (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={index === checked}
            tabIndex={index === stop ? 0 : -1}
            className={styles.segment}
            onClick={() => {
              choose(index, false);
            }}
            onKeyDown={(event) => {
              onKeyDown(event, index);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </span>
  );
}
