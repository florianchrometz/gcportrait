// SPDX-License-Identifier: MIT
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs without globals, so Testing Library cannot register its own cleanup. Files that run in the
// node environment (`// @vitest-environment node`, e.g. the SVG baselines) have no document to clean.
afterEach(() => {
  if (typeof document === 'undefined') return;
  cleanup();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme-preference');
  window.localStorage.clear();
});
