// SPDX-License-Identifier: MIT
/**
 * Placeholders in texts that the maintainer fills in (docs/author.md): a word or phrase in capitals in
 * square brackets ("[FULL NAME]", "[STREET AND NUMBER]"), in double braces ("{{EMAIL}}") or in angle brackets
 * ("<POSTCODE>"), and the markers TODO, TBD and PLACEHOLDER. A strict build (WEBSITE_STRICT=1, the deploy
 * workflows) refuses to publish a text that still holds one.
 */

const PATTERNS: readonly RegExp[] = [
  /\[[A-Z0-9][A-Z0-9 _.,'’/&@+()-]{1,}[A-Z0-9)]\]/g,
  /\{\{[^}]*\}\}/g,
  /<[A-Z][A-Z0-9 _-]{2,}>/g,
  /\b(?:TODO|TBD|PLACEHOLDER)\b/g,
];

/** The placeholders a text holds, in order of appearance, each once. */
export function placeholdersIn(text: string): string[] {
  // Inline code and fenced code are examples, not placeholders.
  const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const found: { index: number; value: string }[] = [];
  for (const pattern of PATTERNS) {
    for (const match of prose.matchAll(pattern)) found.push({ index: match.index, value: match[0] });
  }
  return [...new Set(found.sort((a, b) => a.index - b.index).map((item) => item.value))];
}
