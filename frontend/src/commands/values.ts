// SPDX-License-Identifier: Apache-2.0
/**
 * Fillable commands in the app, the parts without React: which value each variable of a command shows, the text a
 * Copy button copies, what the session keeps, and the facts the app already knows. The variables themselves (name,
 * label, description, synthetic example, format, secret) are COMMAND_VARIABLES in `@gcportrait/model`, the one
 * registry the website's docs share; a command's text names them as tokens (`YOUR_ORG_ID`), and every registered
 * token becomes a field (commands/VariableField.tsx).
 *
 * A variable's value: what the person typed over what the app knows, as long as the app still knows the same thing;
 * a fact that changes (another scope picked, another account signed in) shows again. So an entry keeps the fact it
 * was typed over (`basis`): `{ value: '20000000002', basis: '20000000001' }` shows 20000000002 while the folder picked
 * is 20000000001, and the new folder's number once another is picked.
 */
import {
  commandVariable,
  isCommandVariableValue,
  splitVariableTokens,
  VARIABLE_NAME_PATTERN,
  type CommandVariableName,
} from '@gcportrait/model';

import type { ScopeChoice, ScopeKind } from '../scope/scopeName';

/** The one sessionStorage key: a JSON object of variable name → entry, variables that are not secret only. */
export const STORAGE_KEY = 'gcportrait.commandVariables';

/** A stored value longer than this is dropped (nothing a command needs is this long). */
const MAX_VALUE = 500;

/** What the person typed into a variable's field, over the fact the app knew then ('' for none). */
export interface Entry {
  readonly value: string;
  readonly basis: string;
}

export type Entries = Readonly<Record<string, Entry>>;

/** What the app knows of some variables (the scope picked, the account signed in, the instance's account). */
export type Facts = Readonly<Partial<Record<CommandVariableName, string>>>;

/** The variable that stands for a scope's id in a command, by the scope's kind. */
export const SCOPE_ID_VARIABLES = {
  organization: 'YOUR_ORG_ID',
  folder: 'YOUR_FOLDER_ID',
  project: 'YOUR_PROJECT_ID',
} as const satisfies Readonly<Record<ScopeKind, CommandVariableName>>;

/** An email that is safe inside a double-quoted shell word (the backend's own rule, preflight/commands.ts). */
const SAFE_EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$/;

/** `email` when {@link SAFE_EMAIL} holds it, else undefined: the app's one rule for an email in a command. */
export function safeEmail(email: string | null): string | undefined {
  return email !== null && SAFE_EMAIL.test(email) ? email : undefined;
}

/**
 * What the app knows: the scope picked (its id under its kind's variable, YOUR_SCOPE_ID and YOUR_SCOPE_KIND), the
 * quota project (or a project scope itself, which the check tries first), the signed-in account's email, and the
 * instance's service account. Nothing for what it does not know: signed out, in demo mode, on a demo-only instance.
 */
export function commandFacts({
  scope,
  quotaProject,
  email,
  serviceAccount,
}: {
  readonly scope: Pick<ScopeChoice, 'kind' | 'id'> | null;
  readonly quotaProject: string | null;
  readonly email: string | null;
  readonly serviceAccount: string | null;
}): Facts {
  const facts: Partial<Record<CommandVariableName, string>> = {};
  if (scope !== null) {
    facts[SCOPE_ID_VARIABLES[scope.kind]] = scope.id;
    facts.YOUR_SCOPE_ID = scope.id;
    facts.YOUR_SCOPE_KIND = scope.kind;
  }
  const quota = quotaProject ?? (scope?.kind === 'project' ? scope.id : null);
  if (quota !== null) facts.YOUR_QUOTA_PROJECT = quota;
  const account = safeEmail(email);
  if (account !== undefined) facts.YOUR_EMAIL = account;
  const robot = safeEmail(serviceAccount);
  if (robot !== undefined) facts.YOUR_SA_EMAIL = robot;
  return facts;
}

/** The value a variable shows: what was typed over the fact known now, else that fact, else what was typed. */
export function effectiveValue(entry: Entry | undefined, fact: string | undefined): string {
  if (entry !== undefined && (fact === undefined || entry.basis === fact)) return entry.value;
  return fact ?? '';
}

/** Every variable's value, typed or known ('' or absent: unfilled). */
export function effectiveValues(entries: Entries, facts: Facts): Readonly<Record<string, string>> {
  const known: Readonly<Record<string, string | undefined>> = facts;
  const values: Record<string, string> = {};
  for (const name of new Set([...Object.keys(entries), ...Object.keys(facts)])) {
    values[name] = effectiveValue(entries[name], known[name]);
  }
  return values;
}

/** A value as typed into a field: line breaks and tabs (from a paste) removed. */
export function fieldValue(raw: string): string {
  return raw.replace(/[\r\n\t]+/g, '');
}

/** Whether `value` has the format of the variable `name`; an empty value and an unregistered name do. */
export function matchesFormat(name: string, value: string): boolean {
  const variable = commandVariable(name);
  return value.trim() === '' || variable === undefined || isCommandVariableValue(variable, value.trim());
}

/** Whether `name` is a registered variable that is a secret (never kept). */
export function isSecret(name: string): boolean {
  return commandVariable(name)?.secret === true;
}

/**
 * The text a command's Copy button copies: each registered token replaced by its value, an unfilled one left as its
 * token; and the distinct tokens left unfilled, in order. Text and unregistered tokens are copied as they are.
 */
export function resolveCommand(
  command: string,
  values: Readonly<Record<string, string>>,
): { readonly text: string; readonly unfilled: readonly string[] } {
  const unfilled: string[] = [];
  let text = '';
  for (const part of splitVariableTokens(command)) {
    if (typeof part === 'string') {
      text += part;
      continue;
    }
    const value = commandVariable(part.token) === undefined ? '' : (values[part.token] ?? '').trim();
    if (value !== '') {
      text += value;
      continue;
    }
    text += part.token;
    if (commandVariable(part.token) !== undefined && !unfilled.includes(part.token))
      unfilled.push(part.token);
  }
  return { text, unfilled };
}

/** The note a Copy button is described by: how many of its command's values are still to fill. */
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

function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.value === 'string' &&
    typeof record.basis === 'string' &&
    record.value.length <= MAX_VALUE &&
    record.basis.length <= MAX_VALUE
  );
}

/** The entries kept in sessionStorage (`raw`): only well-formed ones of registered variables that are not secret. */
export function readStoredEntries(raw: string | null): Entries {
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const entries: Record<string, Entry> = {};
  for (const [name, entry] of Object.entries(parsed)) {
    if (
      VARIABLE_NAME_PATTERN.test(name) &&
      commandVariable(name) !== undefined &&
      !isSecret(name) &&
      isEntry(entry)
    )
      entries[name] = { value: entry.value, basis: entry.basis };
  }
  return entries;
}

/** What to keep in sessionStorage: the entries of variables that are not secret, as JSON; null when none remain. */
export function storedEntriesText(entries: Entries): string | null {
  const kept: Record<string, Entry> = {};
  for (const [name, entry] of Object.entries(entries)) {
    if (!isSecret(name) && commandVariable(name) !== undefined && isEntry(entry)) kept[name] = entry;
  }
  return Object.keys(kept).length === 0 ? null : JSON.stringify(kept);
}
