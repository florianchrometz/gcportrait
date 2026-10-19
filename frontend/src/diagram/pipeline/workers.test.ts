// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LayoutClient } from '@gcportrait/layout';
import type { DataClient } from './dataClient';
import { sharedWorkers, startRole, type DiagramWorkers } from './workers';

interface MockWorkerInstance {
  readonly name: string;
  readonly postMessage: ReturnType<typeof vi.fn>;
  readonly terminate: ReturnType<typeof vi.fn>;
  readonly listeners: Map<string, Set<(event: unknown) => void>>;
}

const mockInstances: MockWorkerInstance[] = vi.hoisted(() => []);

vi.mock('./diagram.worker?worker', () => {
  return {
    default: class {
      readonly name: string;
      readonly postMessage = vi.fn();
      readonly terminate = vi.fn();
      readonly listeners = new Map<string, Set<(event: unknown) => void>>();

      constructor(options?: { readonly name?: string }) {
        this.name = options?.name ?? '';
        mockInstances.push(this);
      }

      addEventListener(type: string, listener: (event: unknown) => void): void {
        let set = this.listeners.get(type);
        if (set === undefined) {
          set = new Set();
          this.listeners.set(type, set);
        }
        set.add(listener);
      }

      removeEventListener(type: string, listener: (event: unknown) => void): void {
        this.listeners.get(type)?.delete(listener);
      }
    },
  };
});

function fakeWorkers(): {
  readonly workers: DiagramWorkers;
  readonly dispose: ReturnType<typeof vi.fn>;
} {
  const dispose = vi.fn();
  return {
    dispose,
    workers: {
      data: {} as DataClient,
      layout: {} as LayoutClient,
      dispose,
    },
  };
}

describe('sharedWorkers', () => {
  it('creates and caches the worker pair', () => {
    const created = fakeWorkers();
    const factory = vi.fn(() => created.workers);
    const getWorkers = sharedWorkers(factory);

    const first = getWorkers();
    const second = getWorkers();
    expect(first).toBe(second);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('cancels disposal and keeps the same pair when re-acquired in the same tick', async () => {
    const created = fakeWorkers();
    const factory = vi.fn(() => created.workers);
    const getWorkers = sharedWorkers(factory);

    const first = getWorkers();
    first.dispose();

    // Re-acquire synchronously before microtask fires (React StrictMode remount)
    const second = getWorkers();
    expect(second).toBe(first);
    expect(factory).toHaveBeenCalledTimes(1);

    await Promise.resolve();
    expect(created.dispose).not.toHaveBeenCalled();
  });

  it('disposes the pair after a microtask when not re-acquired', async () => {
    const created = fakeWorkers();
    const factory = vi.fn(() => created.workers);
    const getWorkers = sharedWorkers(factory);

    const first = getWorkers();
    first.dispose();
    expect(created.dispose).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(created.dispose).toHaveBeenCalledTimes(1);

    const createdNext = fakeWorkers();
    factory.mockReturnValue(createdNext.workers);
    const next = getWorkers();
    expect(next).not.toBe(first);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('ignores duplicate dispose calls', async () => {
    const created = fakeWorkers();
    const factory = vi.fn(() => created.workers);
    const getWorkers = sharedWorkers(factory);

    const first = getWorkers();
    first.dispose();
    first.dispose();

    await Promise.resolve();
    expect(created.dispose).toHaveBeenCalledTimes(1);

    first.dispose();
    expect(created.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('startRole', () => {
  beforeEach(() => {
    mockInstances.length = 0;
  });

  it('wires client events, postMessage, error handling, and termination', () => {
    const receive = vi.fn();
    const fail = vi.fn();
    const disposeClient = vi.fn();
    let sendRequest!: (req: unknown, transfer?: Transferable[]) => void;

    const role = startRole(
      'demo',
      (post) => {
        sendRequest = post;
        return { receive, fail, dispose: disposeClient };
      },
      'demo',
    );

    expect(mockInstances).toHaveLength(1);
    const instance = mockInstances[0];
    if (instance === undefined) throw new Error('missing worker instance');
    expect(instance.name).toBe('demo');

    sendRequest({ type: 'ping' });
    expect(instance.postMessage).toHaveBeenCalledWith({ type: 'ping' });

    const buffer = new ArrayBuffer(16);
    sendRequest({ type: 'upload' }, [buffer]);
    expect(instance.postMessage).toHaveBeenCalledWith({ type: 'upload' }, [buffer]);

    const onMessage = [...(instance.listeners.get('message') ?? [])][0];
    if (onMessage === undefined) throw new Error('missing message listener');
    onMessage({ data: { ok: true } });
    expect(receive).toHaveBeenCalledWith({ ok: true });

    const onError = [...(instance.listeners.get('error') ?? [])][0];
    if (onError === undefined) throw new Error('missing error listener');
    onError({ message: 'Boom' });
    expect(fail).toHaveBeenCalledWith('Boom');

    onError({ message: '' });
    expect(fail).toHaveBeenCalledWith('The demo worker failed.');

    role.dispose();
    expect(disposeClient).toHaveBeenCalledTimes(1);
    expect(instance.terminate).toHaveBeenCalledTimes(1);
  });

  it('applies decode function when provided', () => {
    const receive = vi.fn();
    const decode = vi.fn((data: unknown) => ({ decoded: data }));

    startRole('data', () => ({ receive, fail: vi.fn(), dispose: vi.fn() }), 'data', decode);

    const instance = mockInstances[0];
    if (instance === undefined) throw new Error('missing worker instance');
    const onMessage = [...(instance.listeners.get('message') ?? [])][0];
    if (onMessage === undefined) throw new Error('missing message listener');
    onMessage({ data: 'raw-message' });

    expect(decode).toHaveBeenCalledWith('raw-message');
    expect(receive).toHaveBeenCalledWith({ decoded: 'raw-message' });
  });
});
