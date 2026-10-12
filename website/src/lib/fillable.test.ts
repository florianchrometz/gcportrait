// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  copiedMessage,
  fieldValue,
  matchesPattern,
  readStoredValues,
  resolveBlock,
  storedValuesText,
  unfilledNote,
} from './fillable.js';
import { startFillable } from './fillable-page.js';

describe('a code block’s text and note', () => {
  const parts = [
    'gcloud projects add-iam-policy-binding ',
    { name: 'YOUR_PROJECT_ID' },
    ' --member="serviceAccount:gcportrait-backend@',
    { name: 'YOUR_PROJECT' },
    '.iam.gserviceaccount.com"\n# again: ',
    { name: 'YOUR_PROJECT_ID' },
  ];

  it('fills in the values and keeps an unfilled variable as its token', () => {
    expect(resolveBlock(parts, { YOUR_PROJECT: ' demo-tools-1 ' })).toEqual({
      text: 'gcloud projects add-iam-policy-binding YOUR_PROJECT_ID --member="serviceAccount:gcportrait-backend@demo-tools-1.iam.gserviceaccount.com"\n# again: YOUR_PROJECT_ID',
      unfilled: ['YOUR_PROJECT_ID'],
    });
    expect(
      resolveBlock(parts, { YOUR_PROJECT: 'demo-tools-1', YOUR_PROJECT_ID: 'demo-web-1' }).unfilled,
    ).toEqual([]);
    expect(resolveBlock(['plain'], {})).toEqual({ text: 'plain', unfilled: [] });
  });

  it('says how many values are still to fill, and what a copy left unfilled', () => {
    expect(unfilledNote(0)).toBe('');
    expect(unfilledNote(1)).toBe('1 value to fill');
    expect(unfilledNote(3)).toBe('3 values to fill');
    expect(copiedMessage([])).toBe('Copied.');
    expect(copiedMessage(['YOUR_REGION'])).toBe('Copied, with 1 value still to fill: YOUR_REGION.');
    expect(copiedMessage(['YOUR_REGION', 'YOUR_SERVICE'])).toBe(
      'Copied, with 2 values still to fill: YOUR_REGION, YOUR_SERVICE.',
    );
  });
});

describe('a field’s value', () => {
  it('keeps one line', () => {
    expect(fieldValue('demo-\r\nweb-1\t')).toBe('demo-web-1');
  });

  it('checks the format, but never refuses: an empty value or a broken pattern passes', () => {
    expect(matchesPattern('^[a-z]+[0-9]$', 'europe3')).toBe(true);
    expect(matchesPattern('^[a-z]+[0-9]$', 'Europe 3')).toBe(false);
    expect(matchesPattern('^[a-z]+[0-9]$', '')).toBe(true);
    expect(matchesPattern('^[a-z$', 'x')).toBe(true);
  });
});

describe('the values kept in the browser', () => {
  it('reads only well-formed entries the page accepts, and survives anything else', () => {
    const raw = JSON.stringify({
      YOUR_PROJECT: 'demo-tools-1',
      YOUR_REGION: '',
      YOUR_ACCESS_TOKEN: 'ya29.example-token',
      lowercase: 'x',
      YOUR_ORG_ID: 30000000001,
      YOUR_BUCKET: 'x'.repeat(501),
    });
    expect(readStoredValues(raw, (name) => name !== 'YOUR_ACCESS_TOKEN')).toEqual({
      YOUR_PROJECT: 'demo-tools-1',
    });
    expect(readStoredValues(null)).toEqual({});
    expect(readStoredValues('not json')).toEqual({});
    expect(readStoredValues('["YOUR_PROJECT"]')).toEqual({});
    expect(readStoredValues('null')).toEqual({});
  });

  it('keeps the non-empty values of variables that are not secret, and nothing when none remains', () => {
    const secret = (name: string): boolean => name === 'YOUR_ACCESS_TOKEN';
    expect(
      storedValuesText(
        {
          YOUR_PROJECT: ' demo-tools-1 ',
          YOUR_REGION: '',
          YOUR_ACCESS_TOKEN: 'ya29.example-token',
          bad: 'x',
        },
        secret,
      ),
    ).toBe('{"YOUR_PROJECT":"demo-tools-1"}');
    expect(storedValuesText({ YOUR_ACCESS_TOKEN: 'ya29.example-token' }, secret)).toBeNull();
    expect(storedValuesText({}, secret)).toBeNull();
  });
});

/**
 * Where the docs pages keep the values a visitor types, as docs/legal/data-processing-inventory.md (row W2) and
 * docs/website.md ("Fillable commands") name it: the tests hold the page's script to this key, not to its constant.
 */
const KEY = 'gcportrait.docs.variables';

/** A page element as far as the page's script asks about one: never a field (`matches`), attributes ignored. */
class FakeElement {
  matches(): boolean {
    return false;
  }
  setAttribute(): undefined {
    return undefined;
  }
  removeAttribute(): undefined {
    return undefined;
  }
}

/** The Variables panel's input of YOUR_PROJECT. */
class FakeInput extends FakeElement {
  value = '';
  readonly dataset = { varInput: 'YOUR_PROJECT' };
}

/**
 * Runs the page's script (src/lib/fillable-page.ts) on a page whose Variables panel has one variable, YOUR_PROJECT,
 * and nothing else, over `items` as the browser's local storage. Returns the panel's input and the visitor's and the
 * other tabs' actions: typing into the input, "Clear values", and a change of local storage made in another tab.
 */
function startPage(items: Map<string, string>) {
  const listeners = new Map<string, (event: unknown) => void>();
  const input = new FakeInput();
  const row = {
    dataset: { varRow: 'YOUR_PROJECT', label: 'Project ID', pattern: '', hint: '' },
    hasAttribute: (): boolean => false,
    querySelector: (selector: string) => (selector === 'input[data-var-input]' ? input : null),
  };
  const clearButton = {
    addEventListener: (_type: string, listener: () => void) => listeners.set('clear', listener),
  };
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('HTMLInputElement', FakeInput);
  vi.stubGlobal('document', {
    querySelector: (selector: string) => (selector === '[data-var-clear]' ? clearButton : null),
    querySelectorAll: (selector: string) => (selector === '[data-var-row]' ? [row] : []),
    createElement: () => ({ contentEditable: 'inherit' }),
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
  });
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
      removeItem: (key: string) => items.delete(key),
    },
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
  });
  startFillable();
  return {
    input,
    type: (value: string): void => {
      input.value = value;
      listeners.get('input')?.({ target: input });
    },
    clear: (): void => listeners.get('clear')?.({}),
    changedElsewhere: (key: string | null): void => listeners.get('storage')?.({ key }),
  };
}

describe('the page’s script and local storage (fillable-page.ts)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the values under the key the data-processing inventory names: read on start, written on typing, removed by Clear values', () => {
    const items = new Map([
      [KEY, JSON.stringify({ YOUR_PROJECT: 'demo-tools-1', YOUR_REGION: 'europe-west3' })],
    ]);
    const page = startPage(items);
    expect(page.input.value).toBe('demo-tools-1');
    page.type('demo-web-1');
    // This page's value over what the other pages keep, under the one key.
    expect([...items.keys()]).toEqual([KEY]);
    expect(JSON.parse(items.get(KEY) ?? 'null')).toEqual({
      YOUR_PROJECT: 'demo-web-1',
      YOUR_REGION: 'europe-west3',
    });
    page.clear();
    expect(page.input.value).toBe('');
    expect(items.size).toBe(0);
  });

  it('follows another tab’s change of that key, and of no other', () => {
    const items = new Map<string, string>();
    const page = startPage(items);
    expect(page.input.value).toBe('');
    items.set(KEY, JSON.stringify({ YOUR_PROJECT: 'from-another-tab' }));
    page.changedElsewhere('gcportrait.repository');
    expect(page.input.value).toBe('');
    page.changedElsewhere(KEY);
    expect(page.input.value).toBe('from-another-tab');
    // Another tab cleared all of local storage (the event's key is null).
    items.clear();
    page.changedElsewhere(null);
    expect(page.input.value).toBe('');
  });
});
