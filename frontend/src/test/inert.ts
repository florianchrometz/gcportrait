// SPDX-License-Identifier: Apache-2.0
import { expect } from 'vitest';

/**
 * An inert control: announced as unavailable (`aria-disabled`) but not `disabled`, so it stays focusable and
 * keyboard users can reach it and hear why it does nothing.
 */
export function expectInertButFocusable(element: HTMLElement): void {
  expect(element.getAttribute('aria-disabled')).toBe('true');
  expect(element.hasAttribute('disabled')).toBe(false);
  expect(element.tabIndex).toBe(0);
}
