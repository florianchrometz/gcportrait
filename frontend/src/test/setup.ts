// SPDX-License-Identifier: MIT
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach, expect } from 'vitest';

/**
 * The tests that count what a single mount's effects do, by file and full name: they render without StrictMode.
 * DiagramCanvas's ready test records every write of `data-drawing` and `data-diagram-ready`, which a second mount
 * writes again.
 */
const SINGLE_MOUNT: ReadonlyArray<readonly [file: string, test: string]> = [
  [
    'src/diagram/DiagramCanvas.test.tsx',
    'DiagramCanvas > sets data-diagram-ready and data-drawing only once the painter and its listeners are attached',
  ],
];

function singleMount(): boolean {
  const { testPath = '', currentTestName = '' } = expect.getState();
  const file = testPath.replaceAll('\\', '/');
  return SINGLE_MOUNT.some(([path, name]) => file.endsWith(`/${path}`) && currentTestName === name);
}

// Every render, rerender and renderHook of the unit tests runs under React's StrictMode, as main.tsx mounts the
// app in development: each component renders twice, and on mount each effect runs, cleans up and runs again, so
// an effect without its clean-up or a subscription made twice fails here (the e2e suite on CI runs a build, where
// StrictMode does nothing). A test that counts requests counts the ones the app kept (requests.ts).
beforeEach(() => {
  configure({ reactStrictMode: !singleMount() });
});

// Vitest runs without globals, so Testing Library cannot register its own cleanup. Files that run in the
// node environment (`// @vitest-environment node`, e.g. the SVG baselines) have no document to clean.
afterEach(() => {
  if (typeof document === 'undefined') return;
  cleanup();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme-preference');
  window.localStorage.clear();
  // "Do not ask again in this session" (the large-snapshot guard) is a tab's: each test starts a new one.
  window.sessionStorage.clear();
});
