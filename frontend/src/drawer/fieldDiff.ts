// SPDX-License-Identifier: MIT
/**
 * A small deep diff of two `resource.data` values (the drawer's "What changed" summary of a changed asset).
 * Pure and deterministic: objects are walked key by key in code-point order, arrays index by index, and every leaf
 * that differs (a value only on one side, or another value) is one entry with its dotted path. The summary keeps
 * the first `cap` entries with short JSON previews of the values and counts the rest; a value nested deeper than
 * `MAX_FIELD_DEPTH` is compared as a whole.
 */
import { isRecord } from '../guards';
import type { FieldChange, FieldSummary } from './types';

/** How many differences the summary lists (the rest are counted). */
export const FIELD_CAP = 12;
/** How long a value's preview is at most, in characters (cut with an ellipsis). */
export const PREVIEW_LENGTH = 60;
/** How deep the walk goes before comparing a value as a whole. */
export const MAX_FIELD_DEPTH = 16;
/** The path shown for `resource.data` itself (a value that is not an object on one side). */
export const ROOT_PATH = '(data)';

const IDENTIFIER = /^[A-Za-z_$][\w$-]*$/;

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** JSON.stringify typed as it behaves: it answers undefined for undefined, a function or a symbol. */
const toJson: (value: unknown) => string | undefined = JSON.stringify;

/**
 * `value` as JSON text, cut to `PREVIEW_LENGTH` characters. Data that crossed `postMessage` from parsed JSON has a
 * JSON text, `undefined` aside; anything else (a cycle, a function) is named by its type.
 */
export function preview(value: unknown): string {
  let text: string;
  try {
    text = toJson(value) ?? (value === undefined ? 'undefined' : typeof value);
  } catch {
    text = typeof value;
  }
  return text.length <= PREVIEW_LENGTH ? text : `${text.slice(0, PREVIEW_LENGTH - 1)}…`;
}

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function childPath(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${String(key)}]`;
  if (IDENTIFIER.test(key)) return path === '' ? key : `${path}.${key}`;
  return `${path}[${JSON.stringify(key)}]`;
}

/** The fields of `after` that differ from `before`: the first `cap` with their values, and how many more. */
export function fieldDiff(before: unknown, after: unknown, cap: number = FIELD_CAP): FieldSummary {
  const entries: FieldChange[] = [];
  let more = 0;
  const add = (path: string, kind: FieldChange['kind'], from: unknown, to: unknown): void => {
    if (entries.length >= cap) {
      more += 1;
      return;
    }
    entries.push({
      path: path === '' ? ROOT_PATH : path,
      kind,
      ...(kind === 'added' ? {} : { before: preview(from) }),
      ...(kind === 'removed' ? {} : { after: preview(to) }),
    });
  };
  const walk = (a: unknown, b: unknown, path: string, depth: number): void => {
    if (same(a, b)) return;
    if (depth < MAX_FIELD_DEPTH && isRecord(a) && isRecord(b)) {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(compareKeys);
      for (const key of keys) {
        const inA = Object.hasOwn(a, key);
        const inB = Object.hasOwn(b, key);
        const at = childPath(path, key);
        if (inA && inB) walk(a[key], b[key], at, depth + 1);
        else if (inB) add(at, 'added', undefined, b[key]);
        else add(at, 'removed', a[key], undefined);
      }
      return;
    }
    if (depth < MAX_FIELD_DEPTH && Array.isArray(a) && Array.isArray(b)) {
      const length = Math.max(a.length, b.length);
      for (let index = 0; index < length; index += 1) {
        const at = childPath(path, index);
        if (index >= a.length) add(at, 'added', undefined, b[index]);
        else if (index >= b.length) add(at, 'removed', a[index], undefined);
        else walk(a[index], b[index], at, depth + 1);
      }
      return;
    }
    if (a === undefined) add(path, 'added', a, b);
    else if (b === undefined) add(path, 'removed', a, b);
    else add(path, 'changed', a, b);
  };
  walk(before, after, '', 0);
  return { entries, more };
}
