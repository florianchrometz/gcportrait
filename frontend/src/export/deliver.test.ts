// SPDX-License-Identifier: Apache-2.0
/**
 * Delivery of exports and text: downloading files, PNG clipboard copying, and plain-text clipboard copying.
 */
import { describe, expect, it, vi } from 'vitest';

import { canCopyImages, copyFailureMessage, copyPng, copyText, saveFile } from './deliver';

describe('copyText', () => {
  it('returns "copied" when clipboard.writeText resolves', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const scope = {
      navigator: {
        clipboard: { writeText },
      },
    } as unknown as typeof globalThis;

    const outcome = await copyText('hello world', scope);
    expect(outcome).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('hello world');
  });

  it('returns "unavailable" when the clipboard API or writeText is missing', async () => {
    const noClipboard = {
      navigator: {},
    } as unknown as typeof globalThis;
    expect(await copyText('test', noClipboard)).toBe('unavailable');

    const noNavigator = {} as unknown as typeof globalThis;
    expect(await copyText('test', noNavigator)).toBe('unavailable');

    const invalidClipboard = {
      navigator: { clipboard: { writeText: 'not a function' } },
    } as unknown as typeof globalThis;
    expect(await copyText('test', invalidClipboard)).toBe('unavailable');
  });

  it('returns "refused" when clipboard.writeText rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Permission denied'));
    const scope = {
      navigator: {
        clipboard: { writeText },
      },
    } as unknown as typeof globalThis;

    const outcome = await copyText('blocked', scope);
    expect(outcome).toBe('refused');
    expect(writeText).toHaveBeenCalledWith('blocked');
  });
});

describe('copyFailureMessage', () => {
  it('formats unavailable and refused messages without an alternative', () => {
    expect(copyFailureMessage('unavailable')).toBe('Copying is not available here.');
    expect(copyFailureMessage('refused')).toBe('The browser did not allow copying.');
  });

  it('appends the suggested alternative after a colon', () => {
    expect(copyFailureMessage('unavailable', 'copy the address bar instead')).toBe(
      'Copying is not available here: copy the address bar instead.',
    );
    expect(copyFailureMessage('refused', 'copy the address bar instead')).toBe(
      'The browser did not allow copying: copy the address bar instead.',
    );
    expect(copyFailureMessage('refused', 'select the command instead')).toBe(
      'The browser did not allow copying: select the command instead.',
    );
  });
});

describe('saveFile', () => {
  it('creates a hidden download link, triggers click, and removes it', () => {
    vi.useFakeTimers();
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');

    const link = {
      href: '',
      download: '',
      hidden: false,
      click: vi.fn(),
      remove: vi.fn(),
    };
    const append = vi.fn();
    const documentMock = {
      createElement: vi.fn().mockReturnValue(link),
      body: {
        append,
      },
    } as unknown as Document;

    const blob = new Blob(['sample']);
    saveFile(blob, 'export.png', documentMock);

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(link.href).toBe('blob:mock-url');
    expect(link.download).toBe('export.png');
    expect(link.hidden).toBe(true);
    expect(append).toHaveBeenCalledWith(link);
    expect(link.click).toHaveBeenCalled();
    expect(link.remove).toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    vi.useRealTimers();
  });
});

describe('canCopyImages', () => {
  it('checks for ClipboardItem and clipboard.write support', () => {
    expect(canCopyImages({} as typeof globalThis)).toBe(false);

    const withoutSupports = {
      ClipboardItem: vi.fn(),
      navigator: { clipboard: { write: vi.fn() } },
    } as unknown as typeof globalThis;
    expect(canCopyImages(withoutSupports)).toBe(true);

    const withSupports = {
      ClipboardItem: Object.assign(vi.fn(), {
        supports: (type: string) => type === 'image/png',
      }),
      navigator: { clipboard: { write: vi.fn() } },
    } as unknown as typeof globalThis;
    expect(canCopyImages(withSupports)).toBe(true);

    const withoutPngSupport = {
      ClipboardItem: Object.assign(vi.fn(), {
        supports: () => false,
      }),
      navigator: { clipboard: { write: vi.fn() } },
    } as unknown as typeof globalThis;
    expect(canCopyImages(withoutPngSupport)).toBe(false);
  });
});

describe('copyPng', () => {
  it('writes a ClipboardItem with the pending PNG to the clipboard', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    class MockClipboardItem {
      readonly record: Record<string, unknown>;
      constructor(record: Record<string, unknown>) {
        this.record = record;
      }
    }
    const scope = {
      ClipboardItem: MockClipboardItem,
      navigator: { clipboard: { write } },
    } as unknown as typeof globalThis;

    const blob = new Blob(['png-data']);
    const pending = Promise.resolve(blob);
    await copyPng(pending, scope);

    expect(write).toHaveBeenCalledWith([expect.any(MockClipboardItem)]);
  });

  it('falls back to awaiting the blob when the browser rejects with TypeError', async () => {
    class MockClipboardItem {
      readonly record: Record<string, unknown>;
      constructor(record: Record<string, unknown>) {
        this.record = record;
      }
    }
    const blob = new Blob(['png-data']);
    const pending = Promise.resolve(blob);

    const write = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Promise not supported'))
      .mockResolvedValueOnce(undefined);

    const scope = {
      ClipboardItem: MockClipboardItem,
      navigator: { clipboard: { write } },
    } as unknown as typeof globalThis;

    await copyPng(pending, scope);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('rethrows non-TypeError errors', async () => {
    class MockClipboardItem {
      readonly record: Record<string, unknown>;
      constructor(record: Record<string, unknown>) {
        this.record = record;
      }
    }
    const write = vi.fn().mockRejectedValue(new Error('Permission denied'));
    const scope = {
      ClipboardItem: MockClipboardItem,
      navigator: { clipboard: { write } },
    } as unknown as typeof globalThis;

    const pending = Promise.resolve(new Blob(['png-data']));
    await expect(copyPng(pending, scope)).rejects.toThrow('Permission denied');
  });
});
