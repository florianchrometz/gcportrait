// SPDX-License-Identifier: Apache-2.0
/**
 * Binds the app store (store.ts) to the router, both ways: the store starts from the router's first location
 * and follows every later one (`syncLocation`, in a layout effect, so the view is current before the browser
 * paints), and the store's view writes go out through the router's `navigate`, `push` as a new history entry
 * and `replace` in place, so the router's location (and the Diagram link's memory, shell/viewHash.tsx) stays
 * current. The query string is kept when the write stays on the same route. Must be rendered inside a router.
 */
import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useLocation, useNavigate } from '../router';

import { AppStoreContext } from './context';
import { createAppStore, type AppStore, type StoreOptions } from './store';

export function AppStateProvider({
  children,
  options,
}: {
  readonly children: ReactNode;
  /** Store options other than the location (tests: the snapshots on offer). */
  readonly options?: Omit<StoreOptions, 'location'>;
}): ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  const [store] = useState<AppStore>(() => createAppStore({ ...options, location }));
  const locationRef = useRef(location);

  useLayoutEffect(() => {
    locationRef.current = location;
    store.syncLocation(location);
  }, [store, location]);

  useLayoutEffect(() => {
    store.connectNavigator((target, mode) => {
      const current = locationRef.current;
      const nextLocation = {
        pathname: target.pathname,
        search: target.pathname === current.pathname ? current.search : '',
        hash: target.hash,
        key: current.key,
      };
      locationRef.current = nextLocation;
      navigate(
        {
          pathname: target.pathname,
          search: nextLocation.search,
          hash: target.hash,
        },
        { replace: mode === 'replace' },
      );
    });
    return () => {
      store.connectNavigator(null);
    };
  }, [store, navigate]);

  return <AppStoreContext value={store}>{children}</AppStoreContext>;
}
