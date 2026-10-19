// SPDX-License-Identifier: Apache-2.0
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Every render, rerender and renderHook of the unit tests runs under React's StrictMode, as main.tsx mounts the
// app in development: each component renders twice, and on mount each effect runs, cleans up and runs again, so
// an effect without its clean-up or a subscription made twice fails here (the e2e suite on CI runs a build, where
// StrictMode does nothing). A test that counts requests counts the ones the app kept (requests.ts).
configure({ reactStrictMode: true });

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

// jsdom lacks CompressionStream, DecompressionStream, and Blob.prototype.stream, standard in target browsers and Node.
if (typeof window !== 'undefined') {
  if (typeof window.CompressionStream === 'undefined' && typeof CompressionStream !== 'undefined') {
    window.CompressionStream = CompressionStream;
  }
  if (typeof window.DecompressionStream === 'undefined' && typeof DecompressionStream !== 'undefined') {
    window.DecompressionStream = DecompressionStream;
  }
  if (typeof Blob !== 'undefined' && typeof Blob.prototype.stream !== 'function') {
    Blob.prototype.stream = function stream(this: Blob): ReadableStream<Uint8Array<ArrayBuffer>> {
      return new ReadableStream<Uint8Array<ArrayBuffer>>({
        start: async (controller) => {
          const buffer = await this.arrayBuffer();
          controller.enqueue(new Uint8Array(buffer));
          controller.close();
        },
      });
    };
  }
}
