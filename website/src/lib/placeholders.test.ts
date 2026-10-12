// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { placeholdersIn } from './placeholders.js';

describe('placeholdersIn', () => {
  it('finds capitalised placeholders in brackets, braces and angle brackets, and the TODO markers', () => {
    const text =
      'Name: [FULL NAME]\nStreet: {{STREET}}\nPostcode: <POSTCODE>\nEmail: [EMAIL ADDRESS]\nTODO: check\n[FULL NAME]';
    expect(placeholdersIn(text)).toEqual([
      '[FULL NAME]',
      '{{STREET}}',
      '<POSTCODE>',
      '[EMAIL ADDRESS]',
      'TODO',
    ]);
  });

  it('leaves Markdown links, ordinary brackets and code alone', () => {
    const text =
      'See [the guide](self-host.md), (a note), [x], `[NOT A PLACEHOLDER]` and\n```\n<VALUE>\n```\nTODOs aside.';
    expect(placeholdersIn(text)).toEqual([]);
  });
});
