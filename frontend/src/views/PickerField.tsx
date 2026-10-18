// SPDX-License-Identifier: MIT
/**
 * Pickers over the snapshot's choices, on the editable combobox of ui/Combobox: type to search (every
 * word must appear in the value, its label or its second line; case ignored), ↓ to list, Enter or a click to
 * choose. `PickerField` keeps a list of chosen values as removable chips (the Filters popover's regions,
 * projects, folders and types); `PickerInput` chooses one value (the Focus control's parameter).
 *
 * Inside a popover, Escape first closes the results, then clears the text, and only then closes the popover:
 * the combobox marks an Escape it handled (`preventDefault`), which the popover leaves alone.
 */
import { useId, useRef, useState, type ReactElement } from 'react';

import { Combobox, type ComboboxOption } from '../ui/Combobox';
import styles from './PickerField.module.css';

export interface PickerOption {
  /** What the view holds (the hash's value). */
  readonly value: string;
  /** The result's first line. */
  readonly label: string;
  /** Its second line. */
  readonly description?: string;
}

/** At most this many results are listed; typing narrows them. */
export const PICKER_LIMIT = 50;

/** The options matching a query (all of them for an empty one), without `exclude`, at most `limit`. */
export function searchOptions(
  options: readonly PickerOption[],
  query: string,
  exclude: ReadonlySet<string> = new Set(),
  limit = PICKER_LIMIT,
): PickerOption[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');
  const found: PickerOption[] = [];
  for (const option of options) {
    if (exclude.has(option.value)) continue;
    const text = `${option.value} ${option.label} ${option.description ?? ''}`.toLowerCase();
    if (words.every((word) => text.includes(word))) found.push(option);
    if (found.length >= limit) break;
  }
  return found;
}

function comboboxOptions(options: readonly PickerOption[]): ComboboxOption[] {
  return options.map((option) => ({
    key: option.value,
    label: option.label,
    ...(option.description === undefined || option.description === ''
      ? {}
      : { description: option.description }),
  }));
}

interface SearchProps {
  /** The input's accessible name. */
  readonly label: string;
  /** null while the choices are loading, or when they cannot (`unavailable`). */
  readonly options: readonly PickerOption[] | null;
  /** Why there is nothing to pick (the snapshot could not be loaded): the input is inert and says so. */
  readonly unavailable?: string | null | undefined;
  readonly exclude?: ReadonlySet<string>;
  readonly onChoose: (value: string) => void;
  readonly placeholder?: string;
}

/** The combobox both pickers share: its text, its results and the Escape order. */
function PickerSearch({
  label,
  options,
  unavailable,
  exclude,
  onChoose,
  placeholder,
}: SearchProps): ReactElement {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const failed = unavailable !== undefined && unavailable !== null;
  const loading = options === null && !failed;
  const results = options === null ? [] : searchOptions(options, query, exclude);

  return (
    <span className={styles.search}>
      <Combobox
        label={label}
        value={query}
        onValueChange={setQuery}
        options={comboboxOptions(results)}
        onChoose={(option) => {
          setQuery('');
          onChoose(option.key);
        }}
        placeholder={
          failed ? 'Not available' : loading ? 'Loading…' : (placeholder ?? 'Type to search, ↓ to list')
        }
        noResults="No matches"
        open={open}
        onOpenChange={setOpen}
        {...(failed ? { disabled: unavailable } : loading ? { disabled: 'Loading the snapshot…' } : {})}
      />
    </span>
  );
}

export interface PickerFieldProps {
  /** The field's visible label ("Regions"), which names the group of chips and the input. */
  readonly label: string;
  /** The values chosen, in the order to show them. */
  readonly values: readonly string[];
  /** What can be chosen; null while loading, or when it cannot be (`unavailable`). */
  readonly options: readonly PickerOption[] | null;
  /** Why nothing can be chosen (the snapshot could not be loaded). */
  readonly unavailable?: string | null | undefined;
  readonly onAdd: (value: string) => void;
  readonly onRemove: (value: string) => void;
  /** A hint under the field. */
  readonly hint?: string;
  readonly placeholder?: string;
}

/** A list of chosen values as chips with a remove button each, and a combobox to add one. */
export function PickerField({
  label,
  values,
  options,
  unavailable,
  onAdd,
  onRemove,
  hint,
  placeholder,
}: PickerFieldProps): ReactElement {
  const labelId = useId();
  const hintId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const known = new Map((options ?? []).map((option) => [option.value, option]));

  return (
    <div
      ref={groupRef}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={hint === undefined ? undefined : hintId}
      className={styles.field}
    >
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      {values.length === 0 ? null : (
        <ul className={styles.chips} aria-label={`${label} chosen`}>
          {values.map((value) => {
            const option = known.get(value);
            const title = option?.description === undefined ? value : `${value} · ${option.description}`;
            return (
              <li key={value} className={styles.chip} title={title}>
                <span className={styles.chipText}>{option?.label ?? value}</span>
                <button
                  type="button"
                  className={styles.remove}
                  aria-label={`Remove ${option?.label ?? value} from ${label.toLowerCase()}`}
                  onClick={() => {
                    onRemove(value);
                    // The chip goes away with its button: focus moves to the field's input.
                    groupRef.current?.querySelector('input')?.focus();
                  }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <PickerSearch
        label={`Add to ${label.toLowerCase()}`}
        options={options}
        unavailable={unavailable}
        exclude={new Set(values)}
        onChoose={onAdd}
        {...(placeholder === undefined ? {} : { placeholder })}
      />
      {hint === undefined ? null : (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      )}
    </div>
  );
}

export interface PickerInputProps {
  /** The input's accessible name. */
  readonly label: string;
  readonly options: readonly PickerOption[] | null;
  /** Why nothing can be chosen (the snapshot could not be loaded). */
  readonly unavailable?: string | null | undefined;
  readonly onChoose: (value: string) => void;
  readonly placeholder?: string;
}

/** One value to choose (the Focus control's parameter). */
export function PickerInput({
  label,
  options,
  unavailable,
  onChoose,
  placeholder,
}: PickerInputProps): ReactElement {
  return (
    <PickerSearch
      label={label}
      options={options}
      unavailable={unavailable}
      onChoose={onChoose}
      {...(placeholder === undefined ? {} : { placeholder })}
    />
  );
}
