// SPDX-License-Identifier: MIT
/**
 * The app as it ships, one of the two servers playwright.config.ts starts on CI (fixtures/servers.ts): `vite build`
 * of the frontend into a new temporary directory, then `vite preview` of that build until Playwright stops it.
 *
 *   node scripts/built-app.ts --mode demo --port 50123     # VITE_DEMO=1: demo mode, http://localhost:50123, no proxy
 *   node scripts/built-app.ts --mode normal --port 50124   # normal mode, http://localhost:50124, /api proxied to 8080
 *
 * The preview listens on `--port`, the free port the run picked, and takes the rest from frontend/vite.config.ts
 * (`preview`), which gives it the settings of the dev server of the same mode: its `strictPort`, so a port taken
 * meanwhile fails the start, its `/api` proxy, and without `--port` its port. The build logs its errors
 * only: its warnings are the `build` job's (`pnpm build`). Playwright stops the server with SIGTERM (the
 * `gracefulShutdown` of its webServer), and the directory is removed once the preview has exited, or at once when
 * the build fails. Node runs this file as it is (it strips the types): it imports only Node's modules.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const FRONTEND = path.resolve(import.meta.dirname, '..', '..', 'frontend');
/** Vite's command line, from the frontend's own dependency (its package exports no `bin/` path). */
const VITE = path.join(
  path.dirname(createRequire(path.join(FRONTEND, 'package.json')).resolve('vite/package.json')),
  'bin',
  'vite.js',
);

const USAGE = `Usage: node scripts/built-app.ts --mode demo|normal [--port PORT]

Builds the frontend in demo mode (VITE_DEMO=1) or normal mode into a new temporary directory and serves the build
with vite preview on PORT (without it, on that mode's port in frontend/vite.config.ts), until stopped; then removes
the directory.`;

const { values } = parseArgs({ options: { mode: { type: 'string' }, port: { type: 'string' } } });
const { mode, port } = values;
if ((mode !== 'demo' && mode !== 'normal') || (port !== undefined && !/^[1-9]\d{0,4}$/.test(port))) {
  console.error(USAGE);
  process.exit(2);
}
const env = mode === 'demo' ? { ...process.env, VITE_DEMO: '1' } : process.env;
const dir = mkdtempSync(path.join(tmpdir(), `gcportrait-e2e-${mode}-`));

/** Aborted once Playwright (SIGTERM) or a person (SIGINT) stops the server. */
const stopped = new AbortController();
let current: ChildProcess | undefined;

/** Runs Vite with `args` in the frontend and resolves with its exit code (1 when a signal ended it). */
function vite(args: readonly string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [VITE, ...args], {
      cwd: FRONTEND,
      env,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    current = child;
    child.once('error', (error) => {
      console.error(`built-app: Vite did not start: ${error.message}`);
      resolve(1);
    });
    child.once('exit', (code) => {
      resolve(code ?? 1);
    });
  });
}

function stop(): void {
  stopped.abort();
  if (current?.exitCode === null) current.kill('SIGTERM');
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);

let code = await vite(['build', '--outDir', dir, '--emptyOutDir', '--logLevel', 'error']);
if (code === 0 && !stopped.signal.aborted) {
  code = await vite(['preview', '--outDir', dir, ...(port === undefined ? [] : ['--port', port])]);
}
rmSync(dir, { recursive: true, force: true });
process.exit(stopped.signal.aborted ? 0 : code);
