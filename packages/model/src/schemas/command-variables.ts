// SPDX-License-Identifier: MIT
/**
 * The variables of copy-ready commands, as data: every value a reader fills in where the documentation under docs/
 * or the app shows a command, with its label, description, synthetic example, format and whether it is a secret.
 * It is the one registry: the website renders each token in a docs code block as a field from it, the app's command
 * blocks take their fields from it, and `node scripts/user-docs.mjs` fails on a token in a guide that it does not
 * list. The module imports nothing at run time (no zod), so the app's UI thread, the website's build and
 * plain Node (the repository's .mjs tooling loads it by type stripping) all read the same file. Its row schema is
 * CommandVariableSchema (command-variable.ts).
 *
 * The convention (docs/contributing.md, "Data, privacy and presentation"): a value to fill in is written `YOUR_` followed by capitals, digits
 * and underscores, as one word (`YOUR_PROJECT`, `YOUR_ORG_ID`). It is a plain word to a shell, so a command copied
 * unfilled still runs and fails with a clear message (no Google Cloud id is in capitals). Capitals without `YOUR_`
 * are literal text: an environment variable (`OAUTH_CLIENT_ID`), a script's usage line (`--project PROJECT_ID`), a
 * name pattern (`SERVICE-backend@PROJECT…`), a redacted part of a recorded run.
 */
import type { CommandVariable } from './command-variable.js';

/** A variable's name, which is also its token in the texts. */
export const VARIABLE_NAME_PATTERN = /^YOUR_[A-Z0-9]+(?:_[A-Z0-9]+)*$/;

/** A token inside a text: the name as a whole word (`gs://YOUR_BUCKET/x` holds YOUR_BUCKET; `YOUR_Xs` holds none). */
const TOKEN_SOURCE = String.raw`\bYOUR_[A-Z0-9]+(?:_[A-Z0-9]+)*\b`;

/** A Google Cloud project id: 6 to 30 lowercase letters, digits or hyphens, from a letter to a letter or digit. */
const PROJECT_ID = '[a-z][a-z0-9-]{4,28}[a-z0-9]';
/** A project, folder or organisation number. */
const NUMBER = '[1-9][0-9]{0,18}';
/** A lower-case DNS host name with at least two labels. */
const HOST = String.raw`[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+`;

const PROJECT_ID_HINT =
  '6 to 30 lowercase letters, digits or hyphens, starting with a letter and not ending with a hyphen';
const NUMBER_HINT = 'digits only';
const HOST_HINT = 'a host name such as gcportrait.example.com, without https:// or a path';

/** The registry, in the order a page about running gcportrait meets them. Examples are synthetic (AGENTS.md, Data and graph semantics). */
export const COMMAND_VARIABLES = [
  {
    name: 'YOUR_PROJECT',
    label: 'gcportrait’s project',
    description: 'The id of the project gcportrait runs in: deploy.sh’s --project.',
    example: 'demo-gcportrait',
    pattern: `^${PROJECT_ID}$`,
    hint: PROJECT_ID_HINT,
    secret: false,
  },
  {
    name: 'YOUR_PROJECT_NUMBER',
    label: 'Project number',
    description: 'The number of gcportrait’s project, on its dashboard in the console.',
    example: '10000000001',
    pattern: `^${NUMBER}$`,
    hint: NUMBER_HINT,
    secret: false,
  },
  {
    name: 'YOUR_REGION',
    label: 'Region',
    description: 'The region gcportrait runs in: deploy.sh’s --region.',
    example: 'europe-west3',
    pattern: '^[a-z]+(?:-[a-z]+)*[0-9]+$',
    hint: 'a region name in lowercase, such as europe-west3 or us-central1',
    secret: false,
  },
  {
    name: 'YOUR_SERVICE',
    label: 'Service name',
    description: 'The name of gcportrait’s Cloud Run service: deploy.sh’s --service.',
    example: 'gcportrait',
    pattern: '^[a-z](?:[a-z0-9-]{0,20}[a-z0-9])?$',
    hint: 'at most 22 lowercase letters, digits or hyphens, starting with a letter',
    secret: false,
  },
  {
    name: 'YOUR_REVISION',
    label: 'Revision',
    description: 'A revision of that service, as gcloud run revisions list shows it.',
    example: 'gcportrait-00001-abc',
    pattern: '^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$',
    hint: 'lowercase letters, digits and hyphens, starting with a letter',
    secret: false,
  },
  {
    name: 'YOUR_INSTANCE',
    label: 'Instance address',
    description: 'The host your instance answers on: its Cloud Run address or your domain.',
    example: 'gcportrait-10000000001.europe-west3.run.app',
    pattern: `^${HOST}(?::[0-9]{1,5})?$`,
    hint: HOST_HINT,
    secret: false,
  },
  {
    name: 'YOUR_DOMAIN',
    label: 'Your domain',
    description: 'A host name of yours to serve gcportrait at: deploy.sh’s --domain.',
    example: 'gcportrait.example.com',
    pattern: `^${HOST}$`,
    hint: HOST_HINT,
    secret: false,
  },
  {
    name: 'YOUR_OAUTH_CLIENT_ID',
    label: 'OAuth client id',
    description: 'The client id of your OAuth client for gcportrait (never its secret).',
    example: '10000000001-abcdefghij0123456789.apps.googleusercontent.com',
    pattern: String.raw`^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$`,
    hint: 'digits, a hyphen, letters and digits, then .apps.googleusercontent.com',
    secret: false,
  },
  {
    name: 'YOUR_EMAIL',
    label: 'Your e-mail',
    description: 'The e-mail address of the Google account you sign in with.',
    example: 'ada@example.com',
    pattern: String.raw`^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$`,
    hint: 'an e-mail address such as ada@example.com',
    secret: false,
  },
  {
    name: 'YOUR_SA_EMAIL',
    label: 'Service account',
    description: 'The e-mail of gcportrait’s backend service account; the Permissions page shows it.',
    example: 'gcportrait-backend@demo-gcportrait.iam.gserviceaccount.com',
    pattern: String.raw`^[a-z0-9][a-z0-9-]{0,62}@[a-z0-9][a-z0-9.-]*\.gserviceaccount\.com$`,
    hint: 'a service account’s e-mail, ending in .gserviceaccount.com',
    secret: false,
  },
  {
    name: 'YOUR_ORG_ID',
    label: 'Organisation number',
    description: 'The number of the organisation to read, as gcloud organizations list shows it.',
    example: '30000000001',
    pattern: `^${NUMBER}$`,
    hint: NUMBER_HINT,
    secret: false,
  },
  {
    name: 'YOUR_FOLDER_ID',
    label: 'Folder number',
    description: 'The number of the folder to read, shown next to its name in the console.',
    example: '20000000001',
    pattern: `^${NUMBER}$`,
    hint: NUMBER_HINT,
    secret: false,
  },
  {
    name: 'YOUR_PROJECT_ID',
    label: 'Project to read',
    description: 'The id of a project to read; not necessarily the one gcportrait runs in.',
    example: 'demo-web-1',
    pattern: `^${PROJECT_ID}$`,
    hint: PROJECT_ID_HINT,
    secret: false,
  },
  {
    name: 'YOUR_SCOPE_ID',
    label: 'Scope',
    description: 'The scope to read: an organisation’s or a folder’s number, or a project’s id.',
    example: '30000000001',
    pattern: `^(?:${NUMBER}|${PROJECT_ID})$`,
    hint: 'a number (an organisation or a folder) or a project id',
    secret: false,
  },
  {
    name: 'YOUR_SCOPE_KIND',
    label: 'Scope kind',
    description: 'What the scope is: organization, folder or project.',
    example: 'organization',
    pattern: '^(?:organization|folder|project)$',
    hint: 'organization, folder or project',
    secret: false,
  },
  {
    name: 'YOUR_QUOTA_PROJECT',
    label: 'Quota project',
    description: 'The id of a project of yours that your Cloud Asset Inventory requests are charged to.',
    example: 'demo-billing-1',
    pattern: `^${PROJECT_ID}$`,
    hint: PROJECT_ID_HINT,
    secret: false,
  },
  {
    name: 'YOUR_BUCKET',
    label: 'Bucket',
    description: 'The Cloud Storage bucket an export is written to, without gs://.',
    example: 'demo-exports-1',
    pattern: '^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$',
    hint: '3 to 63 lowercase letters, digits, hyphens, underscores or dots',
    secret: false,
  },
  {
    name: 'YOUR_OPERATION_NAME',
    label: 'Export operation',
    description: 'The operation name gcloud asset export printed.',
    example: 'organizations/30000000001/operations/ExportAssets/RESOURCE/1234567890123456789',
    pattern: String.raw`^(?:organizations|folders|projects)/[a-z0-9-]+/operations/\S+$`,
    hint: 'organizations/, folders/ or projects/, the id, then /operations/ and the rest',
    secret: false,
  },
  {
    name: 'YOUR_LEGAL_DIR',
    label: 'Legal texts directory',
    description: 'The directory with your impressum.md and privacy.md, outside the checkout.',
    example: '~/gcportrait-legal',
    pattern: String.raw`^\S+$`,
    hint: 'a directory path without spaces',
    secret: false,
  },
  {
    name: 'YOUR_GITHUB_USER',
    label: 'GitHub account',
    description: 'Your GitHub user name, the owner of your fork.',
    example: 'example-user',
    pattern: '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$',
    hint: 'letters, digits and single hyphens, at most 39 characters',
    secret: false,
  },
  {
    name: 'YOUR_FORK',
    label: 'Your fork',
    description: 'The name of your fork on GitHub (gcportrait unless you renamed it).',
    example: 'gcportrait',
    pattern: '^[A-Za-z0-9._-]{1,100}$',
    hint: 'letters, digits, dots, hyphens or underscores',
    secret: false,
  },
  {
    name: 'YOUR_FIREBASE_PROJECT_ID',
    label: 'Firebase project',
    description: 'The id of the Firebase project that hosts the website’s fallback copy.',
    example: 'demo-gcportrait-site',
    pattern: `^${PROJECT_ID}$`,
    hint: PROJECT_ID_HINT,
    secret: false,
  },
  {
    name: 'YOUR_ACCESS_TOKEN',
    label: 'Access token',
    description: 'A Google OAuth access token, as gcloud auth print-access-token prints it. Never stored.',
    example: 'ya29.example-token',
    pattern: '^[A-Za-z0-9._~+/-]+=*$',
    hint: 'letters, digits and . _ ~ + / -',
    secret: true,
  },
] as const satisfies readonly CommandVariable[];

/** The name of a registered variable. */
export type CommandVariableName = (typeof COMMAND_VARIABLES)[number]['name'];

const BY_NAME: ReadonlyMap<string, CommandVariable> = new Map(
  COMMAND_VARIABLES.map((variable) => [variable.name, variable]),
);

/** The registered variable of that name, or undefined. */
export function commandVariable(name: string): CommandVariable | undefined {
  return BY_NAME.get(name);
}

/** Whether `value` has the variable's format. A check for a hint only: a value is never refused for it. */
export function isCommandVariableValue(variable: Pick<CommandVariable, 'pattern'>, value: string): boolean {
  return new RegExp(variable.pattern, 'u').test(value);
}

/** A piece of a command's text: plain text, or a token (registered or not). */
export type CommandTextPart = string | { readonly token: string };

/** `text` cut into plain text and tokens, in order; joining the parts (tokens as their names) gives `text` back. */
export function splitVariableTokens(text: string): CommandTextPart[] {
  const parts: CommandTextPart[] = [];
  let at = 0;
  for (const match of text.matchAll(new RegExp(TOKEN_SOURCE, 'g'))) {
    if (match.index > at) parts.push(text.slice(at, match.index));
    parts.push({ token: match[0] });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

/** The distinct tokens in `text`, in the order they first appear (registered or not). */
export function variableTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const part of splitVariableTokens(text)) {
    if (typeof part !== 'string' && !tokens.includes(part.token)) tokens.push(part.token);
  }
  return tokens;
}
