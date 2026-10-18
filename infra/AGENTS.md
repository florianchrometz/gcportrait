<!-- SPDX-License-Identifier: Apache-2.0 -->

# AGENTS.md: infra

These rules add to the root AGENTS.md, which applies here too.

## Self-hosting

[docs/self-host.md](../docs/self-host.md) and [docs/self-host-options.md](../docs/self-host-options.md)
are the guides.

- the installer line (`curl -fsSL https://gcportrait.app/install.sh | bash -s -- --project YOUR_PROJECT`)
  downloads the newest release's deploy scripts and checks them against the release's checksums before it
  runs anything;
- `infra/deploy.sh` and `infra/uninstall.sh` are declarative (each run sets the service to its flags), touch
  only what they created (marked by labels and descriptions) and print every change with `--dry-run`; never
  run them against a project you do not own;
- a release image is pulled from ghcr.io through an Artifact Registry remote repository in the operator's
  project, so a redeploy does not depend on ghcr.io;
- `--build` builds the checkout with Cloud Build as an account of its own, `SERVICE-build@PROJECT`, with
  Storage Admin on its labelled build bucket and Artifact Registry Writer on its repository and nothing at
  project level, never as the Compute Engine default account, which often holds Editor on the whole project;
- `--iap` puts Identity-Aware Proxy in front, with user mode inside; `--domain` maps a custom domain through
  a Cloud Run domain mapping in a region that offers them;
- a full instance gets 2 GiB of memory (the render API's worker and pixels need it), a demo-only one 256
  MiB.

- `infra/deploy.sh --demo-only` deploys a demo-only instance with a runtime account of its own that holds no
  role, 256 MiB and at most two instances.

## The service account

The deployment account's roles and the customer's grants follow [AGENTS.md](../AGENTS.md), "Modes and
hosting". The backend's checks follow [backend/AGENTS.md](../backend/AGENTS.md), "The service-account gate".

## Commands

| Goal | Command |
|---|---|
| Deploy your checkout to Cloud Run in a project of yours / remove it again (docs/self-host-options.md; `--dry-run` prints the changes; never against a project you do not own) | `infra/deploy.sh --project YOUR_PROJECT --region europe-west3 --build` / `infra/uninstall.sh --project YOUR_PROJECT --region europe-west3` (`--yes` without a terminal) |
| Check a deployed instance from outside (Cloud Run's front end answers `/healthz` itself) | `curl -s https://YOUR_INSTANCE/api/healthz` (and `/api/config` for its settings) |
| Build and run the production image locally (needs Docker) | `pnpm docker:build`, then `pnpm docker:run` (<http://localhost:8080>) |
| Shell-check the infra scripts after a change / run them offline against stand-ins | `shellcheck -x infra/*.sh` / `pnpm test:infra` |
