<!-- SPDX-License-Identifier: MIT -->

# 0030. `deploy.sh --build` runs Cloud Build as a build account of its own

- **Status:** accepted (2026-10-12): built, tested and used in the timed deploy run; accepted on the
  maintainer's behalf by the build orchestrator, who decided on 2026-10-11 to accept ADRs 0030 to 0032. The
  maintainer may reopen it.
- **Date:** 2026-10-10 (accepted 2026-10-12)
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** [docs/self-host.md](../self-host.md), "What deploy.sh does" and "What Google adds by itself"

## Context

The first design asked `infra/deploy.sh --build` to run a regional Cloud Build with "the project's compute SA"
and a regional bucket owned by the user. deploy.sh names the account each build runs as, rather than relying on
whichever default Google picks for the project. Google creates the Compute Engine default account when a
project enables Compute Engine, and also, as observed on 2026-10-10, right after deploy.sh enabled Cloud Run and
Cloud Build ([docs/self-host.md](../self-host.md), "What Google adds by itself"); in projects without the
secure-by-default organisation policies Google grants it Editor on the whole project, and enabling the Compute
Engine API can also create a default network. A build needs much less: write its own source and logs
bucket and push to one repository.

## Decision

`deploy.sh --build` creates `SERVICE-build@PROJECT.iam.gserviceaccount.com` (marked by its description, removed
by `uninstall.sh`) and submits every build as that account. Its only grants are `roles/storage.admin` on the
instance's build bucket (the role Google documents for a build account with logs in a bucket of the user's:
Cloud Build reads the bucket itself before it accepts a build) and `roles/artifactregistry.writer` on the
instance's build repository. Nothing at project level or above. The build bucket is used only when it belongs
to the project and carries `managed-by=gcportrait-deploy`.

## Consequences

The Compute Engine API is not needed, and nothing in a gcportrait instance relies on the Compute Engine
default account or on Editor. deploy.sh needs `roles/iam.serviceAccountAdmin` and `roles/iam.serviceAccountUser`
to create the account and act as it (Owner covers both). A new account takes a minute or two to propagate, so
deploy.sh repeats the grants and the build submission while Google refuses them for that reason
(`scripts/infra.test.ts` checks that it repeats nothing else). Google may still grant Editor to the Compute
Engine default account when another API is enabled; deploy.sh warns when it finds that grant.

## Alternatives considered

- The Compute Engine default account, as the first design said: in many projects it holds Editor on the whole
  project, and other workloads of the project may share it.
- The legacy Cloud Build account (`PROJECT_NUMBER@cloudbuild.gserviceaccount.com`): Google no longer makes it
  the default build identity in new projects, and its default role covers the whole project.
