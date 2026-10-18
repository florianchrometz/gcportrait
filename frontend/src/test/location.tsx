// SPDX-License-Identifier: Apache-2.0
/**
 * The router's location for the tests: a hidden probe a test harness mounts inside its router, and the readers a test
 * asserts with (path, query string and hash as one text; the hash alone, decoded). One probe for every harness
 * (renderApp, renderControls, renderImport).
 */
import type { ReactElement } from 'react';
import { useLocation } from 'react-router';

const PROBE = 'location';

/** Renders the current router location (path, query string and hash) for `currentLocation`. */
export function LocationProbe(): ReactElement {
  const location = useLocation();
  return (
    <output data-testid={PROBE} hidden>
      {`${location.pathname}${location.search}${location.hash}`}
    </output>
  );
}

/** The router's path, query string and hash, as the probe in `container` shows them. */
export function currentLocation(container: HTMLElement): string {
  return container.querySelector(`[data-testid="${PROBE}"]`)?.textContent ?? '';
}

/** The hash of a location, without its `#` and decoded for reading (`%2F` → `/`). */
export function hashOf(location: string): string {
  return decodeURIComponent(location.replace(/^[^#]*#?/, ''));
}
