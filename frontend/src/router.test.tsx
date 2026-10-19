// SPDX-License-Identifier: Apache-2.0
import { act, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useEffect, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BrowserRouter,
  formatHref,
  Link,
  MemoryRouter,
  NavLink,
  normalizeBasename,
  Outlet,
  parsePath,
  Route,
  Routes,
  stripBasename,
  useHref,
  useLocation,
  useNavigate,
  useNavigationType,
} from './router';

describe('path parsing and formatting', () => {
  it('parses string paths with pathname, search, and hash', () => {
    expect(parsePath('/diagram?debug=1#snapshot=demo:M')).toEqual({
      pathname: '/diagram',
      search: '?debug=1',
      hash: '#snapshot=demo:M',
    });

    expect(parsePath('settings')).toEqual({
      pathname: '/settings',
      search: '',
      hash: '',
    });

    expect(parsePath('/diagram#')).toEqual({
      pathname: '/diagram',
      search: '',
      hash: '',
    });

    expect(parsePath('/diagram?')).toEqual({
      pathname: '/diagram',
      search: '',
      hash: '',
    });
  });

  it('preserves current pathname and search when parsing hash-only strings', () => {
    const current = { pathname: '/diagram', search: '?q=test', hash: '#old' };
    expect(parsePath('#new', current)).toEqual({
      pathname: '/diagram',
      search: '?q=test',
      hash: '#new',
    });
    expect(parsePath('   #new   ', current)).toEqual({
      pathname: '/diagram',
      search: '?q=test',
      hash: '#new',
    });
  });

  it('parses partial path objects and normalizes search and hash', () => {
    expect(parsePath({ pathname: '/diagram', hash: '#' })).toEqual({
      pathname: '/diagram',
      search: '',
      hash: '',
    });

    expect(parsePath({ pathname: 'diagram', search: 'debug=1', hash: 'view' })).toEqual({
      pathname: '/diagram',
      search: '?debug=1',
      hash: '#view',
    });

    expect(parsePath({ hash: '#new' }, { pathname: '/current', search: '?q=1', hash: '' })).toEqual({
      pathname: '/current',
      search: '',
      hash: '#new',
    });
  });

  it('normalizes basename and strips basename from pathname', () => {
    expect(normalizeBasename('/')).toBe('/');
    expect(normalizeBasename('/demo/')).toBe('/demo');
    expect(normalizeBasename('demo')).toBe('/demo');

    expect(stripBasename('/demo/diagram', '/demo')).toBe('/diagram');
    expect(stripBasename('/demo', '/demo')).toBe('/');
    expect(stripBasename('/demo/', '/demo')).toBe('/');
    expect(stripBasename('/other/diagram', '/demo')).toBe('/other/diagram');
    expect(stripBasename('/diagram', '/')).toBe('/diagram');
  });

  it('formats hrefs with root and nested basenames', () => {
    expect(formatHref({ pathname: '/diagram', search: '', hash: '' })).toBe('/diagram');
    expect(formatHref({ pathname: '/diagram', search: '?a=1', hash: '#b' })).toBe('/diagram?a=1#b');
    expect(formatHref({ pathname: '/', search: '', hash: '' }, '/demo')).toBe('/demo/');
    expect(formatHref({ pathname: '/diagram', search: '', hash: '' }, '/demo')).toBe('/demo/diagram');
    expect(formatHref({ pathname: '/diagram', search: '', hash: '#' }, '/demo')).toBe('/demo/diagram');
  });
});

describe('MemoryRouter', () => {
  function Probe(): ReactElement {
    const location = useLocation();
    const type = useNavigationType();
    const navigate = useNavigate();
    const href = useHref('/next');
    return (
      <div>
        <output data-testid="path">{location.pathname}</output>
        <output data-testid="search">{location.search}</output>
        <output data-testid="hash">{location.hash}</output>
        <output data-testid="key">{location.key}</output>
        <output data-testid="type">{type}</output>
        <output data-testid="href">{href}</output>
        <button
          type="button"
          onClick={() => {
            navigate('/diagram');
          }}
        >
          Go Diagram
        </button>
        <button
          type="button"
          onClick={() => {
            navigate('/settings', { replace: true });
          }}
        >
          Replace Settings
        </button>
        <button
          type="button"
          onClick={() => {
            navigate(-1);
          }}
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => {
            navigate(1);
          }}
        >
          Forward
        </button>
      </div>
    );
  }

  it('initializes with default entries and key "default"', () => {
    render(
      <MemoryRouter>
        <Probe />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('path').textContent).toBe('/');
    expect(screen.getByTestId('key').textContent).toBe('default');
    expect(screen.getByTestId('type').textContent).toBe('POP');
    expect(screen.getByTestId('href').textContent).toBe('/next');
  });

  it('marks initial entry 0 as default and index 1 as non-default key', () => {
    render(
      <MemoryRouter initialEntries={['/', '/diagram']} initialIndex={1}>
        <Probe />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('path').textContent).toBe('/diagram');
    expect(screen.getByTestId('key').textContent).not.toBe('default');
  });

  it('navigates with PUSH, REPLACE and delta (-1, +1)', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <Probe />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Go Diagram' }));
    expect(screen.getByTestId('path').textContent).toBe('/diagram');
    expect(screen.getByTestId('type').textContent).toBe('PUSH');
    const diagramKey = screen.getByTestId('key').textContent;
    expect(diagramKey).not.toBe('default');

    await user.click(screen.getByRole('button', { name: 'Replace Settings' }));
    expect(screen.getByTestId('path').textContent).toBe('/settings');
    expect(screen.getByTestId('type').textContent).toBe('REPLACE');
    expect(screen.getByTestId('key').textContent).not.toBe(diagramKey);

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('path').textContent).toBe('/');
    expect(screen.getByTestId('key').textContent).toBe('default');
    expect(screen.getByTestId('type').textContent).toBe('POP');

    await user.click(screen.getByRole('button', { name: 'Forward' }));
    expect(screen.getByTestId('path').textContent).toBe('/settings');
    expect(screen.getByTestId('type').textContent).toBe('POP');
  });

  it('provides a stable navigate callback reference', () => {
    let prevNavigate: ReturnType<typeof useNavigate> | null = null;
    let renders = 0;

    function StabilityTest(): ReactElement {
      const navigate = useNavigate();
      const location = useLocation();
      useEffect(() => {
        renders += 1;
        if (prevNavigate !== null) {
          expect(navigate).toBe(prevNavigate);
        }
        prevNavigate = navigate;
      }, [navigate, location]);
      return (
        <button
          type="button"
          onClick={() => {
            navigate('/page2');
          }}
        >
          Next
        </button>
      );
    }

    render(
      <MemoryRouter initialEntries={['/']}>
        <StabilityTest />
      </MemoryRouter>,
    );
    act(() => {
      prevNavigate?.('/page2');
    });
    expect(renders).toBeGreaterThanOrEqual(2);
  });
});

describe('BrowserRouter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  function BrowserProbe(): ReactElement {
    const location = useLocation();
    const type = useNavigationType();
    const navigate = useNavigate();
    return (
      <div>
        <output data-testid="browser-path">{location.pathname}</output>
        <output data-testid="browser-type">{type}</output>
        <button
          type="button"
          onClick={() => {
            navigate('/test-push');
          }}
        >
          Push
        </button>
        <button
          type="button"
          onClick={() => {
            navigate('/test-replace', { replace: true });
          }}
        >
          Replace
        </button>
        <button
          type="button"
          onClick={() => {
            navigate(-1);
          }}
        >
          Delta
        </button>
      </div>
    );
  }

  it('reads current window location and syncs push/replace state', async () => {
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    const goSpy = vi.spyOn(window.history, 'go').mockImplementation(() => {});

    const user = userEvent.setup();
    render(
      <BrowserRouter basename="/">
        <BrowserProbe />
      </BrowserRouter>,
    );

    expect(screen.getByTestId('browser-path').textContent).toBe('/');

    await user.click(screen.getByRole('button', { name: 'Push' }));
    expect(pushSpy).toHaveBeenCalled();
    expect(screen.getByTestId('browser-path').textContent).toBe('/test-push');
    expect(screen.getByTestId('browser-type').textContent).toBe('PUSH');

    await user.click(screen.getByRole('button', { name: 'Replace' }));
    expect(replaceSpy).toHaveBeenCalled();
    expect(screen.getByTestId('browser-path').textContent).toBe('/test-replace');
    expect(screen.getByTestId('browser-type').textContent).toBe('REPLACE');

    await user.click(screen.getByRole('button', { name: 'Delta' }));
    expect(goSpy).toHaveBeenCalledWith(-1);
  });

  it('reacts to popstate event', () => {
    render(
      <BrowserRouter basename="/">
        <BrowserProbe />
      </BrowserRouter>,
    );

    act(() => {
      window.history.pushState({ key: 'pop-key' }, '', '/popped');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(screen.getByTestId('browser-path').textContent).toBe('/popped');
    expect(screen.getByTestId('browser-type').textContent).toBe('POP');
  });

  it('updates location synchronously across consecutive navigate calls', async () => {
    function SyncNavigateProbe(): ReactElement {
      const location = useLocation();
      const navigate = useNavigate();
      return (
        <div>
          <output data-testid="sync-path">{location.pathname}</output>
          <output data-testid="sync-search">{location.search}</output>
          <output data-testid="sync-hash">{location.hash}</output>
          <button
            type="button"
            onClick={() => {
              navigate('/diagram?q=1#first');
              navigate('#second');
            }}
          >
            Double Navigate
          </button>
        </div>
      );
    }

    const user = userEvent.setup();
    render(
      <BrowserRouter basename="/">
        <SyncNavigateProbe />
      </BrowserRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Double Navigate' }));
    expect(screen.getByTestId('sync-path').textContent).toBe('/diagram');
    expect(screen.getByTestId('sync-search').textContent).toBe('?q=1');
    expect(screen.getByTestId('sync-hash').textContent).toBe('#second');
  });
});

describe('Routes, Route, and Outlet', () => {
  function Shell(): ReactElement {
    return (
      <div data-testid="shell">
        <h1>AppShell</h1>
        <Outlet />
      </div>
    );
  }

  it('matches layout routes, index route, and exact child routes', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<div>Home Page</div>} />
            <Route path="diagram" element={<div>Diagram Page</div>} />
            <Route path="*" element={<div>Not Found</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('shell')).not.toBeNull();
    expect(screen.queryByText('Home Page')).not.toBeNull();
  });

  it('renders matching child route inside layout', () => {
    render(
      <MemoryRouter initialEntries={['/diagram']}>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<div>Home Page</div>} />
            <Route path="diagram" element={<div>Diagram Page</div>} />
            <Route path="*" element={<div>Not Found</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('shell')).not.toBeNull();
    expect(screen.queryByText('Diagram Page')).not.toBeNull();
  });

  it('falls back to wildcard route when no specific route matches', () => {
    render(
      <MemoryRouter initialEntries={['/something-else']}>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<div>Home Page</div>} />
            <Route path="diagram" element={<div>Diagram Page</div>} />
            <Route path="*" element={<div>Not Found</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('shell')).not.toBeNull();
    expect(screen.queryByText('Not Found')).not.toBeNull();
  });

  it('matches flat routes and prefers exact match over wildcard', () => {
    render(
      <MemoryRouter initialEntries={['/diagram']}>
        <Routes>
          <Route path="/diagram" element={<div>Direct Diagram</div>} />
          <Route path="*" element={<div>Direct Wildcard</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText('Direct Diagram')).not.toBeNull();
    expect(screen.queryByText('Direct Wildcard')).toBeNull();
  });
});

describe('Link and NavLink', () => {
  it('handles Link click and navigation', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <Link to="/diagram">To Diagram</Link>
        <Routes>
          <Route path="/" element={<div>On Home</div>} />
          <Route path="/diagram" element={<div>On Diagram</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText('On Home')).not.toBeNull();
    await user.click(screen.getByRole('link', { name: 'To Diagram' }));
    expect(screen.queryByText('On Diagram')).not.toBeNull();
  });

  it('ignores clicks with modifier keys or secondary buttons', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Link to="/diagram">Modifier Link</Link>
        <Routes>
          <Route path="/" element={<div>On Home</div>} />
          <Route path="/diagram" element={<div>On Diagram</div>} />
        </Routes>
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: 'Modifier Link' });
    fireEvent.click(link, { ctrlKey: true });
    expect(screen.queryByText('On Home')).not.toBeNull();
    expect(screen.queryByText('On Diagram')).toBeNull();

    fireEvent.click(link, { button: 1 });
    expect(screen.queryByText('On Home')).not.toBeNull();
    expect(screen.queryByText('On Diagram')).toBeNull();
  });

  it('computes NavLink active state with end=true vs end=false', () => {
    render(
      <MemoryRouter initialEntries={['/diagram']}>
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active-home' : 'inactive-home')}>
          Home Nav
        </NavLink>
        <NavLink
          to="/diagram"
          className={({ isActive }) => (isActive ? 'active-diagram' : 'inactive-diagram')}
        >
          Diagram Nav
        </NavLink>
      </MemoryRouter>,
    );

    const home = screen.getByRole('link', { name: 'Home Nav' });
    const diagram = screen.getByRole('link', { name: 'Diagram Nav' });

    expect(home.className).toBe('inactive-home');
    expect(home.getAttribute('aria-current')).toBeNull();

    expect(diagram.className).toBe('active-diagram');
    expect(diagram.getAttribute('aria-current')).toBe('page');
  });

  it('formats Link href with current pathname and search for relative hash target', () => {
    render(
      <MemoryRouter initialEntries={['/diagram?filter=vpc#top']}>
        <Link to="#section">Section Link</Link>
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: 'Section Link' });
    expect(link.getAttribute('href')).toBe('/diagram?filter=vpc#section');
  });

  it('computes NavLink active state for hash-only target matching current pathname', () => {
    render(
      <MemoryRouter initialEntries={['/diagram']}>
        <NavLink to="#section" className={({ isActive }) => (isActive ? 'active-link' : 'inactive-link')}>
          Section Nav
        </NavLink>
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: 'Section Nav' });
    expect(link.className).toBe('active-link');
    expect(link.getAttribute('aria-current')).toBe('page');
  });
});
