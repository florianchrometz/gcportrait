// SPDX-License-Identifier: Apache-2.0
/** Shared lexical helpers of the catalog's small languages (JSONPath subset, predicates, templates). */

/** A malformed path, template or predicate in the catalog. */
export class CatalogSyntaxError extends Error {
  readonly source: string;
  readonly position: number;

  constructor(message: string, source: string, position: number) {
    super(`${message} at position ${String(position)} in ${JSON.stringify(source)}`);
    this.name = 'CatalogSyntaxError';
    this.source = source;
    this.position = position;
  }
}

/** Reads a quoted string starting at `start` (on the quote); returns the value and the index after it. */
export function readQuoted(source: string, start: number): { value: string; end: number } {
  const quote = source[start];
  let value = '';
  let i = start + 1;
  while (i < source.length) {
    const char = source.charAt(i);
    if (char === '\\') {
      const next = source[i + 1];
      if (next === undefined) break;
      value += next;
      i += 2;
      continue;
    }
    if (char === quote) return { value, end: i + 1 };
    value += char;
    i += 1;
  }
  throw new CatalogSyntaxError('unterminated string', source, start);
}
