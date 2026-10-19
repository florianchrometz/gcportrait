// SPDX-License-Identifier: Apache-2.0
/**
 * The script for fillable commands (src/components/Variables.astro includes it on the docs pages with code and on the
 * landing page; src/lib/fillable.ts has the parts without a DOM). It runs in the visitor's browser and talks to
 * nothing but the page and its local storage.
 *
 * - Each `span.var[data-var]` the build left in the code becomes a field: a labelled inline text box, editable in place
 *   (`contenteditable`, plain text only where the browser offers it, else sanitised here), as wide as its text. A field
 *   that still shows its token selects it when focused, and the first key that edits replaces the whole token, so a
 *   value never mixes with it; emptied, the field shows the token as its placeholder. Enter leaves it.
 * - Every field of one variable, and its input in the Variables panel, show one value: typing in any of them updates
 *   the others at once. On leaving a field, a value that does not match the variable's format is marked
 *   (aria-invalid, the panel's hint, the code block's note), never refused.
 * - On a touch screen each field has a transparent tap target 44 pixels tall around it (`.var-target`, global.css),
 *   under every field and over the code's text, so a tap a little above or below the field still reaches it.
 * - Each code block's Copy button copies the block with the values filled in, an unfilled variable as its token; the
 *   note next to it says how many are still to fill, and a live region says "Copied".
 * - Values of variables that are not secret are kept in local storage under one key (shared by every page with
 *   fields, and with other tabs); "Clear values" removes them. Where storage is blocked, nothing is kept and the page
 *   works.
 *
 * Why the field is never emptied by the script while it has focus: WebKit (Safari on macOS, every browser on an
 * iPhone) cannot keep the caret in an inline editable element whose text a script removed, so what the visitor typed
 * next went nowhere. The browser's own editing (typing over a selection, Backspace) keeps the caret everywhere.
 */
import {
  STORAGE_KEY,
  copiedMessage,
  fieldValue,
  matchesPattern,
  readStoredValues,
  resolveBlock,
  storedValuesText,
  unfilledNote,
  type BlockPart,
} from './fillable.js';

type Variable = {
  readonly name: string;
  readonly label: string;
  readonly pattern: string;
  readonly hint: string;
  readonly secret: boolean;
  readonly input: HTMLInputElement | null;
  readonly hintElement: HTMLElement | null;
  readonly fields: HTMLElement[];
  invalid: boolean;
};

type Block = {
  readonly code: Element;
  readonly note: HTMLElement | null;
  readonly button: HTMLButtonElement;
  readonly label: HTMLElement | null;
  readonly names: readonly string[];
  timer: number | undefined;
};

/** How long the Copy button says "Copied". */
const COPIED_MS = 2000;

/** Keys that change a field's text without a character of their own (a virtual keyboard sends `Unidentified`). */
const EDIT_KEYS = new Set(['Backspace', 'Delete', 'Unidentified', 'Process', 'Dead']);

/** Whether a key press is about to change the text of the focused field (typing, deleting, pasting, cutting). */
function editsText(event: KeyboardEvent): boolean {
  if (event.isComposing) return false;
  if (event.ctrlKey || event.metaKey) return ['v', 'x'].includes(event.key.toLowerCase());
  return event.key.length === 1 || EDIT_KEYS.has(event.key);
}

/**
 * Whether the browser takes `contenteditable="plaintext-only"` (Chromium, Safari, Firefox from 136): set on a probe and
 * read back. Firefox before 136 throws on it; another browser may keep its old value.
 */
export function plaintextOnlySupported(): boolean {
  const probe = document.createElement('span');
  try {
    probe.contentEditable = 'plaintext-only';
  } catch {
    return false;
  }
  return probe.contentEditable === 'plaintext-only';
}

/** Selects the whole text of `field`, so what is typed next replaces it. */
function selectContents(field: HTMLElement): void {
  const selection = window.getSelection();
  if (selection === null) return;
  const range = document.createRange();
  range.selectNodeContents(field);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Puts the caret after the last character of `field`. */
function caretToEnd(field: HTMLElement): void {
  const selection = window.getSelection();
  if (selection === null) return;
  const range = document.createRange();
  range.selectNodeContents(field);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Whether the selection covers all of `field`'s text. */
function selectsAll(field: HTMLElement): boolean {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0) return false;
  return selection.getRangeAt(0).toString() === field.textContent;
}

export function startFillable(): void {
  const status = document.querySelector<HTMLElement>('[data-var-status]');
  const variables = new Map<string, Variable>();
  const values: Record<string, string> = {};

  for (const row of document.querySelectorAll<HTMLElement>('[data-var-row]')) {
    const name = row.dataset.varRow ?? '';
    variables.set(name, {
      name,
      label: row.dataset.label ?? name,
      pattern: row.dataset.pattern ?? '',
      hint: row.dataset.hint ?? '',
      secret: row.hasAttribute('data-secret'),
      input: row.querySelector<HTMLInputElement>('input[data-var-input]'),
      hintElement: row.querySelector<HTMLElement>('[data-var-hint]'),
      fields: [],
      invalid: false,
    });
  }
  const isSecret = (name: string): boolean => variables.get(name)?.secret === true;

  const storage = (): Storage | null => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  };
  const readStored = (): Record<string, string> => {
    try {
      return readStoredValues(storage()?.getItem(STORAGE_KEY) ?? null, (name) => !isSecret(name));
    } catch {
      return {};
    }
  };
  /** This page's values over what the other pages keep; a variable emptied here is removed. */
  const save = (): void => {
    const merged = { ...readStored() };
    for (const name of variables.keys()) {
      const value = values[name] ?? '';
      if (value === '' || isSecret(name)) Reflect.deleteProperty(merged, name);
      else merged[name] = value;
    }
    try {
      const text = storedValuesText(merged, isSecret);
      if (text === null) storage()?.removeItem(STORAGE_KEY);
      else storage()?.setItem(STORAGE_KEY, text);
    } catch {
      // Storage is full or blocked: the values stay on this page only.
    }
  };

  let lastMessage = '';
  const announce = (message: string): void => {
    if (status === null) return;
    // The same words twice in a row are announced again only if the region changes in between.
    status.textContent = message === lastMessage ? `${message}\u00a0` : message;
    lastMessage = status.textContent;
  };

  const blocks: Block[] = [];
  for (const root of document.querySelectorAll<HTMLElement>('[data-code-block]')) {
    const button = root.querySelector<HTMLButtonElement>('[data-code-copy]');
    const code = root.querySelector('pre code') ?? root.querySelector('pre');
    if (button === null || code === null) continue;
    const names: string[] = [];
    for (const field of code.querySelectorAll<HTMLElement>('[data-var]')) {
      const name = field.dataset.var ?? '';
      if (!names.includes(name)) names.push(name);
    }
    blocks.push({
      code,
      note: root.querySelector<HTMLElement>('[data-code-note]'),
      button,
      label: button.querySelector<HTMLElement>('[data-copy-label]'),
      names,
      timer: undefined,
    });
  }

  const updateNotes = (): void => {
    for (const block of blocks) {
      if (block.note === null) continue;
      const invalid = block.names
        .map((name) => variables.get(name))
        .find((variable) => variable?.invalid === true);
      const unfilled = block.names.filter((name) => (values[name] ?? '') === '').length;
      block.note.textContent =
        invalid === undefined ? unfilledNote(unfilled) : `Check ${invalid.label}: ${invalid.hint}.`;
      block.note.toggleAttribute('data-invalid', invalid !== undefined);
    }
  };

  const setInvalid = (variable: Variable, invalid: boolean): void => {
    variable.invalid = invalid;
    for (const element of [...variable.fields, ...(variable.input === null ? [] : [variable.input])]) {
      if (invalid) element.setAttribute('aria-invalid', 'true');
      else element.removeAttribute('aria-invalid');
    }
    if (variable.hintElement !== null) variable.hintElement.hidden = !invalid;
  };

  /** Gives every field and the input of `name` the value; `source` (being typed in) keeps its own text. */
  const setValue = (name: string, raw: string, source: Element | null, persist = true): void => {
    const variable = variables.get(name);
    if (variable === undefined) return;
    const value = raw.trim();
    values[name] = value;
    for (const field of variable.fields) {
      field.toggleAttribute('data-filled', value !== '');
      if (field !== source) field.textContent = value === '' ? name : value;
    }
    if (variable.input !== null && variable.input !== source) variable.input.value = value;
    if (variable.invalid && matchesPattern(variable.pattern, value)) setInvalid(variable, false);
    updateNotes();
    if (persist) save();
  };

  const check = (variable: Variable): void => {
    setInvalid(variable, !matchesPattern(variable.pattern, values[variable.name] ?? ''));
    updateNotes();
  };

  /** Whether `field` still shows its token: the variable is unfilled and nothing was typed over it yet. */
  const showsToken = (field: HTMLElement, variable: Variable): boolean =>
    (values[variable.name] ?? '') === '' && field.textContent === variable.name;

  // The fields: labelled inline text boxes, each with its tap target.
  const editable = plaintextOnlySupported() ? 'plaintext-only' : 'true';
  for (const field of document.querySelectorAll<HTMLElement>('span.var[data-var]')) {
    const variable = variables.get(field.dataset.var ?? '');
    if (variable === undefined) continue;
    field.setAttribute('role', 'textbox');
    field.setAttribute('aria-label', variable.label);
    field.setAttribute('aria-placeholder', variable.name);
    field.setAttribute('aria-describedby', `var-${variable.name}-about var-${variable.name}-hint`);
    field.setAttribute('autocapitalize', 'off');
    field.setAttribute('autocorrect', 'off');
    field.setAttribute('enterkeyhint', 'done');
    field.spellcheck = false;
    field.contentEditable = editable;
    // The wrapper is an inline box of the field's size (nothing moves); the target is shown on touch screens only.
    const wrapper = document.createElement('span');
    wrapper.className = 'var-field';
    const target = document.createElement('span');
    target.className = 'var-target';
    target.setAttribute('aria-hidden', 'true');
    field.before(wrapper);
    wrapper.append(field, target);
    // Its own listener: Safari on an iPhone sends a tap's click only to an element that listens for it.
    target.addEventListener('click', () => {
      field.focus({ preventScroll: true });
      if (!showsToken(field, variable)) caretToEnd(field);
    });
    variable.fields.push(field);
  }

  const fieldOf = (target: EventTarget | null): { field: HTMLElement; variable: Variable } | undefined => {
    if (!(target instanceof HTMLElement) || !target.matches('span.var[data-var][role="textbox"]'))
      return undefined;
    const variable = variables.get(target.dataset.var ?? '');
    return variable === undefined ? undefined : { field: target, variable };
  };
  const inputOf = (target: EventTarget | null): Variable | undefined =>
    target instanceof HTMLInputElement && target.dataset.varInput !== undefined
      ? variables.get(target.dataset.varInput)
      : undefined;

  /** Puts `text` (a paste, or a replacement the browser left to the page) into `field` as one plain line. */
  const insertPlain = (field: HTMLElement, variable: Variable, text: string): void => {
    // Nothing to put in: the field stays as it is (a script never empties a focused field, see above).
    if (text === '') return;
    if (showsToken(field, variable) || !field.contains(window.getSelection()?.anchorNode ?? null))
      selectContents(field);
    const selection = window.getSelection();
    if (selection === null || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    field.normalize();
    caretToEnd(field);
    setValue(variable.name, fieldValue(field.textContent), field);
  };

  document.addEventListener('focusin', (event) => {
    const found = fieldOf(event.target);
    if (found === undefined || !showsToken(found.field, found.variable)) return;
    // After the browser has placed the caret where the field was clicked or tapped: the whole token is selected.
    const { field, variable } = found;
    requestAnimationFrame(() => {
      if (document.activeElement === field && showsToken(field, variable)) selectContents(field);
    });
  });
  document.addEventListener('click', (event) => {
    const found = fieldOf(event.target);
    if (found !== undefined && showsToken(found.field, found.variable)) selectContents(found.field);
  });
  document.addEventListener('keydown', (event) => {
    const found = fieldOf(event.target);
    if (found === undefined) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      found.field.blur();
      return;
    }
    // A caret moved into the token (arrows, a second click): the first key that edits still replaces all of it.
    if (showsToken(found.field, found.variable) && editsText(event)) selectContents(found.field);
  });
  document.addEventListener('beforeinput', (event) => {
    const found = fieldOf(event.target);
    if (found === undefined) return;
    const { field, variable } = found;
    const type = event.inputType;
    // One line only: a virtual keyboard's Enter may come without a key event.
    if (type === 'insertParagraph' || type === 'insertLineBreak') {
      event.preventDefault();
      field.blur();
      return;
    }
    // Without plaintext-only the browser would keep formatting and dropped markup: plain text only.
    if (editable !== 'plaintext-only' && (type.startsWith('format') || type === 'insertFromDrop')) {
      event.preventDefault();
      return;
    }
    // An edit without a key event (a virtual keyboard, a menu) into a partly selected token replaces the token too.
    if (!event.cancelable || !showsToken(field, variable) || selectsAll(field)) return;
    if (type.startsWith('delete')) {
      event.preventDefault();
      selectContents(field);
    } else if (type.startsWith('insert')) {
      event.preventDefault();
      insertPlain(field, variable, fieldValue(event.data ?? event.dataTransfer?.getData('text/plain') ?? ''));
    }
  });
  document.addEventListener('input', (event) => {
    const found = fieldOf(event.target);
    if (found !== undefined) {
      const { field, variable } = found;
      const value = fieldValue(field.textContent);
      // Markup or a line break a browser left in the field (a <br> in an emptied one): back to one plain line.
      if (field.childElementCount > 0 || field.textContent !== value) {
        field.textContent = value;
        if (value !== '') caretToEnd(field);
      }
      setValue(variable.name, value, field);
      return;
    }
    const variable = inputOf(event.target);
    if (variable !== undefined && event.target instanceof HTMLInputElement) {
      setValue(variable.name, event.target.value, event.target);
    }
  });
  document.addEventListener('paste', (event) => {
    const found = fieldOf(event.target);
    if (found === undefined) return;
    // Always as plain text on one line, over the whole token while the field still shows it.
    event.preventDefault();
    insertPlain(found.field, found.variable, fieldValue(event.clipboardData?.getData('text/plain') ?? ''));
  });
  document.addEventListener('focusout', (event) => {
    const found = fieldOf(event.target);
    if (found !== undefined) {
      const value = values[found.variable.name] ?? '';
      found.field.textContent = value === '' ? found.variable.name : value;
      check(found.variable);
      return;
    }
    const variable = inputOf(event.target);
    if (variable !== undefined && event.target instanceof HTMLInputElement) {
      event.target.value = values[variable.name] ?? '';
      check(variable);
    }
  });

  for (const block of blocks) {
    block.button.hidden = false;
    block.button.addEventListener('click', () => {
      const parts: BlockPart[] = [];
      const walk = (node: Node): void => {
        for (const child of node.childNodes) {
          if (child instanceof HTMLElement && child.dataset.var !== undefined)
            parts.push({ name: child.dataset.var });
          else if (child.nodeType === Node.TEXT_NODE) parts.push(child.textContent ?? '');
          else walk(child);
        }
      };
      walk(block.code);
      const { text, unfilled } = resolveBlock(parts, values);
      void writeClipboard(text).then((copied) => {
        if (!copied) {
          announce('Copying did not work here: select the code and copy it yourself.');
          return;
        }
        announce(copiedMessage(unfilled));
        if (block.label !== null) block.label.textContent = 'Copied';
        block.button.setAttribute('data-copied', '');
        window.clearTimeout(block.timer);
        block.timer = window.setTimeout(() => {
          if (block.label !== null) block.label.textContent = 'Copy';
          block.button.removeAttribute('data-copied');
        }, COPIED_MS);
      });
    });
  }

  document.querySelector<HTMLButtonElement>('[data-var-clear]')?.addEventListener('click', () => {
    for (const variable of variables.values()) {
      setValue(variable.name, '', null, false);
      setInvalid(variable, false);
    }
    updateNotes();
    try {
      storage()?.removeItem(STORAGE_KEY);
    } catch {
      // Nothing was kept.
    }
    announce('Values cleared.');
  });

  // Another tab changed the values: show them here too.
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    const stored = readStored();
    for (const name of variables.keys()) {
      if (!isSecret(name) && (stored[name] ?? '') !== (values[name] ?? ''))
        setValue(name, stored[name] ?? '', null, false);
    }
  });

  const stored = readStored();
  for (const name of variables.keys()) {
    const value = stored[name];
    if (value !== undefined) setValue(name, value, null, false);
  }
  updateNotes();
}

/** Writes `text` to the clipboard: the Clipboard API, or a selected text area where that is refused. */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // An older browser, or a page that is not a secure context: the selection way below.
  }
  const active = document.activeElement;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.className = 'visually-hidden';
  document.body.append(area);
  area.select();
  let copied: boolean;
  try {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the one way to copy where the Clipboard API is refused
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  if (active instanceof HTMLElement) active.focus();
  return copied;
}
