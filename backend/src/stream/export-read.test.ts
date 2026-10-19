// SPDX-License-Identifier: Apache-2.0
/**
 * The `gs://` URIs the export read takes (export-read.ts): a bucket and an object or prefix, and everything else
 * refused before anything is asked of Cloud Storage. The route and the read's caps are routes/export.test.ts's.
 */
import { describe, expect, it } from 'vitest';

import { gcsUri, parseGcsUri } from './export-read.js';

describe('parseGcsUri', () => {
  it('reads a bucket and an object or prefix', () => {
    expect(parseGcsUri('gs://demo-exports/2026-10-08/export.json')).toEqual({
      bucket: 'demo-exports',
      object: '2026-10-08/export.json',
    });
    expect(parseGcsUri('gs://demo-exports/prefix/')).toEqual({ bucket: 'demo-exports', object: 'prefix/' });
    expect(parseGcsUri('gs://demo-exports')).toEqual({ bucket: 'demo-exports', object: '' });
    expect(parseGcsUri('  gs://demo.exports.example.com/a b  ')).toEqual({
      bucket: 'demo.exports.example.com',
      object: 'a b',
    });
    expect(gcsUri({ bucket: 'demo-exports', object: 'x' })).toBe('gs://demo-exports/x');
  });

  it('refuses everything else', () => {
    for (const uri of [
      '',
      'gs://',
      'gs:///object',
      'https://storage.googleapis.com/demo-exports/x',
      's3://demo-exports/x',
      'gs://Demo-Exports/x',
      'gs://ab/x',
      'gs://demo..exports/x',
      'gs://-demo/x',
      'gs://demo-exports/a\nb',
      'gs://demo-exports/a\u0000b',
      'gs://demo-exports/..',
      `gs://demo-exports/${'x'.repeat(1025)}`,
      'gs://demo-exports/a\uD800b',
      'gs://demo-exports/a\uDC00',
      'gs://demo-exports/\uDBFF',
    ])
      expect(parseGcsUri(uri), JSON.stringify(uri)).toBeNull();
    // A surrogate pair is one character, and fine.
    expect(parseGcsUri('gs://demo-exports/\u{1F600}.json')).toEqual({
      bucket: 'demo-exports',
      object: '\u{1F600}.json',
    });
  });
});
