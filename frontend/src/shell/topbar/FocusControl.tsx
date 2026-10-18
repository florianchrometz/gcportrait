// SPDX-License-Identifier: Apache-2.0
import type { FocusKind } from '@gcportrait/model';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { cx } from '../../classNames';
import { useAppState, useDiagramActions, usePopover, useScene } from '../../state';
import controls from '../../ui/controls.module.css';
import { Popover } from '../../ui/Popover';
import { Select } from '../../ui/Select';
import {
  FOCUS_KINDS,
  focusOf,
  focusOptions,
  focusParamOf,
  focusValue,
  focusValueLabel,
  type FocusChoice,
} from '../../views/focusForm';
import { PickerInput } from '../../views/PickerField';
import { useViewChoicesState } from '../../views/useViewChoices';
import styles from './FocusControl.module.css';

/** What the button says after "Focus": the parameter, or "standalone projects"; null without a focus. */
export function focusSummary(
  kind: FocusKind | undefined,
  value: string | null,
  label: (kind: FocusKind, value: string) => string,
): string | null {
  if (kind === undefined) return null;
  const param = focusParamOf(kind);
  if (param === null) return 'standalone projects';
  return value === null ? `no ${param.title.toLowerCase()} chosen` : label(kind, value);
}

/**
 * The Focus control (a focus select with its parameter in a popover): a button that says the focus
 * ("Focus", "Focus: demo-web-1") and opens a popover with the focus-view select (none, a single project, a
 * Shared VPC, the standalone projects, a perimeter, an application) and, for a kind that takes one, a picker
 * for its parameter over the snapshot's own choices: its projects (id and display name), its Shared VPC hosts,
 * its perimeters or its applications (views/focusForm.ts). One button keeps the top bar within 1280 px.
 *
 * Writing (`actions.setFocus`, into the hash): None clears the focus and Standalone projects applies at once; a
 * kind with a parameter shows its picker (focus moves into it) and is written only when the parameter is chosen,
 * so the view never holds half a focus; closing the popover drops a kind left unchosen. Choosing closes the
 * popover and gives focus back to the button. A focus the scene builder refused (an unknown project, a host
 * nothing attaches to) says why in the popover. Inert until a snapshot is open; shown on the diagram page only.
 */
export function FocusControl(): ReactElement {
  const focus = useAppState((state) => state.view.spec.focus);
  const hasSnapshot = useAppState((state) => state.view.spec.snapshot !== '');
  const { setFocus } = useDiagramActions();
  const [open, setOpen] = usePopover('focus');
  const [kindOpen, setKindOpen] = useState(false);
  const [pending, setPending] = useState<FocusKind | null>(null);
  const { choices, error: choicesError } = useViewChoicesState();
  const outcome = useScene()?.report.focus;
  const panelRef = useRef<HTMLDivElement>(null);
  const moveIntoPicker = useRef(false);

  const kind: FocusChoice = pending ?? focus?.kind ?? 'none';
  const param = kind === 'none' ? null : focusParamOf(kind);
  const value = pending === null ? focusValue(focus) : null;
  // A focus the scene builder refused: the view is drawn without it, and the button says so.
  const refused =
    focus !== undefined && outcome?.status === 'error' && outcome.kind === focus.kind ? outcome.error : null;
  const error = pending === null ? refused : null;
  const valueLabel = (of: FocusKind, raw: string): string => focusValueLabel(of, raw, choices);
  const summary = focusSummary(focus?.kind, focusValue(focus), valueLabel);

  // A kind with a parameter was chosen: its picker takes focus.
  useEffect(() => {
    if (!moveIntoPicker.current) return;
    moveIntoPicker.current = false;
    panelRef.current?.querySelector<HTMLElement>('input[role="combobox"]')?.focus();
  });

  const onOpenChange = (next: boolean): void => {
    setOpen(next);
    if (!next) {
      setPending(null);
      setKindOpen(false);
    }
  };

  return (
    <Popover
      label={summary === null ? 'Focus' : 'Focus:'}
      title="Focus"
      adornment={
        summary === null ? null : (
          <>
            {/* A space of its own, so every reader names the button "Focus: demo-web-1". */}{' '}
            <span
              className={styles.summary}
              title={`Focus: ${summary}`}
              {...(refused === null ? {} : { 'aria-hidden': true })}
            >
              {summary}
            </span>
            {refused === null ? null : (
              <>
                {/* The cue in words, not only in colour; read as "Focus: no-such, not applied". */}{' '}
                <span className={styles.refused} title={`Not applied: ${refused.message}`} aria-hidden="true">
                  not applied
                </span>
                <span className="visually-hidden">{`${summary}, not applied`}</span>
              </>
            )}
          </>
        )
      }
      open={open}
      onOpenChange={onOpenChange}
      {...(hasSnapshot ? {} : { disabled: 'Open a snapshot to focus on part of it' })}
    >
      {(close) => {
        const choose = (next: FocusChoice): void => {
          if (next === 'none') {
            setFocus(null);
            close();
            return;
          }
          if (focusParamOf(next) === null) {
            setFocus(focusOf(next, null));
            close();
            return;
          }
          setPending(focus?.kind === next ? null : next);
          moveIntoPicker.current = true;
        };
        return (
          <div ref={panelRef} className={styles.panel}>
            <span className={styles.kind}>
              <Select
                label="Show"
                options={FOCUS_KINDS}
                value={kind}
                onChange={choose}
                open={kindOpen}
                onOpenChange={setKindOpen}
              />
            </span>
            {param === null || kind === 'none' ? (
              <p className={styles.note}>
                {kind === 'none'
                  ? 'The whole view, without a focus.'
                  : 'Projects without a Shared VPC, peering or hybrid link.'}
              </p>
            ) : (
              <>
                <PickerInput
                  label={`${param.title} to focus on`}
                  options={choices === null ? null : focusOptions(kind, choices)}
                  unavailable={choicesError}
                  onChoose={(chosen) => {
                    setFocus(focusOf(kind, chosen));
                    close();
                  }}
                />
                {choicesError !== null && value === null ? (
                  // Nothing to choose from (it said "Loading" for good): why.
                  <p className={styles.error} role="alert">
                    {choicesError}
                  </p>
                ) : (
                  <p className={styles.note}>
                    {value === null ? (
                      `Choose the ${param.title.toLowerCase()}: type part of its name or id, or press ↓ to list them.`
                    ) : (
                      <>
                        Focused on <strong>{valueLabel(kind, value)}</strong>.
                      </>
                    )}
                  </p>
                )}
              </>
            )}
            {error === null ? null : (
              <p className={styles.error} role="alert">
                Not applied: {error.message}
              </p>
            )}
            {focus === undefined ? null : (
              <button
                type="button"
                className={cx(controls.control, styles.clear)}
                onClick={() => {
                  setFocus(null);
                  close();
                }}
              >
                Clear focus
              </button>
            )}
          </div>
        );
      }}
    </Popover>
  );
}
