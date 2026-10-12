// SPDX-License-Identifier: MIT
/**
 * The `gcloud` commands the Load export panel shows (skill cai-ingestion §1, §3): how to make an export
 * gcportrait can read, and how to keep its operation next to it for the read time (sidecar.ts). Their variables are
 * tokens of COMMAND_VARIABLES (`@gcportrait/model`): the scope's id under its kind's variable (an organisation's when
 * no scope is picked), YOUR_BUCKET and YOUR_OPERATION_NAME. The command blocks show each as a field, prefilled with
 * the scope picked; never a real value the person did not give.
 */
import type { SnapshotScope } from '@gcportrait/model';

import { SCOPE_ID_VARIABLES } from '../commands/values';
import { SIDECAR_FILE_NAME } from './sidecar';

const SCOPE_FLAGS = {
  organization: '--organization',
  folder: '--folder',
  project: '--project',
} as const;

/** Where the export is written, and where it is copied from. */
export const EXPORT_DESTINATION = 'gs://YOUR_BUCKET/export.json';

/** `gcloud asset export` of a whole scope of that kind, every asset type, resource content, to one object. */
export function exportCommand(
  scope: Pick<SnapshotScope, 'kind'> | null,
  destination = EXPORT_DESTINATION,
): string {
  const kind = scope?.kind ?? 'organization';
  return `gcloud asset export ${SCOPE_FLAGS[kind]}=${SCOPE_ID_VARIABLES[kind]} --content-type=resource --output-path=${destination}`;
}

/** Saves the export's operation as the sidecar, once the export has finished. */
export const DESCRIBE_COMMAND = `gcloud asset operations describe YOUR_OPERATION_NAME --format=json > ${SIDECAR_FILE_NAME}`;

/** Copies the export to this computer, to drop it on the page. */
export function copyCommand(source = EXPORT_DESTINATION): string {
  return `gcloud storage cp ${source} .`;
}
