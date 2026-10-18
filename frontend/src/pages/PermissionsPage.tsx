// SPDX-License-Identifier: MIT
/**
 * The Permissions page (docs/permissions.md): the preflight checklist with commands, and the
 * service-account mode explanation with the account's email:
 * - "Check a scope": signed in, the scope picker, the quota project (user mode), the mode when the instance offers
 *   service-account mode, and the permission check with its checklist and copy-ready commands; signed out, the
 *   sign-in card;
 * - "What each mode needs": the permission table of docs/permissions.md, its commands' variables as fields to
 *   fill in place, prefilled from what the page knows (preflight/PermissionsGuide.tsx);
 * - "Service-account mode": the explanation of docs/permissions.md §3, the account's email from /api/config and
 *   the gate as this instance runs it (with or without the strict exposure check, `saStrictExposure`).
 * The non-affiliation statement is the footer's, as on every page.
 * In demo mode nothing is checked (there is no backend), nor on a demo-only instance (no sign-in); the
 * guidance stays.
 */
import { ModeSelector } from '../auth/ModeSelector';
import { SignInCard } from '../auth/SignInCard';
import { useDemoOnly } from '../demoOnly';
import { useAppMode } from '../mode';
import { PermissionsReference, ServiceAccountExplainer } from '../preflight/PermissionsGuide';
import { PreflightPanel } from '../preflight/PreflightPanel';
import { ScopeStep } from '../scope/ScopeStep';
import { useAppState } from '../state';
import page from './Page.module.css';
import styles from './PermissionsPage.module.css';
import { useDocumentTitle } from './useDocumentTitle';

function CheckSection() {
  const status = useAppState((state) => state.connect.session.status);
  const signedIn = status === 'signed-in' || status === 'expired';
  return (
    <section className={page.section} aria-labelledby="permissions-check">
      <h2 id="permissions-check" className={page.sectionTitle}>
        Check a scope
      </h2>
      {signedIn ? (
        <div className={styles.check}>
          <ModeSelector disabled={status === 'expired' ? 'Sign in again first' : undefined} />
          <ScopeStep disabled={status === 'expired' ? 'Sign in again first' : undefined} />
          <PreflightPanel />
        </div>
      ) : (
        <div className={styles.check}>
          <p className={page.note}>
            Sign in to check what gcportrait can read in an organisation, folder or project, and what to grant
            if something is missing.
          </p>
          <SignInCard />
        </div>
      )}
    </section>
  );
}

export function PermissionsPage() {
  useDocumentTitle('Permissions');
  const { demo } = useAppMode();
  const demoOnly = useDemoOnly();
  const backend = useAppState((state) => state.connect.backend);
  const scope = useAppState((state) => state.connect.scope);
  const config = backend.status === 'ready' ? backend.config : null;
  const serviceAccount = config?.saMode === true ? config.backendServiceAccount : null;

  return (
    <div className={page.page}>
      <div className={page.intro}>
        <h1 className={page.title}>Permissions</h1>
        <p className={page.lead}>
          gcportrait reads Cloud Asset Inventory with your own access, or with a service account your
          organisation grants. It only ever reads.
        </p>
      </div>

      {demo ? (
        <p className={page.note}>
          Demo mode needs no permissions: its organisations are made up in this browser. Checking a real scope
          needs the backend and a Google sign-in.
        </p>
      ) : demoOnly ? (
        <p className={page.note}>
          This instance is a demo: its organisations are made up in this browser, and it offers no sign-in, so
          no scope can be checked here. Deployed to a Google Cloud project of yours, gcportrait checks a real
          scope and shows the exact commands for anything missing.
        </p>
      ) : (
        <CheckSection />
      )}

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
    </div>
  );
}
