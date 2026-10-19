// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef } from 'react';

import { ModeSelector } from '../auth/ModeSelector';
import { SIGN_IN_ACTION, SignInCard } from '../auth/SignInCard';
import type { BackendState } from '../auth/types';
import { NON_AFFILIATION_LONG } from '../branding';
import { cx } from '../classNames';
import { useDemoOnly, useLegalPages } from '../demoOnly';
import { LoadExport } from '../import/LoadExport';
import { PullNow } from '../import/PullNow';
import { legalTarget } from '../legal/api';
import { LegalPageLink } from '../legal/LegalLinks';
import { PermissionsReference, ServiceAccountExplainer } from '../preflight/PermissionsGuide';
import { PreflightPanel } from '../preflight/PreflightPanel';
import { SELF_HOST_GUIDE_URL } from '../projectSite';
import { ScopeStep } from '../scope/ScopeStep';
import { DemoEntry } from '../snapshots/DemoEntry';
import { useAppState } from '../state';
import controls from '../ui/controls.module.css';
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

/**
 * The start page: where a diagram's data comes from, the guided environment and permission check flow, the
 * permissions reference for each mode, plus the About block with the non-affiliation statement.
 *
 * Two variants: a demo-only instance (the backend's DEMO_ONLY, such as the maintainer's sign-in-free demo) and a demo
 * build (`pnpm dev:demo`, `pnpm demo:static`), which builds that configuration in, offer the demo organisations only,
 * the way to deploy gcportrait to one's own Google Cloud project and a note that the demo processes no personal data.
 * Live mode offers Your Google Cloud environment (with its guided step-by-step flow after sign-in) and Cloud Asset
 * Inventory export once the backend has answered; until then only the demo, which every variant has, so the sources
 * of the other variant never flash up while /api/config is on its way.
 */
export function ConnectPage() {
  const demoOnly = useDemoOnly();
  const backend = useAppState((state) => state.connect.backend);
  const scope = useAppState((state) => state.connect.scope);
  useDocumentTitle('Connect');
  const deciding = backend.status === 'loading';
  const config = backend.status === 'ready' ? backend.config : null;
  const serviceAccount = config?.saMode === true ? config.backendServiceAccount : null;

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
        {demoOnly || deciding ? (
          <ul className={styles.sources}>
            <li className={cx(styles.source, styles.wideSource)}>
              <h3 className={styles.sourceTitle}>{DEMO_SOURCE.title}</h3>
              <p className={styles.sourceDescription}>{DEMO_SOURCE.description}</p>
              <DemoEntry action={DEMO_SOURCE.action} />
            </li>
          </ul>
        ) : (
          <div className={styles.sourceStack}>
            <ul className={styles.sources}>
              <li className={cx(styles.source, styles.wideSource)}>
                <h3 className={styles.sourceTitle}>{SIGN_IN_SOURCE.title}</h3>
                <p className={styles.sourceDescription}>{SIGN_IN_SOURCE.description}</p>
                <SignInCard />
              </li>
            </ul>
            <Environment />
            <ul className={styles.sources}>
              <li className={cx(styles.source, styles.wideSource)}>
                <h3 className={styles.sourceTitle}>{EXPORT_SOURCE.title}</h3>
                <p className={styles.sourceDescription}>{EXPORT_SOURCE.description}</p>
                <LoadExport />
              </li>
            </ul>
          </div>
        )}
      </section>

      {demoOnly ? <SelfHost /> : null}
      {demoOnly ? <DemoPrivacy /> : null}

      {demoOnly ? (
        <p className={page.note}>
          This instance is a demo: its organisations are made up in this browser, and it offers no sign-in, so
          no scope can be checked here. Deployed to a Google Cloud project of yours, gcportrait checks a real
          scope and shows the exact commands for anything missing.
        </p>
      ) : null}

      <section className={page.section} aria-labelledby="permissions-reference">
        <h2 id="permissions-reference" className={page.sectionTitle}>
          What each mode needs
        </h2>
        <PermissionsReference scope={scope} serviceAccount={serviceAccount} />
      </section>

      <section className={page.section} aria-labelledby="permissions-sa">
        <h2 id="permissions-sa" className={page.sectionTitle}>
          Service-account mode
        </h2>
        <ServiceAccountExplainer
          offered={config?.saMode === true}
          serviceAccount={serviceAccount}
          scope={scope?.scope ?? null}
          strictExposure={config?.saMode === true && config.saStrictExposure}
        />
      </section>

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
 * self-hosting guide on the website, which starts with the one-line installer.
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
        your own Google sign-in and your own permissions. The guide starts with a one-line installer.
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
 * After sign-in: a guided step-by-step workflow to choose identity and scope (ModeSelector + ScopeStep),
 * check and grant permissions inline (PreflightPanel), and pull the inventory (PullNow); they coordinate
 * through the app store's `connect` slice only. Shown while signed in, and after an expiry with its controls
 * inert. When a sign-in completes, focus moves to this section's heading (the sign-in button that had it is gone).
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
    <section id="permissions-check" className={page.section} aria-labelledby="connect-environment">
      <h2 id="connect-environment" ref={headingRef} tabIndex={-1} className={page.sectionTitle}>
        Read your environment
      </h2>
      <div role="region" aria-label="Check a scope" className={styles.steps}>
        <div className={styles.step}>
          <p className={styles.stepLabel}>Step 1 · Choose identity and scope</p>
          <ModeSelector disabled={inert} />
          <ScopeStep disabled={inert} />
        </div>
        <div className={styles.step}>
          <p className={styles.stepLabel}>Step 2 · Check and grant permissions</p>
          <PreflightPanel />
        </div>
        <div className={styles.step}>
          <p className={styles.stepLabel}>Step 3 · Pull inventory</p>
          <PullStep />
        </div>
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
