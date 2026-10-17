// SPDX-License-Identifier: MIT
/**
 * The two Vite dev servers playwright.config.ts starts: the app in demo mode (`pnpm dev:demo`, no proxy) and in normal
 * mode (`pnpm dev`'s Vite server, whose proxy sends every path that starts with `/api` to a backend on port 8080, which
 * the suite never starts; fixtures/live.ts keeps every request away from it).
 */
export const DEMO_URL = 'http://localhost:5174';
export const LIVE_URL = 'http://localhost:5173';
