// SPDX-License-Identifier: Apache-2.0
/** An assertion for the parsers of the catalog's small languages, for the unit tests (not part of the public API). */
import { expect } from 'vitest';
import { CatalogSyntaxError } from '../engine/syntax.js';

/**
 * Parses `source` once and expects a CatalogSyntaxError whose message contains `message` and, when given, that
 * points at `position`. Returns the error for further checks.
 */
export function expectSyntaxError(
  parse: (source: string) => unknown,
  source: string,
  message: string,
  position?: number,
): CatalogSyntaxError {
  let thrown: unknown;
  try {
    parse(source);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(CatalogSyntaxError);
  const error = thrown as CatalogSyntaxError;
  expect(error.message).toContain(message);
  if (position !== undefined) expect(error.position).toBe(position);
  return error;
}
