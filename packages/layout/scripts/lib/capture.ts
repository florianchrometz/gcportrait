// SPDX-License-Identifier: MIT
/**
 * Test helper for the package's commands (scripts/measure.test.ts, scripts/bench.test.ts): runs a command's
 * `run(argv, write)` with its output collected instead of written to standard output.
 */

/** A command's entry point: the arguments and where its output goes; resolves to the exit code. */
export type CommandRun = (argv: readonly string[], write: (text: string) => void) => number | Promise<number>;

export interface Captured {
  readonly code: number;
  readonly text: string;
}

export async function capture(run: CommandRun, argv: readonly string[]): Promise<Captured> {
  let text = '';
  const code = await run(argv, (chunk) => {
    text += chunk;
  });
  return { code, text };
}
