// SPDX-License-Identifier: MIT
/**
 * The Permissions page's standing guidance (docs/permissions.md; skill cai-ingestion §3):
 * - `PermissionsReference`: what each way of reading needs, as a table, its commands in the command group of
 *   the scope picked (an organisation's when none is) with their variables as fields to fill in place, prefilled
 *   from what the app knows (the scope, the quota project, the account, this instance's service account;
 *   commands/useCommandVariables.ts), and the Variables panel to fill each once for the whole page; on a phone, where
 *   a third column would leave a command a few characters' width, the same rows as a list under a heading per mode,
 *   each command under its need, as wide as the page (the same command blocks, so the same controls);
 * - `ServiceAccountExplainer`: service-account mode in the words of docs/permissions.md §3, with the account's
 *   email, and the gate.
 */
import type { ReactElement } from 'react';

import { safeEmail, SCOPE_ID_VARIABLES } from '../commands/values';
import { VariablesPanel } from '../commands/VariablesPanel';
import { exportCommand } from '../import/commands';
import type { ScopeChoice, ScopeKind } from '../scope/scopeName';
import { useScreen } from '../ui/screen';
import { CommandBlock } from './CommandBlock';
import { EMAIL_PLACEHOLDER, serviceAccountParagraphs } from './copy';
import styles from './Preflight.module.css';

/** The `gcloud` command group that grants roles on a scope of each kind. */
const COMMAND_GROUPS: Readonly<Record<ScopeKind, string>> = {
  organization: 'gcloud organizations',
  folder: 'gcloud resource-manager folders',
  project: 'gcloud projects',
};

interface Row {
  readonly mode: string;
  readonly need: string;
  readonly commands: readonly string[];
}

export interface PermissionsReferenceProps {
  readonly scope: Pick<ScopeChoice, 'kind'> | null;
  /** This instance's service account, when it offers service-account mode. */
  readonly serviceAccount: string | null;
}

/**
 * The permission table: one row per need, with its commands. Their variables are tokens (COMMAND_VARIABLES): the
 * scope's id under its kind's variable, YOUR_EMAIL, YOUR_QUOTA_PROJECT, YOUR_SA_EMAIL and YOUR_BUCKET; the command
 * blocks fill them in from what the page knows and what the person types.
 */
export function referenceRows({ scope, serviceAccount }: PermissionsReferenceProps): readonly Row[] {
  const kind = scope?.kind ?? 'organization';
  const binding = (member: string, role: string): string =>
    `${COMMAND_GROUPS[kind]} add-iam-policy-binding ${SCOPE_ID_VARIABLES[kind]} --member="${member}" --role="${role}"`;
  const user = `user:${EMAIL_PLACEHOLDER}`;
  return [
    {
      mode: 'Your account',
      need: 'roles/cloudasset.viewer on the scope (or the single permission cloudasset.assets.listResource)',
      commands: [binding(user, 'roles/cloudasset.viewer')],
    },
    {
      mode: 'Your account',
      need:
        'A quota project: the Cloud Asset API enabled in it, and roles/serviceusage.serviceUsageConsumer ' +
        '(serviceusage.services.use) on it',
      commands: [
        'gcloud services enable cloudasset.googleapis.com --project=YOUR_QUOTA_PROJECT',
        `gcloud projects add-iam-policy-binding YOUR_QUOTA_PROJECT --member="${user}" --role="roles/serviceusage.serviceUsageConsumer"`,
      ],
    },
    {
      mode: 'Your account',
      need: 'resourcemanager.*.get on the scope, to show names (normally part of Viewer or Browser); optional',
      commands: [],
    },
    {
      mode: 'Service account',
      need: `roles/cloudasset.viewer on the scope for ${safeEmail(serviceAccount) ?? 'this instance’s service account'}`,
      commands: [binding('serviceAccount:YOUR_SA_EMAIL', 'roles/cloudasset.viewer')],
    },
    {
      mode: 'Service account',
      need: 'You still need resourcemanager.*.get on the scope yourself (the gate below)',
      commands: [],
    },
    {
      mode: 'Export file',
      need: 'storage.objects.get on the export’s bucket (roles/storage.objectViewer), to open it from Cloud Storage',
      commands: [exportCommand(scope)],
    },
  ];
}

export function PermissionsReference(props: PermissionsReferenceProps): ReactElement {
  const rows = referenceRows(props);
  const phone = useScreen() === 'phone';
  return (
    <>
      <VariablesPanel commands={rows.flatMap((row) => row.commands)} />
      {phone ? <ReferenceList rows={rows} /> : <ReferenceTable rows={rows} />}
    </>
  );
}

function Commands({ row }: { readonly row: Row }): ReactElement {
  return (
    <>
      {row.commands.map((command) => (
        <CommandBlock key={command} command={command} context="reference" />
      ))}
    </>
  );
}

function ReferenceTable({ rows }: { readonly rows: readonly Row[] }): ReactElement {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className="visually-hidden">What each way of reading Cloud Asset Inventory needs</caption>
        <thead>
          <tr>
            <th scope="col">Mode</th>
            <th scope="col">Needed</th>
            <th scope="col">Command</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.mode}:${row.need}`}>
              <td>{row.mode}</td>
              <td>{row.need}</td>
              <td>{row.commands.length === 0 ? '—' : <Commands row={row} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The rows on a phone: a heading per mode (the rows of a mode follow each other), its needs listed under it. */
function ReferenceList({ rows }: { readonly rows: readonly Row[] }): ReactElement {
  const modes: { readonly mode: string; readonly rows: Row[] }[] = [];
  for (const row of rows) {
    const last = modes.at(-1);
    if (last?.mode === row.mode) last.rows.push(row);
    else modes.push({ mode: row.mode, rows: [row] });
  }
  return (
    <div className={styles.modes}>
      {modes.map(({ mode, rows: needs }) => (
        <div key={mode} className={styles.mode}>
          <h3 className={styles.itemTitle}>{mode}</h3>
          <ul className={styles.needs}>
            {needs.map((row) => (
              <li key={row.need} className={styles.need}>
                <p>{row.need}</p>
                <Commands row={row} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export interface ServiceAccountExplainerProps {
  /** Whether this instance offers service-account mode at all. */
  readonly offered: boolean;
  readonly serviceAccount: string | null;
  readonly scope: string | null;
  /** Whether the instance's gate runs the strict exposure check (`saStrictExposure` in /api/config). */
  readonly strictExposure?: boolean;
}

export function ServiceAccountExplainer({
  offered,
  serviceAccount,
  scope,
  strictExposure = false,
}: ServiceAccountExplainerProps): ReactElement {
  return (
    <div className={styles.explainer}>
      {offered ? (
        <p>
          This instance’s service account:{' '}
          {serviceAccount === null ? 'not published by this instance' : <code>{serviceAccount}</code>}. Grant
          it <code>roles/cloudasset.viewer</code> on a scope to let people read it through this instance.
        </p>
      ) : (
        <p>This instance does not offer service-account mode; everything is read with your own account.</p>
      )}
      {serviceAccountParagraphs(scope, serviceAccount, strictExposure).map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      <p>
        <strong>The gate.</strong> Before the service account reads a scope, gcportrait asks Google, with your
        own sign-in, whether you hold the permission to see that scope (resourcemanager.organizations.get,
        resourcemanager.folders.get or resourcemanager.projects.get).{' '}
        {strictExposure
          ? 'This instance also checks that the service account cannot see the scope’s details on its own. '
          : null}
        Only then does the account list the scope’s assets. A passed check is remembered for at most five
        minutes, for your sign-in and that scope only. The gate cannot be switched off: an operator can only
        turn service-account mode off as a whole.
      </p>
    </div>
  );
}
