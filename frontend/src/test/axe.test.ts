// SPDX-License-Identifier: MIT
/**
 * The axe helper (axe.ts): an audit started while another is under way, as a test that timed out leaves one,
 * waits for it rather than failing with "Axe is already running", and an audit after a failed one runs.
 */
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { axeViolations, expectNoAxeViolations } from './axe';

describe('axeViolations', () => {
  beforeEach(() => {
    document.body.innerHTML = '<main><h1>Title</h1><button type="button">Go</button></main>';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is needed: axe itself refuses a second audit while one is under way', async () => {
    const first = axe.run(document.body);
    expect(() => axe.run(document.body)).toThrow('Axe is already running');
    await first;
  });

  it('waits for an audit still under way instead of failing', async () => {
    // Not awaited, as a test that timed out leaves it.
    const first = axeViolations();
    await expectNoAxeViolations();
    await expect(first).resolves.toEqual([]);
  });

  it('runs after an audit that failed', async () => {
    document.body.innerHTML = '<main><img src="x.png"></main>';
    const failed = axeViolations(document.createElement('div'));
    await expect(failed).rejects.toThrow();
    const findings = await axeViolations();
    expect(findings.map((finding) => finding.rule)).toContain('image-alt');
  });
});
