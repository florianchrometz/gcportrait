// SPDX-License-Identifier: MIT
/**
 * The values typed into command fields, for this tab (commands/values.ts has the rules): one entry per variable, so
 * every field of a variable, in every command on a page, shows one value; kept in sessionStorage under one key
 * (variables that are not secret only), so a reload or another page of the app in this tab shows them again, and
 * nothing outlives the tab. Where storage is blocked the values stay in memory. Read with `useSyncExternalStore`
 * (commands/useCommandVariables.ts); the store is read from sessionStorage when it is first asked, not on import.
 */
import {
  fieldValue,
  matchesFormat,
  readStoredEntries,
  STORAGE_KEY,
  storedEntriesText,
  type Entries,
} from './values';

export interface VariablesSnapshot {
  readonly entries: Entries;
  /** Variables whose value a field found not of the variable's format on leaving it (a hint, never a refusal). */
  readonly invalid: ReadonlySet<string>;
}

let snapshot: VariablesSnapshot | null = null;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readStored(): string | null {
  try {
    return storage()?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function getVariablesSnapshot(): VariablesSnapshot {
  snapshot ??= { entries: readStoredEntries(readStored()), invalid: new Set() };
  return snapshot;
}

export function subscribeVariables(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function commit(next: VariablesSnapshot, persist: boolean): void {
  snapshot = next;
  if (persist) {
    try {
      const text = storedEntriesText(next.entries);
      if (text === null) storage()?.removeItem(STORAGE_KEY);
      else storage()?.setItem(STORAGE_KEY, text);
    } catch {
      // Storage is full or blocked: the values stay in this tab's memory.
    }
  }
  for (const listener of listeners) listener();
}

/** Gives the variable `name` the value typed (`raw`), over the fact the app knows of it now (`fact`). */
export function setVariable(name: string, raw: string, fact: string | undefined): void {
  const current = getVariablesSnapshot();
  const value = fieldValue(raw);
  const basis = fact ?? '';
  const entries = Object.fromEntries(Object.entries(current.entries).filter(([key]) => key !== name));
  // Typing the fact itself (or emptying a field the app knows nothing for) leaves nothing to keep.
  if (value !== basis) entries[name] = { value, basis };
  let invalid = current.invalid;
  if (invalid.has(name) && matchesFormat(name, value)) {
    invalid = new Set([...invalid].filter((key) => key !== name));
  }
  commit({ entries, invalid }, true);
}

/** On leaving a field: marks the variable when `value` is not of its format, unmarks it when it is. */
export function checkVariable(name: string, value: string): void {
  const current = getVariablesSnapshot();
  const bad = !matchesFormat(name, value);
  if (bad === current.invalid.has(name)) return;
  const invalid = new Set([...current.invalid].filter((key) => key !== name));
  if (bad) invalid.add(name);
  commit({ entries: current.entries, invalid }, false);
}

/** Forgets every value typed (the app's facts show again). */
export function clearVariables(): void {
  commit({ entries: {}, invalid: new Set() }, true);
}

/** For tests: forgets the in-memory values, so the next read starts from sessionStorage again. */
export function resetVariablesForTests(): void {
  snapshot = null;
}
