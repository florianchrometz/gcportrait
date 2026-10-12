// SPDX-License-Identifier: MIT
import { SnapshotSchema, UlidSchema } from '@gcportrait/model';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ingest } from './ingest.js';
import type { IngestSettings } from './session.js';
import type { IngestInput } from './sources.js';
import {
  byteStream,
  clone,
  FIXED_TIME,
  iterate,
  ndjson,
  numberedAsset,
  seededEntropy,
  testOptions,
  utf8,
} from './testing/helpers.js';
import {
  createIngestWorkerHandler,
  postIngestJob,
  type IngestWorkerRequest,
  type IngestWorkerResponse,
} from './worker.js';

const settings: IngestSettings = {
  scope: { kind: 'project', id: 'demo-net-1' },
  source: { kind: 'api', detail: 'user mode' },
};

function harness() {
  const replies: IngestWorkerResponse[] = [];
  const handle = createIngestWorkerHandler((message) => replies.push(message), {
    clock: () => FIXED_TIME,
    entropy: seededEntropy(),
  });
  const send = (...messages: unknown[]) => {
    for (const message of messages) handle(message);
  };
  return { replies, send };
}

const done = (replies: readonly IngestWorkerResponse[]) => replies.filter((reply) => reply.type === 'done');
const errors = (replies: readonly IngestWorkerResponse[]) =>
  replies.filter((reply) => reply.type === 'error');

describe('createIngestWorkerHandler', () => {
  it('runs a job from start to done', () => {
    const { replies, send } = harness();
    const bytes = utf8(ndjson([numberedAsset(1), numberedAsset(2)]));
    send(
      { type: 'start', job: 'j1', settings },
      { type: 'chunk', job: 'j1', data: bytes.slice(0, 33) },
      { type: 'chunk', job: 'j1', data: bytes.slice(33) },
      { type: 'end', job: 'j1' },
    );
    expect(replies).toHaveLength(1);
    const [reply] = done(replies);
    expect(reply?.job).toBe('j1');
    const snapshot = SnapshotSchema.parse(reply?.result.snapshot);
    expect(snapshot.stats.count).toBe(2);
    expect(snapshot.scope).toEqual(settings.scope);
    // The result is plain data and crosses a structured clone unchanged.
    expect(clone(reply?.result)).toEqual(reply?.result);
  });

  it('forwards progress events, tagged with the job', () => {
    const { replies, send } = harness();
    send(
      { type: 'start', job: 'j', settings: { ...settings, progressEveryBytes: 10 } },
      { type: 'chunk', job: 'j', data: ndjson([{ t: 'progress', pages: 1, assets: 500 }]) },
      { type: 'end', job: 'j' },
    );
    expect(replies.map((reply) => reply.type)).toEqual(['progress', 'progress', 'done']);
    expect(replies[0]).toEqual({
      type: 'progress',
      job: 'j',
      event: { type: 'upstream-progress', pages: 1, assets: 500 },
    });
    expect(replies[1]).toMatchObject({ type: 'progress', job: 'j', event: { type: 'read', lines: 1 } });
  });

  it('separates parts by index, forgiving a missing final newline and skipped empty parts', () => {
    const { replies, send } = harness();
    send(
      { type: 'start', job: 'j', settings },
      { type: 'chunk', job: 'j', part: 0, data: JSON.stringify(numberedAsset(1)) },
      { type: 'chunk', job: 'j', part: 2, data: JSON.stringify(numberedAsset(2)) },
      { type: 'chunk', job: 'j', data: '\n' },
      { type: 'end', job: 'j' },
    );
    const [reply] = done(replies);
    expect(reply?.result.snapshot.stats.count).toBe(2);
    expect(reply?.result.report.parts).toBe(3);
  });

  it('counts trailing empty parts that the end message announces', () => {
    const { replies, send } = harness();
    send(
      { type: 'start', job: 'j', settings },
      { type: 'chunk', job: 'j', part: 1, data: ndjson([numberedAsset(1)]) },
      { type: 'end', job: 'j', parts: 4 },
    );
    expect(done(replies)[0]?.result.report.parts).toBe(4);
    send({ type: 'start', job: 'k', settings }, { type: 'end', job: 'k', parts: 2 });
    expect(done(replies)[1]?.result.report.parts).toBe(2);
  });

  it('drops a cancelled job and answers with a cancelled error', () => {
    const { replies, send } = harness();
    send(
      { type: 'start', job: 'j', settings },
      { type: 'chunk', job: 'j', data: ndjson([numberedAsset(1)]) },
      { type: 'cancel', job: 'j' },
      { type: 'chunk', job: 'j', data: ndjson([numberedAsset(2)]) },
      { type: 'end', job: 'j' },
      { type: 'cancel', job: 'j' },
    );
    expect(replies).toEqual([
      { type: 'error', job: 'j', error: { code: 'cancelled', message: 'The ingest job was cancelled.' } },
    ]);
  });

  it('runs several jobs at once', () => {
    const { replies, send } = harness();
    send(
      { type: 'start', job: 'a', settings },
      { type: 'start', job: 'b', settings },
      { type: 'chunk', job: 'a', data: ndjson([numberedAsset(1)]) },
      { type: 'chunk', job: 'b', data: ndjson([numberedAsset(2), numberedAsset(3)]) },
      { type: 'end', job: 'b' },
      { type: 'end', job: 'a' },
    );
    expect(done(replies).map((reply) => [reply.job, reply.result.snapshot.stats.count])).toEqual([
      ['b', 2],
      ['a', 1],
    ]);
  });

  it('posts an upstream error once and drops the rest of the job', () => {
    const { replies, send } = harness();
    send(
      { type: 'start', job: 'j', settings },
      {
        type: 'chunk',
        job: 'j',
        data: ndjson([
          { t: 'error', status: 403, message: 'Permission denied on organizations/30000000001' },
        ]),
      },
      { type: 'chunk', job: 'j', data: ndjson([numberedAsset(1)]) },
      { type: 'end', job: 'j' },
    );
    expect(replies).toEqual([
      {
        type: 'error',
        job: 'j',
        error: {
          code: 'upstream',
          message: 'Permission denied on organizations/30000000001',
          upstream: { status: 403 },
        },
      },
    ]);
  });

  it('posts a strict-mode problem with its location', () => {
    const { replies, send } = harness();
    send(
      { type: 'start', job: 'j', settings: { ...settings, strict: true } },
      { type: 'chunk', job: 'j', data: 'nope\n' },
    );
    expect(errors(replies)[0]?.error).toMatchObject({
      code: 'malformed',
      problem: { code: 'invalid-json', part: 0, line: 1 },
    });
  });

  it('posts invalid settings as an error for that job', () => {
    const { replies, send } = harness();
    send({ type: 'start', job: 'j', settings: { ...settings, scope: { kind: 'planet', id: 'x' } } });
    expect(errors(replies)).toEqual([
      { type: 'error', job: 'j', error: expect.objectContaining({ code: 'invalid-options' }) as unknown },
    ]);
  });

  it.each<[string, unknown[], string, RegExp]>([
    ['a non-object', [42], '', /must be an object/],
    ['a missing job id', [{ type: 'end' }], '', /non-empty "job"/],
    ['an unknown type', [{ type: 'pause', job: 'j' }], 'j', /"type" must be/],
    ['a start without settings', [{ type: 'start', job: 'j' }], 'j', /needs "settings"/],
    [
      'a chunk without data',
      [
        { type: 'start', job: 'j', settings },
        { type: 'chunk', job: 'j', data: 3 },
      ],
      'j',
      /needs "data"/,
    ],
    [
      'a negative part',
      [
        { type: 'start', job: 'j', settings },
        { type: 'chunk', job: 'j', part: -1, data: '' },
      ],
      'j',
      /"part" must be/,
    ],
    [
      'a part going backwards',
      [
        { type: 'start', job: 'j', settings },
        { type: 'chunk', job: 'j', part: 1, data: '' },
        { type: 'chunk', job: 'j', part: 0, data: '' },
      ],
      'j',
      /Part 0 arrived after part 1/,
    ],
    ['a chunk for an unknown job', [{ type: 'chunk', job: 'x', data: '' }], 'x', /was not started/],
    ['an end for an unknown job', [{ type: 'end', job: 'x' }], 'x', /was not started/],
    ['a cancel for an unknown job', [{ type: 'cancel', job: 'x' }], 'x', /was not started/],
    [
      'an end with a malformed parts count',
      [
        { type: 'start', job: 'j', settings },
        { type: 'end', job: 'j', parts: 1.5 },
      ],
      'j',
      /"parts" must be/,
    ],
    [
      'an end announcing fewer parts than arrived',
      [
        { type: 'start', job: 'j', settings },
        { type: 'chunk', job: 'j', part: 2, data: '' },
        { type: 'end', job: 'j', parts: 2 },
      ],
      'j',
      /says 2 parts, but part 2 arrived/,
    ],
    [
      'a second start',
      [
        { type: 'start', job: 'j', settings },
        { type: 'start', job: 'j', settings },
      ],
      'j',
      /already started/,
    ],
  ])('posts a protocol error for %s', (_name, messages, job, message) => {
    const { replies, send } = harness();
    send(...messages);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ type: 'error', job, error: { code: 'protocol' } });
    const [reply] = errors(replies);
    expect(reply?.error.message).toMatch(message);
  });

  it('ignores late messages for a job that already finished', () => {
    const { replies, send } = harness();
    send(
      { type: 'start', job: 'j', settings },
      { type: 'end', job: 'j' },
      { type: 'chunk', job: 'j', data: 'x' },
      { type: 'end', job: 'j' },
    );
    expect(replies.map((reply) => reply.type)).toEqual(['done']);
    send({ type: 'start', job: 'j', settings });
    expect(errors(replies)[0]?.error.message).toMatch(/already started/);
  });

  it('reports an unexpected exception as internal', () => {
    const replies: IngestWorkerResponse[] = [];
    const handle = createIngestWorkerHandler((message) => replies.push(message), {
      clock: () => FIXED_TIME,
      entropy: () => {
        throw new RangeError('entropy exhausted');
      },
    });
    handle({ type: 'start', job: 'j', settings });
    handle({ type: 'end', job: 'j' });
    expect(replies).toEqual([
      { type: 'error', job: 'j', error: { code: 'internal', message: 'entropy exhausted' } },
    ]);
    const strings: IngestWorkerResponse[] = [];
    const throwing = createIngestWorkerHandler((message) => strings.push(message), {
      clock: () => {
        throw 'clock broken' as unknown as Error;
      },
      entropy: () => 0,
    });
    throwing({ type: 'start', job: 'k', settings });
    throwing({ type: 'end', job: 'k' });
    expect(strings).toEqual([
      { type: 'error', job: 'k', error: { code: 'internal', message: 'clock broken' } },
    ]);
  });
});

describe('default clock and entropy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('use Date.now and crypto.getRandomValues', () => {
    vi.useFakeTimers({ now: FIXED_TIME });
    const replies: IngestWorkerResponse[] = [];
    const handle = createIngestWorkerHandler((message) => replies.push(message));
    const ids = ['a', 'b', 'c', 'd', 'e'].map((job) => {
      handle({ type: 'start', job, settings });
      handle({ type: 'end', job });
      const reply = replies.at(-1);
      return reply?.type === 'done' ? reply.result.snapshot.id : '';
    });
    for (const id of ids) {
      expect(UlidSchema.safeParse(id).success).toBe(true);
      expect(id.slice(0, 10)).toBe('01M4DP4XG0');
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('refuses to start without crypto unless an entropy source is passed', () => {
    vi.stubGlobal('crypto', undefined);
    expect(() => createIngestWorkerHandler(() => undefined)).toThrow(
      /crypto.getRandomValues is not available/,
    );
    expect(() => createIngestWorkerHandler(() => undefined, { entropy: () => 0 })).not.toThrow();
  });
});

describe('postIngestJob', () => {
  type Posted = [message: IngestWorkerRequest, transfer: ArrayBuffer[]];

  /** A byte stream with no chunks at all, as an empty Blob or an empty response body gives. */
  const emptyStream = () => byteStream([]);
  const emptyBlob = () => ({ size: 0, stream: emptyStream });

  it.each<[string, () => IngestInput]>([
    ['no sources', () => []],
    ['one empty blob', emptyBlob],
    ['a trailing empty blob', () => [ndjson([numberedAsset(1)]), emptyBlob()]],
    ['a leading empty stream', () => [emptyStream(), ndjson([numberedAsset(1)])]],
    [
      'empty parts everywhere',
      () => [emptyBlob(), '', emptyStream(), JSON.stringify(numberedAsset(1)), emptyBlob()],
    ],
    ['several files', () => [ndjson([numberedAsset(1)]), byteStream([utf8(ndjson([numberedAsset(2)]))])]],
  ])('gives the same result as ingest() for %s', async (_name, input) => {
    const { replies, send } = harness();
    await postIngestJob(
      (message) => {
        send(clone(message));
      },
      'j',
      input(),
      settings,
    );
    const direct = await ingest(input(), testOptions({ ...settings }));
    expect(done(replies)[0]?.result).toEqual(direct);
  });

  it('cancels the job and rejects when a source fails to read', async () => {
    const posted: IngestWorkerRequest[] = [];
    const failing = {
      getReader: () => ({
        read: () => Promise.reject(new Error('disk gone')),
        cancel: () => Promise.resolve(),
        releaseLock: () => undefined,
      }),
    };
    await expect(
      postIngestJob((message) => posted.push(message), 'j', ['a\n', failing], settings),
    ).rejects.toThrow('disk gone');
    expect(posted.map((message) => message.type)).toEqual(['start', 'chunk', 'cancel']);
    const { replies, send } = harness();
    send(...posted);
    expect(replies).toEqual([
      { type: 'error', job: 'j', error: { code: 'cancelled', message: 'The ingest job was cancelled.' } },
    ]);
  });

  it('cancels the job and rejects when the input is not a list of sources', async () => {
    const posted: IngestWorkerRequest[] = [];
    await expect(
      postIngestJob((message) => posted.push(message), 'j', 42 as unknown as IngestInput, settings),
    ).rejects.toMatchObject({ code: 'invalid-source' });
    expect(posted.map((message) => message.type)).toEqual(['start', 'cancel']);
  });

  it('posts start, one chunk per chunk with its part, and end', async () => {
    const posted: Posted[] = [];
    await postIngestJob(
      (message, transfer) => posted.push([message, transfer]),
      'j',
      ['a\n', iterate(['b', '\n'])],
      settings,
    );
    expect(posted.map(([message]) => message)).toEqual([
      { type: 'start', job: 'j', settings },
      { type: 'chunk', job: 'j', part: 0, data: 'a\n' },
      { type: 'chunk', job: 'j', part: 1, data: 'b' },
      { type: 'chunk', job: 'j', part: 1, data: '\n' },
      { type: 'end', job: 'j', parts: 2 },
    ]);
    expect(posted.every(([, transfer]) => transfer.length === 0)).toBe(true);
  });

  it('transfers stream and blob chunks that own their buffer, and copies everything else', async () => {
    const whole = utf8('a\n');
    const view = utf8('xxb\n').subarray(2);
    const callerOwned = utf8('c\n');
    const posted: Posted[] = [];
    await postIngestJob(
      (message, transfer) => posted.push([message, transfer]),
      'j',
      [byteStream([whole, view]), { size: 2, stream: () => byteStream([utf8('d\n')]) }, callerOwned],
      settings,
    );
    const transfers = posted
      .filter(([message]) => message.type === 'chunk')
      .map(([, transfer]) => transfer.length);
    expect(transfers).toEqual([1, 0, 1, 0]);
  });

  it('never transfers text chunks, even from a stream', async () => {
    const posted: Posted[] = [];
    const textStream = {
      getReader: () => {
        let sent = false;
        return {
          read: () => {
            if (sent) return Promise.resolve({ done: true });
            sent = true;
            return Promise.resolve({ done: false, value: 'a\n' as unknown as Uint8Array });
          },
          cancel: () => Promise.resolve(),
          releaseLock: () => undefined,
        };
      },
    };
    await postIngestJob((message, transfer) => posted.push([message, transfer]), 'j', textStream, settings);
    expect(posted.find(([message]) => message.type === 'chunk')).toEqual([
      { type: 'chunk', job: 'j', part: 0, data: 'a\n' },
      [],
    ]);
  });
});
