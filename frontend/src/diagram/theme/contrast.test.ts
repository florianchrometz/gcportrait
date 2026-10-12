// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { blendOver, contrastRatio, parseHex, readableOn, relativeLuminance } from './contrast';

describe('WCAG contrast', () => {
  it('computes relative luminance and the ratio per WCAG 2.2', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBe(1);
    expect(contrastRatio('#000000', '#FFFFFF')).toBe(21);
    expect(contrastRatio('#FFFFFF', '#000000')).toBe(21);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
    // Reference value: #767676 on white is the classic 4.54 : 1.
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
  });

  it('reads only #RRGGBB', () => {
    expect(parseHex('#1a73E8')).toEqual([26, 115, 232]);
    expect(() => parseHex('#fff')).toThrow();
    expect(() => parseHex('red')).toThrow();
  });

  it('blends a translucent colour over its background as a browser composites it (the ghosts)', () => {
    expect(blendOver('#FFFFFF', 0.5, '#000000')).toBe('#808080');
    expect(blendOver('#a8c7fa', 1, '#000000')).toBe('#A8C7FA');
    expect(blendOver('#FFFFFF', 0, '#1F1F1F')).toBe('#1F1F1F');
    expect(blendOver('#FFFFFF', 0.5, '#A8C7FA')).toBe('#D4E3FD');
  });

  it('picks the first readable candidate, else the most contrasting one', () => {
    expect(readableOn('#FFFFFF', ['#5F6368', '#202124'])).toBe('#5F6368');
    expect(readableOn('#A8C7FA', ['#5F6368', '#202124'])).toBe('#202124');
    expect(readableOn('#808080', ['#7F7F7F', '#000000'], 21)).toBe('#000000');
    expect(() => readableOn('#FFFFFF', [])).toThrow();
  });
});
