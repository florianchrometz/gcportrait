// SPDX-License-Identifier: Apache-2.0
/**
 * `[` and `]` move the timeline one day back and forward (style skill §13), from anywhere on the diagram page
 * but a text field, a popup or a dialog, on any keyboard layout: the key is matched by the character it typed,
 * however the layout reached it (Option+5 on a German Mac, AltGr+8 on a German PC; shortcuts.ts). They call the
 * store's `stepTick`, which writes the view's `tick`; the timeline bar's readout says where the view is. When
 * the timeline cannot move (no snapshot, its timeline not known yet, the first or the latest day) a visually hidden
 * status message says why, once per key press.
 */
import { useEffect, useState, type ReactElement } from 'react';

import { useAppStore, useDiagramActions } from '../state';
import { stepTarget } from '../timeline/model';
import { isInsidePopup, isShortcutKey, isTypingTarget, TIMELINE_KEYS } from './shortcuts';

export function TimelineKeys(): ReactElement {
  const store = useAppStore();
  const actions = useDiagramActions();
  // Each press that cannot move the timeline is a new message: its count keys the element that holds the text, so
  // the status region gets a new node each time and a screen reader announces it again, even with the same words.
  const [said, setSaid] = useState<{ readonly text: string; readonly count: number } | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const step = TIMELINE_KEYS[event.key];
      if (step === undefined || !isShortcutKey(event)) return;
      if (isTypingTarget(event.target) || isInsidePopup(event.target)) return;
      event.preventDefault();
      const { view, timeline } = store.getState();
      const target = stepTarget(view.spec, timeline, step);
      const moved = actions.stepTick(step);
      setSaid((previous) =>
        moved || !('refusal' in target) ? null : { text: target.refusal, count: (previous?.count ?? 0) + 1 },
      );
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [store, actions]);

  return (
    <p className="visually-hidden" role="status" data-testid="timeline-keys-status">
      {said === null ? null : (
        <span key={said.count} data-count={said.count}>
          {said.text}
        </span>
      )}
    </p>
  );
}
