// SPDX-License-Identifier: MIT
/**
 * Large answers of the diagram workers cross to the page as transferred bytes. A worker's answer is
 * structured-cloned on `postMessage` and deserialised on the UI thread when the page reads it; for a large Layout
 * that is a long task (demo XL at `projects`, 11.4 MB of JSON: about 42 ms). The same answer as JSON bytes,
 * transferred (no copy) and parsed on the UI thread, takes about 28 ms there. So the
 * data and layout roles of the worker script (diagram.worker.ts) post a Scene answer or a
 * Layout of more than `TRANSFER_ABOVE_RECTS` rects as `{ type: 'encoded', bytes }`, the message's JSON as UTF-8 with
 * the buffer transferred, and the page (workers.ts) decodes every message before its client reads it. Smaller
 * answers, the defaults at 1280 × 800 among them, are structured-cloned: the JSON step would cost more than it
 * saves.
 * The answers are plain data, so the round trip gives the page what the clone gave it (transfer.test.ts), but for a
 * field whose value is `undefined` (an icon's `category`), which JSON leaves out and which reads the same.
 */

import { isObject } from '../../guards';

/** Above how many rects a Scene answer or a Layout travels as transferred JSON bytes. */
export const TRANSFER_ABOVE_RECTS = 1000;

/** A worker answer as transferred JSON bytes. */
export interface EncodedMessage {
  readonly type: 'encoded';
  readonly bytes: ArrayBuffer;
}

/** How many rects an answer carries: a layout `result`'s rects, a `scene` answer's Scene rect count; else 0. */
export function rectsOf(message: unknown): number {
  if (!isObject(message)) return 0;
  if (message['type'] === 'result') {
    const layout = message['layout'];
    const rects = isObject(layout) ? layout['rects'] : undefined;
    return isObject(rects) ? Object.keys(rects).length : 0;
  }
  if (message['type'] === 'scene') {
    const answer = message['answer'];
    const scene = isObject(answer) ? answer['scene'] : undefined;
    const metadata = isObject(scene) ? scene['metadata'] : undefined;
    const count = isObject(metadata) ? metadata['rectCount'] : undefined;
    return typeof count === 'number' ? count : 0;
  }
  return 0;
}

/** The message as transferred JSON bytes when it carries more than `above` rects; null to post it as it is. */
export function encodeLarge(message: unknown, above: number = TRANSFER_ABOVE_RECTS): EncodedMessage | null {
  if (rectsOf(message) <= above) return null;
  const bytes = new TextEncoder().encode(JSON.stringify(message));
  // The encoder's buffer holds exactly the bytes; a view on a larger one would transfer more than it says.
  const buffer = bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
  return { type: 'encoded', bytes: buffer };
}

/** A message from a diagram worker as its client reads it: an encoded one decoded, any other as it is. */
export function decodeMessage(data: unknown): unknown {
  if (!isObject(data) || data['type'] !== 'encoded') return data;
  const bytes = data['bytes'];
  if (!(bytes instanceof ArrayBuffer)) return data;
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
