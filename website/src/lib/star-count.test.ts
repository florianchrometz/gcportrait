// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as github from './github.js';
import {
  type FactStore,
  type RepositoryFacts,
  currentRepositoryFacts,
  factsOf,
  formatCount,
  isRepositorySlug,
  keptFacts,
  keptFactsText,
  liveRepositoryFacts,
  repositoryLinkLabel,
  versionName,
} from './star-count.js';
import { fakeFetch, json } from './testing/helpers.js';

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);

/**
 * What the site promises about the widget in the visitor's browser (docs/legal/data-processing-inventory.md, row W3,
 * and docs/website.md, "GitHub repository widget"): the facts are kept in sessionStorage under this key, GitHub is
 * asked at most once an hour, and an answer is waited for 4 seconds. The tests hold the code to these values, not to
 * its own constants.
 */
const KEY = 'gcportrait.repository';
const HOUR = 60 * 60 * 1000;
const LIVE_TIMEOUT_MS = 4000;
const SLUG = 'florianchrometz/gcportrait';
const REPOSITORY = 'https://api.github.com/repos/florianchrometz/gcportrait';
const RELEASE = `${REPOSITORY}/releases/latest`;

const FACTS: RepositoryFacts = { version: 'v1.0.0', stars: 1301, forks: 42 };

/** Stubs the global fetch (the browser's) with `answer`, recording each call. */
function stubFetch(answer: (url: string, init: RequestInit | undefined) => Promise<Response>) {
  return fakeFetch(answer, { global: true }).calls;
}

/** GitHub's two answers: the repository's and the latest release's, each a JSON body with a status. */
function githubAnswers(
  repository: [number, unknown],
  release: [number, unknown] = [200, { tag_name: 'v1.0.0' }],
) {
  return (url: string): Promise<Response> =>
    Promise.resolve(url.endsWith('/releases/latest') ? json(...release) : json(...repository));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the build and the browser share one formatter and one name', () => {
  it('is the same function in both (github.ts re-exports them)', () => {
    expect(github.formatCount).toBe(formatCount);
    expect(github.repositoryLinkLabel).toBe(repositoryLinkLabel);
  });
});

describe('formatCount', () => {
  it.each([
    [0, '0'],
    [7, '7'],
    [999, '999'],
    [1000, '1k'],
    [1049, '1k'],
    [1234, '1.2k'],
    [1250, '1.3k'],
    [1999, '2k'],
    [9999, '10k'],
    [12_000, '12k'],
    [12_345, '12.3k'],
    [36_776, '36.8k'],
    [63_156, '63.2k'],
    [83_280, '83.3k'],
    [456_789, '456.8k'],
    [999_949, '999.9k'],
    [999_950, '1M'],
    [1_234_567, '1.2M'],
    [12_345_678, '12.3M'],
  ])('%d → %s', (count, label) => {
    expect(formatCount(count)).toBe(label);
  });
});

describe('repositoryLinkLabel', () => {
  it('names the project, GitHub and, when known, the version, the stars and the forks', () => {
    expect(repositoryLinkLabel('gcportrait', null)).toBe('gcportrait on GitHub');
    expect(repositoryLinkLabel('gcportrait', { version: 'v1.0.0', stars: 12, forks: 3 })).toBe(
      'gcportrait on GitHub: version 1.0.0, 12 stars, 3 forks',
    );
    expect(repositoryLinkLabel('gcportrait', { version: null, stars: 1234, forks: 1 })).toBe(
      'gcportrait on GitHub: 1.2k stars, 1 fork',
    );
    expect(repositoryLinkLabel('gcportrait', { version: '2026.10', stars: 1, forks: 0 })).toBe(
      'gcportrait on GitHub: version 2026.10, 1 star, 0 forks',
    );
  });

  it('reads a "v" before a number as part of the tag, not of the version', () => {
    expect(versionName('v1.0.0')).toBe('1.0.0');
    expect(versionName('V2.1')).toBe('2.1');
    expect(versionName('1.0.0')).toBe('1.0.0');
    expect(versionName('vNext')).toBe('vNext');
    expect(versionName('release-7')).toBe('release-7');
  });
});

describe('isRepositorySlug', () => {
  it('takes owner/name as GitHub allows them', () => {
    expect(isRepositorySlug('florianchrometz/gcportrait')).toBe(true);
    expect(isRepositorySlug('withastro/astro')).toBe(true);
    expect(isRepositorySlug('a-b/c.d_e-f')).toBe(true);
  });

  it('refuses anything that would change the request’s path or query', () => {
    for (const slug of [
      '',
      'owner',
      'owner/',
      '/name',
      'owner/name/extra',
      'owner/..',
      'owner/.',
      '../x',
      'owner/name?x=1',
      'owner/name#x',
      'owner/na me',
      'owner/name%2F',
      'own_er/name',
      `${'a'.repeat(40)}/name`,
    ]) {
      expect(isRepositorySlug(slug), slug).toBe(false);
    }
  });
});

describe('the kept facts (sessionStorage)', () => {
  it('are written as the facts with the time they were read', () => {
    expect(keptFactsText(FACTS, NOW)).toBe(
      `{"facts":{"version":"v1.0.0","stars":1301,"forks":42},"at":${String(NOW)}}`,
    );
  });

  it('are used for less than an hour', () => {
    const text = keptFactsText(FACTS, NOW);
    expect(keptFacts(text, NOW)).toEqual(FACTS);
    expect(keptFacts(text, NOW + HOUR - 1)).toEqual(FACTS);
    expect(keptFacts(text, NOW + HOUR)).toBeUndefined();
    const none = { version: null, stars: 0, forks: 0 };
    expect(keptFacts(keptFactsText(none, NOW), NOW)).toEqual(none);
  });

  it('note a request with no facts yet (or none at all) for the hour too', () => {
    expect(keptFactsText(null, NOW)).toBe(`{"facts":null,"at":${String(NOW)}}`);
    expect(keptFacts(keptFactsText(null, NOW), NOW)).toBeNull();
    expect(keptFacts(keptFactsText(null, NOW), NOW + HOUR - 1)).toBeNull();
    expect(keptFacts(keptFactsText(null, NOW), NOW + HOUR)).toBeUndefined();
    expect(keptFacts(keptFactsText(null, NOW + 1), NOW)).toBeUndefined();
  });

  it('are ignored when missing, dated in the future, or not what the page wrote', () => {
    expect(keptFacts(null, NOW)).toBeUndefined();
    expect(keptFacts(keptFactsText(FACTS, NOW + 1), NOW)).toBeUndefined();
    const at = String(NOW);
    for (const text of [
      '',
      'not json',
      'null',
      '1234',
      '[1234]',
      `{"facts":{"version":"v1.0.0","stars":1,"forks":2}}`,
      '{"at":0}',
      `{"at":${at}}`,
      // What the star count kept before the widget had forks and a version: asked again.
      `{"count":1234,"at":${at}}`,
      `{"facts":false,"at":${at}}`,
      `{"facts":{"version":"v1.0.0","stars":"1","forks":2},"at":${at}}`,
      `{"facts":{"version":"v1.0.0","stars":1},"at":${at}}`,
      `{"facts":{"version":"v1.0.0","stars":-1,"forks":2},"at":${at}}`,
      `{"facts":{"version":"v1.0.0","stars":1.5,"forks":2},"at":${at}}`,
      `{"facts":{"version":"<b>1</b>","stars":1,"forks":2},"at":${at}}`,
      `{"facts":{"stars":1,"forks":2},"at":${at}}`,
      `{"facts":{"version":"v1.0.0","stars":1,"forks":2},"at":"${at}"}`,
    ]) {
      expect(keptFacts(text, NOW), text).toBeUndefined();
    }
  });

  it('take only a tag the header may show as it is', () => {
    expect(factsOf({ version: 'v1.0.0-rc.1+build.5', stars: 1, forks: 2 })).not.toBeNull();
    for (const version of ['', ' v1', '-v1', 'v1 0', 'a'.repeat(41), '<v1>', 'v1/2', 1]) {
      expect(factsOf({ version, stars: 1, forks: 2 }), String(version)).toBeNull();
    }
  });
});

describe('liveRepositoryFacts (the browser’s two requests)', () => {
  it('asks for the repository and its latest release together: anonymous, no referrer, GitHub’s JSON, 4 s', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const calls = stubFetch(
      githubAnswers([200, { stargazers_count: 1301, forks_count: 42, private: false }]),
    );
    await expect(liveRepositoryFacts(SLUG)).resolves.toEqual(FACTS);
    expect(calls.map((call) => call.url)).toEqual([REPOSITORY, RELEASE]);
    for (const { init } of calls) {
      expect(init?.credentials).toBe('omit');
      expect(init?.referrerPolicy).toBe('no-referrer');
      expect(init?.method).toBeUndefined(); // GET
      // Accept only: a CORS-safelisted header, so the browser sends no preflight.
      expect(init?.headers).toEqual({ Accept: 'application/vnd.github+json' });
      expect(init?.signal).toBe(timeout.mock.results[0]?.value);
    }
    expect(timeout).toHaveBeenCalledOnce();
    expect(timeout).toHaveBeenCalledWith(LIVE_TIMEOUT_MS);
  });

  it('asks nothing for a repository name it would not put into a URL', async () => {
    const calls = stubFetch(githubAnswers([200, { stargazers_count: 1, forks_count: 1 }]));
    await expect(liveRepositoryFacts('owner/..')).resolves.toBeUndefined();
    await expect(liveRepositoryFacts('https://example.com/x')).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it.each([
    [404, { message: 'Not Found' }],
    [403, { message: 'API rate limit exceeded' }],
    [429, { message: 'Too Many Requests' }],
    [500, {}],
    [301, {}],
  ])('resolves to undefined when the repository’s answer is a %d', async (status, body) => {
    stubFetch(githubAnswers([status, body]));
    await expect(liveRepositoryFacts(SLUG)).resolves.toBeUndefined();
  });

  it('resolves to undefined for a repository body without both counts', async () => {
    for (const body of [
      {},
      { stargazers_count: 12 },
      { forks_count: 3 },
      { stargazers_count: '12', forks_count: 3 },
      { stargazers_count: 12, forks_count: -1 },
      { stargazers_count: 1.5, forks_count: 3 },
      { stargazers_count: null, forks_count: 3 },
      null,
      [],
      'text',
    ]) {
      stubFetch(githubAnswers([200, body]));
      await expect(liveRepositoryFacts(SLUG), JSON.stringify(body)).resolves.toBeUndefined();
    }
    stubFetch(() => Promise.resolve(new Response('<html>', { status: 200 })));
    await expect(liveRepositoryFacts(SLUG)).resolves.toBeUndefined();
  });

  it('gives the counts without a version when the release’s answer has none', async () => {
    const counts: [number, unknown] = [200, { stargazers_count: 12, forks_count: 3 }];
    for (const release of [
      [404, { message: 'Not Found' }],
      [403, {}],
      [500, {}],
      [200, {}],
      [200, { tag_name: 7 }],
      [200, { tag_name: '<script>' }],
    ] as [number, unknown][]) {
      stubFetch(githubAnswers(counts, release));
      await expect(liveRepositoryFacts(SLUG), JSON.stringify(release)).resolves.toEqual({
        version: null,
        stars: 12,
        forks: 3,
      });
    }
    stubFetch((url) =>
      url.endsWith('/releases/latest')
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(json(...counts)),
    );
    await expect(liveRepositoryFacts(SLUG)).resolves.toEqual({ version: null, stars: 12, forks: 3 });
  });

  it('resolves to undefined when offline, and never logs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(liveRepositoryFacts(SLUG)).resolves.toBeUndefined();
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('gives up at the timeout it is given: both requests are aborted then', async () => {
    // AbortSignal.timeout runs on Node's own timers, which fake timers do not reach: a real 50 ms, and the spy shows
    // that the requests' signal is the one for those 50 ms.
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const calls = stubFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason as Error);
          });
        }),
    );
    await expect(liveRepositoryFacts(SLUG, 50)).resolves.toBeUndefined();
    expect(timeout).toHaveBeenCalledWith(50);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.init?.signal).toBe(timeout.mock.results[0]?.value);
      expect(call.init?.signal?.aborted).toBe(true);
    }
  });
});

/** sessionStorage as a map; `blocked` makes reading it (as a blocked browser does), or only writing, throw. */
function memoryStore(blocked?: 'store' | 'write') {
  const items = new Map<string, string>();
  const store: FactStore = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      if (blocked === 'write') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      items.set(key, value);
    },
  };
  return {
    items,
    store: (): FactStore => {
      if (blocked === 'store') throw new DOMException('The operation is insecure.', 'SecurityError');
      return store;
    },
  };
}

/** GitHub, answering each request with the next of `answers` (facts, or undefined for a failure). */
function answering(...answers: (RepositoryFacts | undefined)[]) {
  const asked: string[] = [];
  return {
    asked,
    ask: (slug: string): Promise<RepositoryFacts | undefined> => {
      asked.push(slug);
      return Promise.resolve(answers.shift());
    },
  };
}

describe('currentRepositoryFacts (asking GitHub at most once an hour per tab)', () => {
  const LATER: RepositoryFacts = { version: 'v1.1.0', stars: 1302, forks: 43 };

  it('asks once, notes it before asking, and keeps the facts for the hour', async () => {
    const { items, store } = memoryStore();
    let notedWhileAsking: string | undefined;
    const answers = answering(FACTS);
    const ask = (slug: string): Promise<RepositoryFacts | undefined> => {
      notedWhileAsking = items.get(KEY);
      return answers.ask(slug);
    };
    await expect(currentRepositoryFacts(SLUG, store, ask, () => NOW)).resolves.toEqual(FACTS);
    expect(answers.asked).toEqual([SLUG]);
    expect(notedWhileAsking).toBe(keptFactsText(null, NOW));
    expect(items.get(KEY)).toBe(keptFactsText(FACTS, NOW));
    expect([...items.keys()]).toEqual([KEY]);
    // Later pages of the hour: the kept facts, no request.
    await expect(currentRepositoryFacts(SLUG, store, ask, () => NOW + HOUR - 1)).resolves.toEqual(FACTS);
    expect(answers.asked).toHaveLength(1);
    // An hour on: asked again.
    await expect(
      currentRepositoryFacts(SLUG, store, answering(LATER).ask, () => NOW + HOUR),
    ).resolves.toEqual(LATER);
  });

  it('after a failure shows nothing and does not ask again within the hour', async () => {
    const { items, store } = memoryStore();
    const answers = answering(undefined, FACTS);
    await expect(currentRepositoryFacts(SLUG, store, answers.ask, () => NOW)).resolves.toBeUndefined();
    expect(items.get(KEY)).toBe(keptFactsText(null, NOW));
    for (const later of [NOW + 1, NOW + 60_000, NOW + HOUR - 1]) {
      await expect(currentRepositoryFacts(SLUG, store, answers.ask, () => later)).resolves.toBeUndefined();
    }
    expect(answers.asked).toHaveLength(1);
    await expect(currentRepositoryFacts(SLUG, store, answers.ask, () => NOW + HOUR)).resolves.toEqual(FACTS);
    expect(answers.asked).toHaveLength(2);
  });

  it('does not ask again when the page that asked was left before the answer', async () => {
    const { store } = memoryStore();
    const asked: string[] = [];
    const never = (slug: string): Promise<RepositoryFacts | undefined> => {
      asked.push(slug);
      return new Promise<RepositoryFacts | undefined>(() => undefined);
    };
    void currentRepositoryFacts(SLUG, store, never, () => NOW);
    await expect(currentRepositoryFacts(SLUG, store, never, () => NOW + 500)).resolves.toBeUndefined();
    expect(asked).toHaveLength(1);
  });

  it('never asks where sessionStorage is blocked or cannot be written', async () => {
    for (const blocked of ['store', 'write'] as const) {
      const answers = answering(FACTS);
      const { store } = memoryStore(blocked);
      await expect(
        currentRepositoryFacts(SLUG, store, answers.ask, () => NOW),
        blocked,
      ).resolves.toBeUndefined();
      await expect(
        currentRepositoryFacts(SLUG, store, answers.ask, () => NOW + 1),
        blocked,
      ).resolves.toBeUndefined();
      expect(answers.asked, blocked).toEqual([]);
    }
  });

  it('asks again over something it did not write, and never logs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { items, store } = memoryStore();
    items.set(KEY, 'not json');
    const answers = answering(undefined);
    await expect(currentRepositoryFacts(SLUG, store, answers.ask, () => NOW)).resolves.toBeUndefined();
    expect(answers.asked).toHaveLength(1);
    expect(items.get(KEY)).toBe(keptFactsText(null, NOW));
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('asks GitHub itself by default (liveRepositoryFacts), anonymously', async () => {
    const calls = stubFetch(githubAnswers([200, { stargazers_count: 7, forks_count: 1 }]));
    const { store } = memoryStore();
    await expect(currentRepositoryFacts(SLUG, store)).resolves.toEqual({
      version: 'v1.0.0',
      stars: 7,
      forks: 1,
    });
    expect(calls.map((call) => [call.url, call.init?.credentials])).toEqual([
      [REPOSITORY, 'omit'],
      [RELEASE, 'omit'],
    ]);
  });
});
