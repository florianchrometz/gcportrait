// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { isLicenseAllowed, licenseIdsOf } from './spdx-expression.mjs';

const ALLOWED = ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'MPL-2.0'];

describe('isLicenseAllowed', () => {
  it.each([
    ['MIT', true],
    ['mit', true],
    ['Apache-2.0', true],
    ['GPL-3.0-only', false],
    ['(MIT OR GPL-3.0-only)', true],
    ['GPL-3.0-only OR MIT', true],
    ['MIT AND BSD-3-Clause', true],
    ['MIT AND GPL-3.0-only', false],
    ['(MIT AND GPL-2.0-only) OR Apache-2.0', true],
    ['MIT AND (GPL-2.0-only OR Apache-2.0)', true],
    ['GPL-2.0-only WITH Classpath-exception-2.0', false],
    ['Apache-2.0 WITH LLVM-exception', true],
    ['MPL-2.0+', true],
    ['', false],
    ['Unknown', false],
    ['UNLICENSED', false],
    ['SEE LICENSE IN LICENSE.md', false],
    ['(MIT', false],
    ['MIT OR', false],
    ['MIT)', false],
  ])('%j -> %s', (expression, expected) => {
    expect(isLicenseAllowed(expression, ALLOWED)).toBe(expected);
  });
});

describe('licenseIdsOf', () => {
  it.each([
    ['MIT', ['MIT']],
    ['(MIT OR GPL-3.0-only)', ['MIT', 'GPL-3.0-only']],
    ['MIT and (LGPL-2.1+ or Apache-2.0)', ['MIT', 'LGPL-2.1', 'Apache-2.0']],
    ['GPL-2.0-only WITH Classpath-exception-2.0', ['GPL-2.0-only']],
    ['Apache-2.0 WITH LLVM-exception OR MIT', ['Apache-2.0', 'MIT']],
    ['', []],
    ['SEE LICENSE IN LICENSE.md', ['SEE', 'LICENSE', 'IN', 'LICENSE.md']],
  ])('%j -> %j', (expression, expected) => {
    expect(licenseIdsOf(expression)).toEqual(expected);
  });
});
