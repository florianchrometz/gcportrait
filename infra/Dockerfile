# syntax=docker/dockerfile:1
# SPDX-License-Identifier: MIT
#
# The gcportrait production image (docs/self-host-options.md, "Run the image locally"): the built SPA and the backend bundled into one ESM file,
# on a distroless Node 22 base that runs as a non-root user. Build from the repository root:
#
#   docker build -f infra/Dockerfile -t gcportrait:local .        (or: pnpm docker:build)
#
# infra/deploy.sh --build builds this file with Cloud Build (infra/cloudbuild.yaml) and .github/workflows/
# release.yml publishes it on v* tags. The image needs nothing at run time but its environment
# (docs/configuration.md): it listens on PORT (8080), serves the SPA, /healthz and /api/*, and keeps no state.
#
# It works with the classic builder and BuildKit alike (no cache or secret mounts), because Cloud Build's docker
# step may use either. Both base images are pinned by digest, on literal FROM lines so that Dependabot can propose
# their updates (.github/dependabot.yml; it does not read images from build arguments); bump the tag and the digest
# together.

# ---------------------------------------------------------------------------------------------------------------
# Stage 1: install the workspace from the lockfile, build the SPA and bundle the backend.
# ---------------------------------------------------------------------------------------------------------------
FROM node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build

# CI=true: pnpm installs without prompts and treats the lockfile as frozen. Corepack provides the pnpm version
# pinned in package.json ("packageManager") without asking.
ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /src

# Dependencies first, from the lockfile alone, so this layer is reused while only sources change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN corepack enable && pnpm --version && pnpm fetch

# Then the sources (.dockerignore keeps out node_modules, build output, docs and local env files).
COPY . .
# --offline: everything comes from the store filled by `pnpm fetch`. The root `prepare` script compiles the
# asset catalog (packages/catalog/src/generated/, a git-ignored build artefact the SPA build reads).
RUN pnpm install --frozen-lockfile --offline

# The SPA (frontend/dist, with the font and gcportrait licences under licenses/ and THIRD_PARTY_NOTICES.txt, the
# notices of every third-party package in the app and the server: scripts/third-party-notices.mjs) and
# the backend bundles (backend/dist/server.mjs; the render API's worker, render-worker.mjs, with what it reads at run
# time in render-assets/: resvg's WebAssembly module and the Roboto faces; their source maps; and the
# licences of the npm packages inlined into them or copied). An image never ships without its notices: the build
# stops here if the file is missing or empty.
RUN pnpm --filter @gcportrait/frontend run build \
 && pnpm --filter @gcportrait/backend run bundle \
 && test -s frontend/dist/licenses/THIRD_PARTY_NOTICES.txt

# ---------------------------------------------------------------------------------------------------------------
# Stage 2: the runtime. No shell, no package manager, no node_modules: Node, the bundle and the SPA.
# ---------------------------------------------------------------------------------------------------------------
FROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:13593b7570658e8477de39e2f4a1dd25db2f836d68a0ba771251572d23bb4f8e

# The version /healthz and /api/config report: the release workflow passes the git tag, deploy.sh --build the
# output of `git describe`.
ARG APP_VERSION=dev

# The description is the long form of the non-affiliation statement; the licence is
# gcportrait's own (MIT). Third-party material in the image keeps its own terms (/app/THIRD_PARTY.md): every
# package's notices in /app/frontend/dist/licenses/THIRD_PARTY_NOTICES.txt (served at
# /licenses/THIRD_PARTY_NOTICES.txt and linked from the app's Settings page), the SPA's licences next to it, the
# server's in /app/backend/dist/licenses/. The label app.gcportrait.third-party-notices names that file's path in
# the image, so `docker inspect` points at it without starting a container.
LABEL org.opencontainers.image.title="gcportrait" \
      org.opencontainers.image.description="gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are trademarks of Google and are used under Google's icon usage terms." \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${APP_VERSION}" \
      app.gcportrait.third-party-notices="/app/frontend/dist/licenses/THIRD_PARTY_NOTICES.txt"

WORKDIR /app
# The same layout as the repository, so the backend finds frontend/dist and its package.json where it looks by
# default (backend/src/config.ts); STATIC_DIR below says so explicitly.
COPY --from=build /src/LICENSE /src/THIRD_PARTY.md /app/
COPY --from=build /src/brand/LICENSE.md /app/brand/LICENSE.md
COPY --from=build /src/backend/package.json /app/backend/package.json
COPY --from=build /src/backend/dist/server.mjs /src/backend/dist/server.mjs.map /app/backend/dist/
# The render API: its worker next to server.mjs, which starts it per render, and its assets. Read only;
# the worker writes nothing (fonts are unwrapped in memory).
COPY --from=build /src/backend/dist/render-worker.mjs /src/backend/dist/render-worker.mjs.map /app/backend/dist/
COPY --from=build /src/backend/dist/render-assets /app/backend/dist/render-assets
COPY --from=build /src/backend/dist/licenses /app/backend/dist/licenses
COPY --from=build /src/frontend/dist /app/frontend/dist

ENV NODE_ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/frontend/dist \
    APP_VERSION=${APP_VERSION}

EXPOSE 8080
# The base image's own non-root user, `nonroot`, by number so that runtimes which check for a non-root user
# (Kubernetes runAsNonRoot) can tell; nothing in /app is writable by it.
USER 65532:65532

# Health: Cloud Run ignores HEALTHCHECK and uses the startup and liveness probes deploy.sh sets on GET /healthz.
# Docker and compose use this one: Node itself fetches /healthz, as the image has no shell or curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# The base image's entrypoint is node; source maps turn stack traces back into backend/src/*.ts positions.
CMD ["--enable-source-maps", "/app/backend/dist/server.mjs"]
