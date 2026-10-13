// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { parseConfig } from './config.js';
import {
  LegalTextError,
  legalTextOf,
  MAX_LEGAL_TEXT_BYTES,
  parseLegalBundle,
  readLegalDir,
} from './legal.js';
import { configRefusal, thrownMessage } from './server.testing.js';

/** Synthetic texts only (agents.md, Security and privacy, principle 6): no real person, no real address. */
const IMPRESSUM =
  '# Impressum\n\nExample Operator\nExample Street 1\n12345 Example City\n\nmail@example.com\n';
const PRIVACY = '# Privacy\n\nThis instance stores nothing about you.\n';

const scratch = mkdtempSync(path.join(tmpdir(), 'gcportrait-legal-test-'));
let dirs = 0;
function legalDir(files: Record<string, string | Uint8Array>): string {
  dirs += 1;
  const dir = path.join(scratch, `legal-${String(dirs)}`);
  mkdirSync(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content);
  return dir;
}

const base64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64');

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** The message with which a legal text is refused. */
const legalRefusal = (run: () => unknown): string => thrownMessage(run, LegalTextError);

describe('legalTextOf', () => {
  const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

  it('keeps UTF-8 text, drops a byte order mark and turns CRLF and CR into LF', () => {
    expect(legalTextOf(bytes('﻿# Straße\r\n\r\nÄrger?\rNein.'), 'x')).toBe('# Straße\n\nÄrger?\nNein.');
  });

  it('refuses invalid UTF-8, control characters, blank texts and oversized ones, naming the source only', () => {
    expect(
      legalRefusal(() => legalTextOf(new Uint8Array([0x23, 0x20, 0xff, 0xfe]), 'LEGAL_DIR/privacy.md')),
    ).toBe('LEGAL_DIR/privacy.md is not valid UTF-8');
    expect(legalRefusal(() => legalTextOf(bytes('a\u0000b secret'), 'here'))).toBe(
      'here contains control characters',
    );
    expect(legalRefusal(() => legalTextOf(bytes('ring \u0007 secret'), 'here'))).toBe(
      'here contains control characters',
    );
    expect(legalRefusal(() => legalTextOf(bytes(' \n\t\n'), 'here'))).toBe('here is empty');
    expect(legalRefusal(() => legalTextOf(bytes('x'.repeat(MAX_LEGAL_TEXT_BYTES + 1)), 'here'))).toBe(
      'here is larger than 64 KiB',
    );
    expect(legalTextOf(bytes('tab\there\nline'), 'here'), 'tabs and line feeds are fine').toBe(
      'tab\there\nline',
    );
  });
});

describe('LEGAL_DIR', () => {
  it('reads impressum.md and privacy.md, either one alone, and ignores other files', () => {
    expect(readLegalDir(legalDir({ 'impressum.md': IMPRESSUM, 'privacy.md': PRIVACY }))).toEqual({
      impressum: IMPRESSUM,
      privacy: PRIVACY,
    });
    expect(readLegalDir(legalDir({ 'privacy.md': PRIVACY, 'notes.txt': 'not served' }))).toEqual({
      impressum: null,
      privacy: PRIVACY,
    });
  });

  it('refuses a missing directory, one without either text, and an unusable text', () => {
    expect(legalRefusal(() => readLegalDir(path.join(scratch, 'nowhere')))).toBe(
      'LEGAL_DIR is not a directory',
    );
    expect(legalRefusal(() => readLegalDir(legalDir({ 'Impressum.txt': IMPRESSUM })))).toBe(
      'LEGAL_DIR holds neither impressum.md nor privacy.md',
    );
    expect(legalRefusal(() => readLegalDir(legalDir({ 'impressum.md': new Uint8Array([0xc3, 0x28]) })))).toBe(
      'LEGAL_DIR/impressum.md is not valid UTF-8',
    );
  });

  it('is read by parseConfig relative to the working directory', () => {
    const dir = legalDir({ 'impressum.md': IMPRESSUM });
    const config = parseConfig({ LEGAL_DIR: path.basename(dir) }, path.dirname(dir));
    expect(config.legal).toEqual({ impressum: IMPRESSUM, privacy: null });
  });
});

describe('LEGAL_BUNDLE', () => {
  it('decodes the base64 of each page', () => {
    expect(
      parseLegalBundle(JSON.stringify({ impressum: base64(IMPRESSUM), privacy: base64(PRIVACY) })),
    ).toEqual({
      impressum: IMPRESSUM,
      privacy: PRIVACY,
    });
    expect(parseLegalBundle(JSON.stringify({ privacy: base64(PRIVACY) }))).toEqual({
      impressum: null,
      privacy: PRIVACY,
    });
  });

  it('refuses anything but an object of base64 strings for the two pages, without echoing it', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['secret-not-json', 'LEGAL_BUNDLE is not JSON'],
      ['["secret"]', 'LEGAL_BUNDLE must be a JSON object with "impressum" and/or "privacy"'],
      ['{}', 'LEGAL_BUNDLE holds neither "impressum" nor "privacy"'],
      [
        JSON.stringify({ terms: base64('secret') }),
        'LEGAL_BUNDLE has keys other than "impressum" and "privacy" (1 of them)',
      ],
      [
        JSON.stringify({ impressum: '# secret plain text' }),
        'LEGAL_BUNDLE.impressum must be a base64 string',
      ],
      [JSON.stringify({ privacy: 12 }), 'LEGAL_BUNDLE.privacy must be a base64 string'],
      [
        JSON.stringify({ privacy: base64('\u0000secret') }),
        'LEGAL_BUNDLE.privacy contains control characters',
      ],
    ];
    for (const [value, message] of cases) {
      const text = configRefusal({ LEGAL_BUNDLE: value });
      expect(text, value).toBe(`Invalid backend configuration:\n  ${message}`);
      expect(text).not.toContain('secret');
    }
  });

  it('cannot be combined with LEGAL_DIR', () => {
    const dir = legalDir({ 'impressum.md': IMPRESSUM });
    expect(configRefusal({ LEGAL_DIR: dir, LEGAL_BUNDLE: '{}' })).toBe(
      'Invalid backend configuration:\n  LEGAL_DIR, LEGAL_BUNDLE: set one of them, not both',
    );
  });
});

describe('LEGAL_IMPRESSUM_URL and LEGAL_PRIVACY_URL (legal pages linked, not served)', () => {
  const IMPRESSUM_URL = 'https://operator.example.com/legal/impressum';
  const PRIVACY_URL = 'https://operator.example.com/legal/privacy';

  it('are null when unset or blank, and read as given (trimmed) otherwise', () => {
    expect(parseConfig({}).legalUrls).toEqual({ impressum: null, privacy: null });
    expect(parseConfig({ LEGAL_IMPRESSUM_URL: ' ', LEGAL_PRIVACY_URL: '' }).legalUrls).toEqual({
      impressum: null,
      privacy: null,
    });
    const config = parseConfig({ LEGAL_IMPRESSUM_URL: ` ${IMPRESSUM_URL} `, LEGAL_PRIVACY_URL: PRIVACY_URL });
    expect(config.legalUrls).toEqual({ impressum: IMPRESSUM_URL, privacy: PRIVACY_URL });
    expect(Object.isFrozen(config.legalUrls)).toBe(true);
    expect(config.legal).toEqual({ impressum: null, privacy: null });
    // A demo-only instance links its pages the same way.
    expect(parseConfig({ DEMO_ONLY: 'true', LEGAL_PRIVACY_URL: PRIVACY_URL }).legalUrls.privacy).toBe(
      PRIVACY_URL,
    );
  });

  it('accept only an https URL without a user name or password, naming the variable and never the value', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['http://operator.example.com/secret', 'must be an https:// URL'],
      ['javascript:alert("secret")', 'must be an https:// URL'],
      ['ftp://operator.example.com/secret', 'must be an https:// URL'],
      ['/legal/secret', 'must be an https:// URL'],
      ['operator.example.com/secret', 'must be an https:// URL'],
      ['https://user:secret@operator.example.com/impressum', 'must not hold a user name or password'],
      [`https://operator.example.com/${'secret'.repeat(400)}`, 'must be at most 2048 characters'],
    ];
    for (const name of ['LEGAL_IMPRESSUM_URL', 'LEGAL_PRIVACY_URL']) {
      for (const [value, message] of cases) {
        const text = configRefusal({ [name]: value });
        expect(text, `${name}=${value}`).toBe(`Invalid backend configuration:\n  ${name}: ${message}`);
        expect(text).not.toContain('secret');
      }
    }
  });

  it('refuse a page that is also served from a text (LEGAL_DIR or LEGAL_BUNDLE): start-up stops', () => {
    const both = legalDir({ 'impressum.md': IMPRESSUM, 'privacy.md': PRIVACY });
    expect(
      configRefusal({ LEGAL_DIR: both, LEGAL_IMPRESSUM_URL: IMPRESSUM_URL, LEGAL_PRIVACY_URL: PRIVACY_URL }),
    ).toBe(
      'Invalid backend configuration:\n' +
        '  LEGAL_IMPRESSUM_URL: must be unset while LEGAL_DIR holds an Impressum (serve the text or link the page, not both)\n' +
        '  LEGAL_PRIVACY_URL: must be unset while LEGAL_DIR holds a privacy notice (serve the text or link the page, not both)',
    );
    expect(
      configRefusal({
        LEGAL_BUNDLE: JSON.stringify({ privacy: base64(PRIVACY) }),
        LEGAL_PRIVACY_URL: PRIVACY_URL,
      }),
    ).toBe(
      'Invalid backend configuration:\n' +
        '  LEGAL_PRIVACY_URL: must be unset while LEGAL_BUNDLE holds a privacy notice (serve the text or link the page, not both)',
    );
  });

  it('may link one page while a text serves the other', () => {
    const config = parseConfig({
      LEGAL_DIR: legalDir({ 'impressum.md': IMPRESSUM }),
      LEGAL_PRIVACY_URL: PRIVACY_URL,
    });
    expect(config.legal).toEqual({ impressum: IMPRESSUM, privacy: null });
    expect(config.legalUrls).toEqual({ impressum: null, privacy: PRIVACY_URL });
  });
});
