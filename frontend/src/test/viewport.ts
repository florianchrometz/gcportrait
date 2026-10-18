// SPDX-License-Identifier: Apache-2.0
/**
 * A window of a given width for jsdom, which lays nothing out and has no matchMedia: `window.innerWidth` and a
 * `window.matchMedia` that answers width queries (`(min-width: …rem|px)`, `(max-width: …)`, joined by `and`, listed
 * with commas) for that width at a 16-pixel rem, and every other query (the colour scheme, motion) with no match.
 */
export interface ViewportControl {
  uninstall(): void;
}

const REM = 16;

/** Whether one width condition (`(min-width: 48rem)`) holds at `width`; null when it is no width condition. */
function widthCondition(condition: string, width: number): boolean | null {
  const match = /^\((min|max)-width:\s*([\d.]+)(rem|px)\)$/.exec(condition.trim());
  if (match === null) return null;
  const [, bound, amount, unit] = match;
  const pixels = Number(amount) * (unit === 'rem' ? REM : 1);
  return bound === 'min' ? width >= pixels : width <= pixels;
}

/** Whether a media query list holds at `width`. */
export function matchesAt(query: string, width: number): boolean {
  return query.split(',').some((part) =>
    part
      .split(/\band\b/)
      .map((condition) => widthCondition(condition, width))
      .every((holds) => holds === true),
  );
}

export function installViewport(width: number): ViewportControl {
  const previousWidth = window.innerWidth;
  const matchMedia = (query: string): MediaQueryList => {
    const list = {
      media: query,
      matches: matchesAt(query, width),
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    };
    return list;
  };
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: matchMedia });
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  return {
    uninstall() {
      Reflect.deleteProperty(window, 'matchMedia');
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        writable: true,
        value: previousWidth,
      });
    },
  };
}
