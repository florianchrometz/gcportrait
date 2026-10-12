// @vitest-environment node
// SPDX-License-Identifier: MIT
/** The gcloud commands the Load export panel shows (commands.ts), with variables for what only the person knows. */
import { describe, expect, it } from 'vitest';

import { DESCRIBE_COMMAND, copyCommand, exportCommand } from './commands';

describe('the gcloud commands', () => {
  it('export the whole scope with resource content, with variables for the scope and the bucket', () => {
    expect(exportCommand(null)).toBe(
      'gcloud asset export --organization=YOUR_ORG_ID --content-type=resource --output-path=gs://YOUR_BUCKET/export.json',
    );
    expect(exportCommand({ kind: 'folder' })).toBe(
      'gcloud asset export --folder=YOUR_FOLDER_ID --content-type=resource --output-path=gs://YOUR_BUCKET/export.json',
    );
    expect(exportCommand({ kind: 'project' }, 'gs://demo-exports/x.json')).toBe(
      'gcloud asset export --project=YOUR_PROJECT_ID --content-type=resource --output-path=gs://demo-exports/x.json',
    );
  });

  it('describe the export operation into operation.json, and copy the export down', () => {
    expect(DESCRIBE_COMMAND).toBe(
      'gcloud asset operations describe YOUR_OPERATION_NAME --format=json > operation.json',
    );
    expect(copyCommand()).toBe('gcloud storage cp gs://YOUR_BUCKET/export.json .');
  });
});
