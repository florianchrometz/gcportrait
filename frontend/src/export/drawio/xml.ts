// SPDX-License-Identifier: Apache-2.0
/**
 * A small XML reader and writer for the draw.io export: the diagram's own SVG markup in (the static render of
 * `renderDiagramSvg`, or the export's live drawing serialised by the browser), draw.io's file format out. No DOM, so
 * the same code runs in the browser and in Node (the render library). It reads well-formed XML: elements,
 * attributes, character data, CDATA, the five predefined entities and character references; the XML declaration,
 * processing instructions, comments and a doctype are skipped.
 */

export interface XmlElement {
  readonly kind: 'element';
  readonly name: string;
  /** In document order. */
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: readonly XmlNode[];
}

export interface XmlText {
  readonly kind: 'text';
  readonly text: string;
}

export type XmlNode = XmlElement | XmlText;

/** The markup could not be read; `offset` is where reading stopped. */
export class XmlError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(`${message} (at character ${String(offset)})`);
    this.name = 'XmlError';
    this.offset = offset;
  }
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

/** Character data with its entity and character references replaced. */
export function decodeEntities(value: string, offset = 0): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (whole, name: string) => {
    if (name.startsWith('#x')) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    const named = NAMED_ENTITIES[name];
    if (named === undefined) throw new XmlError(`unknown entity ${whole}`, offset);
    return named;
  });
}

const NAME = /[A-Za-z_:][\w.:-]*/y;
const SPACE = /\s*/y;

function isNameStart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z_:]/.test(char);
}

/** Parses a document and returns its root element. */
export function parseXml(source: string): XmlElement {
  let at = 0;
  const stack: Array<{ name: string; attributes: Map<string, string>; children: XmlNode[] }> = [];
  let root: XmlElement | undefined;

  const skipSpace = (): void => {
    SPACE.lastIndex = at;
    SPACE.exec(source);
    at = SPACE.lastIndex;
  };
  const readName = (): string => {
    NAME.lastIndex = at;
    const match = NAME.exec(source);
    if (match === null) throw new XmlError('expected a name', at);
    at = NAME.lastIndex;
    return match[0];
  };
  const skipPast = (end: string, what: string): number => {
    const found = source.indexOf(end, at);
    if (found < 0) throw new XmlError(`unterminated ${what}`, at);
    const start = at;
    at = found + end.length;
    return start;
  };
  const addChild = (node: XmlNode): void => {
    const parent = stack[stack.length - 1];
    if (parent !== undefined) parent.children.push(node);
    else if (node.kind === 'text' && node.text.trim() === '') return;
    else if (node.kind === 'text') throw new XmlError('text outside the root element', at);
  };

  while (at < source.length) {
    const lt = source.indexOf('<', at);
    if (lt < 0) {
      addChild({ kind: 'text', text: decodeEntities(source.slice(at), at) });
      break;
    }
    if (lt > at) addChild({ kind: 'text', text: decodeEntities(source.slice(at, lt), at) });
    at = lt;
    if (source.startsWith('<!--', at)) {
      skipPast('-->', 'comment');
    } else if (source.startsWith('<![CDATA[', at)) {
      at += 9;
      const start = skipPast(']]>', 'CDATA section');
      addChild({ kind: 'text', text: source.slice(start, at - 3) });
    } else if (source.startsWith('<?', at)) {
      skipPast('?>', 'processing instruction');
    } else if (source.startsWith('<!', at)) {
      skipPast('>', 'declaration');
    } else if (source.startsWith('</', at)) {
      at += 2;
      const name = readName();
      skipSpace();
      if (source[at] !== '>') throw new XmlError(`expected > after </${name}`, at);
      at += 1;
      const open = stack.pop();
      if (open?.name !== name) throw new XmlError(`</${name}> does not close <${open?.name ?? ''}>`, at);
      const element: XmlElement = {
        kind: 'element',
        name,
        attributes: open.attributes,
        children: open.children,
      };
      if (stack.length === 0) {
        if (root !== undefined) throw new XmlError('more than one root element', at);
        root = element;
      } else addChild(element);
    } else {
      at += 1;
      if (!isNameStart(source[at])) throw new XmlError('expected an element name after <', at);
      const name = readName();
      const attributes = new Map<string, string>();
      for (;;) {
        skipSpace();
        const char = source[at];
        if (char === '>' || char === '/') break;
        if (!isNameStart(char)) throw new XmlError(`unexpected ${char ?? 'end'} in <${name}>`, at);
        const attribute = readName();
        skipSpace();
        if (source[at] !== '=') throw new XmlError(`attribute ${attribute} has no value`, at);
        at += 1;
        skipSpace();
        const quote = source[at];
        if (quote !== '"' && quote !== "'") throw new XmlError(`attribute ${attribute} is not quoted`, at);
        const end = source.indexOf(quote, at + 1);
        if (end < 0) throw new XmlError(`attribute ${attribute} is not closed`, at);
        if (attributes.has(attribute)) throw new XmlError(`attribute ${attribute} given twice`, at);
        attributes.set(attribute, decodeEntities(source.slice(at + 1, end), at));
        at = end + 1;
      }
      if (source[at] === '/') {
        if (source[at + 1] !== '>') throw new XmlError(`expected /> in <${name}>`, at);
        at += 2;
        const element: XmlElement = { kind: 'element', name, attributes, children: [] };
        if (stack.length === 0) {
          if (root !== undefined) throw new XmlError('more than one root element', at);
          root = element;
        } else addChild(element);
      } else {
        at += 1;
        stack.push({ name, attributes, children: [] });
      }
    }
  }
  const unclosed = stack[stack.length - 1];
  if (unclosed !== undefined) throw new XmlError(`<${unclosed.name}> is not closed`, at);
  if (root === undefined) throw new XmlError('no root element', at);
  return root;
}

/** Character data escaped for an element's content. */
export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A value escaped for a double-quoted attribute (line breaks and tabs kept as references). */
export function escapeAttribute(value: string): string {
  return escapeText(value)
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
    .replace(/\t/g, '&#9;');
}

/** An element as markup: attributes in their order, empty elements self-closed, no added whitespace. */
export function serializeXml(element: XmlElement): string {
  const attributes = [...element.attributes]
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join('');
  if (element.children.length === 0) return `<${element.name}${attributes}/>`;
  const content = element.children
    .map((child) => (child.kind === 'text' ? escapeText(child.text) : serializeXml(child)))
    .join('');
  return `<${element.name}${attributes}>${content}</${element.name}>`;
}

/** The element's child elements, in order. */
export function childElements(element: XmlElement): XmlElement[] {
  return element.children.filter((child): child is XmlElement => child.kind === 'element');
}

/** Every element of the tree, the root first, in document order. */
export function* descendants(element: XmlElement): Generator<XmlElement> {
  yield element;
  for (const child of element.children) if (child.kind === 'element') yield* descendants(child);
}

/** The text content of an element and its descendants. */
export function textContent(element: XmlElement): string {
  return element.children.map((child) => (child.kind === 'text' ? child.text : textContent(child))).join('');
}
