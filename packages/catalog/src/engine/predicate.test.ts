// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { evaluatePredicate, parsePredicate, testPredicate } from './predicate.js';
import { expectSyntaxError } from '../testing/syntax.js';

const asset = {
  name: '//compute.googleapis.com/projects/demo-net-1/global/routes/default-route-1',
  data: {
    name: 'default-route-1',
    status: 'TERMINATED',
    state: 'ACTIVE',
    disabled: true,
    priority: 1000,
    sizeGb: '200',
    tags: ['web', 'blue'],
    nextHopNetwork: 'https://www.googleapis.com/compute/v1/projects/demo-net-1/global/networks/core',
    nothing: null,
    zero: 0,
    blank: '',
  },
};

describe('evaluatePredicate', () => {
  it.each([
    // comparisons
    ["$.data.status == 'TERMINATED'", true],
    ['$.data.status == "RUNNING"', false],
    ["$.data.state != 'ACTIVE'", false],
    ["$.data.status != 'ACTIVE'", true],
    ["$.data.missing != 'ACTIVE'", false],
    ['$.data.disabled == true', true],
    ['$.data.disabled == false', false],
    ['$.data.nothing == null', true],
    ['$.data.priority >= 1000', true],
    ['$.data.priority > 1000', false],
    ['$.data.priority < 1001', true],
    ['$.data.priority <= 999', false],
    ['$.data.sizeGb > 100', true],
    ['$.data.sizeGb == 200', true],
    ["$.data.status > 'A'", false],
    ['$.data.tags[*] == "blue"', true],
    // lists
    ["$.data.status in ['TERMINATED', 'STOPPED']", true],
    ["$.data.status in ['RUNNING']", false],
    ['$.data.status in []', false],
    ["$.data.state not in ['ACTIVE']", false],
    ["$.data.status not in ['ACTIVE']", true],
    ["$.data.missing not in ['ACTIVE']", false],
    ["$.data.tags[*] not in ['green']", true],
    // presence
    ['$.data.nextHopNetwork exists', true],
    ['$.data.nothing exists', false],
    ['$.data.missing missing', true],
    ['$.data.nothing missing', true],
    ['$.data.name missing', false],
    // truthiness of a bare path
    ['$.data.disabled', true],
    ['$.data.zero', false],
    ['$.data.blank', false],
    ['$.data.nothing', false],
    ['$.data.missing', false],
    // strings
    ["$.data.name startsWith 'default-route-'", true],
    ["$.data.name endsWith '-1'", true],
    ["$.data.name contains 'route'", true],
    ["$.data.priority startsWith '1'", false],
    // boolean operators and precedence
    ["$.data.nextHopNetwork exists && $.data.name startsWith 'default-route-'", true],
    ["$.data.missing exists && $.data.name startsWith 'default-route-'", false],
    ['$.data.missing exists || $.data.disabled == true', true],
    ['$.data.missing exists || $.data.disabled == false && $.data.zero', false],
    ['($.data.missing exists || $.data.disabled == true) && $.data.zero', false],
    ['!$.data.disabled', false],
    ['!($.data.missing exists)', true],
    ["$.data.tags[?(@ == 'web')] exists", true],
  ])('%s → %s', (predicate, expected) => {
    expect(evaluatePredicate(predicate, asset)).toBe(expected);
  });

  it('is false for a malformed predicate, the second time too (the cache-hit path)', () => {
    expect(evaluatePredicate('$.data.status ===', asset)).toBe(false);
    expect(evaluatePredicate('$.data.status ===', asset)).toBe(false);
  });

  it('evaluates a parsed predicate against a separate current item', () => {
    const parsed = parsePredicate("@.key == 'a' && $.flag", { allowCurrent: true });
    expect(testPredicate(parsed, { flag: true }, { key: 'a' })).toBe(true);
    expect(testPredicate(parsed, { flag: false }, { key: 'a' })).toBe(false);
  });
});

describe('parsePredicate', () => {
  it('builds or-of-and trees', () => {
    const parsed = parsePredicate('$.a || $.b && $.c');
    expect(parsed.kind).toBe('or');
    expect(parsed.kind === 'or' && parsed.items[1]?.kind).toBe('and');
  });

  it.each([
    ['an empty predicate', '', 'expected a path starting with $'],
    ['a value without a path', "'x' == $.a", 'expected a path starting with $'],
    ['a missing value', '$.a ==', 'expected a value'],
    ['a bare word value', '$.a == ACTIVE', 'expected a quoted string, a number, true, false or null'],
    ['a symbol as value', '$.a == )', 'expected a quoted string'],
    ['an unknown operator', '$.a matches "x"', 'unknown operator matches'],
    ['not without in', "$.a not ['x']", 'expected in after not'],
    ['an unclosed list', "$.a in ['x'", 'expected ]'],
    ['a list without brackets', "$.a in 'x'", 'expected ['],
    ['startsWith without a string', '$.a startsWith 1', 'expected a quoted string'],
    ['an unclosed group', '($.a', 'expected )'],
    ['trailing input', '$.a == 1 2', 'unexpected input'],
    ['a stray character', '$.a == 1 #', 'unexpected "#"'],
    ['a malformed path', '$..a', 'recursive descent'],
    ['@ outside a filter', '@.a', 'a path starts with $'],
    ['an unterminated string', "$.a == 'x", 'unterminated string'],
  ])('rejects %s', (_case, source, message) => {
    expectSyntaxError(parsePredicate, source, message);
  });
});
