// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { isObject, isRecord } from './guards';

const values: ReadonlyArray<readonly [string, unknown, boolean, boolean]> = [
  // [what, value, isRecord, isObject]
  ['a plain object', { a: 1 }, true, true],
  ['an object without a prototype', Object.create(null), true, true],
  ['a class instance', new Date(0), true, true],
  ['an array', [1, 2], false, true],
  ['an empty array', [], false, true],
  ['null', null, false, false],
  ['undefined', undefined, false, false],
  ['a string', 'x', false, false],
  ['a number', 1, false, false],
  ['a boolean', true, false, false],
  ['a function', () => undefined, false, false],
];

describe('the record guards', () => {
  it.each(values)('%s: isRecord %#', (_, value, record) => {
    expect(isRecord(value)).toBe(record);
  });

  it.each(values)('%s: isObject %#', (_, value, _record, object) => {
    expect(isObject(value)).toBe(object);
  });
});
