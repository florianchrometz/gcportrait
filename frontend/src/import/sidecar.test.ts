// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { operationJson as operation } from './fixtures';
import {
  exportReadTime,
  futureReadTimeNote,
  MAX_SIDECAR_BYTES,
  looksLikeSidecarName,
  namedScope,
  parseSidecar,
  parseTypedReadTime,
} from './sidecar';

describe('the operation.json sidecar', () => {
  it('gives the read time from the response and the scope from the request', () => {
    expect(parseSidecar(operation())).toEqual({
      readTime: '2026-10-08T06:00:01.123456Z',
      scope: { kind: 'organization', id: '30000000001' },
    });
  });

  it('takes the request’s read time when the response has none yet, and reads folders and projects', () => {
    expect(
      parseSidecar(
        operation({
          metadata: { parent: 'folders/20000000001', readTime: '2026-10-07T00:00:00Z' },
          response: { readTime: undefined },
        }),
      ),
    ).toEqual({ readTime: '2026-10-07T00:00:00Z', scope: { kind: 'folder', id: '20000000001' } });
    expect(parseSidecar(operation({ metadata: { parent: 'projects/demo-app-1' } }))?.scope).toEqual({
      kind: 'project',
      id: 'demo-app-1',
    });
  });

  it('is recognised by the operation name alone, without @type', () => {
    const text = JSON.stringify({
      name: 'projects/demo-app-1/operations/ExportAssets/RESOURCE/42',
      response: { readTime: '2026-10-08T00:00:00Z' },
    });
    expect(parseSidecar(text)).toEqual({ readTime: '2026-10-08T00:00:00Z' });
  });

  it('refuses whatever is not such an operation', () => {
    for (const text of [
      '',
      'not json',
      '[]',
      '{"name":"//compute.googleapis.com/projects/demo-app-1/zones/europe-west3-a/instances/vm-1","assetType":"compute.googleapis.com/Instance"}',
      JSON.stringify({ name: 'operations/other/1', response: { readTime: '2026-10-08T00:00:00Z' } }),
      operation({ metadata: { parent: 'billingAccounts/1' }, response: { readTime: 'yesterday' } }),
      operation({ metadata: { parent: 'folders/abc' }, response: { readTime: undefined } }),
      `${' '.repeat(MAX_SIDECAR_BYTES)}${operation()}`,
    ])
      expect(parseSidecar(text), text.slice(0, 60)).toBeNull();
  });

  it('is looked for under names with "operation" in them', () => {
    expect(looksLikeSidecarName('operation.json')).toBe(true);
    expect(looksLikeSidecarName('export.json.operation.json')).toBe(true);
    expect(looksLikeSidecarName('Export-Operation.JSON')).toBe(true);
    expect(looksLikeSidecarName('export.json')).toBe(false);
    expect(looksLikeSidecarName('operation.txt')).toBe(false);
  });
});

describe('namedScope', () => {
  it('takes the name the assets give the same scope, and nothing from another one', () => {
    const named = { kind: 'organization', id: '30000000001', displayName: 'example.com' } as const;
    expect(namedScope({ kind: 'organization', id: '30000000001' }, named)).toEqual(named);
    expect(namedScope({ kind: 'folder', id: '20000000001' }, named)).toEqual({
      kind: 'folder',
      id: '20000000001',
    });
    expect(namedScope({ kind: 'project', id: '10000000001' }, undefined)).toEqual({
      kind: 'project',
      id: '10000000001',
    });
  });
});

describe('a read time typed for an export without its operation.json', () => {
  const NOW = Date.parse('2026-10-10T12:00:00Z');

  it('is read as UTC, to the second, with or without seconds, T, Z, UTC or an offset; empty is none', () => {
    for (const [text, readTime] of [
      ['2026-10-05 14:30', '2026-10-05T14:30:00Z'],
      ['  2026-10-05 14:30:12  ', '2026-10-05T14:30:12Z'],
      ['2026-10-05T14:30:12.987Z', '2026-10-05T14:30:12Z'],
      ['2026-10-05 14:30 UTC', '2026-10-05T14:30:00Z'],
      ['2026-10-05t14:30z', '2026-10-05T14:30:00Z'],
      ['2026-10-05 16:30+02:00', '2026-10-05T14:30:00Z'],
      ['2026-10-05 09:00-05:30', '2026-10-05T14:30:00Z'],
      ['2026-10-06 04:30+14:00', '2026-10-05T14:30:00Z'],
      ['2026-10-05 02:30-12:00', '2026-10-05T14:30:00Z'],
      ['2024-02-29 00:00', '2024-02-29T00:00:00Z'],
    ] as const)
      expect(parseTypedReadTime(text, NOW)).toEqual({ readTime });
    expect(parseTypedReadTime('', NOW)).toBeNull();
    expect(parseTypedReadTime('   ', NOW)).toBeNull();
  });

  it('is refused, with how to write it, when it is no such time', () => {
    for (const text of [
      'yesterday',
      '2026-10-05',
      '05.10.2026 14:30',
      '2026-02-29 12:00',
      '2026-10-05 24:00',
      '2026-10-05 14:60',
      '2026-10-05 14:30:61',
      '2026-10-05 14:30+15:00',
      '2026-10-05 14:30+14:01',
      '2026-10-05 14:30+14:59',
      '2026-10-05 14:30-12:01',
      '2026-10-05 14:30-13:00',
      '2026-10-05 14:30-14:59',
      '2026-10-05 14:30+02:75',
      '1969-12-31 23:59',
    ])
      expect(parseTypedReadTime(text, NOW)).toEqual({
        problem: 'Type the read time as 2026-10-05 14:30 (UTC), or leave it empty.',
      });
  });

  it('is refused when it is later than this computer’s clock', () => {
    expect(parseTypedReadTime('2026-10-10 12:01', NOW)).toEqual({
      problem: "2026-10-10 12:01 UTC is later than this computer's clock: type when the export was taken.",
    });
    expect(parseTypedReadTime('2026-10-10 12:00', NOW)).toEqual({ readTime: '2026-10-10T12:00:00Z' });
  });
});

describe('the read time an export is read with', () => {
  const sidecar = parseSidecar(operation());

  it.each([
    ['0000-01-01T00:00:00+01:00', '-000001-12-31 23:00 UTC'],
    ['9999-12-31T23:30:00-01:00', '+010000-01-01 00:30 UTC'],
  ])('formats accepted sidecar time %s across the UTC year boundary', (readTime, expected) => {
    const accepted = parseSidecar(operation({ response: { readTime } }));
    expect(accepted?.readTime).toBe(readTime);
    expect(exportReadTime(accepted, '2026-10-05T14:30:00Z').note).toBe(
      `The export's operation.json names its read time, ${expected}, so the time typed, ` +
        '2026-10-05 14:30 UTC, was not used.',
    );
    expect(exportReadTime(sidecar, readTime).note).toBe(
      "The export's operation.json names its read time, 2026-10-08 06:00 UTC, so the time typed, " +
        `${expected}, was not used.`,
    );
    expect(futureReadTimeNote(readTime, Date.parse(readTime) - 1)).toBe(
      `Its read time, ${expected}, is later than this computer's clock; its scope's timeline shows it at ` +
        'the present until then.',
    );
  });

  it('still rejects invalid direct formatting inputs rather than treating them as display text', () => {
    expect(() => exportReadTime({ readTime: 'soon' }, '2026-10-05T14:30:00Z')).toThrow(RangeError);
    expect(() => exportReadTime(sidecar, 'soon')).toThrow(RangeError);
  });

  it('is the operation.json’s, else the one typed, else none (the estimate)', () => {
    expect(exportReadTime(sidecar, undefined)).toEqual({
      readTime: '2026-10-08T06:00:01.123456Z',
      origin: 'export-sidecar',
    });
    expect(exportReadTime(null, '2026-10-05T14:30:00Z')).toEqual({
      readTime: '2026-10-05T14:30:00Z',
      origin: 'user',
    });
    expect(exportReadTime(null, undefined)).toEqual({});
    expect(exportReadTime({}, undefined)).toEqual({});
  });

  it('says when the operation.json’s replaced a different time typed', () => {
    expect(exportReadTime(sidecar, '2026-10-05T14:30:00Z')).toEqual({
      readTime: '2026-10-08T06:00:01.123456Z',
      origin: 'export-sidecar',
      note:
        "The export's operation.json names its read time, 2026-10-08 06:00 UTC, so the time typed, " +
        '2026-10-05 14:30 UTC, was not used.',
    });
    expect(exportReadTime(sidecar, '2026-10-08T06:00:01.123456Z').note).toBeUndefined();
  });
});

describe('a read time in the future', () => {
  it('is said: the timeline shows the snapshot at the present', () => {
    const now = Date.parse('2026-10-10T12:00:00Z');
    expect(futureReadTimeNote('2026-10-11T08:00:00Z', now)).toBe(
      "Its read time, 2026-10-11 08:00 UTC, is later than this computer's clock; its scope's timeline shows it " +
        'at the present until then.',
    );
    expect(futureReadTimeNote('2026-10-10T12:00:00Z', now)).toBeNull();
    expect(futureReadTimeNote('not a time', now)).toBeNull();
  });
});
