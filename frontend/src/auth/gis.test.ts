// SPDX-License-Identifier: MIT
/**
 * Google's script is loaded on demand, once, from exactly GIS_SCRIPT_URL; a failure leaves nothing behind so the
 * next press tries again; an API already on the page (a second click, a test's stand-in) is used as it is.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GIS_SCRIPT_URL, GisLoadError, loadGis, readGis } from './gis';
import { fakeGis } from './testing';

type GoogleHost = { google?: unknown };

function scripts(): HTMLScriptElement[] {
  return [...document.querySelectorAll<HTMLScriptElement>('script')].filter(
    (script) => script.src === GIS_SCRIPT_URL,
  );
}

afterEach(() => {
  delete (window as GoogleHost).google;
  for (const script of scripts()) script.remove();
  vi.useRealTimers();
});

describe('readGis', () => {
  it('finds google.accounts.oauth2 only when its two functions are there', () => {
    const gis = fakeGis();
    expect(readGis({ google: { accounts: { oauth2: gis.oauth2 } } })).not.toBeNull();
    expect(readGis({})).toBeNull();
    expect(readGis({ google: { accounts: {} } })).toBeNull();
    expect(readGis({ google: { accounts: { oauth2: { initTokenClient: () => null } } } })).toBeNull();
    expect(readGis(null)).toBeNull();
  });

  it('refuses a token client without requestAccessToken', () => {
    const gis = readGis({
      google: { accounts: { oauth2: { initTokenClient: () => ({}), revoke: () => null } } },
    });
    expect(() =>
      gis?.initTokenClient({ client_id: 'x', scope: 's', callback: () => null, error_callback: () => null }),
    ).toThrow(GisLoadError);
  });
});

describe('loadGis', () => {
  it('adds one async script for GIS, once, and resolves when it has set itself up', async () => {
    const first = loadGis(document);
    const second = loadGis(document);
    expect(second).toBe(first);
    const [script, ...others] = scripts();
    expect(others).toEqual([]);
    expect(script?.async).toBe(true);
    (window as GoogleHost).google = { accounts: { oauth2: fakeGis().oauth2 } };
    script?.dispatchEvent(new Event('load'));
    const gis = await first;
    expect(typeof gis.initTokenClient).toBe('function');
    // Already there: no second script.
    await loadGis(document);
    expect(scripts()).toHaveLength(1);
  });

  it('uses an API that is already on the page without adding a script', async () => {
    (window as GoogleHost).google = { accounts: { oauth2: fakeGis().oauth2 } };
    await loadGis(document);
    expect(scripts()).toEqual([]);
  });

  it('fails on a load error, removes its script and lets the next call try again', async () => {
    const load = loadGis(document);
    scripts()[0]?.dispatchEvent(new Event('error'));
    await expect(load).rejects.toThrow(/could not be loaded/);
    expect(scripts()).toEqual([]);
    const again = loadGis(document);
    expect(again).not.toBe(load);
    expect(scripts()).toHaveLength(1);
    scripts()[0]?.dispatchEvent(new Event('error'));
    await expect(again).rejects.toBeInstanceOf(GisLoadError);
  });

  it('fails when the script loads but defines nothing, and when it takes too long', async () => {
    const empty = loadGis(document);
    scripts()[0]?.dispatchEvent(new Event('load'));
    await expect(empty).rejects.toThrow(/did not set itself up/);

    vi.useFakeTimers();
    const slow = loadGis(document, 5000);
    const outcome = expect(slow).rejects.toThrow(/did not load in time/);
    await vi.advanceTimersByTimeAsync(5000);
    await outcome;
    expect(scripts()).toEqual([]);
  });
});
