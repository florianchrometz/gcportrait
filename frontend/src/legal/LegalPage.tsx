// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router';

import { cx } from '../classNames';
import { useLegalPages } from '../demoOnly';
import page from '../pages/Page.module.css';
import { useDocumentTitle } from '../pages/useDocumentTitle';
import controls from '../ui/controls.module.css';
import { useAppState } from '../state';
import { fetchLegalTexts, legalTarget, type LegalPageId, type LegalTexts } from './api';
import { ExternalLegalLink } from './ExternalLegalLink';
import styles from './Legal.module.css';
import { renderInlines, MarkdownBlocks } from './RenderMarkdown';
import { parseMarkdown } from './markdown';

/** Each page's name: its `<h1>` when the text does not begin with a heading of its own, and its tab title. */
export const LEGAL_PAGE_TITLES: Readonly<Record<LegalPageId, string>> = {
  impressum: 'Impressum',
  privacy: 'Privacy notice',
};

/** How a sentence names each page ("This instance publishes no …"). */
const LEGAL_PAGE_NOUNS: Readonly<Record<LegalPageId, string>> = {
  impressum: 'Impressum',
  privacy: 'privacy notice',
};

/** The footer's link text for each page. */
export const LEGAL_LINK_TEXTS: Readonly<Record<LegalPageId, string>> = {
  impressum: 'Impressum',
  privacy: 'Privacy',
};

type TextState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly texts: LegalTexts }
  | { readonly status: 'failed' };

/**
 * /impressum and /privacy: the instance's own texts, written by whoever runs it and given to the backend
 * (LEGAL_DIR or LEGAL_BUNDLE), fetched from GET /api/legal when the page opens and rendered from Markdown without any
 * HTML (markdown.ts, RenderMarkdown.tsx). A text that starts with a level-1 heading supplies the page's `<h1>`; otherwise the
 * page's own name does, and the text's headings move one level down. A page the instance links instead
 * (LEGAL_IMPRESSUM_URL, LEGAL_PRIVACY_URL; the static demo's maintainer pages) is a link to it here, in a new tab like
 * the footer's (ExternalLegalLink.tsx), so an old link or a typed address still leads there. An instance without the
 * page (a demo build, which asks no backend, included) says that it publishes none; the footer links only what exists.
 */
export function LegalPage({ id }: { readonly id: LegalPageId }): ReactElement {
  const title = LEGAL_PAGE_TITLES[id];
  useDocumentTitle(title);
  const backend = useAppState((state) => state.connect.backend.status);
  const pages = useLegalPages();
  const published = pages[id];
  const target = legalTarget(pages, id);
  const [state, setState] = useState<TextState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!published) return undefined;
    const controller = new AbortController();
    setState({ status: 'loading' });
    void fetchLegalTexts(controller.signal).then((texts) => {
      if (controller.signal.aborted) return;
      setState(texts === null ? { status: 'failed' } : { status: 'ready', texts });
    });
    return () => {
      controller.abort();
    };
  }, [published, attempt]);

  const text = state.status === 'ready' ? state.texts[id] : null;
  const blocks = useMemo(() => (text === null ? [] : parseMarkdown(text)), [text]);
  const first = blocks[0];
  const ownTitle = first?.kind === 'heading' && first.level === 1 ? first : null;

  const waiting = backend === 'loading';
  let body: ReactElement;
  if (waiting || (published && state.status === 'loading')) {
    body = (
      <p role="status" className={page.note}>
        Loading…
      </p>
    );
  } else if (target?.kind === 'linked') {
    body = (
      <div className={styles.text}>
        <p className={page.lead}>
          The {LEGAL_PAGE_NOUNS[id]} is published on {target.host}:{' '}
          <ExternalLegalLink url={target.url} host={target.host} text={target.url} />
        </p>
      </div>
    );
  } else if (!published || (state.status === 'ready' && text === null)) {
    body = (
      <p className={page.lead}>
        This instance publishes no {LEGAL_PAGE_NOUNS[id]}. Back to the <Link to="/">Connect</Link> page.
      </p>
    );
  } else if (state.status === 'failed') {
    body = (
      <div className={page.section}>
        <p role="alert" className={page.lead}>
          The text could not be loaded.
        </p>
        <p>
          <button
            type="button"
            className={cx(controls.control, controls.primary)}
            onClick={() => {
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </p>
      </div>
    );
  } else {
    body = (
      <div className={styles.text}>
        <MarkdownBlocks
          blocks={ownTitle === null ? blocks : blocks.slice(1)}
          shift={ownTitle === null ? 1 : 0}
        />
      </div>
    );
  }

  return (
    <div className={page.page}>
      <div className={page.intro}>
        <h1 className={page.title}>{ownTitle === null ? title : renderInlines(ownTitle.children)}</h1>
      </div>
      {body}
    </div>
  );
}
