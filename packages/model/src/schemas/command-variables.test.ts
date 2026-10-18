// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { findNonSyntheticData } from '../testing/synthetic.js';
import {
  COMMAND_VARIABLES,
  CommandVariableSchema,
  VARIABLE_NAME_PATTERN,
  commandVariable,
  isCommandVariableValue,
  splitVariableTokens,
  variableTokens,
} from './command-variable.js';

describe('COMMAND_VARIABLES', () => {
  it.each(COMMAND_VARIABLES.map((variable) => [variable.name, variable] as const))(
    '%s matches CommandVariableSchema',
    (_, variable) => {
      expect(CommandVariableSchema.safeParse(variable).error).toBeUndefined();
    },
  );

  it('names each variable once', () => {
    const names = COMMAND_VARIABLES.map((variable) => variable.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(COMMAND_VARIABLES.map((variable) => [variable.name, variable] as const))(
    'the example of %s matches its own pattern',
    (_, variable) => {
      expect(isCommandVariableValue(variable, variable.example)).toBe(true);
    },
  );

  it('gives only synthetic examples', () => {
    const examples = COMMAND_VARIABLES.map((variable) => variable.example).join('\n');
    expect(findNonSyntheticData(examples)).toEqual([]);
  });

  it('marks the access token, and only it, as a secret', () => {
    expect(COMMAND_VARIABLES.filter((variable) => variable.secret).map((variable) => variable.name)).toEqual([
      'YOUR_ACCESS_TOKEN',
    ]);
  });

  it('holds the variables the docs and the app use', () => {
    for (const name of [
      'YOUR_PROJECT',
      'YOUR_PROJECT_ID',
      'YOUR_ORG_ID',
      'YOUR_FOLDER_ID',
      'YOUR_SCOPE_KIND',
      'YOUR_SCOPE_ID',
      'YOUR_SA_EMAIL',
      'YOUR_OAUTH_CLIENT_ID',
      'YOUR_REGION',
      'YOUR_SERVICE',
      'YOUR_PROJECT_NUMBER',
      'YOUR_DOMAIN',
      'YOUR_LEGAL_DIR',
      'YOUR_EMAIL',
    ]) {
      expect(commandVariable(name)?.name).toBe(name);
    }
  });
});

describe('CommandVariableSchema', () => {
  const valid = {
    name: 'YOUR_THING',
    label: 'Thing',
    description: 'A thing.',
    example: 'a1',
    pattern: '^[a-z][0-9]$',
    hint: 'a letter and a digit',
    secret: false,
  };

  it('accepts a complete row', () => {
    expect(CommandVariableSchema.safeParse(valid).success).toBe(true);
  });

  it('refuses a name without YOUR_, an unanchored or broken pattern, and unknown keys', () => {
    expect(CommandVariableSchema.safeParse({ ...valid, name: 'PROJECT_ID' }).success).toBe(false);
    expect(CommandVariableSchema.safeParse({ ...valid, name: 'YOUR_project' }).success).toBe(false);
    expect(CommandVariableSchema.safeParse({ ...valid, pattern: '[a-z]' }).success).toBe(false);
    expect(CommandVariableSchema.safeParse({ ...valid, pattern: '^[a-z$' }).success).toBe(false);
    expect(CommandVariableSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });
});

describe('the project id, number, region and host formats', () => {
  it.each([
    // a project id: 6 to 30 characters, lower case, starting with a letter, not ending with a hyphen
    ['YOUR_PROJECT', 'demo-web-1', true],
    ['YOUR_PROJECT', 'abc', false],
    ['YOUR_PROJECT', '1demo-web', false],
    ['YOUR_PROJECT', 'demo-web-', false],
    ['YOUR_PROJECT', 'Demo-Web-1', false],
    ['YOUR_PROJECT', 'a'.repeat(31), false],
    // numbers are digits only, without a resource prefix or a leading zero
    ['YOUR_ORG_ID', '30000000001', true],
    ['YOUR_ORG_ID', 'organizations/30000000001', false],
    ['YOUR_PROJECT_NUMBER', '0123', false],
    // a lower-case region with its number
    ['YOUR_REGION', 'us-central1', true],
    ['YOUR_REGION', 'northamerica-northeast2', true],
    ['YOUR_REGION', 'Europe-West3', false],
    ['YOUR_REGION', 'europe-west', false],
    // a host name without a scheme or a path
    ['YOUR_INSTANCE', 'localhost.example.com:8080', true],
    ['YOUR_INSTANCE', 'https://gcportrait.example.com', false],
    ['YOUR_DOMAIN', 'gcportrait.example.com/x', false],
    // a scope as a number or a project id
    ['YOUR_SCOPE_ID', '20000000001', true],
    ['YOUR_SCOPE_ID', 'demo-web-1', true],
    ['YOUR_SCOPE_ID', 'folders/1', false],
  ])('%s accepts %j: %s', (name, value, ok) => {
    const variable = commandVariable(name);
    if (variable === undefined) throw new Error(`${name} is not registered`);
    expect(isCommandVariableValue(variable, value)).toBe(ok);
  });
});

describe('tokens in a text', () => {
  it('cuts a command into text and tokens, whole words only', () => {
    const command =
      'gcloud projects add-iam-policy-binding YOUR_PROJECT_ID --member="serviceAccount:gcportrait-backend@YOUR_PROJECT.iam.gserviceaccount.com"';
    expect(splitVariableTokens(command)).toEqual([
      'gcloud projects add-iam-policy-binding ',
      { token: 'YOUR_PROJECT_ID' },
      ' --member="serviceAccount:gcportrait-backend@',
      { token: 'YOUR_PROJECT' },
      '.iam.gserviceaccount.com"',
    ]);
    expect(splitVariableTokens('gs://YOUR_PROJECT-YOUR_SERVICE-builds')).toEqual([
      'gs://',
      { token: 'YOUR_PROJECT' },
      '-',
      { token: 'YOUR_SERVICE' },
      '-builds',
    ]);
    expect(splitVariableTokens('YOUR_X')).toEqual([{ token: 'YOUR_X' }]);
    expect(splitVariableTokens('no tokens, not even MY_YOUR_X, YOUR_Xs, YOUR_X_ or YOUR_')).toEqual([
      'no tokens, not even MY_YOUR_X, YOUR_Xs, YOUR_X_ or YOUR_',
    ]);
    expect(splitVariableTokens('')).toEqual([]);
  });

  it('lists the distinct tokens in order, registered or not', () => {
    expect(variableTokens('YOUR_B YOUR_A YOUR_B OAUTH_CLIENT_ID')).toEqual(['YOUR_B', 'YOUR_A']);
  });

  it('knows a variable name when it sees one', () => {
    expect(VARIABLE_NAME_PATTERN.test('YOUR_PROJECT_NUMBER')).toBe(true);
    expect(VARIABLE_NAME_PATTERN.test('YOUR__X')).toBe(false);
    expect(commandVariable('YOUR_NOTHING')).toBeUndefined();
  });
});
