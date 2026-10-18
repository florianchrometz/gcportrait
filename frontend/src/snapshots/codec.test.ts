// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodeJson, decodeText, encodeJson, GZIP_TYPE, JSON_TYPE, plainBlob } from './codec';

afterEach(() => {
  vi.unstubAllGlobals();
});

const VALUE = {
  name: 'example.com',
  assets: Array.from({ length: 200 }, (_, index) => ({ index, text: 'x'.repeat(40) })),
};

describe('the stored-document codec', () => {
  it('compresses JSON with gzip and reads it back', async () => {
    const blob = await encodeJson(VALUE);
    expect(blob.type).toBe(GZIP_TYPE);
    expect(blob.size).toBeLessThan(JSON.stringify(VALUE).length / 4);
    expect(await decodeJson(blob)).toEqual(VALUE);
    const plain = await plainBlob(blob);
    expect(plain.type).toBe(JSON_TYPE);
    expect(await plain.text()).toBe(JSON.stringify(VALUE));
  });

  it('stores plain JSON where the platform cannot compress, and reads both', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    const blob = await encodeJson(VALUE);
    expect(blob.type).toBe(JSON_TYPE);
    expect(await decodeText(blob)).toBe(JSON.stringify(VALUE));
    expect(await plainBlob(blob)).toBe(blob);
  });
});
