// SPDX-License-Identifier: MIT
/**
 * The scope step of reading a live environment: the scope picker and, in user mode, the
 * quota project picker, both writing the app store's `connect` slice (useScopeTarget.ts). The Permissions page
 * shows it above the permission check; the Connect page can show it in its "Read your environment" section.
 */
import type { ReactElement } from 'react';

import { useAppState } from '../state';
import styles from './ScopePicker.module.css';
import { ScopePicker } from './ScopePicker';
import { useScopeTarget } from './useScopeTarget';

const PROJECT_KINDS = ['project'] as const;

export function ScopeStep({ disabled }: { readonly disabled?: string | undefined }): ReactElement {
  const { scope, quotaProject, recent, chooseScope, chooseQuotaProject } = useScopeTarget();
  const mode = useAppState((state) => state.connect.mode);
  const signedIn = useAppState((state) => state.connect.session.status === 'signed-in');

  const quotaDescription =
    scope?.kind === 'project'
      ? 'Optional: gcportrait first tries the project itself. Pick another one if that project cannot pay for the requests.'
      : 'A project of yours that pays for the requests: the Cloud Asset API enabled in it, and you allowed to use it ' +
        '(serviceusage.services.use).';

  return (
    <div className={styles.step}>
      <ScopePicker
        label="Scope"
        value={scope}
        onChange={chooseScope}
        recent={recent}
        searchEnabled={signedIn}
        disabled={disabled}
        placeholder="Search, or type organizations/ID, folders/ID or projects/ID"
        description="An organisation, folder or project to draw."
      />
      {mode === 'user' ? (
        <ScopePicker
          label="Quota project"
          kinds={PROJECT_KINDS}
          value={
            quotaProject === null
              ? null
              : { kind: 'project', scope: `projects/${quotaProject}`, id: quotaProject }
          }
          onChange={(choice) => {
            chooseQuotaProject(choice?.id ?? null);
          }}
          searchEnabled={signedIn}
          disabled={disabled}
          placeholder="Search your projects, or type a project id"
          description={quotaDescription}
        />
      ) : null}
    </div>
  );
}
