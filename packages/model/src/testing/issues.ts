// SPDX-License-Identifier: MIT
import type { z } from 'zod';

/** The dotted paths of the issues a schema reports for a value; empty when the value is valid. */
export function issuePaths(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.map(String).join('.'));
}

/** Each issue a schema reports for a value as `path: message`; empty when the value is valid. */
export function issueLines(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`);
}

/** The messages of the issues a schema reports for a value; empty when the value is valid. */
export function issueMessages(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

/** The value, which a fixture guarantees to exist; fails the test loudly otherwise. */
export function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('the fixture does not have the expected entry');
  return value;
}

/** A shallow copy of an object without some of its keys. */
export function without<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...value };
  for (const key of keys) Reflect.deleteProperty(copy, key);
  return copy;
}

/** A fresh value from `make`, changed in place by `change`: a valid sample with one thing planted in it. */
export function withChange<T>(make: () => T, change: (value: T) => void): T {
  const value = make();
  change(value);
  return value;
}
