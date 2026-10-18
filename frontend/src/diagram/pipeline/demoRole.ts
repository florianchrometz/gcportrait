// SPDX-License-Identifier: MIT
/**
 * The demo role of the diagram worker (diagram.worker.ts): "Try the demo" in a worker of its own, started for
 * one job and ended with it (workers.ts, `createBrowserDemoJob`). Preparing demo XL (its 35-day history generated,
 * read and encoded for storage) takes seconds; in the data worker, which answers one request at a time, it would hold
 * back every Scene request behind it, and its history would stay in the data worker's memory afterwards.
 * The generator is loaded by no other thread than a worker (AGENTS.md, Architecture and code): the data worker for
 * drawing the demo organisations, this one for preparing them; both load the same chunk (demo.ts).
 *
 * It answers the data protocol's `demo` request (protocol.ts) with `job-progress` messages and `demo` or `error`;
 * any other request is a protocol error.
 */
import { isDemoSize } from '@gcportrait/model';

import { isObject } from '../../guards';
import type { DataResponse } from './protocol';

export function startRole(post: (message: DataResponse) => void): (message: unknown) => void {
  return (message) => {
    const id = isObject(message) && typeof message['id'] === 'number' ? message['id'] : -1;
    if (!isObject(message) || message['type'] !== 'demo') {
      post({
        type: 'error',
        id,
        error: { code: 'protocol', message: 'the demo worker prepares demo organisations only' },
      });
      return;
    }
    const size = message['size'];
    if (!isDemoSize(size)) {
      post({
        type: 'error',
        id,
        error: { code: 'protocol', message: `no demo organisation of size ${JSON.stringify(size)}` },
      });
      return;
    }
    import('./demo')
      .then(({ prepareDemo }) =>
        prepareDemo(size, (progress) => {
          post({ type: 'job-progress', id, progress });
        }),
      )
      .then(
        (prepared) => {
          post({ type: 'demo', id, prepared });
        },
        (error: unknown) => {
          post({
            type: 'error',
            id,
            error: { code: 'internal', message: error instanceof Error ? error.message : String(error) },
          });
        },
      );
  };
}
