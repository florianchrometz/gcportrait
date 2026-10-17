// SPDX-License-Identifier: MIT
import { createServer, type Server } from 'node:net';

/**
 * The two servers playwright.config.ts starts: the app in demo mode (no proxy) and in normal mode (whose proxy sends
 * every path that starts with `/api` to a backend on port 8080, which the suite never starts; fixtures/live.ts keeps
 * every request away from it). Locally they are the Vite dev servers (`pnpm dev:demo`, and `pnpm dev`'s Vite server);
 * on CI a build of each mode, served by `vite preview` with the same proxy (scripts/built-app.ts).
 *
 * A run serves them on two free ports of its own, so that two runs never meet and a server another checkout left
 * running (on the people's ports 5173 and 5174, say) is never tested in this checkout's place: the first process of a
 * run to load this module, Playwright's runner (through playwright.config.ts), picks them and names the two URLs in
 * E2E_DEMO_URL and E2E_LIVE_URL, which every process it starts inherits (its workers, its test loader, the servers'
 * commands), so all of them reach the same two servers. A variable a person sets names a server of theirs instead,
 * which a local run reuses when it answers there (e2e/README.md).
 */

/** The variables that carry the two servers' URLs to every process of a run. */
const DEMO_URL_VARIABLE = 'E2E_DEMO_URL';
const LIVE_URL_VARIABLE = 'E2E_LIVE_URL';

/** The origin `variable` names, when it is set: an http URL with its port. */
function named(variable: string): string | undefined {
  const value = process.env[variable];
  if (value === undefined || value === '') return undefined;
  const url = URL.parse(value);
  if (url?.protocol !== 'http:' || url.port === '') {
    throw new Error(
      `${variable}=${value} names no http server with its port, such as http://localhost:5174.`,
    );
  }
  return url.origin;
}

function listening(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    // No host: the wildcard address, so the port is free on every address, localhost's (where Vite listens) included.
    server.listen(0, () => {
      const address = server.address();
      if (typeof address === 'object' && address !== null) resolve(address.port);
      else reject(new Error('a probe for a free port has no port'));
    });
  });
}

function closed(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => {
      resolve();
    });
  });
}

/** `count` different ports nothing listens on: all held at once, so the system gives each a different one, then freed. */
async function freePorts(count: number): Promise<number[]> {
  const probes = Array.from({ length: count }, () => createServer());
  try {
    return await Promise.all(probes.map(listening));
  } finally {
    await Promise.all(probes.map(closed));
  }
}

const namedDemo = named(DEMO_URL_VARIABLE);
const namedLive = named(LIVE_URL_VARIABLE);
const [demoPort, livePort] =
  namedDemo === undefined || namedLive === undefined ? await freePorts(2) : [undefined, undefined];

/** The demo-mode server's origin, `http://localhost:<port>`. */
export const DEMO_URL = namedDemo ?? `http://localhost:${String(demoPort)}`;
/** The normal-mode server's origin, `http://localhost:<port>`. */
export const LIVE_URL = namedLive ?? `http://localhost:${String(livePort)}`;
process.env[DEMO_URL_VARIABLE] = DEMO_URL;
process.env[LIVE_URL_VARIABLE] = LIVE_URL;

/**
 * Whether each server's URL was named before this module could pick one: in the runner by a person, in the run's other
 * processes by the runner. A local run reuses a server only at a URL a person named; a port the run picked was free a
 * moment before, so whatever answers there is not the run's own server, and the run fails rather than test it.
 */
export const NAMED = { demo: namedDemo !== undefined, live: namedLive !== undefined } as const;
