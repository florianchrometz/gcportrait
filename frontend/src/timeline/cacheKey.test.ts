// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * The tick cache key (skill cai-ingestion §5): `(scope, readTime, contentType, assetTypes?)`, never reused across
 * scopes, read times, content types or type filters; the type patterns are a set; no separator makes two keys alike.
 */
import { describe, expect, it } from 'vitest';

import { assetTypesPart, TICK_CONTENT_TYPE, tickCacheKey } from './cacheKey';

const BASE = {
  scope: 'organizations/30000000001',
  readTime: '2026-10-01T00:00:00Z',
  contentType: TICK_CONTENT_TYPE,
};

describe('tickCacheKey', () => {
  it('is the same for the same read', () => {
    expect(tickCacheKey(BASE)).toBe(tickCacheKey({ ...BASE }));
    expect(tickCacheKey(BASE)).toBe('["organizations/30000000001","2026-10-01T00:00:00Z","RESOURCE","*"]');
  });

  it('differs per scope, read time, content type and type filter', () => {
    const keys = [
      tickCacheKey(BASE),
      tickCacheKey({ ...BASE, scope: 'folders/20000000001' }),
      tickCacheKey({ ...BASE, scope: 'projects/demo-web-1' }),
      tickCacheKey({ ...BASE, scope: 'organizations/30000000002' }),
      tickCacheKey({ ...BASE, readTime: '2026-10-02T00:00:00Z' }),
      tickCacheKey({ ...BASE, contentType: 'IAM_POLICY' }),
      tickCacheKey({ ...BASE, assetTypes: ['compute.googleapis.com/.*'] }),
      tickCacheKey({ ...BASE, assetTypes: ['compute.googleapis.com/.*', 'run.googleapis.com/.*'] }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('reads the type patterns as a set; none and an empty list both mean every type', () => {
    expect(tickCacheKey({ ...BASE, assetTypes: ['b', 'a', 'a'] })).toBe(
      tickCacheKey({ ...BASE, assetTypes: ['a', 'b'] }),
    );
    expect(tickCacheKey({ ...BASE, assetTypes: [] })).toBe(tickCacheKey(BASE));
    expect(tickCacheKey({ ...BASE, assetTypes: undefined })).toBe(tickCacheKey(BASE));
    expect(assetTypesPart(undefined)).toBe('*');
    // A pattern that is literally `*` is not "every type".
    expect(assetTypesPart(['*'])).not.toBe(assetTypesPart(undefined));
  });

  it('cannot be made alike by separators inside the parts', () => {
    expect(tickCacheKey({ ...BASE, scope: 'a","b' })).not.toBe(
      tickCacheKey({ ...BASE, scope: 'a', readTime: `b","${BASE.readTime}` }),
    );
    expect(tickCacheKey({ ...BASE, assetTypes: ['a,b'] })).not.toBe(
      tickCacheKey({ ...BASE, assetTypes: ['a', 'b'] }),
    );
  });
});
