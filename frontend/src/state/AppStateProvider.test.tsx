// SPDX-License-Identifier: MIT
/**
 * The store bound to a router (AppStateProvider): writes reach the location as PUSH or REPLACE navigations, the
 * query string is kept, the router's own navigations (a link, Back) reach the store, and the view a component
 * reads is always the one in the hash.
 */
import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { decodeViewSpec } from '@gcportrait/model';
import type { ReactElement } from 'react';
import { Link, MemoryRouter, useLocation, useNavigate, useNavigationType } from 'react-router';
import { describe, expect, it } from 'vitest';

import { AppStateProvider } from './AppStateProvider';
import { useAppStore, useView } from './hooks';
import type { AppStore } from './store';

let captured: AppStore | null = null;
let back: (() => void) | null = null;

function Probe(): ReactElement {
  const location = useLocation();
  const type = useNavigationType();
  const view = useView();
  const navigate = useNavigate();
  captured = useAppStore();
  back = () => {
    void navigate(-1);
  };
  return (
    <>
      <output data-testid="url">{`${location.pathname}${location.search}${location.hash}`}</output>
      <output data-testid="type">{type}</output>
      <output data-testid="lens">{view.lens}</output>
      <Link to={{ pathname: '/diagram', hash: '#snapshot=demo:L&lens=data' }}>other view</Link>
      <Link to="/settings">settings</Link>
    </>
  );
}

function setup(path: string): AppStore {
  render(
    <MemoryRouter initialEntries={['/', path]} initialIndex={1}>
      <AppStateProvider>
        <Probe />
      </AppStateProvider>
    </MemoryRouter>,
  );
  if (captured === null) throw new Error('no store');
  return captured;
}

const text = (id: string): string => screen.getByTestId(id).textContent;

describe('AppStateProvider', () => {
  it('starts from the router location and pushes a discrete change, keeping the query string', () => {
    const store = setup('/diagram?debug=1#snapshot=demo:S&lens=networking');
    expect(store.getState().view.spec).toEqual(decodeViewSpec('snapshot=demo:S&lens=networking'));
    expect(text('lens')).toBe('networking');
    act(() => {
      store.actions.setLens('security');
    });
    expect(text('url')).toBe('/diagram?debug=1#snapshot=demo:S&lens=security');
    expect(text('type')).toBe('PUSH');
    expect(text('lens')).toBe('security');
    // Back returns to the previous view, through the router, and the store follows.
    act(() => {
      back?.();
    });
    expect(text('url')).toBe('/diagram?debug=1#snapshot=demo:S&lens=networking');
    expect(store.getState().view.spec.lens).toBe('networking');
  });

  it('replaces the history entry for a continuous change (selection, highlight)', () => {
    const store = setup('/diagram#snapshot=demo:S');
    act(() => {
      store.actions.select('node-1');
    });
    expect(text('url')).toBe('/diagram#snapshot=demo:S&selection=node-1');
    expect(text('type')).toBe('REPLACE');
    act(() => {
      store.actions.highlight('10.0.0.2');
    });
    expect(text('type')).toBe('REPLACE');
    // Replaced, so Back leaves the diagram (the entry before it was "/").
    act(() => {
      back?.();
    });
    expect(text('url')).toBe('/');
    expect(store.getState().view.onDiagram).toBe(false);
    expect(store.getState().selection.selected).toBeNull();
  });

  it('follows a link and leaves the hash to the router away from /diagram', async () => {
    const store = setup('/diagram#snapshot=demo:S');
    await userEvent.click(screen.getByRole('link', { name: 'other view' }));
    expect(store.getState().view.spec).toEqual(decodeViewSpec('snapshot=demo:L&lens=data'));
    expect(text('lens')).toBe('data');
    await userEvent.click(screen.getByRole('link', { name: 'settings' }));
    expect(store.getState().view.onDiagram).toBe(false);
    expect(text('lens')).toBe('overview');
    // A view write from elsewhere opens the diagram route.
    act(() => {
      store.actions.setSnapshot('demo:M');
    });
    expect(text('url')).toBe('/diagram#snapshot=demo:M');
    expect(text('type')).toBe('PUSH');
  });

  it('never rewrites a hash it only read, unknown keys included', () => {
    const store = setup('/diagram#lens=networking&root=folders%2F123&unknown=1');
    expect(text('url')).toBe('/diagram#lens=networking&root=folders%2F123&unknown=1');
    expect(store.getState().view.spec.root).toBe('folders/123');
    act(() => {
      store.setHovered('x');
      store.updateUi((ui) => ({ ...ui, popover: 'lens' }));
    });
    expect(text('url')).toBe('/diagram#lens=networking&root=folders%2F123&unknown=1');
  });
});
