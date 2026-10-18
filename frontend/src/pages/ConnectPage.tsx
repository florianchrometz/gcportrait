// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef } from 'react';

import { ModeSelector } from '../auth/ModeSelector';
import { SIGN_IN_ACTION, SignInCard } from '../auth/SignInCard';
import type { BackendState } from '../auth/types';
import { NON_AFFILIATION_LONG } from '../branding';
import { cx } from '../classNames';
import { useDemoOnly, useLegalPages } from '../demoOnly';
import { LoadExport } from '../import/LoadExport';
import { legalTarget } from '../legal/api';
import { LegalPageLink } from '../legal/LegalLinks';
import { PullNow } from '../import/PullNow';
import { ScopeStep } from '../scope/ScopeStep';
import { DemoEntry } from '../snapshots/DemoEntry';
import { useAppState } from '../state';
import controls from '../ui/controls.module.css';
import { INERT_HINT } from '../ui/dom';
import { SELF_HOST_GUIDE_URL } from '../projectSite';
import styles from './ConnectPage.module.css';
import page from './Page.module.css';
import { useDocumentTitle } from './useDocumentTitle';

type Source = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** The card's action (the export card's is its panel, import/LoadExport.tsx). */
  readonly action: string;
};

const DEMO_SOURCE: Source = {
  id: 'demo',
  title: 'Demo organisations',
  description: 'Explore synthetic organisations of different sizes. No Google account and no backend needed.',
  action: 'Try the demo',
};

const SIGN_IN_SOURCE: Source = {
  id: 'sign-in',
  title: 'Your Google Cloud environment',
  description: 'Read an organisation, folder or project with your own Cloud Asset Inventory permissions.',
  action: SIGN_IN_ACTION,
};

const EXPORT_SOURCE: Source = {
  id: 'export',
  title: 'Cloud Asset Inventory export',
  description: 'Open the output of an asset export, from files or from Cloud Storage. Nothing is uploaded.',
  action: 'Load export',
};

/** The export card comes last and spans the row: its panel needs the room. */
const LIVE_SOURCES: readonly Source[] = [SIGN_IN_SOURCE, DEMO_SOURCE, EXPORT_SOURCE];

/**
 * The start page: where a diagram's data comes from, plus the About block with the non-affiliation statement.
 * "Try the demo" (snapshots/DemoEntry.tsx); "Sign in with Google" (auth/SignInCard.tsx), after which
 * the "Read your environment" section offers the mode (auth/ModeSelector.tsx), the scope and "Pull now".
 *
 * Two variants: a demo-only instance (the backend's DEMO_ONLY, such as the maintainer's sign-in-free demo) and a demo
 * build (`pnpm dev:demo`, `pnpm demo:static`), which builds that configuration in, offer the demo organisations only,
 * the way to deploy gcportrait to one's own Google Cloud project and a note that the demo processes no personal data.
 * Live mode offers every source once the backend has answered; until then only the demo, which every variant has, so
 * the sources of the other variant never flash up while /api/config is on its way.
 */
export function ConnectPage() {
  const demoOnly = useDemoOnly();
  const backendStatus = useAppState((state) => state.connect.backend.status);
  useDocumentTitle('Connect');
  const deciding = backendStatus === 'loading';
  const sources = demoOnly || deciding ? [DEMO_SOURCE] : LIVE_SOURCES;

  return (
    <div className={page.page}>
      <div className={page.intro}>
        <h1 className={page.title}>Connect</h1>
        <p className={page.lead}>
          gcportrait draws a Google Cloud organisation, folder or project as an architecture diagram, from
          Cloud Asset Inventory data.
        </p>
      </div>

      <section className={page.section} aria-labelledby="connect-sources">
        <h2 id="connect-sources" className={page.sectionTitle}>
          {demoOnly ? 'Demo mode' : 'Choose a source'}
        </h2>
        <ul className={styles.sources}>
          {sources.map((source) => (
            <li
              key={source.id}
              className={cx(styles.source, source.id === EXPORT_SOURCE.id && styles.wideSource)}
            >
              <h3 className={styles.sourceTitle}>{source.title}</h3>
              <p className={styles.sourceDescription}>{source.description}</p>
              {source.id === DEMO_SOURCE.id ? (
                <DemoEntry action={source.action} />
              ) : source.id === SIGN_IN_SOURCE.id ? (
                <SignInCard />
              ) : source.id === EXPORT_SOURCE.id ? (
                <LoadExport />
              ) : (
                <div className={styles.sourceAction}>
                  <button
                    type="button"
                    className={styles.button}
                    aria-disabled="true"
                    aria-describedby={`${source.id}-hint`}
                  >
                    {source.action}
                  </button>
                  <span id={`${source.id}-hint`} className={page.note}>
                    {INERT_HINT}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {demoOnly ? <SelfHost /> : null}
      {demoOnly ? <DemoPrivacy /> : null}
      {demoOnly || deciding ? null : <Environment />}
      {demoOnly ? null : <BackendStatus />}

      <section className={cx(page.section, styles.about)} aria-labelledby="connect-about">
        <h2 id="connect-about" className={page.sectionTitle}>
          About
        </h2>
        <p>{NON_AFFILIATION_LONG}</p>
      </section>
    </div>
  );
}

/**
 * A demo-only instance: the call to deploy gcportrait to one's own Google Cloud project, a link to the
 * self-hosting guide on the website, which starts with the one-line installer and the "Open in Cloud Shell" button.
 */
function SelfHost() {
  return (
    <section className={cx(page.section, styles.selfHost)} aria-labelledby="connect-self-host">
      <h2 id="connect-self-host" className={page.sectionTitle}>
        Your own Google Cloud
      </h2>
      <p>
        This demo draws made-up organisations. To draw your own organisation, folder or project, run
        gcportrait in a Google Cloud project of yours: one Cloud Run service that one script sets up, with
        your own Google sign-in and your own permissions. The guide starts with a one-line installer, with an
        &ldquo;Open in Cloud Shell&rdquo; button for those without a terminal.
      </p>
      <p>
        <a className={cx(controls.control, controls.primary, styles.cta)} href={SELF_HOST_GUIDE_URL}>
          Deploy gcportrait to your own Google Cloud project
        </a>
      </p>
    </section>
  );
}

/**
 * A demo-only instance and the static demo: what it does with personal data, which is nothing, and the privacy
 * notice when it publishes one, as its own page or linked elsewhere (legal/).
 */
function DemoPrivacy() {
  const privacy = legalTarget(useLegalPages(), 'privacy');
  return (
    <section className={page.section} aria-labelledby="connect-demo-privacy">
      <h2 id="connect-demo-privacy" className={page.sectionTitle}>
        No personal data
      </h2>
      <p className={page.note}>
        This demo processes no personal data: it has no sign-in, reads nothing from Google Cloud and stores
        nothing on its server. The demo organisations are synthetic, generated in your browser and kept only
        there.
        {privacy === null ? null : (
          <>
            {' '}
            The <LegalPageLink id="privacy" target={privacy} text="privacy notice" /> has the details.
          </>
        )}
      </p>
    </section>
  );
}

/**
 * After sign-in: read with which identity (the mode), which scope (scope/ScopeStep.tsx, also on the
 * Permissions page), then "Pull now" (import/PullNow.tsx); they coordinate through the app store's
 * `connect` slice only. Shown while signed in, and after an expiry with its controls inert. When a sign-in
 * completes, focus moves to this section's heading (the sign-in button that had it is gone).
 */
function Environment() {
  const status = useAppState((state) => state.connect.session.status);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previous = useRef(status);

  useEffect(() => {
    if (previous.current === 'signing-in' && status === 'signed-in') headingRef.current?.focus();
    previous.current = status;
  }, [status]);

  if (status !== 'signed-in' && status !== 'expired') return null;
  const inert = status === 'expired' ? 'Sign in again first' : undefined;
  return (
    <section className={page.section} aria-labelledby="connect-environment">
      <h2 id="connect-environment" ref={headingRef} tabIndex={-1} className={page.sectionTitle}>
        Read your environment
      </h2>
      <div className={styles.steps}>
        <ModeSelector disabled={inert} />
        <ScopeStep disabled={inert} />
        <PullStep />
      </div>
    </section>
  );
}

/** The live pull (import/PullNow.tsx) of the chosen scope into a snapshot in this browser. */
function PullStep() {
  return <PullNow />;
}

function describeBackend(backend: BackendState): string {
  switch (backend.status) {
    case 'loading':
      return 'Checking the backend…';
    case 'unavailable':
      return 'The backend did not answer. Sign-in and live import need it; the demo does not.';
    case 'ready': {
      const signIn = backend.config.oauthClientId === null ? 'not configured' : 'configured';
      const saMode = backend.config.saMode ? 'on' : 'off';
      return `Backend version ${backend.config.version}. Google sign-in is ${signIn}; service-account mode is ${saMode}.`;
    }
  }
}

/** Live mode only: what the backend reports through GET /api/config (auth/AuthProvider.tsx asks once). */
function BackendStatus() {
  const backend = useAppState((state) => state.connect.backend);
  return (
    <section className={page.section} aria-labelledby="connect-backend">
      <h2 id="connect-backend" className={page.sectionTitle}>
        Backend
      </h2>
      <p role="status" className={page.note}>
        {describeBackend(backend)}
      </p>
    </section>
  );
}
