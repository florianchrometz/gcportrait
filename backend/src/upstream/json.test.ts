// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { isRecord, parseJson, readJson } from './json.js';

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('readJson (an answer’s body)', () => {
  it.each<readonly [string, Uint8Array, unknown]>([
    ['an object', utf8('{"error":{"status":"NOT_FOUND"}}'), { error: { status: 'NOT_FOUND' } }],
    ['an array', utf8('[1,"two"]'), [1, 'two']],
    ['a string', utf8('"page-token"'), 'page-token'],
    ['a number', utf8('42'), 42],
    ['null', utf8('null'), null],
    ['text around the value', utf8(' \n{"a":1}\n'), { a: 1 }],
    [
      'non-ASCII text',
      utf8('{"message":"Zugriff verweigert für „demo“"}'),
      { message: 'Zugriff verweigert für „demo“' },
    ],
    ['a byte-order mark first', new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('{"a":1}')]), { a: 1 }],
  ])('reads %s', (_label, body, expected) => {
    expect(readJson(body)).toEqual(expected);
  });

  it.each<readonly [string, Uint8Array]>([
    ['an empty body', new Uint8Array(0)],
    ['whitespace only', utf8(' \n')],
    ['an HTML page', utf8('<!DOCTYPE html><html><body>Error 404</body></html>')],
    ['truncated JSON', utf8('{"error":{"status":')],
    ['two values', utf8('{} {}')],
    ['invalid UTF-8', new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x3a, 0x31, 0x7d])],
    ['a lone continuation byte', new Uint8Array([0x22, 0x80, 0x22])],
    ['an overlong encoding', new Uint8Array([0x22, 0xc0, 0xaf, 0x22])],
  ])('gives undefined for %s, never throwing', (_label, body) => {
    expect(readJson(body)).toBeUndefined();
  });
});

describe('parseJson (text)', () => {
  it.each<readonly [string, unknown]>([
    ['{"error":"invalid_grant"}', { error: 'invalid_grant' }],
    ['[]', []],
    ['"x"', 'x'],
    ['null', null],
  ])('reads %s', (text, expected) => {
    expect(parseJson(text)).toEqual(expected);
  });

  it.each(['', 'not json', '{', '{"a":1}}', 'undefined'])('gives undefined for %j', (text) => {
    expect(parseJson(text)).toBeUndefined();
  });
});

describe('isRecord', () => {
  it.each<readonly [string, unknown, boolean]>([
    ['an object', { a: 1 }, true],
    ['an empty object', {}, true],
    ['an object without a prototype', Object.create(null) as unknown, true],
    ['an array', [], false],
    ['null', null, false],
    ['undefined', undefined, false],
    ['a string', 'x', false],
    ['a number', 1, false],
    ['a boolean', true, false],
  ])('%s', (_label, value, expected) => {
    expect(isRecord(value)).toBe(expected);
  });
});
