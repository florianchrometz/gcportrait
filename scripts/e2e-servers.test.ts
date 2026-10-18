// SPDX-License-Identifier: MIT
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

import type { UserConfigFn } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTempTree, REPO, SPAWN_TIMEOUT, type TempTree } from './testing/temp-tree.js';

interface Invocation {
  readonly args: string[];
  readonly cache?: string;
  readonly demo?: string;
  readonly directory: string;
}

const children: ChildProcess[] = [];
let tree: TempTree;

beforeEach(() => {
  tree = createTempTree('e2e-servers');
  tree.write('e2e/scripts/built-app.ts', readFileSync(path.join(REPO, 'e2e/scripts/built-app.ts')));
  tree.write('frontend/package.json', '{"type":"module"}');
  tree.write('frontend/node_modules/vite/package.json', '{"name":"vite","type":"module"}');
  tree.write(
    'frontend/node_modules/vite/bin/vite.js',
    `
import { appendFileSync, existsSync } from 'node:fs';
const args = process.argv.slice(2);
const cache = process.env.GCPORTRAIT_VITE_CACHE_DIR || undefined;
const directory = cache ?? args[args.indexOf('--outDir') + 1];
const invocation = { args, cache, demo: process.env.VITE_DEMO, directory };
process.on('SIGTERM', () => {
  appendFileSync(process.env.INVOCATIONS, JSON.stringify({ aliveAtExit: existsSync(directory) }) + '\\n');
  process.exit(0);
});
appendFileSync(process.env.INVOCATIONS, JSON.stringify(invocation) + '\\n');
console.log(JSON.stringify(invocation));
if (process.env.FAIL_STAGE === (args[0] ?? 'dev')) process.exit(7);
if (args[0] === 'build' || process.env.EXIT_AT_ONCE === '1') process.exit(0);
setInterval(() => {}, 1000);
`,
  );
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => {
        child.once('exit', () => {
          resolve();
        });
        child.kill('SIGTERM');
      });
    }
  }
  tree.remove();
  vi.unstubAllEnvs();
  vi.resetModules();
});

function start(args: readonly string[], env: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, [path.join(tree.root, 'e2e/scripts/built-app.ts'), ...args], {
    env: {
      ...process.env,
      VITE_DEMO: '',
      GCPORTRAIT_VITE_CACHE_DIR: '',
      INVOCATIONS: path.join(tree.root, 'invocations.jsonl'),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const ready = new Promise<Invocation>((resolve, reject) => {
    createInterface({ input: child.stdout }).once('line', (line) => {
      resolve(JSON.parse(line) as Invocation);
    });
    child.once('exit', () => {
      reject(new Error(`server exited before ready: ${stderr}`));
    });
    child.once('error', reject);
  });
  return { child, ready, exited };
}

describe('the e2e server lifecycle', SPAWN_TIMEOUT, () => {
  it('isolates simultaneous dev caches, preserves mode, and removes each only after its child exits', async () => {
    tree.write('foreign/keep', 'unrelated cache');
    const demo = start(['--mode', 'demo', '--dev', '--port', '50123'], {
      GCPORTRAIT_VITE_CACHE_DIR: path.join(tree.root, 'foreign'),
    });
    const normal = start(['--mode', 'normal', '--dev', '--port', '50124']);
    const [first, second] = await Promise.all([demo.ready, normal.ready]);
    expect(first.args).toEqual(['--port', '50123']);
    expect(second.args).toEqual(['--port', '50124']);
    expect(first.demo).toBe('1');
    expect(second.demo).toBe('');
    expect(first.cache).toBeTruthy();
    expect(second.cache).toBeTruthy();
    expect(first.cache).not.toBe(second.cache);
    expect(path.isAbsolute(first.directory)).toBe(true);
    expect(existsSync(first.directory)).toBe(true);
    expect(existsSync(second.directory)).toBe(true);
    demo.child.kill('SIGTERM');
    expect(await demo.exited).toBe(0);
    expect(existsSync(first.directory)).toBe(false);
    expect(existsSync(second.directory)).toBe(true);
    normal.child.kill('SIGINT');
    expect(await normal.exited).toBe(0);
    expect(existsSync(second.directory)).toBe(false);
    expect(tree.read('invocations.jsonl').match(/"aliveAtExit":true/g)).toHaveLength(2);
    expect(tree.read('foreign/keep')).toBe('unrelated cache');
  });

  it.each([0, 7])('cleans a dev cache after Vite exits %i without a signal', async (code) => {
    const server = start(['--mode', 'demo', '--dev'], {
      EXIT_AT_ONCE: '1',
      FAIL_STAGE: code === 7 ? 'dev' : '',
    });
    const invocation = await server.ready;
    expect(await server.exited).toBe(code);
    expect(existsSync(invocation.directory)).toBe(false);
  });

  it('keeps the default build and preview arguments and cleanup', async () => {
    const server = start(['--mode', 'demo', '--port', '50123']);
    const build = await server.ready;
    expect(build.args).toEqual([
      'build',
      '--outDir',
      build.directory,
      '--emptyOutDir',
      '--logLevel',
      'error',
    ]);
    expect(build.cache).toBeUndefined();
    await expect.poll(() => tree.read('invocations.jsonl').trim().split('\n').length).toBe(2);
    const preview = JSON.parse(tree.read('invocations.jsonl').trim().split('\n')[1] ?? '') as Invocation;
    expect(preview.args).toEqual(['preview', '--outDir', build.directory, '--port', '50123']);
    server.child.kill('SIGTERM');
    expect(await server.exited).toBe(0);
    expect(existsSync(build.directory)).toBe(false);
    expect(tree.read('invocations.jsonl')).toContain('"aliveAtExit":true');
  });

  it('removes a failed build without starting preview', async () => {
    const server = start(['--mode', 'normal'], { FAIL_STAGE: 'build' });
    const build = await server.ready;
    expect(await server.exited).toBe(7);
    expect(existsSync(build.directory)).toBe(false);
    expect(tree.read('invocations.jsonl').trim().split('\n')).toHaveLength(1);
  });
});

describe('frontend dependency caches', () => {
  it.each([
    ['', '', 'node_modules/.vite'],
    ['1', '', 'node_modules/.vite-demo'],
    ['', '1', 'node_modules/.vite-static-demo'],
  ])('preserves ordinary mode defaults (%s, %s)', async (demo, staticDemo, expected) => {
    vi.stubEnv('VITE_DEMO', demo);
    vi.stubEnv('VITE_STATIC_DEMO', staticDemo);
    vi.stubEnv('GCPORTRAIT_VITE_CACHE_DIR', '');
    const { default: configureFrontend } = (await import(
      pathToFileURL(path.join(REPO, 'frontend/vite.config.ts')).href
    )) as { default: UserConfigFn };
    const config = await configureFrontend({ command: 'serve', mode: 'development' });
    expect(config.cacheDir).toBe(expected);
    expect(config.server?.strictPort).toBe(true);
    expect(config.server?.proxy).toEqual(
      demo || staticDemo ? {} : { '/api': { target: 'http://localhost:8080' } },
    );
    vi.stubEnv('GCPORTRAIT_VITE_CACHE_DIR', path.join(tree.root, 'cache'));
    const isolated = await configureFrontend({ command: 'serve', mode: 'development' });
    expect(isolated.cacheDir).toBe(path.join(tree.root, 'cache'));
    expect(isolated.server).toEqual(config.server);
    expect(isolated.preview).toEqual(config.preview);
  });
});

describe('Playwright server ownership', () => {
  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])('keeps reuse limited to named local servers (CI=%s, named=%s)', async (ci, named) => {
    vi.stubEnv('CI', ci ? 'true' : '');
    vi.stubEnv('E2E_DEMO_URL', named ? 'http://localhost:50123' : undefined);
    vi.stubEnv('E2E_LIVE_URL', named ? 'http://localhost:50124' : undefined);
    const { default: config } = (await import(
      pathToFileURL(path.join(REPO, 'e2e/playwright.config.ts')).href
    )) as {
      default: {
        webServer: {
          command: string;
          url: string;
          reuseExistingServer: boolean;
          gracefulShutdown: { signal: string; timeout: number };
        }[];
      };
    };
    const servers = config.webServer;
    if (!Array.isArray(servers)) throw new Error('expected two servers');
    expect(servers).toHaveLength(2);
    for (const [index, server] of servers.entries()) {
      const mode = index === 0 ? 'demo' : 'normal';
      const port = new URL(server.url).port;
      expect(server.command).toBe(
        `node scripts/built-app.ts --mode ${mode} --port ${port}${ci ? '' : ' --dev'}`,
      );
      expect(server.reuseExistingServer).toBe(!ci && named);
      expect(server.gracefulShutdown).toEqual({ signal: 'SIGTERM', timeout: 10_000 });
    }
  });
});
