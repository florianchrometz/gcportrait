// SPDX-License-Identifier: Apache-2.0
/**
 * Fillable commands on the docs pages, the parts without a DOM: what the build writes next to a code block and what
 * the page's script (src/components/Variables.astro) computes. Each `YOUR_…` token in a guide's code is a variable
 * of COMMAND_VARIABLES (@gcportrait/model); the build renders it as a field, and the script lets the visitor fill
 * it in. Every field of one variable on a page shows one value; Copy copies a block with the values, an unfilled
 * one as its token. The values of variables that are not secret are kept in the browser's local storage under one
 * key, so they are filled in again on every docs page; nothing leaves the browser.
 *
 * This module imports nothing, so the page's script stays small (docs/website.md, "Fillable commands").
 */

/** The one local-storage key: a JSON object of variable name → value, non-secret variables only. */
export const STORAGE_KEY = 'gcportrait.docs.variables';

/** A stored value longer than this is dropped (nothing a command needs is this long). */
const MAX_VALUE = 500;

const NAME = /^YOUR_[A-Z0-9]+(?:_[A-Z0-9]+)*$/;

/** The note next to a code block's Copy button: how many of its variables are still to fill. */
export function unfilledNote(count: number): string {
  if (count <= 0) return '';
  return count === 1 ? '1 value to fill' : `${String(count)} values to fill`;
}

/** What the live region says after a copy, with the tokens that were copied unfilled. */
export function copiedMessage(unfilled: readonly string[]): string {
  if (unfilled.length === 0) return 'Copied.';
  const what = unfilled.length === 1 ? 'value' : 'values';
  return `Copied, with ${String(unfilled.length)} ${what} still to fill: ${unfilled.join(', ')}.`;
}

/** A value as typed into a field: line breaks and tabs (from a paste) removed. */
export function fieldValue(raw: string): string {
  return raw.replace(/[\r\n\t]+/g, '');
}

/** Whether `value` has the format of `pattern` (a JavaScript regular expression source); an empty value does. */
export function matchesPattern(pattern: string, value: string): boolean {
  if (value === '') return true;
  try {
    return new RegExp(pattern, 'u').test(value);
  } catch {
    return true;
  }
}

/** A piece of a code block: its text, or a field standing for a variable. */
export type BlockPart = string | { readonly name: string };

/** The text a code block's Copy button copies, and the distinct variables in it that are still unfilled. */
export function resolveBlock(
  parts: readonly BlockPart[],
  values: Readonly<Record<string, string>>,
): { readonly text: string; readonly unfilled: readonly string[] } {
  const unfilled: string[] = [];
  let text = '';
  for (const part of parts) {
    if (typeof part === 'string') {
      text += part;
      continue;
    }
    const value = (values[part.name] ?? '').trim();
    if (value === '') {
      text += part.name;
      if (!unfilled.includes(part.name)) unfilled.push(part.name);
    } else {
      text += value;
    }
  }
  return { text, unfilled };
}

/** The values kept in local storage (`raw`), only well-formed entries whose name `keep` accepts. */
export function readStoredValues(
  raw: string | null,
  keep: (name: string) => boolean = () => true,
): Record<string, string> {
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (
      NAME.test(name) &&
      typeof value === 'string' &&
      value !== '' &&
      value.length <= MAX_VALUE &&
      keep(name)
    ) {
      values[name] = value;
    }
  }
  return values;
}

/**
 * What to keep in local storage: the non-empty values of variables that are not secret, as JSON; null when
 * nothing remains (the key is then removed).
 */
export function storedValuesText(
  values: Readonly<Record<string, string>>,
  isSecret: (name: string) => boolean,
): string | null {
  const kept: Record<string, string> = {};
  for (const [name, raw] of Object.entries(values)) {
    const value = raw.trim();
    if (NAME.test(name) && value !== '' && value.length <= MAX_VALUE && !isSecret(name)) kept[name] = value;
  }
  return Object.keys(kept).length === 0 ? null : JSON.stringify(kept);
}
