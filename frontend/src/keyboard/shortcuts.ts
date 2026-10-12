// SPDX-License-Identifier: MIT
/**
 * The app's single-key shortcuts (style skill §13): `/` focuses the search box (shell/topbar/SearchBox.tsx),
 * `[` and `]` move the timeline (TimelineKeys.tsx), and on the canvas `+`, `-` and `0` zoom
 * (diagram/keyboard/zoom.ts). A single key is text while typing, and belongs to a popup or a dialog while one has
 * focus, so a shortcut only applies outside them.
 */

/** Whether a key press happened where a single character is text: a text field or an editable element. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null
  );
}

/**
 * Whether a key press happened inside a popup or a dialog, or on a control whose popup is open (a list with
 * type-ahead), which handle their own keys; or in an inert subtree.
 */
export function isInsidePopup(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      '[inert], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], ' +
        '[role="combobox"][aria-expanded="true"], [aria-haspopup][aria-expanded="true"]',
    ) !== null
  );
}

/**
 * Whether a key press may be a single-character shortcut (`/`, `[`, `]`, and on the canvas `+`, `-`, `0`). A
 * shortcut is matched by the character the key produced (`event.key`), so whatever the layout needed to type it
 * counts as that character: Shift, Alt (macOS Option: `[` is Option+5 on a German Mac) and AltGr (`[` is AltGr+8
 * on a German PC, which Windows reports as Ctrl+Alt, Linux as the AltGraph modifier). Meta (Cmd+[ is the
 * browser's Back) and Ctrl without Alt (Ctrl+- zooms the page) make it someone else's shortcut; so does a handler
 * that took the key before.
 */
export function isShortcutKey(
  event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'defaultPrevented' | 'getModifierState'>,
): boolean {
  if (event.defaultPrevented || event.metaKey) return false;
  if (!event.ctrlKey) return true;
  return event.altKey || altGraph(event);
}

/** Whether AltGr is held (`getModifierState('AltGraph')`; false where the browser does not report it). */
function altGraph(event: Pick<KeyboardEvent, 'getModifierState'>): boolean {
  try {
    return typeof event.getModifierState === 'function' && event.getModifierState('AltGraph');
  } catch {
    return false;
  }
}

/** The two timeline keys and the step each makes: `[` one day back, `]` one day forward. */
export const TIMELINE_KEYS: Readonly<Record<string, -1 | 1>> = Object.freeze({ '[': -1, ']': 1 });
