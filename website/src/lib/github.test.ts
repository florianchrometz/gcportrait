// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';

import { REPOSITORY_URL } from '../site.js';
import {
  askRepositoryFacts,
  buildRepositoryFactsOf,
  factsOverride,
  repositoryOf,
  repositorySlug,
  type Repository,
} from './github.js';
import { fakeFetch, json } from './testing/helpers.js';

const REPO: Repository = { owner: 'example-owner', name: 'example-repo' };
const REPOSITORY = 'https://api.github.com/repos/example-owner/example-repo';
const RELEASE = `${REPOSITORY}/releases/latest`;
/** How the build's warning lines start and end (src/lib/github.ts). */
const PREFIX = 'website: GitHub repository widget:';
const NO_FACTS = "the header's GitHub link shows no stars, forks or version.";
const NOT_PUBLIC =
  "the header's GitHub link shows no stars, forks or version, and visitors' browsers will not ask GitHub for them.";
const NO_VERSION = "the header's GitHub link shows no version.";

// The timeout tests run on fake timers (github.ts waits with setTimeout); every other test on real ones.
afterEach(() => {
  vi.useRealTimers();
});

function warnings() {
  const lines: string[] = [];
  return { lines, warn: (line: string) => lines.push(line) };
}

/** GitHub's answers to the build: the repository's, and the latest release's (v1.0.0 unless given). */
function answers(repository: () => Promise<Response>, release?: () => Promise<Response>) {
  return fakeFetch((url) =>
    url.endsWith('/releases/latest')
      ? (release ?? (() => Promise.resolve(json(200, { tag_name: 'v1.0.0' }))))()
      : repository(),
  );
}

const COUNTS = (): Promise<Response> =>
  Promise.resolve(json(200, { stargazers_count: 1234, forks_count: 56 }));

describe('repositoryOf', () => {
  it('reads owner and name from the site’s repository URL', () => {
    expect(repositoryOf(REPOSITORY_URL)).toEqual({ owner: 'florianchrometz', name: 'gcportrait' });
    expect(repositoryOf('https://github.com/a/b.git')).toEqual({ owner: 'a', name: 'b' });
    expect(repositoryOf('https://github.com/a/b/')).toEqual({ owner: 'a', name: 'b' });
  });

  it('refuses anything that is not a github.com repository', () => {
    expect(() => repositoryOf('https://gitlab.com/a/b')).toThrow(/github\.com/);
    expect(() => repositoryOf('https://github.com/a')).toThrow(/github\.com/);
    expect(() => repositoryOf('https://github.com/a/b/tree/main')).toThrow(/github\.com/);
  });
});

describe('repositorySlug', () => {
  it('is owner/name for the header link’s data-repository, or undefined when the browser should ask nothing', () => {
    expect(repositorySlug(REPOSITORY_URL)).toBe('florianchrometz/gcportrait');
    expect(repositorySlug('https://github.com/example-owner/example-repo.git')).toBe(
      'example-owner/example-repo',
    );
    expect(repositorySlug('https://gitlab.com/example-owner/example-repo')).toBeUndefined();
    expect(repositorySlug('https://github.com/example-owner')).toBeUndefined();
    expect(repositorySlug('https://github.com/example-owner/..')).toBeUndefined();
  });
});

describe('askRepositoryFacts', () => {
  it('asks the repository and its latest release, with the token when there is one, and gives the facts', async () => {
    const { fetch, calls } = answers(COUNTS);
    const { lines, warn } = warnings();
    await expect(askRepositoryFacts(REPO, { fetch, token: 'test-token', warn })).resolves.toEqual({
      facts: { version: 'v1.0.0', stars: 1234, forks: 56 },
      notPublic: false,
    });
    expect(lines).toEqual([]);
    expect(calls.map((call) => call.url)).toEqual([REPOSITORY, RELEASE]);
    for (const call of calls) {
      const headers = call.init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer test-token');
      expect(headers.Accept).toBe('application/vnd.github+json');
      expect(headers['User-Agent']).toBeDefined();
      expect(call.init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('sends no Authorization header without a token (or with an empty one)', async () => {
    for (const token of [undefined, '']) {
      const { fetch, calls } = answers(COUNTS);
      await askRepositoryFacts(REPO, { fetch, token, warn: () => undefined });
      for (const call of calls)
        expect(call.init?.headers as Record<string, string>).not.toHaveProperty('Authorization');
    }
  });

  // A loop rather than it.each: its `$why` would cut the names at 40 characters.
  for (const answer of [
    { status: 404, headers: {}, token: undefined, why: 'not found or not public yet', outcome: NOT_PUBLIC },
    {
      status: 403,
      headers: { 'x-ratelimit-remaining': '0' },
      token: 'secret-value',
      why: 'rate limit spent; set GITHUB_TOKEN',
      outcome: NO_FACTS,
    },
    { status: 401, headers: {}, token: 'secret-value', why: 'GITHUB_TOKEN refused', outcome: NO_FACTS },
    {
      status: 429,
      headers: {},
      token: undefined,
      why: 'refused or rate-limited; set GITHUB_TOKEN',
      outcome: NO_FACTS,
    },
    { status: 500, headers: {}, token: undefined, why: 'unexpected status', outcome: NO_FACTS },
  ]) {
    it(`gives no facts with one warning when the repository's answer is a ${String(answer.status)} (${answer.why}), never printing the token`, async () => {
      const { fetch } = answers(() => Promise.resolve(json(answer.status, { message: 'x' }, answer.headers)));
      const { lines, warn } = warnings();
      await expect(askRepositoryFacts(REPO, { fetch, token: answer.token, warn })).resolves.toEqual({
        facts: null,
        notPublic: answer.status === 404,
      });
      expect(lines).toEqual([
        `${PREFIX} GitHub answered ${String(answer.status)} for example-owner/example-repo (${answer.why}); ${answer.outcome}`,
      ]);
      if (answer.token !== undefined) expect(lines.join('\n')).not.toContain(answer.token);
    });
  }

  it('gives no facts with one warning when there is no answer within the timeout', async () => {
    let aborted = 0;
    const { fetch } = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted += 1;
            reject(new DOMException('This operation was aborted', 'AbortError'));
          });
        }),
    );
    const { lines, warn } = warnings();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const asked = askRepositoryFacts(REPO, { fetch, timeoutMs: 20, warn });
    await vi.advanceTimersByTimeAsync(20);
    await expect(asked).resolves.toEqual({ facts: null, notPublic: false });
    expect(aborted).toBe(2);
    expect(lines).toEqual([`${PREFIX} no answer from https://api.github.com within 0.02 s; ${NO_FACTS}`]);
  });

  it('gives up at the timeout even when the fetch ignores the abort signal', async () => {
    const { fetch } = fakeFetch(() => new Promise<Response>(() => undefined));
    const { lines, warn } = warnings();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const asked = askRepositoryFacts(REPO, { fetch, timeoutMs: 20, warn });
    await vi.advanceTimersByTimeAsync(20);
    await expect(asked).resolves.toEqual({ facts: null, notPublic: false });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('no answer');
  });

  it('gives no facts with one warning when offline (the fetch rejects)', async () => {
    const { fetch } = fakeFetch(() =>
      Promise.reject(
        new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND api.github.com') }),
      ),
    );
    const { lines, warn } = warnings();
    await expect(askRepositoryFacts(REPO, { fetch, warn })).resolves.toEqual({
      facts: null,
      notPublic: false,
    });
    expect(lines).toEqual([
      `${PREFIX} could not reach https://api.github.com (getaddrinfo ENOTFOUND api.github.com); ${NO_FACTS}`,
    ]);
  });

  it('says not public, with one warning, when the answer says the repository is private (a token that may read it)', async () => {
    const { fetch } = answers(() =>
      Promise.resolve(json(200, { private: true, stargazers_count: 0, forks_count: 0 })),
    );
    const { lines, warn } = warnings();
    await expect(askRepositoryFacts(REPO, { fetch, token: 'test-token', warn })).resolves.toEqual({
      facts: null,
      notPublic: true,
    });
    expect(lines).toEqual([`${PREFIX} example-owner/example-repo is private; ${NOT_PUBLIC}`]);
  });

  it('gives no facts with one warning for a body without both counts', async () => {
    for (const body of [
      {},
      { stargazers_count: 12 },
      { forks_count: 3 },
      { stargazers_count: '12', forks_count: 3 },
      { stargazers_count: -1, forks_count: 3 },
      { stargazers_count: 1.5, forks_count: 3 },
      null,
    ]) {
      const { fetch } = answers(() => Promise.resolve(json(200, body)));
      const { lines, warn } = warnings();
      await expect(askRepositoryFacts(REPO, { fetch, warn }), JSON.stringify(body)).resolves.toEqual({
        facts: null,
        notPublic: false,
      });
      expect(lines).toEqual([
        `${PREFIX} GitHub's answer for example-owner/example-repo has no stargazers_count and forks_count; ${NO_FACTS}`,
      ]);
    }
    const { fetch } = answers(() => Promise.resolve(new Response('<html>not json</html>', { status: 200 })));
    const { lines, warn } = warnings();
    await expect(askRepositoryFacts(REPO, { fetch, warn })).resolves.toEqual({
      facts: null,
      notPublic: false,
    });
    expect(lines).toHaveLength(1);
  });

  it('gives the counts without a version, and no line, for a repository without a release (a 404)', async () => {
    const { fetch } = answers(COUNTS, () => Promise.resolve(json(404, { message: 'Not Found' })));
    const { lines, warn } = warnings();
    await expect(askRepositoryFacts(REPO, { fetch, warn })).resolves.toEqual({
      facts: { version: null, stars: 1234, forks: 56 },
      notPublic: false,
    });
    expect(lines).toEqual([]);
  });

  it('gives the counts without a version, and one line, when the release’s answer fails otherwise', async () => {
    const cases: [() => Promise<Response>, string][] = [
      [
        () => Promise.resolve(json(403, {}, { 'x-ratelimit-remaining': '0' })),
        `${PREFIX} GitHub answered 403 for the latest release of example-owner/example-repo (rate limit spent; set GITHUB_TOKEN); ${NO_VERSION}`,
      ],
      [
        () => Promise.resolve(json(200, { tag_name: 'not a tag' })),
        `${PREFIX} GitHub's latest release of example-owner/example-repo has no tag_name to show; ${NO_VERSION}`,
      ],
      [
        () => Promise.reject(new TypeError('fetch failed')),
        `${PREFIX} the latest release of example-owner/example-repo: could not reach https://api.github.com (fetch failed); ${NO_VERSION}`,
      ],
    ];
    for (const [release, line] of cases) {
      const { fetch } = answers(COUNTS, release);
      const { lines, warn } = warnings();
      await expect(askRepositoryFacts(REPO, { fetch, warn })).resolves.toEqual({
        facts: { version: null, stars: 1234, forks: 56 },
        notPublic: false,
      });
      expect(lines).toEqual([line]);
    }
  });

  it('says not public only on a 404 or a private answer: on any other failure the visitor’s browser may still ask', async () => {
    const failures: (() => Promise<Response>)[] = [
      () => Promise.resolve(json(403, {}, { 'x-ratelimit-remaining': '0' })),
      () => Promise.resolve(json(429, {})),
      () => Promise.resolve(json(500, {})),
      () => Promise.resolve(json(401, {})),
      () => Promise.resolve(json(200, {})),
      () => Promise.reject(new TypeError('fetch failed')),
      () => new Promise<Response>(() => undefined),
    ];
    // The last never answers: the 20 ms timeout ends it, on fake timers.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    for (const failure of failures) {
      const { fetch } = answers(failure);
      const asked = askRepositoryFacts(REPO, { fetch, timeoutMs: 20, warn: () => undefined });
      await vi.advanceTimersByTimeAsync(20);
      await expect(asked).resolves.toEqual({ facts: null, notPublic: false });
    }
  });
});

describe('factsOverride (WEBSITE_STAR_COUNT, WEBSITE_FORK_COUNT, WEBSITE_RELEASE)', () => {
  it('is undefined while WEBSITE_STAR_COUNT is unset or empty, so the build asks GitHub', () => {
    expect(factsOverride({})).toBeUndefined();
    expect(factsOverride({ WEBSITE_STAR_COUNT: '  ', WEBSITE_FORK_COUNT: '3' })).toBeUndefined();
  });

  it('takes the stars, the forks (0 when unset) and the version (none when unset); "off" is no facts', () => {
    expect(factsOverride({ WEBSITE_STAR_COUNT: '1234' })).toEqual({ version: null, stars: 1234, forks: 0 });
    expect(
      factsOverride({ WEBSITE_STAR_COUNT: '12', WEBSITE_FORK_COUNT: '3', WEBSITE_RELEASE: 'v1.0.0' }),
    ).toEqual({ version: 'v1.0.0', stars: 12, forks: 3 });
    expect(factsOverride({ WEBSITE_STAR_COUNT: 'off', WEBSITE_FORK_COUNT: '3' })).toBeNull();
  });

  it('refuses anything else with a warning: no facts for the stars, the default for the others', () => {
    const { lines, warn } = warnings();
    expect(factsOverride({ WEBSITE_STAR_COUNT: '1.2k' }, warn)).toBeNull();
    expect(factsOverride({ WEBSITE_STAR_COUNT: '-3' }, warn)).toBeNull();
    expect(
      factsOverride({ WEBSITE_STAR_COUNT: '5', WEBSITE_FORK_COUNT: 'many', WEBSITE_RELEASE: '<b>' }, warn),
    ).toEqual({ version: null, stars: 5, forks: 0 });
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('WEBSITE_STAR_COUNT is "1.2k"');
    expect(lines[2]).toContain('WEBSITE_FORK_COUNT is "many"');
    expect(lines[3]).toContain('WEBSITE_RELEASE is "<b>"');
  });
});

describe('buildRepositoryFactsOf (the build’s one ask)', () => {
  const quiet = (): void => undefined;

  it('asks GitHub for a github.com repository, with the token from the environment', async () => {
    const { fetch, calls } = answers(COUNTS);
    const { lines, warn } = warnings();
    await expect(
      buildRepositoryFactsOf(
        'https://github.com/example-owner/example-repo',
        { GITHUB_TOKEN: 'test-token' },
        { fetch, warn },
      ),
    ).resolves.toEqual({ facts: { version: 'v1.0.0', stars: 1234, forks: 56 }, notPublic: false });
    expect(lines).toEqual([]);
    expect(calls.map((call) => call.url)).toEqual([REPOSITORY, RELEASE]);
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
  });

  it('never fails over a repository URL that is not on github.com: one warning, no facts, no request', async () => {
    for (const url of ['https://gitlab.example.com/owner/repo', 'https://github.com/owner', 'not a url']) {
      const { fetch, calls } = answers(COUNTS);
      const { lines, warn } = warnings();
      await expect(buildRepositoryFactsOf(url, {}, { fetch, warn })).resolves.toEqual({
        facts: null,
        notPublic: false,
      });
      expect(calls).toHaveLength(0);
      expect(lines).toHaveLength(1);
      expect(lines[0]?.startsWith(`${PREFIX} `)).toBe(true);
      expect(lines[0]?.endsWith(`; ${NO_FACTS}`)).toBe(true);
    }
  });

  it('takes the overrides first, without a request, whatever the URL, and never says not public', async () => {
    const { fetch, calls } = answers(() => Promise.resolve(json(404, {})));
    await expect(
      buildRepositoryFactsOf('https://gitlab.example.com/a/b', { WEBSITE_STAR_COUNT: '7' }, { fetch }),
    ).resolves.toEqual({ facts: { version: null, stars: 7, forks: 0 }, notPublic: false });
    await expect(
      buildRepositoryFactsOf(REPOSITORY_URL, { WEBSITE_STAR_COUNT: 'off' }, { fetch }),
    ).resolves.toEqual({ facts: null, notPublic: false });
    expect(calls).toHaveLength(0);
    // Without them, GitHub's 404 says not public.
    await expect(buildRepositoryFactsOf(REPOSITORY_URL, {}, { fetch, warn: quiet })).resolves.toEqual({
      facts: null,
      notPublic: true,
    });
  });
});
