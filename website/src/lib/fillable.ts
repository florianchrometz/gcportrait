// SPDX-License-Identifier: Apache-2.0
/**
 * Fillable commands on the docs pages, the parts without a DOM: what the build writes next to a code block and what
 * the page's script (src/components/Variables.astro) computes. Each `YOUR_…` token in a guide's code is a variable
 * of COMMAND_VARIABLES (@gcportrait/model); the build renders it as a field, and the script lets the visitor fill
 * it in. Every field of one variable on a page shows one value; Copy copies a block with the values, an unfilled
 * one as its token. The values of variables that are not secret are kept in the browser's local storage under one
 * key, so they are filled in again on every docs page; nothing leaves the browser.
 *
 * The shared helpers (fieldValue, unfilledNote, copiedMessage, resolveCommandParts) come from @gcportrait/model,
 * which imports no zod, so the page's script stays small without pulling the schema library into the bundle.
 */
import {
  COMMAND_VARIABLE_MAX_VALUE,
  copiedMessage,
  fieldValue,
  matchesVariablePattern,
  resolveCommandParts,
  unfilledNote,
  VARIABLE_NAME_PATTERN,
} from '@gcportrait/model';

export { copiedMessage, fieldValue, matchesVariablePattern as matchesPattern, unfilledNote };

/** The one local-storage key: a JSON object of variable name → value, non-secret variables only. */
export const STORAGE_KEY = 'gcportrait.docs.variables';

/** A piece of a code block: its text, or a field standing for a variable. */
export type BlockPart = string | { readonly name: string };

/** The text a code block's Copy button copies, and the distinct variables in it that are still unfilled. */
export function resolveBlock(
  parts: readonly BlockPart[],
  values: Readonly<Record<string, string>>,
): { readonly text: string; readonly unfilled: readonly string[] } {
  return resolveCommandParts(parts, values);
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
      VARIABLE_NAME_PATTERN.test(name) &&
      typeof value === 'string' &&
      value !== '' &&
      value.length <= COMMAND_VARIABLE_MAX_VALUE &&
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
    if (
      VARIABLE_NAME_PATTERN.test(name) &&
      value !== '' &&
      value.length <= COMMAND_VARIABLE_MAX_VALUE &&
      !isSecret(name)
    )
      kept[name] = value;
  }
  return Object.keys(kept).length === 0 ? null : JSON.stringify(kept);
}
