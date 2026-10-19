// SPDX-License-Identifier: Apache-2.0
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from './api';
import type { ScopeChoice } from './scopeName';
import { SEARCH_DEBOUNCE_MS, useScopeSearch } from './useScopeSearch';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    searchScopes: vi.fn(),
  };
});

const USER1_SCOPE: ScopeChoice = {
  kind: 'project',
  scope: 'projects/user1-project',
  id: 'user1-project',
  displayName: 'User 1 Project',
};

const USER2_SCOPE: ScopeChoice = {
  kind: 'project',
  scope: 'projects/user2-project',
  id: 'user2-project',
  displayName: 'User 2 Project',
};

describe('useScopeSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(api.searchScopes).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports signed-out when enabled is false', () => {
    const { result } = renderHook(() => useScopeSearch('', { enabled: false, active: true }));

    expect(result.current).toEqual({ status: 'signed-out' });
    expect(api.searchScopes).not.toHaveBeenCalled();
  });

  it('searches when enabled and active, caching results for repeated queries', async () => {
    vi.mocked(api.searchScopes).mockResolvedValue({
      kind: 'ok',
      scopes: [USER1_SCOPE],
      problems: [],
    });

    const { result, rerender } = renderHook(
      ({ text }: { text: string }) => useScopeSearch(text, { enabled: true, active: true }),
      { initialProps: { text: '' } },
    );

    expect(result.current).toEqual({ status: 'searching', text: '' });

    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      await Promise.resolve();
    });

    expect(api.searchScopes).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({
      status: 'done',
      text: '',
      scopes: [USER1_SCOPE],
      problems: [],
      more: false,
    });

    // Searching a different query
    rerender({ text: 'web' });
    expect(result.current).toEqual({ status: 'searching', text: 'web' });

    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      await Promise.resolve();
    });
    expect(api.searchScopes).toHaveBeenCalledTimes(2);

    // Returning to the previous query hits cache immediately without another search
    rerender({ text: '' });
    expect(result.current).toEqual({
      status: 'done',
      text: '',
      scopes: [USER1_SCOPE],
      problems: [],
      more: false,
    });
    expect(api.searchScopes).toHaveBeenCalledTimes(2);
  });

  it('clears cache, aborts in-flight request, and resets state when disabled on sign-out to prevent cross-account leak', async () => {
    vi.mocked(api.searchScopes).mockResolvedValue({
      kind: 'ok',
      scopes: [USER1_SCOPE],
      problems: [],
    });

    const { result, rerender } = renderHook(
      ({ enabled, active }: { enabled: boolean; active: boolean }) => useScopeSearch('', { enabled, active }),
      { initialProps: { enabled: true, active: true } },
    );

    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      await Promise.resolve();
    });

    expect(api.searchScopes).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({
      status: 'done',
      text: '',
      scopes: [USER1_SCOPE],
      problems: [],
      more: false,
    });

    // User signs out: enabled changes to false
    rerender({ enabled: false, active: true });
    expect(result.current).toEqual({ status: 'signed-out' });

    // New user signs in: enabled changes back to true with fresh search results
    vi.mocked(api.searchScopes).mockResolvedValue({
      kind: 'ok',
      scopes: [USER2_SCOPE],
      problems: [],
    });

    rerender({ enabled: true, active: true });

    // With cache cleared, it should not immediately return USER1_SCOPE; it should search
    expect(result.current).toEqual({ status: 'searching', text: '' });

    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      await Promise.resolve();
    });

    // A fresh network request must have been made
    expect(api.searchScopes).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({
      status: 'done',
      text: '',
      scopes: [USER2_SCOPE],
      problems: [],
      more: false,
    });
  });

  it('aborts an in-flight search request when disabled on sign-out', () => {
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(api.searchScopes).mockImplementation((_auth, _req, signal) => {
      capturedSignal = signal;
      return new Promise(() => {
        // pending
      });
    });

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useScopeSearch('', { enabled, active: true }),
      { initialProps: { enabled: true } },
    );

    // Advance past debounce so searchScopes is called
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });

    expect(api.searchScopes).toHaveBeenCalledTimes(1);
    expect(capturedSignal?.aborted).toBe(false);

    // Sign out while request is in flight
    rerender({ enabled: false });

    expect(capturedSignal?.aborted).toBe(true);
  });
});
