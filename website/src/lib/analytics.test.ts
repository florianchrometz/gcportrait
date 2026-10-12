// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import {
  ANALYTICS_SESSION_KEY,
  SIGNALS,
  analyticsEnabled,
  isSiteHost,
  outboundSignal,
  pagePath,
  randomId,
  sessionIdentity,
  trackingRefused,
  type SessionStore,
} from './analytics.js';

/**
 * What the site promises about its page views (docs/website.md, "Analytics", and the data-processing inventory's row
 * W4): the session's identifiers under this sessionStorage key, these signal names, and nothing else. The tests hold
 * the code to these values, not to its own constants.
 */
const KEY = 'gcportrait.analytics';
const PAGE = 'https://gcportrait.app/docs/self-host/';
const REPOSITORY = 'https://github.com/florianchrometz/gcportrait';

/** sessionStorage as a map; `blocked` makes reaching it (a blocked browser), or only writing it (full), throw. */
function memoryStore(blocked?: 'store' | 'write') {
  const items = new Map<string, string>();
  const store: SessionStore = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      if (blocked === 'write') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      items.set(key, value);
    },
  };
  return {
    items,
    store: (): SessionStore => {
      if (blocked === 'store') throw new DOMException('The operation is insecure.', 'SecurityError');
      return store;
    },
  };
}

/** Identifiers made in order: a, b, c, … as 32 hexadecimal digits. */
function counter() {
  let next = 0;
  return () => (next++).toString(16).padStart(32, '0');
}

describe('the build: WEBSITE_ANALYTICS, on by default in a deploying build only', () => {
  it('is off in development, local and pull-request builds and the tests (nothing set)', () => {
    expect(analyticsEnabled({})).toBe(false);
    expect(analyticsEnabled({ WEBSITE_STRICT: '0' })).toBe(false);
    expect(analyticsEnabled({ WEBSITE_ANALYTICS: '' })).toBe(false);
  });

  it('is on in a deploying build (WEBSITE_STRICT=1, set by the Pages and release workflows when they deploy)', () => {
    expect(analyticsEnabled({ WEBSITE_STRICT: '1' })).toBe(true);
    expect(analyticsEnabled({ WEBSITE_STRICT: 'true' })).toBe(true);
    expect(analyticsEnabled({ WEBSITE_STRICT: '1', WEBSITE_ANALYTICS: '  ' })).toBe(true);
  });

  it('follows WEBSITE_ANALYTICS where it is set: 0 switches a deploying build off (forks), 1 any build on', () => {
    for (const off of ['0', 'false', 'off', 'OFF', ' 0 ']) {
      expect(analyticsEnabled({ WEBSITE_STRICT: '1', WEBSITE_ANALYTICS: off })).toBe(false);
    }
    for (const on of ['1', 'true', 'on', 'True'])
      expect(analyticsEnabled({ WEBSITE_ANALYTICS: on })).toBe(true);
  });

  it('fails the build on any other value rather than guess', () => {
    expect(() => analyticsEnabled({ WEBSITE_ANALYTICS: 'yes please' })).toThrow(
      /WEBSITE_ANALYTICS is "yes please": 1 \(on\) or 0 \(off\)/,
    );
  });
});

describe('the page: only the site’s own host, never against Do Not Track or Global Privacy Control', () => {
  it('sends from gcportrait.app only: not a local preview, a check in a browser or another host', () => {
    expect(isSiteHost('gcportrait.app')).toBe(true);
    expect(isSiteHost('GCPORTRAIT.APP')).toBe(true);
    for (const host of [
      'localhost',
      '127.0.0.1',
      'www.gcportrait.app',
      'fork.github.io',
      'gcportrait.app.example',
    ]) {
      expect(isSiteHost(host)).toBe(false);
    }
  });

  it('respects Do Not Track, in the current and the older spellings, and Global Privacy Control', () => {
    expect(trackingRefused({ doNotTrack: '1' })).toBe(true);
    expect(trackingRefused({ doNotTrack: 'yes' })).toBe(true);
    expect(trackingRefused({ msDoNotTrack: '1' })).toBe(true);
    expect(trackingRefused({ windowDoNotTrack: '1' })).toBe(true);
    expect(trackingRefused({ globalPrivacyControl: true })).toBe(true);
    expect(trackingRefused({ doNotTrack: '0', globalPrivacyControl: true })).toBe(true);
  });

  it('sends where neither is set', () => {
    expect(trackingRefused({})).toBe(false);
    expect(trackingRefused({ doNotTrack: null, globalPrivacyControl: undefined })).toBe(false);
    expect(
      trackingRefused({ doNotTrack: '0', msDoNotTrack: 'unspecified', globalPrivacyControl: false }),
    ).toBe(false);
  });
});

describe('what a page sends', () => {
  it('names the signals: the page view, and a followed link to the demo or the repository', () => {
    expect(SIGNALS).toEqual({
      pageView: 'pageView',
      demo: 'Outbound.demo',
      repository: 'Outbound.repository',
    });
  });

  it('sends the page’s path without its query and fragment', () => {
    expect(pagePath('https://gcportrait.app/docs/self-host/?project=my-project#oauth')).toBe(
      '/docs/self-host/',
    );
    expect(pagePath('https://gcportrait.app/#author')).toBe('/');
    expect(pagePath('https://gcportrait.app/docs/?utm_source=x')).toBe('/docs/');
    expect(pagePath('https://gcportrait.app/no such page/')).toBe('/no%20such%20page/');
    expect(pagePath('not an address')).toBe('/');
  });

  it('knows a followed link to the demo, written as a path or an address on the page’s own origin', () => {
    for (const href of ['/demo/', '/demo/diagram', '/demo', 'https://gcportrait.app/demo/?x=1']) {
      expect(outboundSignal(href, PAGE, REPOSITORY)).toBe('Outbound.demo');
    }
    expect(outboundSignal('/docs/', PAGE, REPOSITORY)).toBeUndefined();
    expect(outboundSignal('/demonstration/', PAGE, REPOSITORY)).toBeUndefined();
    expect(outboundSignal('https://demo.example.com/demo/', PAGE, REPOSITORY)).toBeUndefined();
  });

  it('knows a followed link to the repository: the header’s link to it and anything below it', () => {
    for (const href of [
      REPOSITORY,
      `${REPOSITORY}/`,
      `${REPOSITORY}/releases`,
      `${REPOSITORY}/blob/main/docs/self-host.md#costs`,
    ]) {
      expect(outboundSignal(href, PAGE, REPOSITORY)).toBe('Outbound.repository');
    }
    for (const href of [
      'https://github.com/florianchrometz/gcportrait-other',
      'https://github.com/florianchrometz',
      'https://florian-chrometz.de/legal/privacy-policy',
      'https://app.diagrams.net/?url=x',
    ]) {
      expect(outboundSignal(href, PAGE, REPOSITORY)).toBeUndefined();
    }
    // A page without the header's link to the repository knows no repository.
    expect(outboundSignal(REPOSITORY, PAGE, undefined)).toBeUndefined();
    expect(outboundSignal('javascript:void 0', PAGE, REPOSITORY)).toBeUndefined();
    expect(outboundSignal('/demo/', 'not a page', REPOSITORY)).toBeUndefined();
  });
});

describe('the session’s identifiers (sessionStorage only)', () => {
  it('makes random ones of 32 hexadecimal digits', () => {
    expect(randomId((bytes) => bytes.fill(0xab))).toBe('ab'.repeat(16));
    expect(randomId((bytes) => bytes)).toMatch(/^0{32}$/);
  });

  it('makes a user and a session identifier for the tab and keeps them under gcportrait.analytics', () => {
    const { items, store } = memoryStore();
    const first = sessionIdentity(store, counter());
    expect(first).toEqual({ user: '0'.repeat(32), session: `${'0'.repeat(31)}1` });
    expect([...items.keys()]).toEqual([KEY]);
    expect(ANALYTICS_SESSION_KEY).toBe(KEY);
    expect(JSON.parse(items.get(KEY) ?? '')).toEqual(first);
    // The next page of the tab: the same identifiers, none made.
    const next = sessionIdentity(store, () => {
      throw new Error('made a new identifier');
    });
    expect(next).toEqual(first);
  });

  it('replaces what it cannot read as its own', () => {
    for (const kept of ['not json', '{"user":"x","session":"y"}', '{"user":1}', 'null', '[]']) {
      const { items, store } = memoryStore();
      items.set(KEY, kept);
      expect(sessionIdentity(store, counter()).user).toBe('0'.repeat(32));
      expect(JSON.parse(items.get(KEY) ?? '')).toEqual({
        user: '0'.repeat(32),
        session: `${'0'.repeat(31)}1`,
      });
    }
  });

  it('makes this page’s own where sessionStorage is blocked or full, and never throws', () => {
    for (const blocked of ['store', 'write'] as const) {
      const { items, store } = memoryStore(blocked);
      expect(sessionIdentity(store, counter())).toEqual({
        user: '0'.repeat(32),
        session: `${'0'.repeat(31)}1`,
      });
      expect(items.size).toBe(0);
    }
    expect(sessionIdentity(() => undefined, counter()).user).toBe('0'.repeat(32));
  });
});
