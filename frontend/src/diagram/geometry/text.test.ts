// SPDX-License-Identifier: Apache-2.0
import { measureText } from '@gcportrait/layout';
import { describe, expect, it } from 'vitest';

import { ELLIPSIS, fitRuns, fitSubtitle, fitText, runsWidth } from './text';

describe('fitText', () => {
  it('leaves text that fits alone', () => {
    expect(fitText('orders-api', 700, 13, 200)).toBe('orders-api');
  });

  it('cuts text that does not fit with an ellipsis, within the width, as long as possible', () => {
    const text = 'eventarc-europe-west3-orders-handler-614468-sub-400';
    const cut = fitText(text, 700, 13, 120);
    expect(cut.endsWith(ELLIPSIS)).toBe(true);
    expect(measureText(cut, 700, 13)).toBeLessThanOrEqual(120);
    const longer = `${Array.from(text).slice(0, Array.from(cut).length).join('')}${ELLIPSIS}`;
    expect(measureText(longer, 700, 13)).toBeGreaterThan(120);
  });

  it('never splits a code point and drops trailing spaces before the ellipsis', () => {
    expect(fitText('ab 👩‍💻👩‍💻👩‍💻', 400, 13, measureText('ab …', 400, 13))).toBe('ab…');
  });

  it('gives nothing when not even the ellipsis fits', () => {
    expect(fitText('anything', 400, 13, 2)).toBe('');
  });
});

describe('fitRuns and fitSubtitle', () => {
  it('keeps whole runs while they fit and cuts the first that does not, in its own face', () => {
    const runs = fitSubtitle('10.0.0.4 · TCP · internal', 400, 10.5, 1000);
    expect(runs).toEqual([
      { text: '10.0.0.4', family: 'mono' },
      { text: ' · TCP · internal', family: 'sans' },
    ]);
    const width = measureText('10.0.0.4', 400, 10.5, { family: 'mono' }) + 12;
    const cut = fitRuns(runs, 400, 10.5, width);
    expect(cut[0]).toEqual({ text: '10.0.0.4', family: 'mono' });
    expect(cut[1]?.text.endsWith(ELLIPSIS)).toBe(true);
    expect(runsWidth(cut, 400, 10.5)).toBeLessThanOrEqual(width);
  });
});
