<!-- SPDX-License-Identifier: Apache-2.0 -->

# infra/

gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is
not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are
trademarks of Google and are used under Google's icon usage terms.

Everything that builds the production image and puts an instance on Cloud Run. The guide is the self-hosting
guide, <https://gcportrait.app/docs/self-host/> (`docs/self-host.md` in the repository); every option, with its
default and an example, is in <https://gcportrait.app/docs/self-host-options/> (`docs/self-host-options.md`), and
every flag and variable in the configuration reference, <https://gcportrait.app/docs/configuration/>
(`docs/configuration.md`).

## Deploy

```sh
curl -fsSL https://gcportrait.app/install.sh | bash -s -- --project YOUR_PROJECT
```

The project id is all it needs. The installer downloads the deploy scripts of the newest release, checks them
against the release's `checksums.txt`, keeps them in a folder `gcportrait-vX.Y.Z` and runs its
`infra/deploy.sh` with the release's image; every other flag passes through to deploy.sh. deploy.sh ends with
the next steps: open the address, create the OAuth client (the console link and the origins it prints),
redeploy with `--oauth-client-id`, with the exact command.

A release's deploy scripts are `deploy.sh`, `common.sh`, `uninstall.sh`, `install.sh` and this README, with
the release's tag in `VERSION` next to this folder. Run them by their path:
`infra/deploy.sh --image vX.Y.Z --project YOUR_PROJECT ...` in the folder that holds `VERSION` (the
installer's `gcportrait-vX.Y.Z`), or `gcportrait-vX.Y.Z/infra/deploy.sh ...` from where the installer ran. The
commands deploy.sh prints at its end name the scripts by their path from the directory you ran it in.

| File | What it does |
|---|---|
| `install.sh` | The one-line installer, served as `https://gcportrait.app/install.sh` (the website's build copies it as it is): downloads a release's deploy scripts, checks their SHA-256 against the release's `checksums.txt` before it unpacks or runs anything, and runs their `deploy.sh --image TAG` with the other arguments. |
| `deploy.sh` | Deploys an instance: APIs, the backend's service account (no roles), the image, the Cloud Run service, optionally Identity-Aware Proxy, a domain mapping and legal pages; then checks it and prints the next steps. Declarative and idempotent; `--dry-run` prints every change. |
| `uninstall.sh` | Removes exactly what `deploy.sh` created, found by its marks. |
| `common.sh` | Sourced by the scripts: names, marks, the published image, the remote repository, shared checks and helpers. |
| `Dockerfile` | The production image: the SPA and the backend bundled into one file on a distroless Node base, as a non-root user. Built by `deploy.sh --build` in a clone (through `cloudbuild.yaml`), by the release workflow (`.github/workflows/release.yml`, for linux/amd64 and linux/arm64) and by the Cloud Run Button (`app.json` at the repository root). Not part of a release's deploy scripts. |
| `cloudbuild.yaml` | The Cloud Build configuration of `deploy.sh --build`. |
| `cloud-run-button.sh` | The Cloud Run Button's `postcreate` hook (`app.json`): the settings the button cannot set, and the next steps. |
| `compose.yaml` | Runs an image of your checkout on your machine (`pnpm docker:build`, then `pnpm docker:run`). |

## Where the image comes from

- **A release (the default).** `.github/workflows/release.yml` publishes `ghcr.io/florianchrometz/gcportrait`
  on every `v*` tag, with the deploy scripts and `checksums.txt` attached to the GitHub release. `deploy.sh`
  (without `--build`) first asks ghcr.io, anonymously, whether the image exists, then creates once per project
  and region an Artifact Registry remote repository `ghcr` (upstream `https://ghcr.io`, labelled
  `managed-by=gcportrait-deploy`) and deploys
  `REGION-docker.pkg.dev/PROJECT/ghcr/florianchrometz/gcportrait:TAG` from it. Cloud Run could run a public
  ghcr.io image directly, but Google recommends the remote repository for availability; it keeps a copy of
  each image it fetched. `uninstall.sh` deletes the repository with the last instance that deploys from it.
- **Your checkout.** In a clone of the repository, `deploy.sh --build` uploads the checkout and builds
  `Dockerfile` with Cloud Build in your project, into a repository and with a build account of the instance's
  own.
- **The Cloud Run Button.** Builds `Dockerfile` in Cloud Shell and deploys it with the button's defaults; the
  hook adds the rest. The self-hosting options' "Run on Google Cloud" lists its limits.

## Checking a change

```sh
shellcheck -x infra/*.sh     # from the repository root
pnpm test:infra              # the scripts and the installer against stand-ins for gcloud, curl and GitHub
```

`scripts/infra.test.ts` and the tests beside it run the scripts end to end with bash against stand-ins that
answer from a rule list and log every call, so nothing reaches Google; they also run every command of
`docs/cloudshell-tutorial.md`. `scripts/infra-install.test.ts` runs the installer against the deploy scripts
`scripts/release-assets.sh` packs, as a release attaches them, served from a local folder in place of GitHub.
`scripts/cloud-run-button.test.ts` checks `app.json` against the Cloud Run Button's file format. Never run the
scripts against a project you do not own.
