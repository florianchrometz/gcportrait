// SPDX-License-Identifier: Apache-2.0
import type { ReactElement, ReactNode } from 'react';
import { Link } from '../router';

import type { Block, HeadingLevel, Inline } from './markdown';

/**
 * Renders the blocks of markdown.ts as React elements: text is always text (React escapes it), and the only
 * attributes ever set are a link's `href`, which `safeHref` has already restricted to `http:`, `https:`,
 * `mailto:` and this site's own paths (those navigate inside the app). No `dangerouslySetInnerHTML`, so no HTML from a legal text can reach the
 * page.
 *
 * `shift` moves every heading down by that many levels (capped at 6), so the page's own `<h1>` stays the only one.
 */
export function MarkdownBlocks({
  blocks,
  shift = 0,
}: {
  readonly blocks: readonly Block[];
  readonly shift?: number;
}): ReactElement {
  return <>{blocks.map((block, index) => renderBlock(block, index, shift))}</>;
}

function headingTag(level: HeadingLevel, shift: number): 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' {
  const shifted = Math.min(6, Math.max(1, level + shift));
  switch (shifted) {
    case 1:
      return 'h1';
    case 2:
      return 'h2';
    case 3:
      return 'h3';
    case 4:
      return 'h4';
    case 5:
      return 'h5';
    default:
      return 'h6';
  }
}

function renderBlock(block: Block, key: number, shift: number): ReactNode {
  switch (block.kind) {
    case 'heading': {
      const Tag = headingTag(block.level, shift);
      return <Tag key={key}>{renderInlines(block.children)}</Tag>;
    }
    case 'paragraph':
      return <p key={key}>{renderInlines(block.children)}</p>;
    case 'rule':
      return <hr key={key} />;
    case 'list': {
      const items = block.items.map((item, index) => <li key={index}>{renderInlines(item)}</li>);
      return block.ordered ? (
        <ol key={key} start={block.start === 1 ? undefined : block.start}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      );
    }
  }
}

export function renderInlines(nodes: readonly Inline[]): ReactNode[] {
  return nodes.map((node, index) => renderInline(node, index));
}

function renderInline(node: Inline, key: number): ReactNode {
  switch (node.kind) {
    case 'text':
      return node.text;
    case 'strong':
      return <strong key={key}>{renderInlines(node.children)}</strong>;
    case 'emphasis':
      return <em key={key}>{renderInlines(node.children)}</em>;
    case 'code':
      return <code key={key}>{node.text}</code>;
    case 'break':
      return <br key={key} />;
    case 'link':
      // A path on this site (`/privacy`) stays in the app; anything else is an ordinary link.
      return node.href.startsWith('/') ? (
        <Link key={key} to={node.href}>
          {renderInlines(node.children)}
        </Link>
      ) : (
        <a key={key} href={node.href}>
          {renderInlines(node.children)}
        </a>
      );
  }
}
