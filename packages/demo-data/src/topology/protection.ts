// SPDX-License-Identifier: MIT
/**
 * Sensitive Data Protection in the data platform (feature `security`): an inspection template for personal
 * data, a weekly job trigger that inspects the data lake bucket with it, and a discovery configuration that
 * profiles the warehouse table.
 */
import type { JsonObject } from '../core/json.js';
import type { OrgContext } from './context.js';
import { addProjectAsset, fullName, type ProjectCtx } from './kit.js';
import type { Region } from './vocabulary.js';

export function addDataProtection(
  ctx: OrgContext,
  project: ProjectCtx,
  region: Region,
  lake: string,
  dataset: string,
  table: string,
  /** The table's full name: the discovery configuration profiles it. */
  tableName: string,
): void {
  const base = `projects/${project.id}/locations/${region.name}`;
  const template = `${base}/inspectTemplates/pii-eu`;
  const add = (kind: string, path: string, data: JsonObject, after?: number): void => {
    addProjectAsset(ctx.b, project, {
      assetType: `dlp.googleapis.com/${kind}`,
      name: fullName('dlp.googleapis.com', path),
      location: region.name,
      data: { name: path, ...data },
      ...(after === undefined ? {} : { after }),
    });
  };
  add('InspectTemplate', template, {
    displayName: 'Personal data',
    description: 'E-mail addresses, phone numbers and bank accounts',
    inspectConfig: {
      infoTypes: [{ name: 'EMAIL_ADDRESS' }, { name: 'PHONE_NUMBER' }, { name: 'IBAN_CODE' }],
      minLikelihood: 'LIKELY',
      limits: { maxFindingsPerRequest: 1000 },
    },
  });
  add('JobTrigger', `${base}/jobTriggers/lake-weekly`, {
    displayName: 'Lake bucket, weekly',
    description: 'Inspects everything that lands in the data lake',
    status: 'HEALTHY',
    triggers: [{ schedule: { recurrencePeriodDuration: '604800s' } }],
    inspectJob: {
      storageConfig: {
        cloudStorageOptions: { fileSet: { url: `gs://${lake}/**` }, bytesLimitPerFilePercent: 10 },
        timespanConfig: { enableAutoPopulationOfTimespanConfig: true },
      },
      inspectTemplateName: template,
      actions: [{ publishSummaryToCscc: {} }],
    },
  });
  const tableCreatedAt = ctx.b.referenced(tableName);
  add(
    'DiscoveryConfig',
    `${base}/discoveryConfigs/warehouse-profiles`,
    {
      displayName: 'Warehouse profiles',
      status: 'RUNNING',
      inspectTemplates: [template],
      targets: [
        {
          bigQueryTarget: {
            filter: { tableReference: { projectId: project.id, datasetId: dataset, tableId: table } },
            cadence: { schemaModifiedCadence: { frequency: 'UPDATE_FREQUENCY_DAILY' } },
          },
        },
      ],
    },
    tableCreatedAt,
  );
}
