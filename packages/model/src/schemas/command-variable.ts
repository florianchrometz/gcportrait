// SPDX-License-Identifier: MIT
/**
 * One variable of a copy-ready command: a value the reader fills in where the documentation or the app shows
 * a command (`gcloud projects add-iam-policy-binding YOUR_PROJECT_ID …`). The registry itself is data in a
 * module that imports no zod (command-variables.ts), so the website's build, the app's UI thread and the
 * repository's tooling read it without the schema library; this module declares its row schema and re-exports
 * it, and command-variables.test.ts checks every row against the schema.
 */
import * as z from 'zod';

import { VARIABLE_NAME_PATTERN } from './command-variables.js';

/** Whether `source` compiles as a JavaScript regular expression anchored at both ends. */
function isAnchoredPattern(source: string): boolean {
  if (!source.startsWith('^') || !source.endsWith('$')) return false;
  try {
    new RegExp(source, 'u');
    return true;
  } catch {
    return false;
  }
}

export const CommandVariableSchema = z.strictObject({
  /** The token as the texts write it: `YOUR_` and capitals, digits and underscores (`YOUR_PROJECT_ID`). */
  name: z.string().regex(VARIABLE_NAME_PATTERN, 'must be YOUR_ followed by capitals, digits and underscores'),
  /** A short label for the field ("Project to read"). */
  label: z.string().min(1).max(40),
  /** One or two sentences: what the value is and where to find it. */
  description: z.string().min(1),
  /** A synthetic example that matches `pattern` (no real organisation data). */
  example: z.string().min(1),
  /** The value's format as a JavaScript regular expression source, anchored with `^` and `$`. */
  pattern: z.string().refine(isAnchoredPattern, 'must be a regular expression anchored with ^ and $'),
  /** The format in words, for the hint shown when a value does not match `pattern` ("digits only"). */
  hint: z.string().min(1),
  /** A secret is never stored: not in the browser, not in a log, not in a URL. */
  secret: z.boolean(),
});

export type CommandVariable = z.infer<typeof CommandVariableSchema>;

export {
  COMMAND_VARIABLES,
  VARIABLE_NAME_PATTERN,
  commandVariable,
  isCommandVariableValue,
  splitVariableTokens,
  variableTokens,
  type CommandTextPart,
} from './command-variables.js';
