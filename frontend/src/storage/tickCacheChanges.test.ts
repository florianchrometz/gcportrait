// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * The tick cache's change signal between tabs (tickCacheChanges.ts): a message is the entry's key fields and the kind
 * of change, nothing else, and anything else that arrives is ignored; the channel is open only while something
 * listens, a change posted meanwhile going out on a channel of its own that closes at once; a page never hears what
 * it posts itself; and without `BroadcastChannel`, or with one that refuses, nothing is posted, heard or thrown. The
 * last cases run on Node's own `BroadcastChannel`, under a name of their own.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TICK_CONTENT_TYPE, tickCacheKey } from '../timeline/cacheKey';
import {
  createTickCacheChanges,
  openBroadcastChannel,
  readTickCacheChange,
  TICK_CACHE_CHANNEL,
  tickCacheChange,
  tickCacheChanges,
  type TabChannelOpener,
  type TickCacheChange,
} from './tickCacheChanges';

const SCOPE = 'organizations/30000000001';
const READ_TIME = '2026-10-02T00:00:00Z';
const KEY = tickCacheKey({ scope: SCOPE, readTime: READ_TIME, contentType: TICK_CONTENT_TYPE });
const PUT: TickCacheChange = {
  change: 'put',
  key: KEY,
  scope: SCOPE,
  readTime: READ_TIME,
  contentType: TICK_CONTENT_TYPE,
};

interface FakeChannel {
  readonly name: string;
  readonly posted: unknown[];
  readonly receive: (data: unknown) => void;
  closed: boolean;
}

/** An opener that keeps every channel it opens. */
function fakeOpener(): { readonly open: TabChannelOpener; readonly channels: FakeChannel[] } {
  const channels: FakeChannel[] = [];
  const open: TabChannelOpener = (name, receive) => {
    const channel: FakeChannel = { name, posted: [], receive, closed: false };
    channels.push(channel);
    return {
      post: (message) => {
        channel.posted.push(message);
      },
      close: () => {
        channel.closed = true;
      },
    };
  };
  return { open, channels };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a change of the tick cache', () => {
  it('names the entry by its key fields alone', () => {
    const entry = { ...PUT, day: '2026-10-02', assetCount: 40, bytes: 1_000, blob: new Blob(['{}']) };
    expect(tickCacheChange('delete', entry)).toStrictEqual({ ...PUT, change: 'delete' });
    expect(TICK_CACHE_CHANNEL).toBe('gcportrait.tickCache');
  });

  it('is read from what another tab posts only when it is one, its key fields only', () => {
    expect(readTickCacheChange({ ...PUT, assetCount: 40, snapshot: '{}' })).toStrictEqual(PUT);
    expect(readTickCacheChange({ ...PUT, change: 'delete' })).toStrictEqual({ ...PUT, change: 'delete' });
    for (const data of [
      null,
      'put',
      42,
      [],
      { ...PUT, change: 'clear' },
      { ...PUT, key: 1 },
      { change: 'put', key: KEY, scope: SCOPE, readTime: READ_TIME },
    ])
      expect(readTickCacheChange(data)).toBeNull();
  });
});

describe('the change signal', () => {
  it('opens its channel while something listens, hands it what other tabs post and posts through it', () => {
    const { open, channels } = fakeOpener();
    const changes = createTickCacheChanges({ open });
    const first: TickCacheChange[] = [];
    const second: TickCacheChange[] = [];
    const stopFirst = changes.subscribe((change) => first.push(change));
    const stopSecond = changes.subscribe((change) => second.push(change));
    expect(channels.map((channel) => channel.name)).toEqual([TICK_CACHE_CHANNEL]);
    const [channel] = channels;
    if (channel === undefined) throw new Error('no channel');
    channel.receive({ ...PUT, assetCount: 40 });
    channel.receive({ something: 'else' });
    expect(first).toStrictEqual([PUT]);
    expect(second).toStrictEqual([PUT]);
    // Posted through the open channel, which is not handed back what it posts itself.
    changes.post({ ...PUT, change: 'delete' });
    expect(channels).toHaveLength(1);
    expect(channel.posted).toStrictEqual([{ ...PUT, change: 'delete' }]);
    stopFirst();
    stopFirst();
    expect(channel.closed).toBe(false);
    stopSecond();
    expect(channel.closed).toBe(true);
    // Listening again opens a new one.
    changes.subscribe(() => undefined)();
    expect(channels).toHaveLength(2);
  });

  it('posts on a channel of its own, closed at once, while nothing listens, and only the key fields', () => {
    const { open, channels } = fakeOpener();
    const changes = createTickCacheChanges({ open, name: 'other.tickCache' });
    changes.post({ ...PUT, assetCount: 40 } as TickCacheChange);
    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatchObject({ name: 'other.tickCache', closed: true });
    expect(channels[0]?.posted).toStrictEqual([PUT]);
  });

  it('posts, hears and throws nothing where the browser gives it no channel, or the channel fails', () => {
    const none = createTickCacheChanges({ open: () => null });
    expect(() => {
      none.post(PUT);
      none.subscribe(() => undefined)();
    }).not.toThrow();
    const refusing = createTickCacheChanges({
      open: () => {
        throw new Error('SecurityError');
      },
    });
    expect(() => {
      refusing.post(PUT);
      refusing.subscribe(() => undefined)();
    }).not.toThrow();
    let closed = false;
    const failing = createTickCacheChanges({
      open: () => ({
        post: () => {
          throw new Error('DataCloneError');
        },
        close: () => {
          closed = true;
        },
      }),
    });
    expect(() => {
      failing.post(PUT);
    }).not.toThrow();
    expect(closed).toBe(true);
    vi.stubGlobal('BroadcastChannel', undefined);
    expect(openBroadcastChannel(TICK_CACHE_CHANNEL, () => undefined)).toBeNull();
  });

  it('is one per page', () => {
    expect(tickCacheChanges()).toBe(tickCacheChanges());
  });
});

describe('between two pages, on a real BroadcastChannel', () => {
  const name = 'gcportrait.tickCache.tickCacheChanges-test';

  it('hands one page what the other posts, never what it posts itself, and lets the pages close it', async () => {
    const one = createTickCacheChanges({ name });
    const other = createTickCacheChanges({ name });
    const heardByOne: TickCacheChange[] = [];
    const heardByOther: TickCacheChange[] = [];
    let arrived: () => void = () => undefined;
    const arrival = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const stopOne = one.subscribe((change) => {
      heardByOne.push(change);
      arrived();
    });
    const stopOther = other.subscribe((change) => heardByOther.push(change));
    other.post(PUT);
    await arrival;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(heardByOne).toStrictEqual([PUT]);
    expect(heardByOther).toStrictEqual([]);
    stopOne();
    stopOther();
  });

  it('delivers what a page posts while it does not listen itself', async () => {
    const listening = createTickCacheChanges({ name });
    const posting = createTickCacheChanges({ name });
    const heard = new Promise<TickCacheChange>((resolve) => {
      const stop = listening.subscribe((change) => {
        stop();
        resolve(change);
      });
    });
    posting.post({ ...PUT, change: 'delete' });
    expect(await heard).toStrictEqual({ ...PUT, change: 'delete' });
  });
});
