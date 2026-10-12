// SPDX-License-Identifier: MIT
/** The asynchronous entry points: read sources into a Snapshot, or just into lines. */
import { IngestError, type IngestProblem } from './errors.js';
import { LineSplitter, type LineProblemCode } from './lines.js';
import {
  createIngestSession,
  DEFAULT_MAX_LINE_BYTES,
  type IngestOptions,
  type IngestResult,
} from './session.js';
import { chunksOf, sourcesOf, type IngestInput } from './sources.js';

/**
 * Reads every source of the input, in order, as separate parts, and returns the Snapshot and the report.
 * Rejects with an {@link IngestError} for invalid options or sources, an upstream `error` frame, or (with
 * `strict`) the first malformed line; malformed lines are otherwise counted and skipped.
 */
export async function ingest(input: IngestInput, options: IngestOptions): Promise<IngestResult> {
  const session = createIngestSession(options);
  for (const source of sourcesOf(input)) {
    for await (const chunk of chunksOf(source)) session.push(chunk);
    session.endPart();
  }
  return session.finish();
}

/** One line from {@link readLines}. */
export interface TextLine {
  /** Index of the input part (file), from 0. */
  readonly part: number;
  /** Line number within the part, from 1, counting blank lines. */
  readonly line: number;
  /** The line without its line break, carriage return or byte-order mark. */
  readonly text: string;
}

/** Options of {@link readLines}. */
export interface ReadLinesOptions {
  /** The longest line read, in bytes (for text input: UTF-16 code units). Default 64 MiB. */
  readonly maxLineBytes?: number;
  /**
   * Receives lines that are too long or not UTF-8; reading goes on. Without it, such a line rejects with an
   * {@link IngestError} (`malformed`).
   */
  readonly onProblem?: (problem: IngestProblem) => void;
}

/**
 * The streaming line reader on its own: yields every non-blank line of every source, decoded, in order.
 * Chunk boundaries may fall anywhere; LF and CRLF both end a line; a byte-order mark at the start of a line
 * is dropped; each source's last line counts even without a final newline.
 */
export async function* readLines(
  input: IngestInput,
  options: ReadLinesOptions = {},
): AsyncGenerator<TextLine> {
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes < 1) {
    throw new IngestError('invalid-options', 'maxLineBytes: must be a positive integer.');
  }
  const queue: (TextLine | IngestProblem)[] = [];
  const splitter = new LineSplitter(
    {
      line: (text, part, line) => {
        if (text.trim().length > 0) queue.push({ part, line, text });
      },
      problem: (code: LineProblemCode, part, line, message) => {
        queue.push({ code, part, line, message });
      },
    },
    maxLineBytes,
  );
  const drain = function* (): Generator<TextLine> {
    for (const entry of queue.splice(0)) {
      if ('text' in entry) {
        yield entry;
      } else if (options.onProblem) {
        options.onProblem(entry);
      } else {
        throw new IngestError(
          'malformed',
          `Malformed input at part ${String(entry.part)}, line ${String(entry.line)}: ${entry.message}`,
          { problem: entry },
        );
      }
    }
  };
  for (const source of sourcesOf(input)) {
    for await (const chunk of chunksOf(source)) {
      splitter.push(chunk);
      yield* drain();
    }
    splitter.endPart();
    yield* drain();
  }
}
