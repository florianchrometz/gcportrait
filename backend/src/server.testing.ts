// SPDX-License-Identifier: Apache-2.0
/**
 * The backend's server as the route tests start it (never imported by the app, so neither bundle carries it):
 * the real `buildServer` with a test configuration (no SPA build, version 9.9.9-test), a pretend Google
 * behind the real allowlisted client that never sleeps and has no jitter, its log lines captured, and the
 * server closed when the test ends; and the message of a configuration it refuses to start with.
 */
import path from 'node:path';
import { Writable } from 'node:stream';

import type { FastifyInstance } from 'fastify';
import { onTestFinished } from 'vitest';

import { ConfigError, parseConfig, type ServerConfig } from './config.js';
import { buildServer, type BuildServerOptions } from './server.js';
import { immediateSleep } from './upstream/google.testing.js';
import type { UpstreamFetch, UpstreamOptions } from './upstream/request.js';

/** A static directory that does not exist: the server runs without a SPA build, as in development. */
const NO_SPA_BUILD = path.join(import.meta.dirname, '..', 'no-such-dist');

/** What a test server wrote to its log. */
export interface CapturedLogs {
  readonly stream: Writable;
  /** The lines written so far, without empty ones. */
  readonly lines: () => string[];
  /** Everything written so far, as one text. */
  readonly text: () => string;
}

export function captureLogs(): CapturedLogs {
  const chunks: string[] = [];
  const text = (): string => chunks.join('');
  return {
    stream: new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString('utf8'));
        callback();
      },
    }),
    text,
    lines: () =>
      text()
        .split('\n')
        .filter((line) => line !== ''),
  };
}

/** A pretend Google that fails the call: the default for a test that must reach none. */
export const noGoogle: UpstreamFetch = (url) =>
  Promise.reject(new Error(`this test calls no Google: ${url}`));

export interface TestServerOptions extends Omit<BuildServerOptions, 'logDestination' | 'upstream'> {
  /** Environment variables over the test defaults. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** LOG_LEVEL: silent unless the test reads the log. */
  readonly logLevel?: string;
  /** The pretend Google ({@link noGoogle} by default). */
  readonly fetch?: UpstreamFetch;
  /** The upstream client's other options, over the defaults (no sleeping, no jitter). */
  readonly upstream?: Omit<UpstreamOptions, 'fetch'>;
  /** Changes the parsed configuration before the server is built (what no variable can set, such as a limit). */
  readonly configure?: (config: ServerConfig) => ServerConfig;
}

export interface TestServer {
  readonly app: FastifyInstance;
  readonly logs: CapturedLogs;
}

/** Builds a server for one test; it is closed when the test ends. */
export async function startTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  const { env = {}, logLevel = 'silent', fetch = noGoogle, upstream, configure, ...rest } = options;
  const parsed = parseConfig({
    STATIC_DIR: NO_SPA_BUILD,
    APP_VERSION: '9.9.9-test',
    LOG_LEVEL: logLevel,
    ...env,
  });
  const logs = captureLogs();
  const app = await buildServer(configure === undefined ? parsed : configure(parsed), {
    logDestination: logs.stream,
    upstream: { fetch, sleep: immediateSleep, random: () => 0, ...upstream },
    ...rest,
  });
  onTestFinished(async () => {
    await app.close();
  });
  return { app, logs };
}

/** Starts listening on a free loopback port and returns the port. */
export async function listenOnLoopback(app: FastifyInstance): Promise<number> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

/** An error class a refusal may be an instance of. */
export type ErrorClass = abstract new (...args: never[]) => Error;

/** The message of the error `run` throws, which must be one of `kinds`; fails the test otherwise. */
export function thrownMessage(run: () => unknown, ...kinds: readonly ErrorClass[]): string {
  try {
    run();
  } catch (error) {
    if (kinds.some((kind) => error instanceof kind)) return (error as Error).message;
    throw error;
  }
  throw new Error('expected a refusal');
}

/** The message with which `parseConfig` refuses `env`: start-up stops with it. */
export function configRefusal(env: Readonly<Record<string, string | undefined>>, cwd?: string): string {
  return thrownMessage(() => parseConfig(env, cwd), ConfigError);
}
