// SPDX-License-Identifier: MIT
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTempTree, REPO, SPAWN_TIMEOUT } from './testing/temp-tree.js';

const REPORTER = path.join(REPO, 'e2e/scripts/server-advice-reporter.ts');
const resolve = createRequire(path.join(REPO, 'e2e/package.json')).resolve;
const URL = 'http://localhost:50123';
const SUFFIX =
  ' is already used, make sure that nothing is running on the port/url or set reuseExistingServer:true in config.webServer.';

interface AdviceReporter {
  onError(error: { message?: string; stack?: string }): void;
  printsToStdio(): boolean;
}

async function reporter(picked: boolean): Promise<AdviceReporter> {
  const { default: Reporter } = (await import(pathToFileURL(REPORTER).href)) as {
    default: new (options: { servers: { url: string; picked: boolean }[] }) => AdviceReporter;
  };
  return new Reporter({ servers: [{ url: URL, picked }] });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('occupied-server advice', () => {
  it.each([true, false])('adds advice without changing the original error (picked=%s)', async (picked) => {
    const instance = await reporter(picked);
    const error = Object.freeze({
      message: `Error: ${URL}${SUFFIX}`,
      stack: `Error: ${URL}${SUFFIX}\n  at server`,
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    instance.onError(error);
    expect(stderr).toHaveBeenCalledTimes(1);
    const message = String(stderr.mock.calls[0]?.[0]);
    expect(message).toContain(URL);
    expect(message).toContain(picked ? 'rerun to pick new ports' : 'explicit CI server URL');
    expect(message).toContain('Do not enable reuseExistingServer');
    expect(instance.printsToStdio()).toBe(true);
    expect(error).toEqual({
      message: `Error: ${URL}${SUFFIX}`,
      stack: `Error: ${URL}${SUFFIX}\n  at server`,
    });
  });

  it('ignores other errors, unknown URLs, and similar text without the exact refusal', async () => {
    const instance = await reporter(true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    for (const message of [
      undefined,
      'Error: http://localhost:50124' + SUFFIX,
      URL + SUFFIX,
      URL + ' is already used',
      'unrelated failure',
    ]) {
      instance.onError(message === undefined ? {} : { message });
    }
    expect(stderr).not.toHaveBeenCalled();
  });

  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])('configures advice only for nonreusable servers (CI=%s, named=%s)', async (ci, named) => {
    vi.stubEnv('CI', ci ? 'true' : '');
    vi.stubEnv('E2E_DEMO_URL', named ? URL : undefined);
    vi.stubEnv('E2E_LIVE_URL', named ? 'http://localhost:50124' : undefined);
    vi.stubEnv('PLAYWRIGHT_JSON_OUTPUT_FILE', '/tmp/gcportrait-advice-config-only.json');
    const { default: config } = (await import(
      pathToFileURL(path.join(REPO, 'e2e/playwright.config.ts')).href
    )) as {
      default: {
        reporter: [string, { servers?: { url: string; picked: boolean }[] }?][];
        webServer: { url: string; reuseExistingServer: boolean }[];
      };
    };
    expect(config.reporter.map(([name]) => name)).toEqual([
      'list',
      ...(ci ? ['html'] : []),
      'json',
      './scripts/server-advice-reporter.ts',
    ]);
    expect(config.reporter.at(-1)?.[1]?.servers).toEqual(
      config.webServer
        .filter((server) => !server.reuseExistingServer)
        .map(({ url }) => ({ url, picked: !named })),
    );
  });

  it(
    'keeps the real refusal, reports and exit status without launching the server command',
    SPAWN_TIMEOUT,
    async () => {
      const tree = createTempTree('server-advice');
      const server = createServer((_request, response) => {
        response.end('occupied');
      });
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          resolve();
        });
      });
      try {
        const address = server.address();
        if (typeof address !== 'object' || address === null) throw new Error('missing occupied port');
        const url = `http://127.0.0.1:${String(address.port)}`;
        const marker = path.join(tree.root, 'command-started');
        const json = path.join(tree.root, 'report.json');
        tree.write('server.cjs', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started');`);
        tree.write(
          'test.spec.cjs',
          `const {test} = require(${JSON.stringify(resolve('@playwright/test'))}); test('never runs', () => {});`,
        );
        tree.write(
          'playwright.config.cjs',
          `module.exports = ${JSON.stringify({
            testDir: tree.root,
            reporter: [
              ['list'],
              [REPORTER, { servers: [{ url, picked: true }] }],
              ['json', { outputFile: json }],
            ],
            webServer: {
              command: `${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(tree.root, 'server.cjs'))}`,
              url,
              reuseExistingServer: false,
            },
          })};`,
        );
        let result: { stdout: string; stderr: string; code?: number };
        try {
          const output = await promisify(execFile)(
            process.execPath,
            [
              resolve('@playwright/test/cli'),
              'test',
              '--config',
              path.join(tree.root, 'playwright.config.cjs'),
              '--workers=1',
              '--retries=0',
            ],
            {
              cwd: tree.root,
              env: { ...process.env, CI: '', FORCE_COLOR: '0' },
              timeout: SPAWN_TIMEOUT.timeout,
            },
          );
          result = { ...output, code: 0 };
        } catch (error) {
          result = error as { stdout: string; stderr: string; code: number };
        }
        expect(result.code).toBe(1);
        expect(existsSync(marker)).toBe(false);
        expect((result.stdout + result.stderr).split(url + SUFFIX)).toHaveLength(2);
        expect(result.stderr.match(/gcportrait e2e:/g)).toHaveLength(1);
        expect(result.stderr).toContain('rerun to pick new ports');
        const report = JSON.parse(readFileSync(json, 'utf8')) as {
          errors: { message: string; stack: string }[];
        };
        expect(report.errors).toHaveLength(1);
        expect(report.errors[0]?.message).toBe(`Error: ${url}${SUFFIX}`);
        expect(report.errors[0]?.stack).toContain(url + SUFFIX);
        expect(JSON.stringify(report)).not.toContain('gcportrait e2e:');
      } finally {
        await new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        });
        tree.remove();
      }
    },
  );
});
