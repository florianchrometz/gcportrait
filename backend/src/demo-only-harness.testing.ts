// SPDX-License-Identifier: MIT
/**
 * The real backend in demo-only mode (DEMO_ONLY=true), for e2e/tests/demo-only.spec.ts (never imported by the
 * app, so neither bundle carries it). The spec starts it as a process and sends the browser's `/api` requests
 * to it, so /api/config, /api/legal, the 404s of the routes demo-only mode leaves out and the rate limit run
 * as they do on Cloud Run; Vite serves the SPA.
 *
 * Arguments: `--legal-dir PATH` (optional) becomes LEGAL_DIR. It prints `{"ready":{"port":N}}` once listening and
 * `{"google":"URL"}` should anything try to reach Google (nothing may). Everything is synthetic
 * (AGENTS.md, Security and privacy, principle 6).
 */
import { ConfigError, parseConfig } from './config.js';
import { buildServer } from './server.js';

function emit(line: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

const legalIndex = process.argv.indexOf('--legal-dir');
const legalDir = legalIndex < 0 ? undefined : process.argv[legalIndex + 1];

let config;
try {
  config = parseConfig({
    DEMO_ONLY: 'true',
    LEGAL_DIR: legalDir,
    LOG_LEVEL: 'silent',
    APP_VERSION: '0.0.0-demo-only-e2e',
    // No SPA here: Vite serves it in the e2e run.
    STATIC_DIR: 'no-such-dist',
  });
} catch (error) {
  process.stderr.write(`${error instanceof ConfigError ? error.message : String(error)}\n`);
  process.exit(1);
}

const app = await buildServer(config, {
  upstream: {
    fetch: (url) => {
      emit({ google: url });
      return Promise.reject(new Error('demo-only mode must not call Google'));
    },
  },
});
const address = await app.listen({ host: '127.0.0.1', port: 0 });
emit({ ready: { port: Number(new URL(address).port) } });

const stop = (): void => {
  void app.close().then(() => process.exit(0));
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
