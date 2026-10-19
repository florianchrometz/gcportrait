// SPDX-License-Identifier: Apache-2.0
/**
 * The export's file name (skill gcp-diagram-style §8): `gcportrait_<scope>_<lens>_<readTime>.<ext>`. Every part
 * is reduced to characters that are safe in a file name on every desktop system (no `:` from the read time,
 * no `/` or spaces from a scope name), so the name a browser saves is the name the skill gives.
 */
import { WORDMARK } from '../branding';

export type ExportExtension = 'svg' | 'png' | 'drawio';

/** The longest a scope or lens part may be, so the whole name stays well below every file-system limit. */
const PART_LIMIT = 64;

/** A name part: letters, digits, `.` and `-` only; anything else becomes `-`, runs collapse, ends are trimmed. */
export function fileNamePart(value: string, fallback: string): string {
  const cleaned = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, PART_LIMIT)
    .replace(/[-.]+$/g, '');
  return cleaned === '' ? fallback : cleaned;
}

/**
 * The read time in ISO-8601 basic format at UTC, to the second: `2026-10-08T00:00:00Z` → `20261008T000000Z`.
 * Basic format has no `:`, which Windows does not allow in a file name. A value that is not a timestamp is kept
 * as a cleaned name part.
 */
export function readTimePart(readTime: string): string {
  const instant = Date.parse(readTime);
  if (Number.isNaN(instant)) return fileNamePart(readTime, 'undated');
  return new Date(instant)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
}

export interface FileNameParts {
  /** The scope on the canvas (organisation, folder or project display name, or the drill-in root). */
  readonly scope: string;
  readonly lens: string;
  readonly readTime: string;
}

/** `gcportrait_example.com_overview_20261008T000000Z.svg`. */
export function exportFileName(parts: FileNameParts, extension: ExportExtension): string {
  return (
    [
      WORDMARK,
      fileNamePart(parts.scope, 'scope'),
      fileNamePart(parts.lens, 'lens'),
      readTimePart(parts.readTime),
    ].join('_') + `.${extension}`
  );
}
