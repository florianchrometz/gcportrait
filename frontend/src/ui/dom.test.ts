// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from 'vitest';

import { capturePointer, prefersReducedMotion, releasePointer } from './dom';

describe('pointer capture', () => {
  it('captures and lets go where the element supports it, and only a pointer it holds', () => {
    const held = new Set<number>();
    const release = vi.fn((id: number) => held.delete(id));
    const element = {
      setPointerCapture: (id: number) => held.add(id),
      hasPointerCapture: (id: number) => held.has(id),
      releasePointerCapture: release,
    } as unknown as Element;
    capturePointer(element, 3);
    expect(held.has(3)).toBe(true);
    releasePointer(element, 4);
    expect(release).not.toHaveBeenCalled();
    releasePointer(element, 3);
    expect(release).toHaveBeenCalledWith(3);
    expect(held.size).toBe(0);
  });

  it('does nothing where the element has no pointer capture (jsdom)', () => {
    const element = {} as Element;
    expect(() => {
      capturePointer(element, 1);
      releasePointer(element, 1);
    }).not.toThrow();
  });
});

describe('reduced motion', () => {
  const view = (matches: boolean): Pick<Window, 'matchMedia'> => ({
    matchMedia: (query: string) =>
      ({ matches: matches && query === '(prefers-reduced-motion: reduce)' }) as MediaQueryList,
  });

  it('asks the given window for prefers-reduced-motion', () => {
    expect(prefersReducedMotion(view(true))).toBe(true);
    expect(prefersReducedMotion(view(false))).toBe(false);
  });

  it('answers no without a window or without matchMedia', () => {
    expect(prefersReducedMotion(null)).toBe(false);
    expect(prefersReducedMotion(undefined)).toBe(false);
    expect(prefersReducedMotion({})).toBe(false);
  });
});
