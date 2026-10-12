// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import {
  GENERIC_ICON_KEY,
  ICON_KEYS,
  categoryOf,
  iconFor,
  isOwnDrawing,
  placeIcon,
  resolveIcon,
  type Icon,
} from './index.js';

const must = (key: string): Icon => {
  const icon = iconFor(key);
  if (icon === undefined) throw new Error(`${key} does not resolve`);
  return icon;
};

describe('ICON_KEYS', () => {
  it('is sorted, unique and frozen, and every key resolves', () => {
    expect([...ICON_KEYS]).toEqual([...new Set(ICON_KEYS)].sort());
    expect(Object.isFrozen(ICON_KEYS)).toBe(true);
    for (const key of ICON_KEYS) expect(iconFor(key)?.key).toBe(key);
  });

  it('holds the hierarchy marks, the generic marks and the category marks', () => {
    for (const key of [
      'organization',
      'folder',
      'project',
      'cloud_generic',
      'generic_resource',
      'category_networking',
    ]) {
      expect(ICON_KEYS).toContain(key);
    }
  });
});

describe('iconFor', () => {
  it('returns a complete, unsized SVG document with its viewBox', () => {
    const icon = must('cloud_run');
    expect(icon.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 512 512"[ >]/);
    expect(icon.svg.endsWith('</svg>')).toBe(true);
    expect(icon.svg).not.toMatch(/<svg[^>]*\s(width|height)=/);
    expect(icon).toMatchObject({ key: 'cloud_run', viewBox: '0 0 512 512', kind: 'official', set: 'core' });
  });

  it('gives marquee products the core colour mark and sub-products the two-tone console icon', () => {
    for (const key of [
      'compute_engine',
      'google_kubernetes_engine',
      'bigquery',
      'cloud_sql',
      'cloud_storage',
    ]) {
      expect(must(key)).toMatchObject({ set: 'core', viewBox: '0 0 512 512', plateOnDark: true });
    }
    for (const key of ['cloud_router', 'cloud_firewall_rules', 'virtual_private_cloud', 'cloud_dns']) {
      expect(must(key)).toMatchObject({ set: 'legacy', viewBox: '0 0 24 24', plateOnDark: false });
    }
  });

  it('stands in a category mark for a product without its own icon', () => {
    const icon = must('app_hub');
    expect(icon).toMatchObject({ kind: 'category', set: 'category', category: 'category_operations' });
    expect(icon.svg).toBe(must('category_operations').svg);
  });

  it('marks the generic cloud mark as generic', () => {
    expect(GENERIC_ICON_KEY).toBe('cloud_generic');
    expect(must(GENERIC_ICON_KEY)).toMatchObject({ kind: 'generic', set: 'legacy' });
  });

  it('returns undefined for unknown keys, including inherited property names', () => {
    expect(iconFor('no_such_product')).toBeUndefined();
    expect(iconFor('constructor')).toBeUndefined();
    expect(iconFor('__proto__')).toBeUndefined();
  });

  it('returns the same frozen object every time', () => {
    expect(iconFor('pubsub')).toBe(iconFor('pubsub'));
    expect(Object.isFrozen(iconFor('pubsub'))).toBe(true);
  });
});

describe('resolveIcon', () => {
  it('prefers the type key, then the product key', () => {
    expect(resolveIcon('compute_engine', 'cloud_firewall_rules').key).toBe('cloud_firewall_rules');
    expect(resolveIcon('compute_engine').key).toBe('compute_engine');
    expect(resolveIcon('compute_engine', 'no_such_type').key).toBe('compute_engine');
  });

  it('falls back to the given category mark, then to the category of the keys, then to the generic mark', () => {
    expect(resolveIcon('no_such_product', undefined, 'category_storage').key).toBe('category_storage');
    expect(resolveIcon('no_such_product', 'no_such_type', 'no_such_category').key).toBe(GENERIC_ICON_KEY);
    expect(resolveIcon().key).toBe(GENERIC_ICON_KEY);
    expect(resolveIcon(undefined, 'no_such_type').key).toBe(GENERIC_ICON_KEY);
  });
});

describe('isOwnDrawing', () => {
  it('is true for gcportrait drawings only', () => {
    expect(ICON_KEYS.filter((key) => isOwnDrawing(key))).toEqual([
      'folder',
      'generic_resource',
      'organization',
      'service_account',
    ]);
    expect(isOwnDrawing('project')).toBe(false);
    expect(isOwnDrawing('no_such_key')).toBe(false);
  });

  it('gives own drawings the 24 px grid and no plate', () => {
    expect(must('organization')).toMatchObject({
      kind: 'own',
      set: 'own',
      viewBox: '0 0 24 24',
      plateOnDark: false,
    });
  });
});

describe('categoryOf', () => {
  it('returns the category mark key of a product', () => {
    expect(categoryOf('cloud_run')).toBe('category_serverless_computing');
    expect(categoryOf('virtual_private_cloud')).toBe('category_networking');
    expect(categoryOf('category_networking')).toBeUndefined();
    expect(categoryOf('no_such_key')).toBeUndefined();
  });
});

describe('placeIcon', () => {
  it('adds position and size to the root element only', () => {
    const icon = must('folder');
    const placed = placeIcon(icon, 16, 10, 12.5);
    expect(placed).toBe(icon.svg.replace('<svg ', '<svg x="10" y="12.5" width="16" height="16" '));
  });
});
