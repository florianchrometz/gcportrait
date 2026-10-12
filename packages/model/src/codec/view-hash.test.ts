// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { FOLDER, INSTANCE, ULID, sampleViewSpec } from '../testing/fixtures.js';
import { DEFAULT_VIEW_SPEC } from '../schemas/view-spec.js';
import { decodeViewSpec, encodeViewSpec } from './view-hash.js';

/** The full example of the README, field by field. */
const FULL_HASH = [
  `snapshot=${ULID}`,
  'tick=2026-10-01',
  'lens=load-balancing',
  'focus=shared-vpc',
  'focus.host=demo-net',
  `root=${FOLDER}`,
  'detail=networks',
  'hide=empty-projects,disconnected',
  'regions=europe-west3,us-central1',
  'projects=demo-app,demo-net',
  'folders=20000000001',
  'include=run.googleapis.com/*',
  'exclude=compute.googleapis.com/Disk',
  'depth=4',
  'show-regions=1',
  'show-identities=0',
  'flips=k3x9a1,7fz2m0',
  `selection=${INSTANCE}`,
  'highlight=10.10.0.2',
].join('&');

describe('encodeViewSpec', () => {
  it('encodes the default view as the empty string', () => {
    expect(encodeViewSpec(DEFAULT_VIEW_SPEC)).toBe('');
    expect(encodeViewSpec({})).toBe('');
  });

  it('writes only what differs from the defaults', () => {
    expect(encodeViewSpec({ snapshot: 'demo:M', lens: 'networking' })).toBe(
      'snapshot=demo:M&lens=networking',
    );
    expect(encodeViewSpec({ snapshot: 'demo:S', tick: '2026-09-20', detail: 'projects' })).toBe(
      'snapshot=demo:S&tick=2026-09-20&detail=projects',
    );
  });

  it('writes an extra tick (a read time to the second) readably, and reads it back', () => {
    const hash = encodeViewSpec({ snapshot: 'demo:M', tick: '2026-10-05T14:30:00Z' });
    expect(hash).toBe('snapshot=demo:M&tick=2026-10-05T14:30:00Z');
    expect(decodeViewSpec(hash).tick).toBe('2026-10-05T14:30:00Z');
    expect(decodeViewSpec('snapshot=demo:M&tick=2026-10-05T14:30:00.000Z').tick).toBeUndefined();
  });

  it('writes every field in the documented order', () => {
    expect(encodeViewSpec(sampleViewSpec())).toBe(FULL_HASH);
  });

  it('writes a focus without parameters, and parameters sorted by name', () => {
    expect(encodeViewSpec({ focus: { kind: 'standalone-projects', params: {} } })).toBe(
      'focus=standalone-projects',
    );
    expect(
      encodeViewSpec({ focus: { kind: 'application', params: { name: 'shop', location: 'global' } } }),
    ).toBe('focus=application&focus.location=global&focus.name=shop');
  });

  it('writes a canonical hash for equivalent views', () => {
    const messy = encodeViewSpec({
      filters: { hideEmptyFolders: true, regions: ['us-central1', 'europe-west3', 'us-central1'] },
      flips: ['b', 'a', 'b'],
    });
    expect(messy).toBe('hide=empty-folders&regions=europe-west3,us-central1&flips=a,b');
  });

  it('keeps letters, digits and - . _ ~ * / : @ readable and escapes everything else', () => {
    expect(
      encodeViewSpec({ selection: '//iam.googleapis.com/projects/demo-net/serviceAccounts/web@example.com' }),
    ).toBe('selection=//iam.googleapis.com/projects/demo-net/serviceAccounts/web@example.com');
    expect(encodeViewSpec({ highlight: "web & api, v2+3 = 100% #1 (beta) don't!" })).toBe(
      'highlight=web%20%26%20api%2C%20v2%2B3%20%3D%20100%25%20%231%20%28beta%29%20don%27t%21',
    );
    expect(encodeViewSpec({ highlight: 'Zürich 😀' })).toBe('highlight=Z%C3%BCrich%20%F0%9F%98%80');
    expect(encodeViewSpec({ focus: { kind: 'project', params: { project: 'a,b&c=d' } } })).toBe(
      'focus=project&focus.project=a%2Cb%26c%3Dd',
    );
  });

  it('drops what normalisation drops', () => {
    expect(
      encodeViewSpec({ lens: 'nope', flips: Array.from({ length: 50 }, (_, i) => `f${String(i)}`) }),
    ).toBe(`flips=${Array.from({ length: 48 }, (_, i) => `f${String(i + 2)}`).join(',')}`);
  });
});

describe('decodeViewSpec', () => {
  it('decodes the empty hash, with or without #, to the default view', () => {
    expect(decodeViewSpec('')).toEqual(DEFAULT_VIEW_SPEC);
    expect(decodeViewSpec('#')).toEqual(DEFAULT_VIEW_SPEC);
  });

  it('decodes the documented examples', () => {
    expect(decodeViewSpec('#snapshot=demo:M&lens=networking')).toEqual({
      ...DEFAULT_VIEW_SPEC,
      snapshot: 'demo:M',
      lens: 'networking',
    });
    expect(decodeViewSpec(FULL_HASH)).toEqual(sampleViewSpec());
    expect(decodeViewSpec(`#${FULL_HASH}`)).toEqual(sampleViewSpec());
  });

  it('round-trips escaped text', () => {
    for (const highlight of [
      "web & api, v2+3 = 100% #1 (beta) don't!",
      'Zürich 😀',
      '%2C',
      ' leading and trailing ',
    ]) {
      expect(decodeViewSpec(encodeViewSpec({ highlight })).highlight).toBe(highlight);
    }
  });

  it('reads + as a plus sign, not a space, and accepts lower-case escapes', () => {
    expect(decodeViewSpec('highlight=a+b%2c%c3%bc').highlight).toBe('a+b,ü');
  });

  it('accepts true and false for switches', () => {
    expect(decodeViewSpec('show-regions=true&show-identities=false').filters).toMatchObject({
      showRegions: true,
      showIdentities: false,
    });
  });

  it('ignores unknown keys, keys without a value and empty keys', () => {
    expect(decodeViewSpec('theme=dark&lens&=networking&&lens=data&utm_source=mail')).toEqual({
      ...DEFAULT_VIEW_SPEC,
      lens: 'data',
    });
  });

  it('uses the first occurrence of a repeated key', () => {
    expect(decodeViewSpec('lens=data&lens=compute').lens).toBe('data');
  });

  it('falls back to the default field by field for malformed values', () => {
    const spec = decodeViewSpec(
      [
        'snapshot=%E0%A4%A',
        'tick=2026-02-30',
        'lens=Networking',
        'detail=all',
        'depth=abc',
        'show-regions=maybe',
        'show-identities=1',
        'root=',
        'selection=%ZZ',
        'highlight=%ED%A0%80',
      ].join('&'),
    );
    expect(spec).toEqual({
      ...DEFAULT_VIEW_SPEC,
      detail: 'all',
      filters: { ...DEFAULT_VIEW_SPEC.filters, showIdentities: true },
    });
  });

  it.each(['depth=0', 'depth=65', 'depth=-1', 'depth=1.5', 'depth=1e1', 'depth='])(
    'drops an invalid %s',
    (hash) => {
      expect(decodeViewSpec(hash).filters).not.toHaveProperty('depth');
    },
  );

  it('accepts a depth with leading zeros', () => {
    expect(decodeViewSpec('depth=007').filters.depth).toBe(7);
  });

  it('keeps the well-formed items of a list', () => {
    const spec = decodeViewSpec(
      'flips=ok,%ZZ,not%20ok,,also-ok&regions=,,&hide=bogus,disconnected,disconnected',
    );
    expect(spec.flips).toEqual(['ok', 'also-ok']);
    expect(spec.filters).toEqual({ ...DEFAULT_VIEW_SPEC.filters, hideDisconnected: true });
  });

  it('reads focus parameters only with a valid focus kind, and drops invalid ones', () => {
    expect(decodeViewSpec('focus.project=demo-app').focus).toBeUndefined();
    expect(decodeViewSpec('focus=org&focus.project=demo-app').focus).toBeUndefined();
    expect(
      decodeViewSpec('focus=project&focus.project=demo-app&focus.=x&focus.9=y&focus.bad=%ZZ&focus.e=').focus,
    ).toEqual({ kind: 'project', params: { project: 'demo-app' } });
  });
});
