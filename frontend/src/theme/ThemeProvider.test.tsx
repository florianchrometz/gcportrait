// SPDX-License-Identifier: Apache-2.0
import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createMemoryPreferenceStore,
  PreferenceStoreContext,
  type PreferenceKey,
  type Preferences,
  type PreferenceStore,
} from '../storage/preferences';
import { installMatchMedia, type SystemSchemeControl } from '../test/matchMedia';
import { THEME_MIRROR_KEY, THEME_PREFERENCES } from './theme';
import { ThemeProvider } from './ThemeProvider';
import { useTheme } from './useTheme';

function ThemeProbe() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <div>
      <output data-testid="preference">{preference}</output>
      <output data-testid="resolved">{resolved}</output>
      {THEME_PREFERENCES.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => {
            setPreference(option);
          }}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/** A store whose reads can be held back, recording every write. */
function controllableStore(initial: Partial<Preferences> = {}) {
  const writes: [PreferenceKey, unknown][] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  const store: PreferenceStore = {
    async get(key) {
      if (held) await gate;
      return initial[key];
    },
    set(key, value) {
      writes.push([key, value]);
      return Promise.resolve(true);
    },
  };
  return {
    store,
    writes,
    hold: () => {
      held = true;
    },
    release: () => {
      release();
    },
  };
}

function renderWithStore(store: PreferenceStore) {
  return render(
    <PreferenceStoreContext value={store}>
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    </PreferenceStoreContext>,
  );
}

const html = () => document.documentElement;
let media: SystemSchemeControl | undefined;

afterEach(() => {
  media?.uninstall();
  media = undefined;
  vi.restoreAllMocks();
});

describe('ThemeProvider and useTheme', () => {
  it('follows a light system by default', () => {
    media = installMatchMedia(false);
    renderWithStore(createMemoryPreferenceStore());
    expect(screen.getByTestId('preference').textContent).toBe('system');
    expect(html().dataset.theme).toBe('light');
    expect(html().dataset.themePreference).toBe('system');
  });

  it('follows the system scheme live while the preference is system', () => {
    media = installMatchMedia(true);
    renderWithStore(createMemoryPreferenceStore());
    expect(html().dataset.theme).toBe('dark');
    act(() => {
      media?.setPrefersDark(false);
    });
    expect(html().dataset.theme).toBe('light');
    expect(screen.getByTestId('resolved').textContent).toBe('light');
  });

  it('works without matchMedia at all', () => {
    renderWithStore(createMemoryPreferenceStore());
    expect(html().dataset.theme).toBe('light');
  });

  it('applies the stored preference and refreshes the mirror', async () => {
    media = installMatchMedia(false);
    renderWithStore(controllableStore({ theme: 'dark' }).store);
    expect(await screen.findByText('dark', { selector: '[data-testid="preference"]' })).toBeDefined();
    expect(html().dataset.theme).toBe('dark');
    // The mirror is written by a passive effect, which may run after findByText has already seen the text.
    await waitFor(() => {
      expect(window.localStorage.getItem(THEME_MIRROR_KEY)).toBe('dark');
    });
  });

  it('starts from the mirror before the store answers (no flash)', () => {
    media = installMatchMedia(false);
    window.localStorage.setItem(THEME_MIRROR_KEY, 'dark');
    const controlled = controllableStore();
    controlled.hold();
    renderWithStore(controlled.store);
    expect(html().dataset.theme).toBe('dark');
  });

  it('saves a choice to the store and the mirror', async () => {
    media = installMatchMedia(false);
    const controlled = controllableStore();
    renderWithStore(controlled.store);
    await userEvent.click(screen.getByRole('button', { name: 'dark' }));
    expect(html().dataset.theme).toBe('dark');
    expect(controlled.writes).toEqual([['theme', 'dark']]);
    expect(window.localStorage.getItem(THEME_MIRROR_KEY)).toBe('dark');
  });

  it('keeps an explicit choice when the system scheme changes', async () => {
    media = installMatchMedia(false);
    renderWithStore(createMemoryPreferenceStore());
    await userEvent.click(screen.getByRole('button', { name: 'light' }));
    act(() => {
      media?.setPrefersDark(true);
    });
    expect(html().dataset.theme).toBe('light');
  });

  it('does not let a late store read override a choice made meanwhile', async () => {
    media = installMatchMedia(false);
    const controlled = controllableStore({ theme: 'dark' });
    controlled.hold();
    renderWithStore(controlled.store);
    await userEvent.click(screen.getByRole('button', { name: 'light' }));
    await act(async () => {
      controlled.release();
      await Promise.resolve();
    });
    expect(screen.getByTestId('preference').textContent).toBe('light');
    expect(html().dataset.theme).toBe('light');
  });

  it('stops listening to the system scheme when unmounted', () => {
    media = installMatchMedia(false);
    const { unmount } = renderWithStore(createMemoryPreferenceStore());
    expect(media.listenerCount()).toBe(1);
    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it('refuses to be used outside the provider', () => {
    // React reports the render error on the console as well; keep the test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<ThemeProbe />)).toThrow(/ThemeProvider/);
  });
});
