// SPDX-License-Identifier: Apache-2.0
/**
 * The `pnpm render` entry point (run through tsx with the frontend's tsconfig, so the frontend's components
 * compile with its JSX settings). See run.ts and the package README.
 */
import { run } from './run.js';

process.exitCode = await run(process.argv.slice(2), {
  stdout: (chunk) => process.stdout.write(chunk),
  stderr: (text) => process.stderr.write(text),
  cwd: process.env.INIT_CWD ?? process.cwd(),
});
