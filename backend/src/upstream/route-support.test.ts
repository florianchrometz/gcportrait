// SPDX-License-Identifier: Apache-2.0
import EventEmitter from 'node:events';

import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

import type { UpstreamClient } from './request.js';
import { ClientGoneError, googleContextFor, isClientGoneError } from './route-support.js';

describe('ClientGoneError and isClientGoneError', () => {
  it('identifies ClientGoneError instances and named error objects', () => {
    const error = new ClientGoneError();
    expect(error.name).toBe('ClientGoneError');
    expect(error.message).toBe('The client went away.');
    expect(isClientGoneError(error)).toBe(true);

    const named = new Error('custom');
    named.name = 'ClientGoneError';
    expect(isClientGoneError(named)).toBe(true);

    expect(isClientGoneError(new Error('other'))).toBe(false);
    expect(isClientGoneError(null)).toBe(false);
    expect(isClientGoneError(undefined)).toBe(false);
    expect(isClientGoneError('string')).toBe(false);
  });

  it('identifies client gone from aborted signals', () => {
    const controller = new AbortController();
    controller.abort(new ClientGoneError());
    expect(isClientGoneError(new Error('generic'), controller.signal)).toBe(true);

    const otherController = new AbortController();
    otherController.abort(new Error('other'));
    expect(isClientGoneError(new Error('generic'), otherController.signal)).toBe(false);

    const activeController = new AbortController();
    expect(isClientGoneError(new Error('generic'), activeController.signal)).toBe(false);
  });
});

describe('googleContextFor', () => {
  const dummyClient = {} as UpstreamClient;
  const dummyRequest = { id: 'req-1', log: {} as FastifyBaseLogger } as FastifyRequest;

  it('aborts immediately when the reply socket is already closed or destroyed before finishing', () => {
    const raw = Object.assign(new EventEmitter(), {
      closed: true,
      destroyed: false,
      writableFinished: false,
    });
    const reply = { raw } as unknown as FastifyReply;
    const context = googleContextFor(dummyRequest, reply, dummyClient);
    expect(context.signal.aborted).toBe(true);
    expect(isClientGoneError(context.signal.reason)).toBe(true);
  });

  it('aborts on close event when connection was not finished writing', () => {
    const raw = Object.assign(new EventEmitter(), {
      closed: false,
      destroyed: false,
      writableFinished: false,
    });
    const reply = { raw } as unknown as FastifyReply;
    const context = googleContextFor(dummyRequest, reply, dummyClient);
    expect(context.signal.aborted).toBe(false);

    raw.emit('close');
    expect(context.signal.aborted).toBe(true);
    expect(isClientGoneError(context.signal.reason)).toBe(true);
  });

  it('does not abort on close event when writableFinished is true', () => {
    const raw = Object.assign(new EventEmitter(), {
      closed: false,
      destroyed: false,
      writableFinished: true,
    });
    const reply = { raw } as unknown as FastifyReply;
    const context = googleContextFor(dummyRequest, reply, dummyClient);
    expect(context.signal.aborted).toBe(false);

    raw.emit('close');
    expect(context.signal.aborted).toBe(false);
  });
});
