// SPDX-License-Identifier: Apache-2.0
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useNavigate } from 'react-router';
import { describe, expect, it } from 'vitest';

import { AppStateProvider } from '../state';
import { useDiagramLinkTarget } from './viewHash';

function wrapper(initialEntries: string[]): ({ children }: { readonly children: ReactNode }) => ReactNode {
  return function TestProvider({ children }: { readonly children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>
        <AppStateProvider>{children}</AppStateProvider>
      </MemoryRouter>
    );
  };
}

describe('useDiagramLinkTarget', () => {
  it('returns default diagram path with # when starting away from diagram', () => {
    const { result } = renderHook(() => useDiagramLinkTarget(), {
      wrapper: wrapper(['/settings']),
    });
    expect(result.current).toEqual({ pathname: '/diagram', hash: '#' });
  });

  it('preserves the full location (including search and hash) when already on /diagram', () => {
    const { result } = renderHook(() => useDiagramLinkTarget(), {
      wrapper: wrapper(['/diagram?debug=1#snapshot=demo:M&lens=networking']),
    });
    expect(result.current).toEqual({
      pathname: '/diagram',
      search: '?debug=1',
      hash: '#snapshot=demo:M&lens=networking',
    });
  });

  it('remembers the diagram hash after navigating away from /diagram', () => {
    let navigateFn: ReturnType<typeof useNavigate> | null = null;
    const { result } = renderHook(
      () => {
        const target = useDiagramLinkTarget();
        const navigate = useNavigate();
        navigateFn = navigate;
        return { target };
      },
      {
        wrapper: wrapper(['/diagram#snapshot=demo:L&lens=security']),
      },
    );

    expect(result.current.target).toEqual({
      pathname: '/diagram',
      search: '',
      hash: '#snapshot=demo:L&lens=security',
    });

    // Navigate away to /settings
    act(() => {
      void navigateFn?.('/settings');
    });

    // Link target should retain the last diagram hash
    expect(result.current.target).toEqual({
      pathname: '/diagram',
      hash: '#snapshot=demo:L&lens=security',
    });
  });
});
