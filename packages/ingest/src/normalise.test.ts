// SPDX-License-Identifier: Apache-2.0
import { AssetSchema } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import { isProjectNumber, normaliseAsset, projectNumberOf } from './normalise.js';
import { exportShape, FOLDER, ORG, PROJECT_NUMBER, rawAsset } from './testing/helpers.js';

/** The fields of a normalised asset, in the model's (AssetSchema's) order. */
const ASSET_KEYS = ['name', 'assetType', 'parent', 'ancestors', 'location', 'updateTime', 'data'];

describe('normaliseAsset', () => {
  it('flattens resource.parent, resource.location and resource.data and drops the rest', () => {
    const raw = rawAsset();
    const result = normaliseAsset(raw);
    expect(result).toEqual({
      ok: true,
      asset: {
        name: '//compute.googleapis.com/projects/demo-net-1/global/networks/core',
        assetType: 'compute.googleapis.com/Network',
        parent: '//cloudresourcemanager.googleapis.com/projects/10000000001',
        ancestors: [`projects/${PROJECT_NUMBER}`, FOLDER, ORG],
        location: 'global',
        updateTime: '2026-10-07T18:22:41.123456Z',
        data: {
          name: 'core',
          autoCreateSubnetworks: false,
          selfLink: 'https://www.googleapis.com/compute/v1/projects/demo-net-1/global/networks/core',
        },
      },
    });
    if (!result.ok) throw new Error('unreachable');
    expect(AssetSchema.parse(result.asset)).toEqual(result.asset);
  });

  it('passes data on by reference, untouched', () => {
    const data = { nested: { list: [1, 'two', null], deep: { x: true } }, ignoredByUs: '…' };
    const result = normaliseAsset(rawAsset({ resource: { data } }));
    expect(result.ok && result.asset.data).toBe(data);
  });

  it('keeps the name verbatim, whatever it contains', () => {
    const name = '//storage.googleapis.com/demo-bucket%2Fwith%20escapes/objects/a b';
    const result = normaliseAsset(rawAsset({ name }));
    expect(result.ok && result.asset.name).toBe(name);
  });

  it.each([
    ['no resource', { resource: undefined }, { data: null }, ['parent', 'location']],
    ['a null resource', { resource: null }, { data: null }, ['parent', 'location']],
    [
      'a resource without data',
      { resource: { parent: '//cloudresourcemanager.googleapis.com/projects/1' } },
      { data: null },
      ['location'],
    ],
    ['an empty location', { resource: { data: {}, location: '' } }, { data: {} }, ['parent', 'location']],
    ['a null parent', { resource: { data: {}, parent: null } }, { data: {} }, ['parent', 'location']],
    ['an empty parent', { resource: { data: {}, parent: '' } }, { data: {} }, ['parent', 'location']],
    ['no ancestors', { ancestors: undefined }, { ancestors: [] }, []],
    ['null ancestors', { ancestors: null }, { ancestors: [] }, []],
    ['null data', { resource: { data: null } }, { data: null }, ['parent', 'location']],
    [
      'a resource without parent and location',
      { resource: { data: {} } },
      { data: {} },
      ['parent', 'location'],
    ],
  ])('accepts %s', (_name, overrides, expected, absent) => {
    const result = normaliseAsset(rawAsset(overrides));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.asset).toMatchObject(expected);
    expect(AssetSchema.safeParse(result.asset).success).toBe(true);
    // An absent field is left out, never set to undefined; the others keep the model's order.
    const left = new Set<string>(absent);
    expect(Object.keys(result.asset)).toEqual(ASSET_KEYS.filter((key) => !left.has(key)));
  });

  it.each([
    ['a non-object', [1, 2], 'An asset must be a JSON object.'],
    ['null', null, 'An asset must be a JSON object.'],
    ['a missing name', { name: undefined }, /^name: /],
    ['a relative name', { name: 'projects/p/global/networks/n' }, /^name: must be a full resource name/],
    ['a malformed asset type', { assetType: 'Network' }, /^assetType: /],
    ['a missing update time', { updateTime: undefined }, /^updateTime: /],
    ['a malformed update time', { updateTime: '2026-10-07 18:22' }, /^updateTime: /],
    ['an ancestor of the wrong kind', { ancestors: ['projects/1', 'billingAccounts/2'] }, /^ancestors\.1: /],
    ['ancestors that are not a list', { ancestors: 'projects/1' }, /^ancestors: /],
    ['a resource that is not an object', { resource: 'x' }, 'resource: must be an object.'],
    ['a relative parent', { resource: { data: {}, parent: 'projects/1' } }, /^resource\.parent: /],
    ['a location that is not a string', { resource: { data: {}, location: 3 } }, /^resource\.location: /],
  ])('reports %s', (_name, overrides, message) => {
    const raw = Array.isArray(overrides) || overrides === null ? overrides : rawAsset(overrides);
    const result = normaliseAsset(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(message);
  });
});

describe('normaliseAsset: the two key styles', () => {
  it('reads the snake_case envelope of an exportAssets file exactly like the assets.list shape', () => {
    const listed = rawAsset();
    const exported = exportShape(listed);
    expect(Object.keys(exported)).toEqual(['name', 'asset_type', 'resource', 'ancestors', 'update_time']);
    expect(Object.keys(exported['resource'] as object)).toEqual([
      'version',
      'discovery_document_uri',
      'discovery_name',
      'parent',
      'data',
      'location',
    ]);
    const result = normaliseAsset(exported);
    expect(result).toEqual(normaliseAsset(listed));
    expect(result.ok && result.asset.assetType).toBe('compute.googleapis.com/Network');
    expect(result.ok && result.asset.updateTime).toBe('2026-10-07T18:22:41.123456Z');
  });

  it('accepts one field in each style, and both spellings when they agree', () => {
    const base = rawAsset();
    const mixed = { ...base, assetType: undefined, asset_type: base['assetType'] };
    const both = { ...base, asset_type: base['assetType'], update_time: base['updateTime'] };
    expect(normaliseAsset(mixed)).toEqual(normaliseAsset(base));
    expect(normaliseAsset(both)).toEqual(normaliseAsset(base));
  });

  it.each([
    [
      'asset types that disagree',
      { asset_type: 'compute.googleapis.com/Subnetwork' },
      'assetType, asset_type: the two spellings disagree.',
    ],
    [
      'update times that disagree',
      { update_time: '2026-10-01T00:00:00Z' },
      'updateTime, update_time: the two spellings disagree.',
    ],
  ])('reports %s', (_name, extra, message) => {
    expect(normaliseAsset({ ...rawAsset(), ...extra })).toEqual({ ok: false, message });
  });

  it.each([
    ['a missing asset_type', { asset_type: undefined }, /^asset_type: /],
    ['a malformed asset_type', { asset_type: 'Network' }, /^asset_type: /],
    ['a missing update_time', { update_time: undefined }, /^update_time: /],
    ['a malformed update_time', { update_time: 'yesterday' }, /^update_time: /],
  ])('names the snake_case field in the message for %s', (_name, overrides, message) => {
    const result = normaliseAsset({ ...exportShape(rawAsset()), ...overrides });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toMatch(message);
  });

  it('names the camelCase field when neither spelling is present', () => {
    const result = normaliseAsset({ ...rawAsset(), assetType: undefined });
    expect(result.ok ? '' : result.message).toMatch(/^assetType: /);
  });
});

describe('projectNumberOf', () => {
  it.each([
    [['projects/10000000001', 'folders/20000000001', 'organizations/30000000001'], '10000000001'],
    [['folders/20000000001', 'organizations/30000000001'], undefined],
    [['organizations/30000000001'], undefined],
    [[], undefined],
    // A project id in ancestors is not a number; the next project entry is used.
    [['projects/demo-net-1', 'projects/10000000002'], '10000000002'],
  ])('reads %j as %s', (ancestors, expected) => {
    expect(projectNumberOf({ ancestors })).toBe(expected);
  });
});

describe('isProjectNumber', () => {
  it.each([
    ['10000000001', true],
    ['1', true],
    ['0', false],
    ['01', false],
    ['demo-1', false],
    ['', false],
  ])('%s → %s', (value, expected) => {
    expect(isProjectNumber(value)).toBe(expected);
  });
});
