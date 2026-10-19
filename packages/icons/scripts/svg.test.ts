// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import {
  coloursOf,
  drawingElementCount,
  parseStylesheet,
  parseXml,
  serializeXml,
  transformIcon,
} from './lib/svg.mjs';

const LEGACY = { idPrefix: 'icon-x', viewBoxSize: 24 };
const CORE = { idPrefix: 'icon-y', viewBoxSize: 512 };

describe('parseXml / serializeXml', () => {
  it('round-trips elements, attributes and entities', () => {
    const root = parseXml('<svg a="x &amp; &quot;y&quot; &#60;" b=\'1\'><g/><path d="M0 0"></path></svg>');
    expect(root.attributes).toEqual([
      ['a', 'x & "y" <'],
      ['b', '1'],
    ]);
    expect(serializeXml(root)).toBe('<svg a="x &amp; &quot;y&quot; &lt;" b="1"><g/><path d="M0 0"/></svg>');
  });

  it('skips the prolog and keeps comments and CDATA as nodes', () => {
    const root = parseXml(
      '﻿<?xml version="1.0"?>\n<svg><!-- note --><style><![CDATA[.a{fill:red}]]></style></svg>',
    );
    expect(root.children[0]).toEqual({ type: 'comment', value: ' note ' });
    const style = root.children[1];
    expect(style?.type === 'element' ? style.children : []).toEqual([
      { type: 'text', value: '.a{fill:red}' },
    ]);
  });

  it.each([
    ['<!DOCTYPE svg [<!ENTITY a "b">]><svg/>', /DOCTYPE/],
    ['<svg><g></svg>', /unexpected end tag/],
    ['<svg><g>', /unclosed element/],
    ['<svg a="1" a="2"/>', /duplicate attribute/],
    ['<svg/><svg/>', /one root element/],
    ['<svg>&nbsp;</svg>', /unknown XML entity/],
    ['<svg><g a=1/></svg>', /malformed attribute/],
    ['<svg><!-- open</svg>', /unterminated comment/],
  ])('refuses %s', (source, message) => {
    expect(() => parseXml(source)).toThrow(message);
  });
});

describe('parseStylesheet', () => {
  it('reads single-class rules with selector lists and comments', () => {
    expect(
      parseStylesheet('/* x */ .a{fill:#aecbfa;}.a,.b{fill-rule:evenodd} .b { fill : #4285F4 }'),
    ).toEqual([
      { classes: ['a'], declarations: [['fill', '#aecbfa']] },
      { classes: ['a', 'b'], declarations: [['fill-rule', 'evenodd']] },
      { classes: ['b'], declarations: [['fill', '#4285F4']] },
    ]);
  });

  it.each([
    ['path{fill:red}', /unsupported CSS selector/],
    ['.a .b{fill:red}', /unsupported CSS selector/],
    ['#id{fill:red}', /unsupported CSS selector/],
    ['@media print{.a{fill:red}}', /unsupported CSS/],
    ['.a{fill:red !important}', /!important/],
    ['.a{width:10px}', /no presentation attribute/],
    ['.a{fill}', /malformed declaration/],
  ])('refuses %s', (css, message) => {
    expect(() => parseStylesheet(css)).toThrow(message);
  });
});

describe('transformIcon', () => {
  it('turns class rules into presentation attributes in cascade order and drops editor metadata', () => {
    const source = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<svg id="Artwork" data-name="Layer 1" xmlns="http://www.w3.org/2000/svg" width="24px" height="24px" viewBox="0 0 24 24">',
      '  <!-- Generator: Adobe Illustrator -->',
      '  <defs><style>.cls-1{fill:#aecbfa;}.cls-1,.cls-2{fill-rule:evenodd;}.cls-2{fill:#4285f4;}</style></defs>',
      '  <title>Icon_24px_Example_Color</title>',
      '  <g data-name="Product Icons" jetwayHookID="7">',
      '    <path class="cls-1" d="M1 1h2v2z"/>',
      '    <path class="cls-1 cls-2" fill="#000000" d="M3 3h2v2z"/>',
      '    <rect class="cls-2" style="fill:#669df6" x="1" y="1" width="2" height="2"/>',
      '  </g>',
      '</svg>',
    ].join('\n');
    const result = transformIcon(source, LEGACY);
    expect(result.svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g>' +
        '<path d="M1 1h2v2z" fill="#aecbfa" fill-rule="evenodd"/>' +
        // The class rules beat the presentation attribute; the later rule wins for fill.
        '<path fill="#4285f4" d="M3 3h2v2z" fill-rule="evenodd"/>' +
        // The inline style beats the class rule.
        '<rect x="1" y="1" width="2" height="2" fill-rule="evenodd" fill="#669df6"/>' +
        '</g></svg>',
    );
    expect(result.viewBox).toBe('0 0 24 24');
    expect(result.keptComments).toBe(0);
    expect(drawingElementCount(source)).toBe(drawingElementCount(result.svg));
    expect(coloursOf(result.svg)).toEqual(['#4285f4', '#669df6', '#aecbfa']);
  });

  it('keeps a comment that may carry a notice', () => {
    const notice = ' (c) Example Corp. All rights reserved. ';
    const result = transformIcon(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><!--${notice}--><path d="M0 0"/></svg>`,
      LEGACY,
    );
    expect(result.keptComments).toBe(1);
    expect(result.svg).toContain(`<!--${notice}-->`);
  });

  it('drops unreferenced ids, renames referenced ones and follows every reference', () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24">' +
      '<defs><style>.m{mask:url(#mask)}</style>' +
      '<clipPath id="clip"><rect width="4" height="4"/></clipPath>' +
      '<mask id="mask"><rect id="unused" width="24" height="24" fill="#fff"/></mask>' +
      '<path id="shape" d="M0 0h4v4z"/></defs>' +
      '<g class="m" clip-path="url(\'#clip\')"><use xlink:href="#shape"/></g></svg>';
    expect(transformIcon(source, LEGACY).svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24">' +
        '<defs><clipPath id="icon-x-1"><rect width="4" height="4"/></clipPath>' +
        '<mask id="icon-x-2"><rect width="24" height="24" fill="#fff"/></mask>' +
        '<path id="icon-x-3" d="M0 0h4v4z"/></defs>' +
        '<g clip-path="url(\'#icon-x-1\')" mask="url(#icon-x-2)"><use xlink:href="#icon-x-3"/></g></svg>',
    );
  });

  it('removes <defs> left empty and the xlink namespace when nothing uses it', () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" ' +
      'x="0px" y="0px" viewBox="0 0 512 512" xml:space="preserve" fill="none">' +
      '<defs><style>.a{fill:#34a853}</style></defs><desc>d</desc><metadata/><path class="a" d="M0 0"/></svg>';
    expect(transformIcon(source, CORE).svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none"><path d="M0 0" fill="#34a853"/></svg>',
    );
  });

  it('takes the viewBox from width and height when it is missing', () => {
    expect(
      transformIcon('<svg xmlns="http://www.w3.org/2000/svg" width="24px" height="24"/>', LEGACY).viewBox,
    ).toBe('0 0 24 24');
  });

  it.each([
    ['<svg viewBox="0 0 48 48"/>', /is not 0 0 24 24/],
    ['<svg viewBox="2 0 24 24"/>', /is not 0 0 24 24/],
    ['<svg/>', /is not 0 0 24 24/],
    ['<g viewBox="0 0 24 24"/>', /expected <svg>/],
    ['<svg viewBox="0 0 24 24"><text>x</text></svg>', /text content in <text>|unexpected element <text>/],
    ['<svg viewBox="0 0 24 24"><image href="a.png"/></svg>', /unexpected element <image>/],
    ['<svg viewBox="0 0 24 24"><use href="#nowhere"/></svg>', /undefined id/],
    ['<svg viewBox="0 0 24 24"><path style="width:3"/></svg>', /no presentation attribute/],
    ['<svg viewBox="0 0 24 24" preserveAspectRatio="none"/>', /unexpected root attribute/],
    ['<svg viewBox="0 0 24 24"><style type="text/less">.a{}</style></svg>', /is not CSS/],
  ])('refuses %s', (source, message) => {
    expect(() => transformIcon(source, LEGACY)).toThrow(message);
  });

  it('is a fixed point: transforming its own output changes nothing', () => {
    const once = transformIcon(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><style>.a{fill:#4285f4}</style><path class="a" d="M0 0"/></svg>',
      LEGACY,
    ).svg;
    expect(transformIcon(once, LEGACY).svg).toBe(once);
  });
});

describe('coloursOf', () => {
  it('reads colours from attributes, inline styles and rules, but not paint servers or keywords', () => {
    const source =
      '<svg><style>.a{fill:#AECBFA;stroke:none}.b{stop-color:white}</style>' +
      '<path fill="#4285F4" stroke="url(#g)" style="flood-color:#fff;fill-rule:evenodd"/>' +
      '<path fill="currentColor" stroke="transparent" fill-opacity="0.5"/></svg>';
    expect(coloursOf(source)).toEqual(['#4285f4', '#aecbfa', '#fff', 'white']);
  });
});
