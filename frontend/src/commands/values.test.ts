// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * Fillable commands without React: the value each variable shows, the text Copy copies, the notes, the facts the
 * app knows, what the session keeps; and that every command the app shows names only registered variables.
 */
import { commandVariable, variableTokens } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import { copyCommand, DESCRIBE_COMMAND, exportCommand } from '../import/commands';
import { EMAIL_PLACEHOLDER } from '../preflight/copy';
import { referenceRows } from '../preflight/PermissionsGuide';
import { BLOCKED_ANSWER } from '../preflight/testing';
import { SCOPE_KINDS } from '../scope/scopeName';
import {
  commandFacts,
  copiedMessage,
  effectiveValue,
  effectiveValues,
  fieldValue,
  matchesFormat,
  readStoredEntries,
  resolveCommand,
  storedEntriesText,
  unfilledNote,
} from './values';

describe('resolveCommand', () => {
  const command =
    'gcloud asset export --folder=YOUR_FOLDER_ID --output-path=gs://YOUR_BUCKET/export.json && echo YOUR_BUCKET';

  it('fills each registered token with its value, and leaves an unfilled one as its token', () => {
    expect(resolveCommand(command, { YOUR_FOLDER_ID: '20000000001', YOUR_BUCKET: 'demo-exports-1' })).toEqual(
      {
        text: 'gcloud asset export --folder=20000000001 --output-path=gs://demo-exports-1/export.json && echo demo-exports-1',
        unfilled: [],
      },
    );
    expect(resolveCommand(command, { YOUR_FOLDER_ID: ' 20000000001 ', YOUR_BUCKET: '  ' })).toEqual({
      text: 'gcloud asset export --folder=20000000001 --output-path=gs://YOUR_BUCKET/export.json && echo YOUR_BUCKET',
      unfilled: ['YOUR_BUCKET'],
    });
    expect(resolveCommand(command, {}).unfilled).toEqual(['YOUR_FOLDER_ID', 'YOUR_BUCKET']);
  });

  it('copies text, an unregistered token and a command without tokens as they are', () => {
    expect(resolveCommand('echo YOUR_NOTHING OAUTH_CLIENT_ID', { YOUR_NOTHING: 'x' })).toEqual({
      text: 'echo YOUR_NOTHING OAUTH_CLIENT_ID',
      unfilled: [],
    });
    const plain = BLOCKED_ANSWER.candidates[0]?.commands[0] ?? '';
    expect(resolveCommand(plain, { YOUR_EMAIL: 'ada@example.com' })).toEqual({ text: plain, unfilled: [] });
  });
});

describe('the notes and the announcement', () => {
  it('says how many values are still to fill', () => {
    expect(unfilledNote(0)).toBe('');
    expect(unfilledNote(1)).toBe('1 value to fill');
    expect(unfilledNote(3)).toBe('3 values to fill');
  });

  it('says "Copied." and which tokens were copied unfilled', () => {
    expect(copiedMessage([])).toBe('Copied.');
    expect(copiedMessage(['YOUR_BUCKET'])).toBe('Copied, with 1 value still to fill: YOUR_BUCKET.');
    expect(copiedMessage(['YOUR_ORG_ID', 'YOUR_EMAIL'])).toBe(
      'Copied, with 2 values still to fill: YOUR_ORG_ID, YOUR_EMAIL.',
    );
  });
});

describe('the value a variable shows', () => {
  it('is what was typed over the fact known now, else that fact, else what was typed, else nothing', () => {
    const typed = { value: '20000000002', basis: '20000000001' };
    expect(effectiveValue(typed, '20000000001')).toBe('20000000002');
    // Another scope picked: what the app knows now shows again.
    expect(effectiveValue(typed, '20000000003')).toBe('20000000003');
    // Signed out, or after a reload: what was typed stays.
    expect(effectiveValue(typed, undefined)).toBe('20000000002');
    expect(effectiveValue({ value: '', basis: '20000000001' }, '20000000001')).toBe('');
    expect(effectiveValue(undefined, 'demo-web-1')).toBe('demo-web-1');
    expect(effectiveValue(undefined, undefined)).toBe('');
    expect(
      effectiveValues(
        { YOUR_BUCKET: { value: 'demo-exports-1', basis: '' } },
        { YOUR_FOLDER_ID: '20000000001' },
      ),
    ).toEqual({ YOUR_BUCKET: 'demo-exports-1', YOUR_FOLDER_ID: '20000000001' });
  });

  it('takes one line from a paste, and checks the format without refusing anything', () => {
    expect(fieldValue('demo-\r\nexports-1\t')).toBe('demo-exports-1');
    expect(matchesFormat('YOUR_FOLDER_ID', '20000000001')).toBe(true);
    expect(matchesFormat('YOUR_FOLDER_ID', 'folders/20000000001')).toBe(false);
    expect(matchesFormat('YOUR_FOLDER_ID', '')).toBe(true);
    expect(matchesFormat('YOUR_PROJECT_ID', ' demo-web-1 ')).toBe(true);
    expect(matchesFormat('YOUR_NOTHING', '!')).toBe(true);
  });
});

describe('the facts the app knows', () => {
  it('names the scope under its kind’s variable, and the quota project, the account and the service account', () => {
    expect(
      commandFacts({
        scope: { kind: 'folder', id: '20000000001' },
        quotaProject: 'demo-quota-1',
        email: 'ada@example.com',
        serviceAccount: 'gcportrait-backend@demo-host.iam.gserviceaccount.com',
      }),
    ).toEqual({
      YOUR_FOLDER_ID: '20000000001',
      YOUR_SCOPE_ID: '20000000001',
      YOUR_SCOPE_KIND: 'folder',
      YOUR_QUOTA_PROJECT: 'demo-quota-1',
      YOUR_EMAIL: 'ada@example.com',
      YOUR_SA_EMAIL: 'gcportrait-backend@demo-host.iam.gserviceaccount.com',
    });
    // A project scope is its own quota project until another is picked.
    expect(
      commandFacts({
        scope: { kind: 'project', id: 'demo-web-1' },
        quotaProject: null,
        email: null,
        serviceAccount: null,
      }),
    ).toEqual({
      YOUR_PROJECT_ID: 'demo-web-1',
      YOUR_SCOPE_ID: 'demo-web-1',
      YOUR_SCOPE_KIND: 'project',
      YOUR_QUOTA_PROJECT: 'demo-web-1',
    });
  });

  it('knows nothing signed out or in demo mode, and never an email that could carry shell syntax', () => {
    expect(commandFacts({ scope: null, quotaProject: null, email: null, serviceAccount: null })).toEqual({});
    expect(
      commandFacts({
        scope: null,
        quotaProject: null,
        email: '"$(id)"@example.com',
        serviceAccount: 'a b@c.d',
      }),
    ).toEqual({});
  });
});

describe('what the session keeps', () => {
  it('keeps the entries of registered variables that are not secret, and reads back only well-formed ones', () => {
    const text = storedEntriesText({
      YOUR_BUCKET: { value: 'demo-exports-1', basis: '' },
      YOUR_ACCESS_TOKEN: { value: 'ya29.example-token', basis: '' },
      YOUR_NOTHING: { value: 'x', basis: '' },
    });
    expect(text).toBe('{"YOUR_BUCKET":{"value":"demo-exports-1","basis":""}}');
    expect(readStoredEntries(text)).toEqual({ YOUR_BUCKET: { value: 'demo-exports-1', basis: '' } });
    expect(storedEntriesText({ YOUR_ACCESS_TOKEN: { value: 'ya29.example-token', basis: '' } })).toBeNull();
  });

  it('drops a secret, an unknown name, a malformed entry and an overlong value it finds', () => {
    expect(
      readStoredEntries(
        JSON.stringify({
          YOUR_ACCESS_TOKEN: { value: 'ya29.example-token', basis: '' },
          YOUR_NOTHING: { value: 'x', basis: '' },
          your_bucket: { value: 'x', basis: '' },
          YOUR_REGION: 'europe-west3',
          YOUR_SERVICE: { value: 1, basis: '' },
          YOUR_DOMAIN: { value: 'x'.repeat(501), basis: '' },
          YOUR_ORG_ID: { value: '30000000001', basis: '' },
        }),
      ),
    ).toEqual({ YOUR_ORG_ID: { value: '30000000001', basis: '' } });
    for (const raw of [null, '', 'not json', '[]', '"x"', 'null']) expect(readStoredEntries(raw)).toEqual({});
  });
});

/** Every command text the app shows, for every kind of scope (and none). */
function appCommands(): string[] {
  const scopes = [null, ...SCOPE_KINDS.map((kind) => ({ kind }))];
  return [
    ...scopes.flatMap((scope) =>
      referenceRows({ scope, serviceAccount: 'gcportrait-backend@example.com' }).flatMap(
        (row) => row.commands,
      ),
    ),
    ...scopes.map((scope) => exportCommand(scope)),
    DESCRIBE_COMMAND,
    copyCommand(),
    // The backend's own placeholder in the check's commands (backend/src/preflight/commands.ts).
    `gcloud projects add-iam-policy-binding demo-app-1 --member="user:${EMAIL_PLACEHOLDER}" --role="roles/browser"`,
  ];
}

describe('the app’s commands', () => {
  it('name only variables of the registry (COMMAND_VARIABLES)', () => {
    const tokens = [...new Set(appCommands().flatMap((command) => variableTokens(command)))];
    expect(tokens.filter((name) => commandVariable(name) === undefined)).toEqual([]);
    expect(tokens.sort()).toEqual([
      'YOUR_BUCKET',
      'YOUR_EMAIL',
      'YOUR_FOLDER_ID',
      'YOUR_OPERATION_NAME',
      'YOUR_ORG_ID',
      'YOUR_PROJECT_ID',
      'YOUR_QUOTA_PROJECT',
      'YOUR_SA_EMAIL',
    ]);
  });

  it('have no placeholder outside the registry’s convention (no ORG_ID, BUCKET or the like)', () => {
    for (const command of appCommands()) {
      const rest = command.replace(/\bYOUR_[A-Z0-9]+(?:_[A-Z0-9]+)*\b/g, '');
      expect(rest, command).not.toMatch(/\b[A-Z][A-Z0-9_]{2,}\b/);
    }
  });
});
