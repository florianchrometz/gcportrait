// SPDX-License-Identifier: Apache-2.0

/**
 * A controllable window.matchMedia for jsdom (which has none): answers prefers-color-scheme queries and
 * lets a test flip the system scheme, firing `change` on every live query list.
 */
export type SystemSchemeControl = {
  setPrefersDark(prefersDark: boolean): void;
  readonly listenerCount: () => number;
  uninstall(): void;
};

export function installMatchMedia(initiallyDark: boolean): SystemSchemeControl {
  let prefersDark = initiallyDark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  const matchMedia = (query: string): MediaQueryList => {
    const isDarkQuery = query.replace(/\s+/g, '') === '(prefers-color-scheme:dark)';
    const list = {
      media: query,
      get matches() {
        return isDarkQuery && prefersDark;
      },
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    };
    return list as unknown as MediaQueryList;
  };

  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: matchMedia });

  return {
    setPrefersDark(value) {
      prefersDark = value;
      for (const listener of [...listeners]) listener({ matches: value } as MediaQueryListEvent);
    },
    listenerCount: () => listeners.size,
    uninstall() {
      Reflect.deleteProperty(window, 'matchMedia');
    },
  };
}
