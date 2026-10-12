// SPDX-License-Identifier: MIT
/**
 * Type-ahead for menus and listboxes (WAI-ARIA APG): typed characters move to the next item whose label starts
 * with them; typing the same character again cycles through the items starting with it; the typed text is
 * forgotten after half a second without a key.
 */
import { useRef, type KeyboardEvent } from 'react';

/** How long typed characters are remembered (ms). */
export const TYPEAHEAD_MS = 500;

/** Whether a key press types a character (not a shortcut, not Space, which activates). */
export function isTypeaheadKey(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>,
): boolean {
  return event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey;
}

/**
 * The index of the item `query` moves to from `from`, or -1: the next label (after `from` for one character or
 * a repeated one, from `from` itself for a longer word) that starts with it, ignoring case, wrapping around.
 */
export function typeaheadMatch(labels: readonly string[], from: number, query: string): number {
  const typed = query.toLocaleLowerCase();
  if (typed === '' || labels.length === 0) return -1;
  const first = typed.charAt(0);
  const repeated = typed.split(first).every((part) => part === '');
  const search = repeated ? first : typed;
  const start = repeated ? from + 1 : Math.max(0, from);
  for (let offset = 0; offset < labels.length; offset += 1) {
    const index = (((start + offset) % labels.length) + labels.length) % labels.length;
    if (labels[index]?.toLocaleLowerCase().startsWith(search) === true) return index;
  }
  return -1;
}

/** Remembers typed characters for `TYPEAHEAD_MS`; `type(key)` returns the text typed so far. */
export function useTypeahead(): (key: string) => string {
  const buffer = useRef({ text: '', at: 0 });
  return (key: string): string => {
    const now = Date.now();
    const text = now - buffer.current.at > TYPEAHEAD_MS ? key : buffer.current.text + key;
    buffer.current = { text, at: now };
    return text;
  };
}
