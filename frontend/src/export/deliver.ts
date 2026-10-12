// SPDX-License-Identifier: MIT
/**
 * Where an export goes: a file the browser saves, or the clipboard (PNG only, skill gcp-diagram-style §8).
 */

/** Saves a file through a temporary download link; the object URL is released once the save has started. */
export function saveFile(blob: Blob, fileName: string, document: Document = globalThis.document): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 30_000);
  }
}

/** Whether this browser can put a PNG on the clipboard (the async Clipboard API with `ClipboardItem`). */
export function canCopyImages(scope: typeof globalThis = globalThis): boolean {
  const clipboardItem = (scope as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  const clipboard = (scope.navigator as Navigator | undefined)?.clipboard;
  if (typeof clipboardItem !== 'function' || typeof clipboard?.write !== 'function') return false;
  const supports = (clipboardItem as { supports?: (type: string) => boolean }).supports;
  return typeof supports !== 'function' || supports('image/png');
}

/**
 * Puts a PNG on the clipboard. The item is created at once with the pending image, so the browser still counts
 * the click that asked for it as the user's gesture while the PNG is drawn; a browser that does not take a
 * pending image gets it once it is ready.
 */
export async function copyPng(png: Promise<Blob>, scope: typeof globalThis = globalThis): Promise<void> {
  const clipboard = scope.navigator.clipboard;
  try {
    await clipboard.write([new scope.ClipboardItem({ 'image/png': png })]);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    await clipboard.write([new scope.ClipboardItem({ 'image/png': await png })]);
  }
}
