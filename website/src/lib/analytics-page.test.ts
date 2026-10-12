// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from 'vitest';

import { TELEMETRYDECK_APP_ID, TELEMETRYDECK_TARGET } from '../site.js';
import type { SessionStore } from './analytics.js';
import {
  maySend,
  startAnalytics,
  type AnalyticsContext,
  type Sender,
  type SenderOptions,
} from './analytics-page.js';

/** What a fake SDK saw: the instances' options and every signal, in order. */
type Seen = { instances: SenderOptions[]; signals: { type: string; payload?: Record<string, string> }[] };

/** TelemetryDeck's SDK as the page uses it, recording; `signal` answers with `answer` (a promise, or it throws). */
function fakeSdk(answer: () => Promise<unknown> = () => Promise.resolve(new Response('{}'))) {
  const seen: Seen = { instances: [], signals: [] };
  const loadSender = vi.fn(() =>
    Promise.resolve((options: SenderOptions): Sender => {
      seen.instances.push(options);
      return {
        signal: (type, payload) => {
          seen.signals.push({ type, ...(payload === undefined ? {} : { payload }) });
          return answer();
        },
      };
    }),
  );
  return { seen, loadSender };
}

function memoryStore(): { items: Map<string, string>; store: () => SessionStore } {
  const items = new Map<string, string>();
  return {
    items,
    store: () => ({
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => {
        items.set(key, value);
      },
    }),
  };
}

/**
 * A page of the site in a build with analytics on, at gcportrait.app, without Do Not Track or GPC, loaded and idle at
 * once; `follow` stands for the visitor following a link.
 */
function page(overrides: Partial<AnalyticsContext> = {}) {
  const sdk = fakeSdk();
  const storage = memoryStore();
  let follow: (href: string) => void = () => {
    throw new Error('no listener for followed links');
  };
  const idle: (() => void)[] = [];
  const context: AnalyticsContext = {
    enabled: true,
    href: 'https://gcportrait.app/docs/self-host/?project=my-project#oauth',
    declaredPath: () => '/docs/self-host/',
    hostname: 'gcportrait.app',
    preferences: {},
    storage: storage.store,
    fillRandom: (bytes) => bytes.fill(7),
    whenIdle: (task) => {
      idle.push(task);
      task();
    },
    onFollow: (listener) => {
      follow = listener;
    },
    repository: () => 'https://github.com/florianchrometz/gcportrait',
    loadSender: sdk.loadSender,
    ...overrides,
  };
  return {
    context,
    sdk,
    storage,
    idle,
    follow: (href: string): void => {
      follow(href);
    },
  };
}

describe('when a page sends nothing', () => {
  it.each<[string, Partial<AnalyticsContext>]>([
    ['a build with analytics off', { enabled: false }],
    ['a local preview', { hostname: '127.0.0.1', href: 'http://127.0.0.1:4321/' }],
    [
      'another host (a fork, a mirror)',
      { hostname: 'fork.github.io', href: 'https://fork.github.io/gcportrait/' },
    ],
    ['Do Not Track', { preferences: { doNotTrack: '1' } }],
    ['Global Privacy Control', { preferences: { globalPrivacyControl: true } }],
  ])('%s: no SDK loaded, no signal, nothing stored, nothing waited for', async (_case, overrides) => {
    const { context, sdk, storage, idle } = page(overrides);
    expect(maySend(context)).toBe(false);
    await startAnalytics(context);
    expect(sdk.loadSender).not.toHaveBeenCalled();
    expect(sdk.seen.signals).toEqual([]);
    expect(storage.items.size).toBe(0);
    expect(idle).toEqual([]);
  });
});

describe('a page of the site', () => {
  it('sends one page view with its path once loaded and idle, to TelemetryDeck’s address with the app id', async () => {
    const { context, sdk, storage, idle } = page();
    await startAnalytics(context);
    expect(idle).toHaveLength(1);
    expect(sdk.loadSender).toHaveBeenCalledTimes(1);
    expect(sdk.seen.signals).toEqual([{ type: 'pageView', payload: { path: '/docs/self-host/' } }]);
    const identity = { user: '07'.repeat(16), session: '07'.repeat(16) };
    expect(sdk.seen.instances).toEqual([
      {
        appID: TELEMETRYDECK_APP_ID,
        clientUser: identity.user,
        sessionID: identity.session,
        target: TELEMETRYDECK_TARGET,
      },
    ]);
    // The session's identifiers, in sessionStorage, for the next page of the tab.
    expect(JSON.parse(storage.items.get('gcportrait.analytics') ?? '')).toEqual(identity);
  });

  it('waits for the load event and the idle browser before it loads the SDK', async () => {
    const queued: (() => void)[] = [];
    const { context, sdk } = page({
      whenIdle: (task) => {
        queued.push(task);
      },
    });
    const started = startAnalytics(context);
    expect(sdk.loadSender).not.toHaveBeenCalled();
    queued[0]?.();
    await started;
    expect(sdk.seen.signals.map((signal) => signal.type)).toEqual(['pageView']);
  });

  it('keeps the tab’s identifiers from page to page', async () => {
    const first = page();
    await startAnalytics(first.context);
    const next = page({
      href: 'https://gcportrait.app/coverage/',
      declaredPath: () => '/coverage/',
      storage: first.storage.store,
      fillRandom: () => {
        throw new Error('made new identifiers');
      },
    });
    await startAnalytics(next.context);
    expect(next.sdk.seen.instances[0]?.clientUser).toBe(first.sdk.seen.instances[0]?.clientUser);
    expect(next.sdk.seen.instances[0]?.sessionID).toBe(first.sdk.seen.instances[0]?.sessionID);
    expect(next.sdk.seen.signals).toEqual([{ type: 'pageView', payload: { path: '/coverage/' } }]);
  });

  it('sends a named signal for a followed link to the demo or the repository, and nothing for any other', async () => {
    const { context, sdk, follow } = page();
    await startAnalytics(context);
    follow('https://gcportrait.app/demo/');
    follow('https://github.com/florianchrometz/gcportrait/releases');
    follow('https://gcportrait.app/docs/');
    follow('https://florian-chrometz.de/legal/privacy-policy');
    follow('https://github.com/florianchrometz/gcportrait');
    expect(sdk.seen.signals).toEqual([
      { type: 'pageView', payload: { path: '/docs/self-host/' } },
      { type: 'Outbound.demo', payload: { path: '/docs/self-host/' } },
      { type: 'Outbound.repository', payload: { path: '/docs/self-host/' } },
      { type: 'Outbound.repository', payload: { path: '/docs/self-host/' } },
    ]);
    // One instance for the page, whatever it sends.
    expect(sdk.loadSender).toHaveBeenCalledTimes(1);
    expect(sdk.seen.instances).toHaveLength(1);
  });

  it('never sends a query, a fragment, a typed value or another page’s address', async () => {
    const { context, sdk, follow } = page({
      href: 'https://gcportrait.app/docs/self-host/?YOUR_PROJECT=secret-project#YOUR_REGION=x',
    });
    await startAnalytics(context);
    follow('https://gcportrait.app/demo/?org=secret#view=x');
    const sent = JSON.stringify(sdk.seen);
    expect(sent).not.toMatch(/secret|YOUR_|view=|\?|#/);
  });

  it.each<[string, Partial<AnalyticsContext>]>([
    ['the SDK does not load', { loadSender: () => Promise.reject(new TypeError('Failed to fetch')) }],
    [
      'the SDK throws as it is made',
      {
        loadSender: () =>
          Promise.resolve(() => {
            throw new Error('appID is required');
          }),
      },
    ],
    [
      'sessionStorage is blocked',
      {
        storage: () => {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
      },
    ],
    [
      'the page is not where it says',
      {
        whenIdle: () => {
          throw new Error('no window');
        },
      },
    ],
  ])('never throws or rejects when %s', async (_case, overrides) => {
    const { context } = page(overrides);
    await expect(startAnalytics(context)).resolves.toBeUndefined();
  });

  it('never throws or rejects when TelemetryDeck cannot be reached, answers an error, or the signal throws', async () => {
    for (const answer of [
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => Promise.resolve(new Response('', { status: 500 })),
      () => {
        throw new Error('crypto.subtle is undefined');
      },
    ]) {
      const sdk = fakeSdk(answer);
      const { context, follow } = page({ loadSender: sdk.loadSender });
      await expect(startAnalytics(context)).resolves.toBeUndefined();
      expect(() => {
        follow('https://gcportrait.app/demo/');
      }).not.toThrow();
      expect(sdk.seen.signals.map((signal) => signal.type)).toEqual(['pageView', 'Outbound.demo']);
    }
  });

  it('counts no click on the repository where the page has no link to it in the header', async () => {
    const { context, sdk, follow } = page({ repository: () => undefined });
    await startAnalytics(context);
    follow('https://github.com/florianchrometz/gcportrait');
    expect(sdk.seen.signals.map((signal) => signal.type)).toEqual(['pageView']);
  });
});

describe('the path a page reports', () => {
  it('is the path the page declares, so the 404 page reports /404.html and never the address typed', async () => {
    const { context, sdk } = page({
      href: 'https://gcportrait.app/secret%20draft/?token=abc',
      declaredPath: () => '/404.html',
    });
    await startAnalytics(context);
    expect(sdk.seen.signals).toEqual([{ type: 'pageView', payload: { path: '/404.html' } }]);
  });

  it('falls back to the address without its query and fragment when a page declares nothing', async () => {
    const { context, sdk } = page({ declaredPath: () => undefined });
    await startAnalytics(context);
    expect(sdk.seen.signals).toEqual([{ type: 'pageView', payload: { path: '/docs/self-host/' } }]);
  });
});
