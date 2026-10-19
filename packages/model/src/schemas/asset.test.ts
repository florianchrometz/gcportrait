// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { sampleAsset } from '../testing/fixtures.js';
import { issuePaths, without } from '../testing/issues.js';
import { AncestorSchema, AssetSchema } from './asset.js';

describe('AssetSchema', () => {
  it('accepts a normalised CAI asset and keeps data untouched', () => {
    const asset = sampleAsset();
    expect(AssetSchema.parse(asset)).toEqual(asset);
  });

  it('accepts an asset without the optional parent and location', () => {
    expect(issuePaths(AssetSchema, without(sampleAsset(), 'parent', 'location'))).toEqual([]);
  });

  it('accepts any data value, including null', () => {
    expect(issuePaths(AssetSchema, { ...sampleAsset(), data: null })).toEqual([]);
  });

  it('strips unknown keys so newer exports still parse', () => {
    expect(AssetSchema.parse({ ...sampleAsset(), resource: {} })).not.toHaveProperty('resource');
  });

  it.each([
    ['name', { name: 'web-1' }],
    ['assetType', { assetType: 'Instance' }],
    ['parent', { parent: undefined }],
    ['ancestors.0', { ancestors: ['projects'] }],
    ['location', { location: '' }],
    ['updateTime', { updateTime: '2026-10-07' }],
  ])('rejects a bad %s', (path, patch) => {
    expect(issuePaths(AssetSchema, { ...sampleAsset(), ...patch })).toEqual([path]);
  });

  it('requires the data key', () => {
    expect(issuePaths(AssetSchema, without(sampleAsset(), 'data'))).toEqual(['data']);
  });
});

describe('AncestorSchema', () => {
  it.each(['projects/10000000001', 'folders/20000000001', 'organizations/30000000001', 'projects/demo-net'])(
    'accepts %s',
    (value) => {
      expect(AncestorSchema.safeParse(value).success).toBe(true);
    },
  );
  it.each(['10000000001', 'billingAccounts/1', 'projects/', 'projects/a/b'])('rejects %s', (value) => {
    expect(AncestorSchema.safeParse(value).success).toBe(false);
  });
});
