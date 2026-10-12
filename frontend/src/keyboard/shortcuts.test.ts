// SPDX-License-Identifier: MIT
/**
 * The rules the single-key shortcuts follow (shortcuts.ts, style skill §13), on their own: a key press counts by
 * the character it produced, whatever Shift, Option or AltGr it took, but not as someone else's Cmd or Ctrl shortcut;
 * and a key is text in a field and belongs to a popup or a control whose popup is open. The app's keys through them:
 * keyboard.test.tsx. (jsdom: the element rules take real elements.)
 */
import { describe, expect, it } from 'vitest';

import { isInsidePopup, isShortcutKey, isTypingTarget } from './shortcuts';

type Press = Parameters<typeof isShortcutKey>[0];

/** A key press with these modifiers (AltGraph: the modifier Linux reports for AltGr). */
function press(
  modifiers: { ctrl?: boolean; meta?: boolean; alt?: boolean; altGraph?: boolean; taken?: boolean } = {},
): Press {
  return {
    ctrlKey: modifiers.ctrl ?? false,
    metaKey: modifiers.meta ?? false,
    altKey: modifiers.alt ?? false,
    defaultPrevented: modifiers.taken ?? false,
    getModifierState: (key: string) => key === 'AltGraph' && modifiers.altGraph === true,
  };
}

/** `html` parsed into a fresh element tree; the element marked `data-target` (or the root). */
function target(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.querySelector('[data-target]') ?? host;
}

describe('isShortcutKey', () => {
  it.each([
    // Shift is not looked at: `/` is Shift+7 on a German layout.
    ['no modifier, or Shift', true, press()],
    ['Option (`[` is Option+5 on a German Mac)', true, press({ alt: true })],
    ['Ctrl+Alt (AltGr on a German PC under Windows)', true, press({ ctrl: true, alt: true })],
    ['Ctrl with AltGraph reported (AltGr under Linux)', true, press({ ctrl: true, altGraph: true })],
    ['Cmd (Cmd+[ is the browser’s Back)', false, press({ meta: true })],
    ['Cmd+Option', false, press({ meta: true, alt: true })],
    ['Ctrl alone (Ctrl+- zooms the page)', false, press({ ctrl: true })],
    ['a press a handler took before', false, press({ taken: true })],
  ] as const)('%s → %s', (_case, expected, event) => {
    expect(isShortcutKey(event)).toBe(expected);
  });

  it('takes a browser that cannot report AltGraph as no AltGraph', () => {
    const throwing: Press = {
      ...press({ ctrl: true }),
      getModifierState: () => {
        throw new Error('not supported');
      },
    };
    expect(isShortcutKey(throwing)).toBe(false);
  });
});

describe('where a key press lands', () => {
  it.each([
    ['a text field', '<input data-target>', true, false],
    ['a text area', '<textarea data-target></textarea>', true, false],
    ['an editable element', '<p contenteditable="true"><b data-target>x</b></p>', true, false],
    ['a button', '<button data-target></button>', false, false],
    ['an item of a menu', '<div role="menu"><button data-target></button></div>', false, true],
    ['a dialog', '<div role="dialog"><button data-target></button></div>', false, true],
    ['an inert subtree', '<div inert><button data-target></button></div>', false, true],
    [
      'a combobox with its list open (type-ahead)',
      '<button role="combobox" aria-expanded="true" data-target></button>',
      false,
      true,
    ],
    [
      'a menu button with its menu open',
      '<button aria-haspopup="menu" aria-expanded="true" data-target></button>',
      false,
      true,
    ],
    ['a disclosure button, open', '<button aria-expanded="true" data-target></button>', false, false],
  ])('%s: typing %s, a popup’s %s', (_case, html, typing, popup) => {
    const element = target(html);
    expect(isTypingTarget(element)).toBe(typing);
    expect(isInsidePopup(element)).toBe(popup);
  });

  it('is neither for no target', () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isInsidePopup(null)).toBe(false);
  });
});
