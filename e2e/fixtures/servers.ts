// SPDX-License-Identifier: MIT
/**
 * The two servers playwright.config.ts starts: the app in demo mode (no proxy) and in normal mode (whose proxy sends
 * every path that starts with `/api` to a backend on port 8080, which the suite never starts; fixtures/live.ts keeps
 * every request away from it). Locally they are the Vite dev servers (`pnpm dev:demo`, and `pnpm dev`'s Vite server);
 * on CI a build of each mode, served by `vite preview` on the same port with the same proxy (scripts/built-app.ts).
 */
export const DEMO_URL = 'http://localhost:5174';
export const LIVE_URL = 'http://localhost:5173';
