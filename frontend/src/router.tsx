// SPDX-License-Identifier: Apache-2.0
/**
 * A lightweight History-API and Memory router replacing react-router.
 *
 * Implements the minimal subset required by gcportrait:
 * - History navigation (push, replace, pop / back)
 * - BrowserRouter (window.history) and MemoryRouter (in-memory stack for tests)
 * - Routes matching declarative layout and flat routes with index and wildcard support
 * - Link and NavLink with active state calculation and keyboard/modifier click handling
 * - Location, navigate and navigation type hooks
 */
import {
  Children,
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type CSSProperties,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

export interface Path {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}

export interface PathTarget {
  readonly pathname?: string | undefined;
  readonly search?: string | undefined;
  readonly hash?: string | undefined;
}

export type To = string | PathTarget;

export interface RouterLocation extends Path {
  readonly key: string;
}

export type Location = RouterLocation;

export type NavigationType = 'POP' | 'PUSH' | 'REPLACE';

export interface NavigateOptions {
  readonly replace?: boolean | undefined;
}

export interface NavigateFunction {
  (to: To, options?: NavigateOptions): void;
  (delta: number): void;
}

interface RouterContextValue {
  readonly location: RouterLocation;
  readonly navigationType: NavigationType;
  readonly navigate: NavigateFunction;
  readonly basename: string;
}

const RouterContext = createContext<RouterContextValue | null>(null);

function useRouterContext(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (ctx === null) {
    throw new Error('Router hooks must be used within a Router (BrowserRouter or MemoryRouter).');
  }
  return ctx;
}

export function useLocation(): RouterLocation {
  return useRouterContext().location;
}

export function useNavigate(): NavigateFunction {
  return useRouterContext().navigate;
}

export function useNavigationType(): NavigationType {
  return useRouterContext().navigationType;
}

export function useHref(to: To): string {
  const { basename, location } = useRouterContext();
  return formatHref(parsePath(to, location), basename);
}

let keyCounter = 0;
function createKey(): string {
  keyCounter += 1;
  return `${Date.now().toString(36)}-${keyCounter.toString(36)}`;
}

export function normalizeBasename(basename: string): string {
  const trimmed = basename.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function stripBasename(pathname: string, basename: string): string {
  const base = normalizeBasename(basename);
  if (base === '/') return pathname;
  if (pathname.toLowerCase().startsWith(base.toLowerCase())) {
    const nextChar = pathname.charAt(base.length);
    if (nextChar === '' || nextChar === '/') {
      const rest = pathname.slice(base.length);
      return rest === '' || rest === '/' ? '/' : rest.startsWith('/') ? rest : `/${rest}`;
    }
  }
  return pathname;
}

export function formatHref(path: Path, basename = '/'): string {
  const base = normalizeBasename(basename);
  const pathname = path.pathname.startsWith('/') ? path.pathname : `/${path.pathname}`;
  const search = path.search ? (path.search.startsWith('?') ? path.search : `?${path.search}`) : '';
  const hash = path.hash
    ? path.hash === '#'
      ? ''
      : path.hash.startsWith('#')
        ? path.hash
        : `#${path.hash}`
    : '';
  let fullPath = pathname;
  if (base !== '/') {
    fullPath = pathname === '/' ? `${base}/` : `${base}${pathname}`;
  }
  return `${fullPath}${search}${hash}`;
}

export function parsePath(to: To, current?: Path): Path {
  if (typeof to === 'string') {
    const trimmed = to.trim();
    let pathname = trimmed;
    let search = '';
    let hash = '';

    const hashIndex = pathname.indexOf('#');
    if (hashIndex >= 0) {
      hash = pathname.slice(hashIndex);
      pathname = pathname.slice(0, hashIndex);
    }

    const searchIndex = pathname.indexOf('?');
    if (searchIndex >= 0) {
      search = pathname.slice(searchIndex);
      pathname = pathname.slice(0, searchIndex);
    }

    if (hash === '#') hash = '';
    if (search === '?') search = '';

    if (!pathname) {
      pathname = current?.pathname ?? '/';
      if (trimmed.startsWith('#')) {
        search = current?.search ?? '';
      }
    } else if (!pathname.startsWith('/')) {
      pathname = `/${pathname}`;
    }

    return { pathname, search, hash };
  }

  const pathname = to.pathname
    ? to.pathname.startsWith('/')
      ? to.pathname
      : `/${to.pathname}`
    : (current?.pathname ?? '/');

  let search = to.search ?? '';
  if (search === '?') search = '';
  else if (search && !search.startsWith('?')) search = `?${search}`;

  let hash = to.hash ?? '';
  if (hash === '#') hash = '';
  else if (hash && !hash.startsWith('#')) hash = `#${hash}`;

  return { pathname, search, hash };
}

export function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  const stripped = pathname.replace(/\/+$/, '');
  return stripped === '' ? '/' : stripped.startsWith('/') ? stripped : `/${stripped}`;
}

export interface BrowserRouterProps {
  readonly basename?: string | undefined;
  readonly children?: ReactNode | undefined;
}

function getLocationFromWindow(basename: string): RouterLocation {
  const pathname = stripBasename(window.location.pathname, basename);
  const search = window.location.search === '?' ? '' : window.location.search;
  const hash = window.location.hash === '#' ? '' : window.location.hash;
  const state = window.history.state as { key?: string } | null;
  const key = state?.key ?? 'default';
  return { pathname, search, hash, key };
}

export function BrowserRouter({ basename = '/', children }: BrowserRouterProps): ReactElement {
  const [state, setState] = useState<{
    location: RouterLocation;
    navigationType: NavigationType;
  }>(() => ({
    location: getLocationFromWindow(basename),
    navigationType: 'POP',
  }));

  const basenameRef = useRef(basename);
  basenameRef.current = basename;
  const locationRef = useRef(state.location);
  locationRef.current = state.location;

  useEffect(() => {
    const handlePopState = () => {
      const nextLocation = getLocationFromWindow(basenameRef.current);
      locationRef.current = nextLocation;
      setState({
        location: nextLocation,
        navigationType: 'POP',
      });
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  const navigate: NavigateFunction = useCallback((to: To | number, options?: NavigateOptions) => {
    if (typeof to === 'number') {
      window.history.go(to);
      return;
    }
    const current = locationRef.current;
    const base = basenameRef.current;
    const path = parsePath(to, current);
    const href = formatHref(path, base);
    const key = createKey();
    const nextLocation: RouterLocation = { ...path, key };
    const navType: NavigationType = options?.replace ? 'REPLACE' : 'PUSH';

    if (options?.replace) {
      window.history.replaceState({ key }, '', href);
    } else {
      window.history.pushState({ key }, '', href);
    }

    locationRef.current = nextLocation;
    setState({
      location: nextLocation,
      navigationType: navType,
    });
  }, []);

  const contextValue: RouterContextValue = {
    location: state.location,
    navigationType: state.navigationType,
    navigate,
    basename,
  };

  return <RouterContext value={contextValue}>{children}</RouterContext>;
}

export interface MemoryRouterProps {
  readonly initialEntries?: readonly To[] | undefined;
  readonly initialIndex?: number | undefined;
  readonly basename?: string | undefined;
  readonly children?: ReactNode | undefined;
}

export function MemoryRouter({
  initialEntries,
  initialIndex,
  basename = '/',
  children,
}: MemoryRouterProps): ReactElement {
  const [history, setHistory] = useState<{
    entries: readonly RouterLocation[];
    index: number;
    navigationType: NavigationType;
  }>(() => {
    const initial = initialEntries && initialEntries.length > 0 ? initialEntries : ['/'];
    const entries: RouterLocation[] = initial.map((entry, idx) => ({
      ...parsePath(entry),
      key: idx === 0 ? 'default' : createKey(),
    }));
    const clampIndex = Math.max(0, Math.min(entries.length - 1, initialIndex ?? entries.length - 1));
    return {
      entries,
      index: clampIndex,
      navigationType: 'POP',
    };
  });

  const navigate: NavigateFunction = useCallback((to: To | number, options?: NavigateOptions) => {
    if (typeof to === 'number') {
      setHistory((prev) => {
        const nextIndex = Math.max(0, Math.min(prev.entries.length - 1, prev.index + to));
        if (nextIndex === prev.index) return prev;
        return {
          ...prev,
          index: nextIndex,
          navigationType: 'POP',
        };
      });
      return;
    }

    setHistory((prev) => {
      const current = prev.entries[prev.index];
      const path = parsePath(to, current);
      const nextKey = createKey();
      const nextLocation: RouterLocation = { ...path, key: nextKey };
      if (options?.replace) {
        const nextEntries = [...prev.entries];
        nextEntries[prev.index] = nextLocation;
        return {
          entries: nextEntries,
          index: prev.index,
          navigationType: 'REPLACE',
        };
      }
      const nextEntries = [...prev.entries.slice(0, prev.index + 1), nextLocation];
      return {
        entries: nextEntries,
        index: nextEntries.length - 1,
        navigationType: 'PUSH',
      };
    });
  }, []);

  const currentEntry = history.entries[history.index] ?? {
    pathname: '/',
    search: '',
    hash: '',
    key: 'default',
  };

  const contextValue: RouterContextValue = {
    location: currentEntry,
    navigationType: history.navigationType,
    navigate,
    basename,
  };

  return <RouterContext value={contextValue}>{children}</RouterContext>;
}

export interface RouteProps {
  readonly path?: string | undefined;
  readonly index?: boolean | undefined;
  readonly element?: ReactNode | undefined;
  readonly children?: ReactNode | undefined;
}

export function Route(props: RouteProps): null {
  if (typeof props.path === 'number') return null;
  return null;
}

const OutletContext = createContext<ReactNode>(null);

export function Outlet(): ReactNode {
  return useContext(OutletContext);
}

interface RouteMatch {
  readonly score: number;
  readonly node: ReactNode;
}

function matchRoute(
  routeElement: ReactElement<RouteProps>,
  pathname: string,
  parentPath = '',
): RouteMatch | null {
  const { path, index, element, children } = routeElement.props;

  let currentPath = parentPath;
  let isWildcard = false;

  if (index) {
    const target = normalizePathname(parentPath || '/');
    if (pathname === target) {
      return { score: 2, node: element ?? null };
    }
    return null;
  }

  if (path) {
    if (path === '*') {
      isWildcard = true;
    } else {
      const cleanPath = path.startsWith('/') ? path : `/${path}`;
      currentPath = parentPath ? `${parentPath}${cleanPath}` : cleanPath;
      currentPath = normalizePathname(currentPath);
    }
  }

  if (children) {
    if (path && !isWildcard) {
      if (pathname !== currentPath && !pathname.startsWith(`${currentPath}/`)) {
        return null;
      }
    }

    const childMatches: RouteMatch[] = [];
    Children.forEach(children, (child) => {
      if (child !== null && typeof child === 'object' && 'props' in child) {
        const m = matchRoute(child as ReactElement<RouteProps>, pathname, currentPath);
        if (m !== null) childMatches.push(m);
      }
    });

    if (childMatches.length > 0) {
      childMatches.sort((a, b) => b.score - a.score);
      const best = childMatches[0];
      if (!best) return null;
      const rendered = <OutletContext value={best.node}>{element ?? <Outlet />}</OutletContext>;
      return { score: best.score, node: rendered };
    }

    return null;
  }

  if (isWildcard) {
    return { score: 1, node: element ?? null };
  }

  if (currentPath && pathname === currentPath) {
    return { score: 2, node: element ?? null };
  }

  return null;
}

export function Routes({ children }: { readonly children?: ReactNode | undefined }): ReactElement | null {
  const { pathname } = useLocation();
  const normalized = normalizePathname(pathname);
  const matches: RouteMatch[] = [];

  Children.forEach(children, (child) => {
    if (child !== null && typeof child === 'object' && 'props' in child) {
      const m = matchRoute(child as ReactElement<RouteProps>, normalized, '');
      if (m !== null) matches.push(m);
    }
  });

  const [bestMatch] = matches.sort((a, b) => b.score - a.score);
  if (!bestMatch) return null;
  return <>{bestMatch.node}</>;
}

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  readonly to: To;
  readonly replace?: boolean | undefined;
}

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { to, replace, onClick, target, ...rest },
  ref,
) {
  const { basename, navigate, location } = useRouterContext();
  const path = parsePath(to, location);
  const href = formatHref(path, basename);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      !event.defaultPrevented &&
      event.button === 0 &&
      (!target || target === '_self') &&
      !event.metaKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      navigate(to, { replace });
    }
  };

  return <a {...rest} ref={ref} href={href} target={target} onClick={handleClick} />;
});

export interface NavLinkRenderProps {
  readonly isActive: boolean;
}

export interface NavLinkProps extends Omit<LinkProps, 'className' | 'style' | 'children'> {
  readonly end?: boolean | undefined;
  readonly className?: string | ((props: NavLinkRenderProps) => string | undefined) | undefined;
  readonly style?: CSSProperties | ((props: NavLinkRenderProps) => CSSProperties | undefined) | undefined;
  readonly children?: ReactNode | ((props: NavLinkRenderProps) => ReactNode) | undefined;
}

export const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(function NavLink(
  { to, end = false, className, style, children, ...rest },
  ref,
) {
  const location = useLocation();
  const targetPath = parsePath(to, location).pathname;
  const currentPath = normalizePathname(location.pathname);
  const target = normalizePathname(targetPath);

  const isActive = end
    ? currentPath === target
    : currentPath === target || (target !== '/' && currentPath.startsWith(`${target}/`));

  const resolvedClassName = typeof className === 'function' ? className({ isActive }) : className;
  const resolvedStyle = typeof style === 'function' ? style({ isActive }) : style;
  const resolvedChildren = typeof children === 'function' ? children({ isActive }) : children;

  return (
    <Link
      {...rest}
      ref={ref}
      to={to}
      className={resolvedClassName}
      style={resolvedStyle}
      aria-current={isActive ? 'page' : undefined}
    >
      {resolvedChildren}
    </Link>
  );
});

export function Navigate({
  to,
  replace = false,
}: {
  readonly to: To;
  readonly replace?: boolean | undefined;
}): null {
  const navigate = useNavigate();
  const { hash } = useLocation();
  useEffect(() => {
    const target = typeof to === 'string' && !to.includes('#') && hash ? `${to}${hash}` : to;
    navigate(target, { replace });
  }, [navigate, to, replace, hash]);
  return null;
}
