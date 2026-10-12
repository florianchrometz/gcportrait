// SPDX-License-Identifier: MIT
// @ts-check
/**
 * The mechanical transforms applied to Google's icon SVGs (README "Mechanical transforms"), and the helpers the
 * tests use to check the result. Nothing here changes artwork: geometry, colours, opacity and paint order stay
 * exactly as drawn. What changes is how the same drawing is written down:
 *
 *  1. the XML prolog, editor comments, `<title>`, `<desc>` and `<metadata>` are removed (a comment that carries a
 *     copyright notice is kept, never stripped);
 *  2. `<style>` class rules and inline `style` attributes become presentation attributes, following the CSS
 *     cascade (presentation attribute < class rule, in stylesheet order < inline style); a property that has no
 *     presentation attribute, a selector other than a single class, or `!important` stops the run;
 *  3. ids nothing references are removed; referenced ids are renamed `<prefix>-<n>` so that several icons can be
 *     inlined into one document, and every `url(#…)` and `href="#…"` follows the rename;
 *  4. editor attributes (`data-*`, `jetwayHook*`, `xml:space`) and the root's `id`, `version`, `baseProfile`,
 *     `x`, `y`, `width` and `height` are removed (the renderer sizes the icon), and `<defs>` left empty is removed;
 *  5. the viewBox is written as `0 0 <n> <n>`, `<n>` being the set's native size (24 or 512);
 *  6. whitespace between tags is dropped and attributes are written with double quotes.
 *
 * Plain ESM, Node built-ins only; also imported by the build script and the tests.
 */

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';

/**
 * @typedef {{ type: 'element', name: string, attributes: Array<[string, string]>, children: XmlNode[] }} XmlElement
 * @typedef {{ type: 'text', value: string }} XmlText
 * @typedef {{ type: 'comment', value: string }} XmlComment
 * @typedef {XmlElement | XmlText | XmlComment} XmlNode
 */

/** SVG presentation attributes (SVG 1.1 and 2): the CSS properties a class rule may be turned into. */
export const PRESENTATION_ATTRIBUTES = Object.freeze(
  new Set([
    'alignment-baseline',
    'baseline-shift',
    'clip',
    'clip-path',
    'clip-rule',
    'color',
    'color-interpolation',
    'color-interpolation-filters',
    'color-rendering',
    'cursor',
    'direction',
    'display',
    'dominant-baseline',
    'enable-background',
    'fill',
    'fill-opacity',
    'fill-rule',
    'filter',
    'flood-color',
    'flood-opacity',
    'font-family',
    'font-size',
    'font-size-adjust',
    'font-stretch',
    'font-style',
    'font-variant',
    'font-weight',
    'image-rendering',
    'isolation',
    'letter-spacing',
    'lighting-color',
    'marker-end',
    'marker-mid',
    'marker-start',
    'mask',
    'mix-blend-mode',
    'opacity',
    'overflow',
    'paint-order',
    'pointer-events',
    'shape-rendering',
    'stop-color',
    'stop-opacity',
    'stroke',
    'stroke-dasharray',
    'stroke-dashoffset',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'stroke-opacity',
    'stroke-width',
    'text-anchor',
    'text-decoration',
    'text-rendering',
    'transform',
    'unicode-bidi',
    'vector-effect',
    'visibility',
    'word-spacing',
    'writing-mode',
  ]),
);

/** Paint properties whose values are colours (for the "never recoloured" checks). */
export const COLOUR_PROPERTIES = Object.freeze(
  new Set(['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color', 'color']),
);

/** Elements an icon may contain after the transforms; anything else stops the run for a human to look at. */
const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'use',
  'symbol',
  'clipPath',
  'mask',
  'linearGradient',
  'radialGradient',
  'stop',
  'filter',
  'feBlend',
  'feColorMatrix',
  'feComposite',
  'feFlood',
  'feGaussianBlur',
  'feMerge',
  'feMergeNode',
  'feOffset',
]);

/** Elements that carry no artwork: removed. `style` is read first. */
const METADATA_ELEMENTS = new Set(['title', 'desc', 'metadata']);

/** Root attributes that only size or label the document. */
const ROOT_DROPPED = new Set(['id', 'version', 'baseProfile', 'x', 'y', 'width', 'height']);

/** A comment that must be kept: it may carry a copyright notice. */
const NOTICE_COMMENT = /copyright|©|\(c\)/i;

/**
 * @param {string} name
 * @returns {boolean}
 */
function isEditorAttribute(name) {
  return name.startsWith('data-') || /^jetwayhook/i.test(name) || name === 'xml:space';
}

// ---------------------------------------------------------------------------------------------------------------
// XML

const ENTITIES = /** @type {Record<string, string>} */ ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" });

/**
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, /** @type {string} */ body) => {
    if (body.startsWith('#x')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    const value = ENTITIES[body];
    if (value === undefined) throw new Error(`unknown XML entity ${whole}`);
    return value;
  });
}

/**
 * Parses the XML of one SVG file into its root element. Accepts what icon exports contain (prolog, comments,
 * CDATA, elements, text) and refuses a DOCTYPE, so that no entity expansion can hide content.
 * @param {string} source
 * @returns {XmlElement}
 */
export function parseXml(source) {
  const text = source.startsWith('﻿') ? source.slice(1) : source;
  /** @type {XmlElement} */
  const documentNode = { type: 'element', name: '#document', attributes: [], children: [] };
  /** @type {XmlElement[]} */
  const stack = [documentNode];
  let index = 0;
  /** @returns {XmlElement} */
  const top = () => /** @type {XmlElement} */ (stack[stack.length - 1]);
  const fail = (/** @type {string} */ message) => {
    throw new Error(`${message} at offset ${String(index)}`);
  };
  while (index < text.length) {
    if (text.startsWith('<?', index)) {
      const end = text.indexOf('?>', index);
      if (end < 0) fail('unterminated processing instruction');
      if (stack.length > 1) fail('processing instruction inside an element');
      index = end + 2;
    } else if (text.startsWith('<!--', index)) {
      const end = text.indexOf('-->', index + 4);
      if (end < 0) fail('unterminated comment');
      top().children.push({ type: 'comment', value: text.slice(index + 4, end) });
      index = end + 3;
    } else if (text.startsWith('<![CDATA[', index)) {
      const end = text.indexOf(']]>', index);
      if (end < 0) fail('unterminated CDATA section');
      top().children.push({ type: 'text', value: text.slice(index + 9, end) });
      index = end + 3;
    } else if (text.startsWith('<!', index)) {
      fail('DOCTYPE and other declarations are not accepted');
    } else if (text.startsWith('</', index)) {
      const match = /^<\/([^\s>]+)\s*>/.exec(text.slice(index, index + 256));
      if (match === null) fail('malformed end tag');
      const name = /** @type {RegExpExecArray} */ (match)[1];
      if (stack.length < 2 || top().name !== name) fail(`unexpected end tag </${String(name)}>`);
      stack.pop();
      index += /** @type {RegExpExecArray} */ (match)[0].length;
    } else if (text[index] === '<') {
      const nameMatch = /^<([A-Za-z_][\w:.-]*)/.exec(text.slice(index, index + 256));
      if (nameMatch === null) fail('malformed start tag');
      const name = /** @type {string} */ (/** @type {RegExpExecArray} */ (nameMatch)[1]);
      index += name.length + 1;
      /** @type {XmlElement} */
      const element = { type: 'element', name, attributes: [], children: [] };
      for (;;) {
        while (/\s/.test(text[index] ?? '')) index += 1;
        if (text.startsWith('/>', index)) {
          index += 2;
          top().children.push(element);
          break;
        }
        if (text[index] === '>') {
          index += 1;
          top().children.push(element);
          stack.push(element);
          break;
        }
        const attributeMatch = /^([A-Za-z_][\w:.-]*)\s*=\s*(["'])/.exec(text.slice(index, index + 512));
        if (attributeMatch === null) fail(`malformed attribute in <${name}>`);
        const [whole, attributeName = '', quote = '"'] = /** @type {RegExpExecArray} */ (attributeMatch);
        const valueStart = index + whole.length;
        const valueEnd = text.indexOf(quote, valueStart);
        if (valueEnd < 0) fail(`unterminated attribute ${attributeName}`);
        if (element.attributes.some(([existing]) => existing === attributeName)) {
          fail(`duplicate attribute ${attributeName} in <${name}>`);
        }
        element.attributes.push([attributeName, decodeEntities(text.slice(valueStart, valueEnd))]);
        index = valueEnd + 1;
      }
    } else {
      const end = text.indexOf('<', index);
      const value = text.slice(index, end < 0 ? text.length : end);
      top().children.push({ type: 'text', value: decodeEntities(value) });
      index = end < 0 ? text.length : end;
    }
  }
  if (stack.length !== 1) throw new Error(`unclosed element <${top().name}>`);
  const roots = documentNode.children.filter((node) => node.type === 'element');
  if (roots.length !== 1) throw new Error(`expected one root element, found ${String(roots.length)}`);
  if (documentNode.children.some((node) => node.type === 'text' && node.value.trim() !== '')) {
    throw new Error('text outside the root element');
  }
  return /** @type {XmlElement} */ (roots[0]);
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeAttribute(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeText(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Writes an element tree as compact XML: double-quoted attributes in their order, self-closing empty elements.
 * @param {XmlNode} node
 * @returns {string}
 */
export function serializeXml(node) {
  if (node.type === 'text') return escapeText(node.value);
  if (node.type === 'comment') return `<!--${node.value}-->`;
  const attributes = node.attributes.map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join('');
  if (node.children.length === 0) return `<${node.name}${attributes}/>`;
  return `<${node.name}${attributes}>${node.children.map(serializeXml).join('')}</${node.name}>`;
}

/**
 * @param {XmlElement} element
 * @param {(element: XmlElement) => void} visit
 */
function walk(element, visit) {
  visit(element);
  for (const child of element.children) if (child.type === 'element') walk(child, visit);
}

/**
 * @param {XmlElement} element
 * @param {(element: XmlElement) => boolean} test
 * @returns {boolean} whether `test` holds for the element or any element below it
 */
function someElement(element, test) {
  return (
    test(element) || element.children.some((child) => child.type === 'element' && someElement(child, test))
  );
}

/**
 * @param {XmlElement} element
 * @param {string} name
 * @returns {string | undefined}
 */
export function attributeOf(element, name) {
  return element.attributes.find(([key]) => key === name)?.[1];
}

// ---------------------------------------------------------------------------------------------------------------
// CSS

/**
 * @typedef {{ classes: string[], declarations: Array<[string, string]> }} CssRule
 */

/**
 * Parses CSS declarations (`fill: #fff; fill-rule: evenodd`) into lower-cased property/value pairs.
 * @param {string} text
 * @param {string} where
 * @returns {Array<[string, string]>}
 */
export function parseDeclarations(text, where) {
  /** @type {Array<[string, string]>} */
  const declarations = [];
  for (const part of text.split(';')) {
    if (part.trim() === '') continue;
    const colon = part.indexOf(':');
    if (colon < 0) throw new Error(`${where}: malformed declaration "${part.trim()}"`);
    const property = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim();
    if (/!\s*important/i.test(value)) throw new Error(`${where}: !important is not supported`);
    if (!PRESENTATION_ATTRIBUTES.has(property)) {
      throw new Error(`${where}: CSS property "${property}" has no presentation attribute`);
    }
    declarations.push([property, value]);
  }
  return declarations;
}

/**
 * Parses a stylesheet of single-class rules (`.cls-1, .cls-2 { fill: #4285f4 }`), the only form icon exports
 * use. Anything else (element or id selectors, at-rules, combinators) is refused.
 * @param {string} css
 * @returns {CssRule[]}
 */
export function parseStylesheet(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  /** @type {CssRule[]} */
  const rules = [];
  const leftover = text.replace(
    /([^{}]+)\{([^{}]*)\}/g,
    (_whole, /** @type {string} */ selectorText, /** @type {string} */ body) => {
      const classes = selectorText.split(',').map((selector) => {
        const match = /^\s*\.([A-Za-z0-9_-]+)\s*$/.exec(selector);
        if (match === null) throw new Error(`unsupported CSS selector "${selector.trim()}"`);
        return /** @type {string} */ (match[1]);
      });
      rules.push({ classes, declarations: parseDeclarations(body, `rule ${selectorText.trim()}`) });
      return '';
    },
  );
  if (leftover.trim() !== '') throw new Error(`unsupported CSS: "${leftover.trim().slice(0, 60)}"`);
  return rules;
}

// ---------------------------------------------------------------------------------------------------------------
// The transforms

/** Matches `url(#id)` references (with optional quotes) in an attribute value. */
const URL_REFERENCE = /url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g;

/**
 * @typedef {object} TransformOptions
 * @property {string} idPrefix prefix for the ids that must stay (referenced ones): `<idPrefix>-<n>`
 * @property {number} viewBoxSize the set's native size; the viewBox must be `0 0 <size> <size>`
 */

/**
 * @typedef {object} TransformResult
 * @property {string} svg the transformed file content, without a trailing newline
 * @property {string} viewBox
 * @property {number} keptComments comments kept because they may carry a notice
 */

/**
 * Applies the mechanical transforms to one icon file.
 * @param {string} source
 * @param {TransformOptions} options
 * @returns {TransformResult}
 */
export function transformIcon(source, options) {
  const root = parseXml(source);
  if (root.name !== 'svg') throw new Error(`root element is <${root.name}>, expected <svg>`);
  const viewBox = normaliseViewBox(root, options.viewBoxSize);

  // 1. Harvest and remove <style>; remove metadata elements, editor comments and whitespace.
  /** @type {CssRule[]} */
  const rules = [];
  let keptComments = 0;
  /**
   * @param {XmlElement} element
   */
  const clean = (element) => {
    /** @type {XmlNode[]} */
    const children = [];
    for (const child of element.children) {
      if (child.type === 'comment') {
        if (NOTICE_COMMENT.test(child.value)) {
          keptComments += 1;
          children.push(child);
        }
        continue;
      }
      if (child.type === 'text') {
        if (child.value.trim() !== '') throw new Error(`text content in <${element.name}>`);
        continue;
      }
      if (child.name === 'style') {
        const type = attributeOf(child, 'type');
        if (type !== undefined && type !== 'text/css') throw new Error(`<style type="${type}"> is not CSS`);
        const css = child.children.map((node) => (node.type === 'text' ? node.value : '')).join('');
        rules.push(...parseStylesheet(css));
        continue;
      }
      if (METADATA_ELEMENTS.has(child.name)) continue;
      if (!ALLOWED_ELEMENTS.has(child.name)) throw new Error(`unexpected element <${child.name}>`);
      clean(child);
      children.push(child);
    }
    element.children = children;
  };
  clean(root);

  // 2. Class rules and inline styles → presentation attributes; editor attributes removed.
  walk(root, (element) => {
    /** @type {Map<string, string>} */
    const cascaded = new Map();
    const classes = (attributeOf(element, 'class') ?? '').split(/\s+/).filter((name) => name !== '');
    for (const rule of rules) {
      if (!rule.classes.some((name) => classes.includes(name))) continue;
      for (const [property, value] of rule.declarations) cascaded.set(property, value);
    }
    const style = attributeOf(element, 'style');
    if (style !== undefined) {
      for (const [property, value] of parseDeclarations(style, `style of <${element.name}>`)) {
        cascaded.set(property, value);
      }
    }
    /** @type {Array<[string, string]>} */
    const attributes = [];
    for (const [name, value] of element.attributes) {
      if (name === 'class' || name === 'style' || isEditorAttribute(name)) continue;
      if (element === root && ROOT_DROPPED.has(name)) continue;
      const override = cascaded.get(name);
      attributes.push([name, override ?? value]);
      cascaded.delete(name);
    }
    for (const entry of cascaded) attributes.push(entry);
    element.attributes = attributes;
  });

  // 3. Ids: drop unreferenced ones, rename referenced ones, follow every reference.
  /** @type {Set<string>} */
  const referenced = new Set();
  walk(root, (element) => {
    for (const [name, value] of element.attributes) {
      for (const match of value.matchAll(URL_REFERENCE)) referenced.add(/** @type {string} */ (match[2]));
      if ((name === 'href' || name === 'xlink:href') && value.startsWith('#')) referenced.add(value.slice(1));
    }
  });
  /** @type {Map<string, string>} */
  const renamed = new Map();
  walk(root, (element) => {
    const id = attributeOf(element, 'id');
    if (id === undefined) return;
    if (referenced.has(id)) {
      if (renamed.has(id)) throw new Error(`duplicate id "${id}"`);
      renamed.set(id, `${options.idPrefix}-${String(renamed.size + 1)}`);
    }
  });
  for (const id of referenced) if (!renamed.has(id)) throw new Error(`reference to undefined id "#${id}"`);
  walk(root, (element) => {
    element.attributes = element.attributes.flatMap(([name, value]) => {
      if (name === 'id') {
        const next = renamed.get(value);
        return next === undefined ? [] : [/** @type {[string, string]} */ ([name, next])];
      }
      let rewritten = value.replace(URL_REFERENCE, (_whole, quote, /** @type {string} */ id) => {
        return `url(${String(quote)}#${renamed.get(id) ?? id}${String(quote)})`;
      });
      if ((name === 'href' || name === 'xlink:href') && value.startsWith('#')) {
        rewritten = `#${renamed.get(value.slice(1)) ?? value.slice(1)}`;
      }
      return [/** @type {[string, string]} */ ([name, rewritten])];
    });
  });

  // 4. Empty <defs> go.
  /**
   * @param {XmlElement} element
   */
  const dropEmptyDefs = (element) => {
    for (const child of element.children) if (child.type === 'element') dropEmptyDefs(child);
    element.children = element.children.filter(
      (child) => !(child.type === 'element' && child.name === 'defs' && child.children.length === 0),
    );
  };
  dropEmptyDefs(root);

  // 5. The root: namespace, viewBox at the set's native size, the remaining presentation attributes.
  const usesXlink = someElement(root, (element) =>
    element.attributes.some(([name]) => name.startsWith('xlink:')),
  );
  const rest = root.attributes.filter(
    ([name]) =>
      name !== 'xmlns' && name !== 'viewBox' && !name.startsWith('xmlns:') && !ROOT_DROPPED.has(name),
  );
  for (const [name] of rest) {
    if (!PRESENTATION_ATTRIBUTES.has(name)) throw new Error(`unexpected root attribute ${name}`);
  }
  /** @type {Array<[string, string]>} */
  const rootAttributes = [['xmlns', SVG_NAMESPACE]];
  if (usesXlink) rootAttributes.push(['xmlns:xlink', XLINK_NAMESPACE]);
  rootAttributes.push(['viewBox', viewBox], ...rest);
  root.attributes = rootAttributes;

  return { svg: serializeXml(root), viewBox, keptComments };
}

/**
 * The root's viewBox as `0 0 <size> <size>`, read before any attribute is touched; a missing viewBox is taken
 * from `width` and `height`. Any other geometry stops the run: rescaling coordinates is not mechanical.
 * @param {XmlElement} root
 * @param {number} size
 * @returns {string}
 */
function normaliseViewBox(root, size) {
  const declared = attributeOf(root, 'viewBox');
  const numbers =
    declared === undefined
      ? [
          0,
          0,
          Number.parseFloat(attributeOf(root, 'width') ?? ''),
          Number.parseFloat(attributeOf(root, 'height') ?? ''),
        ]
      : declared
          .trim()
          .split(/[\s,]+/)
          .map(Number);
  const [minX, minY, width, height] = numbers;
  if (numbers.length !== 4 || minX !== 0 || minY !== 0 || width !== size || height !== size) {
    throw new Error(`viewBox "${declared ?? '(none)'}" is not 0 0 ${String(size)} ${String(size)}`);
  }
  return `0 0 ${String(size)} ${String(size)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Checks

/**
 * Every colour value an SVG text names in a colour property, as an attribute, in an inline style or in a
 * stylesheet rule, lower-cased and sorted. `none`, `transparent`, `currentcolor`, `inherit` and paint-server
 * references are not colours.
 * @param {string} source
 * @returns {string[]}
 */
export function coloursOf(source) {
  /** @type {Set<string>} */
  const colours = new Set();
  const add = (/** @type {string} */ value) => {
    const normal = value.trim().toLowerCase();
    if (
      normal === '' ||
      /^(none|transparent|currentcolor|inherit)$/.test(normal) ||
      normal.startsWith('url(')
    )
      return;
    colours.add(normal);
  };
  const properties = [...COLOUR_PROPERTIES].join('|');
  for (const match of source.matchAll(
    new RegExp(`(?:^|[\\s"'{;])(${properties})\\s*=\\s*(["'])([^"']*)\\2`, 'g'),
  )) {
    add(/** @type {string} */ (match[3]));
  }
  for (const match of source.matchAll(new RegExp(`(?:^|[\\s"'{;])(${properties})\\s*:\\s*([^;}"']+)`, 'g'))) {
    add(/** @type {string} */ (match[2]));
  }
  return [...colours].sort();
}

/**
 * Counts the drawing elements of an SVG (shapes, groups, `use`, paint servers, clip paths, masks, filters):
 * the transforms must keep every one.
 * @param {string} source
 * @returns {number}
 */
export function drawingElementCount(source) {
  let count = 0;
  walk(parseXml(source), (element) => {
    if (ALLOWED_ELEMENTS.has(element.name) && element.name !== 'svg' && element.name !== 'defs') count += 1;
  });
  return count;
}
