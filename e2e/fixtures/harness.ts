// SPDX-License-Identifier: MIT
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';

import type { Page } from '@playwright/test';

/**
 * The real backend for the live specs that drive it (sa-mode.spec.ts, demo-only.spec.ts): one of the backend's
 * harness scripts (`backend/src/…/<name>-harness.testing.ts`, never imported) run as its own process with tsx. A harness
 * prints one JSON object per line on stdout, the first `{"ready":{"port":…}}` once it listens.
 */

const BACKEND = path.resolve(import.meta.dirname, '..', '..', 'backend');
const TSX = path.join(BACKEND, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');

export interface BackendHarness<Line> {
  /** Where it listens: http://127.0.0.1:<port>. */
  readonly url: string;
  /** Every line it has printed so far, in order (its ready line included); grows while it runs. */
  readonly lines: readonly Line[];
  /** Stops the process and waits for it to exit. */
  readonly stop: () => Promise<void>;
}

/** Starts the harness `script` (a path from backend/) with `args`, and waits until it listens. */
export async function startHarness<Line extends object>(
  script: string,
  args: readonly string[],
): Promise<BackendHarness<Line>> {
  const child = spawn(TSX, [script, ...args], { cwd: BACKEND, stdio: ['ignore', 'pipe', 'pipe'] });
  const lines: Line[] = [];
  let errors = '';
  child.stderr.on('data', (chunk: Buffer) => {
    errors += chunk.toString('utf8');
  });
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`the backend harness ${script} did not start in time.\n${errors}`));
    }, 60_000);
    createInterface({ input: child.stdout }).on('line', (text) => {
      const line = JSON.parse(text) as Line;
      lines.push(line);
      const ready = (line as { readonly ready?: { readonly port: number } }).ready;
      if (ready !== undefined) {
        clearTimeout(timer);
        resolve(ready.port);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`the backend harness ${script} exited (${String(code)}).\n${errors}`));
    });
  });
  return {
    url: `http://127.0.0.1:${String(port)}`,
    lines,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) {
          resolve();
          return;
        }
        child.once('exit', () => {
          resolve();
        });
        child.kill('SIGTERM');
      }),
  };
}

/** Sends the page's `/api/*` requests (and only those: Vite serves `/src/api/…` modules) to the harness at `url`. */
export async function routeApiTo(page: Page, harness: { readonly url: string }): Promise<void> {
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: `${harness.url}${url.pathname}${url.search}` });
      await route.fulfill({ response });
    },
  );
}
