// SPDX-License-Identifier: MIT
/**
 * Export fixtures for the tests, without React (testing.tsx holds the page harness and the backend's stream frames,
 * test/backend.ts the stand-in backend): an export's operation.json and a demo organisation's export NDJSON.
 * Imported by tests only.
 */
import { generateOrganization, toCaiNdjson } from '@gcportrait/demo-data';
import type { DemoSize } from '@gcportrait/model';

/**
 * A finished `exportAssets` operation of organisation 30000000001, as `gcloud asset operations describe --format=json`
 * prints it; `metadata` and `response` add to (or, with `undefined`, take out of) the request and the response.
 */
export function operationJson(
  overrides: { readonly name?: string; readonly metadata?: object; readonly response?: object } = {},
): string {
  return JSON.stringify(
    {
      name: overrides.name ?? 'organizations/30000000001/operations/ExportAssets/RESOURCE/1234567890',
      metadata: {
        '@type': 'type.googleapis.com/google.cloud.asset.v1.ExportAssetsRequest',
        contentType: 'RESOURCE',
        outputConfig: { gcsDestination: { uri: 'gs://demo-exports/export.json' } },
        parent: 'organizations/30000000001',
        ...overrides.metadata,
      },
      done: true,
      response: {
        '@type': 'type.googleapis.com/google.cloud.asset.v1.ExportAssetsResponse',
        outputConfig: { gcsDestination: { uri: 'gs://demo-exports/export.json' } },
        readTime: '2026-10-08T06:00:01.123456Z',
        ...overrides.response,
      },
    },
    null,
    2,
  );
}

const exportTexts = new Map<DemoSize, string>();

/** Demo organisation `size` as a Cloud Asset Inventory export's NDJSON, generated once per test file. */
export function demoExportNdjson(size: DemoSize = 'S'): string {
  let text = exportTexts.get(size);
  if (text === undefined) {
    text = toCaiNdjson(generateOrganization({ size }).assets, 'export');
    exportTexts.set(size, text);
  }
  return text;
}
