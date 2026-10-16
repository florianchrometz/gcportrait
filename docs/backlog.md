<!-- SPDX-License-Identifier: MIT -->

# Backlog

The open work on gcportrait: questions only the maintainer can settle, what is left before the first release,
and follow-ups. Start a task from an item here or from an issue ([AGENTS.md](../AGENTS.md), "How to work a
task"); a change to a rule updates AGENTS.md in the same pull request. Take an item off this list in the pull
request that settles it. The asset catalog keeps its own, more detailed backlog in
[catalog-followups.md](catalog-followups.md). Each item names its area and, where known, the file.

| Section | What it holds |
|---|---|
| [1. Maintainer decisions](#1-maintainer-decisions) | Questions only the maintainer can settle. |
| [2. Before the first release](#2-before-the-first-release) | By hand, once, around the `v1.0.0` tag. |
| [3. CI](#3-ci) | Follow-ups of the workflows. |
| [4. Self-hosting and backend](#4-self-hosting-and-backend) | Paths to verify on a real instance, defects, hardening. |
| [5. App](#5-app) | The diagram, the drawer, search, the timeline, the Connect and Permissions pages. |
| [6. Performance](#6-performance) | Open items against the targets of the layout skill §7. |
| [7. Catalog and icons](#7-catalog-and-icons) | Beyond [catalog-followups.md](catalog-followups.md). |
| [8. Website and docs](#8-website-and-docs) | The site, the guides, the legal fact sheet. |
| [9. Later](#9-later) | Features planned but not scheduled. |

## 1. Maintainer decisions

- **Security defaults** ([security.md](security.md), section 12): accept only the instance's own OAuth
  client's tokens (O1); steer team instances to `--iap` (O2); the strict exposure check in service-account
  mode, off by default (O8), and the audit line's plain SHA-256 against an HMAC; a per-token share of the page
  budget, a higher minimum rate, or a configurable `STREAM_STALL_MS` (O11).
- **Service-account mode at organisation scope** is open to every member of the customer's domain who can sign
  in, since Google grants `resourcemanager.organizations.get` domain-wide by default; a stricter rule for
  organisations ([AGENTS.md](../AGENTS.md), "Security and privacy", "The service-account gate";
  [permissions.md](permissions.md)).
- **The demo-only Connect page's privacy sentence** ("This demo processes no personal data … stores nothing on
  its server") against the request logs and the in-memory rate limiter of a self-hosted demo-only instance on
  Cloud Run: reword it, add a log exclusion, or both.
- **App decisions:** history entries for view changes; whether the drawer's column counts in the `auto`
  budget; the layout of a focus view; applications and perimeters by structure (an App Hub flag; a narrower
  `secures`); navigation exceptions and Escape on a selection; the console fallback; folding NICs; snapshot
  ids on re-import; Expand and Collapse all in the Detail control; framing an expanded chip at 100 %; search
  ranking; the glide rules; axe-core's MPL-2.0 in the e2e tooling.
- **Self-hosting decisions:** the preflight's 403 contracts; the Connect page's
  inline permission check.

## 2. Before the first release

- **DNS records** for `gcportrait.app` and `www` and the Pages settings (the custom domain with HTTPS
  enforced) ([website.md](website.md), "Deploying to GitHub Pages" and "DNS records").
- **Dependabot** alerts and security updates on in the repository settings (security finding O7).
- **Make the repository and the ghcr.io package public, and tag `v1.0.0`** ([contributing.md, "9.
  Releases"](contributing.md#9-releases)); the tag is the release workflow's first run.
- **`docs/author.md`**: fill in its placeholders; a portrait needs its licence stated before it is committed.
- **The legal pages** on the maintainer's website, checked against [legal/](legal/README.md): the privacy
  notice at <https://florian-chrometz.de/legal/privacy-policy> must mention TelemetryDeck, which counts the
  website's page views once it deploys (the inventory's row W4; [website.md](website.md), "Analytics"), and
  describe the demo as the static build on GitHub Pages (rows W1 and DS1), with no server of its own; and the
  data-processing inventory's placeholders (`[EMAIL PROVIDER]`, `[EMAIL PROVIDER LOCATION]`, `[DATE OF LEGAL
  REVIEW]`).
- **Pricing.** Confirm against Google's pricing page that the Cloud Asset Inventory and Resource Manager calls
  gcportrait makes are free within their quotas, as the FAQ and the self-hosting guide say.
- **A full `pnpm media`** after the last change to the app (the tag's website job refuses stale media), then
  `node scripts/exports.mjs --check`.

## 3. CI

- A dependency cooldown (`cooldown` in `.github/dependabot.yml`, `minimumReleaseAge` in
  `pnpm-workspace.yaml`), the rest of security finding O6.
- A `merge_group` trigger for `pr.yml` if a merge queue is ever enabled.
- `pages.yml`'s website build duplicates CI's website job on pull requests.
- actionlint does not shellcheck the composite actions' `run` steps (`.github/actions/setup`,
  `.github/actions/playwright`).
- The Playwright cache-key race warning is harmless (a note only).
- No CI job runs the website's phone check (`pnpm website:mobile`, 80 MB of WebKit per run).
- `node scripts/exports.mjs --check` as a root script and a CI step.
- `release.yml`'s strict website build should get `GITHUB_TOKEN` (for the repository widget's facts).
- Signing the image (cosign with the workflow's OIDC identity) and build provenance attestations, as
  `release.yml`'s header lists them.

## 4. Self-hosting and backend

- **To verify on a real instance:** `deploy.sh --iap` with user mode, sign-in, a pull
  ([AGENTS.md](../AGENTS.md), "Security and privacy", "Tokens"); `infra/uninstall.sh --disable-apis`, and APIs
  enabled by a stopped run are never labelled, so `--disable-apis` keeps them (`API_LABELS`); the "Open in
  Cloud Shell" tutorial and the "Run on Google Cloud" button clicked through.
- **Record the consent screen** of a real sign-in: its wording for each scope, whether Google's Data Access
  page lists `cloudasset` as sensitive or restricted, and which consumer a header-less Resource Manager call
  names with the instance's own token (cai-ingestion skill §9, "The quota project" and "OAuth scopes").
- `TRUST_PROXY_HOPS=1` behind Cloud Run's front end is not measured (security finding O3).
- `deploy.sh --legal-dir` should refuse placeholders as the strict website build does, and check the texts
  exactly as the backend does (a text of only a byte-order mark or non-breaking spaces passes it and stops the
  backend).
- `infra/compose.yaml` lacks the `LEGAL_*` pass-through.
- The build account's Storage Admin on its bucket: a narrower custom role (Storage Object Admin plus
  `storage.buckets.get`) needs a real `--build` run to verify (security finding O5).
- Requester-pays buckets and an `operation.json` next to a `gs://` export are not supported; the export read's
  idle timeout counts the client's time too.
- The licence-report code is duplicated (`backend/bundle.ts`, `frontend/vite.config.ts`).
- The export route's stall test; the `ClientStalledError` wording; threat T7's wording about slow readers
  ([threat-model.md](threat-model.md)).

## 5. App

- **Renderer and layout:** zone badges and the title block's scope line have no width cap; a selection inside
  a chip after a lens or detail change shows nothing (`selection.shownAs` is unused); the chip count line is
  declared twice (`packages/layout` and `frontend/src/diagram/Drawing.tsx`), and `ZONE_MARKS` belongs in the
  icons data ([packages.md](packages.md), section 5); identical GKE marks on every Kubernetes object, and the
  kubernetes lens draws disks, MIGs and forwarding rules; blank areas under Platform and right of Retail
  (packing; layout skill §4); underline routes along long ring tops and long ways round in root row gaps;
  margin routes in L networking; the `secures` line from a lone card in the root's card row runs to the canvas
  edge; the trace is weak at the fitted scale; the drawer covers the right quarter of the canvas without
  moving the camera; the check mark in `ViewControls.module.css` has no fallback for browsers without CSS alt
  text; exported SVG not verified in Inkscape or Illustrator.
- **Engineering:** worker-side budgets for search and locate (XL search about 150 ms, locate 0.9–1.7 s); the
  data worker's per-request store read; the floating "N of M shown" bar; breadcrumb truncation; XL's
  Snapshot-menu radio; the dark scrim; `shares` bands on L and XL.
- **Defects:** search mixes texts on XL; slow reveals reopen the drawer; focus after a jump link; renaming a
  saved view can duplicate a name; a pending `jumpTo`; another tab deleting the open snapshot.
- **Connect and Permissions pages:** a permission check in flight at sign-out is not cancelled; the scope
  picker's hint lacks `aria-describedby`; a type-filtered pull is stored like a full one; an `operation.json`
  whose scope differs relabels silently; `ImportFailure.command` is never set; the sign-in e2e runs on Vite,
  so no spec covers the built app's CSP and COOP; nothing ties the backend's zod contracts to the frontend's
  guards; the read time in the export title block is raw ISO.
- **Timeline:** a removed node that stays selected gets the "zone" note, and a ghost selected through a drawer
  link gets no ring; diff marker details (nested added outlines under virtual zones; a removals-only chip gets
  the amber dot; the SVG `<desc>` counts the whole snapshot's diff; the console circle covers half of the dot;
  the slider's focus ring covers the marker); playback (Speed stops playback; the worker's cached "now"; an
  extra tick cancels a neighbour's read; a chatty live region); wording ("Previous day" and "Next day" also
  step onto extra ticks; "Timelines by scope" counts copies, not ticks); coverage (no e2e of a live day read
  or of a manual pull becoming an extra tick; "today" does not roll over at midnight).
- **The timeline against a real scope.** A live scope's days are covered only by unit tests against a pretend
  backend; reading days from a real organisation needs a sign-in through a real OAuth client
  ([timeline.md](timeline.md), section 4).
- On a demo-only instance the Snapshots page still offers "Read from Cloud Storage", which needs sign-in.
- **Command variables:** a stale `aria-invalid` after a fact changes; trim typed values on blur; clear the
  Copy status on a change; the Copy button's accessible name from typed values.
- `ThemeProvider.test.tsx` may be flaky (no cause found); fix it if it fails again.
- **Phones and tablets:** a node's menu has no touch gesture on the canvas and drill-in none of its own (the
  details drawer carries both actions; a long press shows what hover shows, a double tap zooms, and on a chip
  leaves the tap's flip); the phone and tablet check runs in Chromium's emulation only, not in WebKit or on a
  real device; on a small phone turned sideways (568 × 320) the canvas is about 90 px tall, so the half-height
  sheet shows little more than the node's name (drag it up to read the details) and Expand all and Collapse
  all hide while it is open; a disclosure notice shown while the sheet is at half height can still be cut by
  the canvas's top on a short canvas; a sheet stays open when the app moves focus out of it by itself (the
  Connect page's heading once a sign-in started before the sheet was opened completes); crossing the phone's
  breakpoint (turning a phone) mounts the view controls again, so a search text not yet sent is lost.

## 6. Performance

Against the app's targets in the [layout skill](../.agents/skills/gcp-diagram-layout/SKILL.md), §7:

- An imported bundle's first step back costs about 290 ms (target 300).
- Far jumps (Home and End) on L take 261–291 ms against 300: consider a higher `MAX_DIFFERENCE`.
- Load the timeline's replay code at idle? (Would that count as prefetching, which the timeline rules out?)
- XL's first diagram takes about 2.6 s; L at the `all` detail level pans at about 29 frames per second.
- The `ticks.ts` formatter `Map` is unbounded.
- A step at the folder level on XL builds the earlier day's view and the open views for the chips' counts; no
  budget covers it.

## 7. Catalog and icons

- Check the catalog against a real, large Cloud Asset Inventory export
  ([catalog-followups.md](catalog-followups.md), section 3).
- Icon drift hardening (`packages/icons/scripts/drift.mjs`): restrict the archive download's redirects to
  https and Google's hosts; cap bodies without `Content-Length`; a total inflation cap; same-basename
  collisions across archives; the overview PDF is untracked.
- Check the style skill's palette against Google's current public architecture-diagram guidance; commit no
  copy of Google's diagrams.
- **Google's older console icons.** Google's product icons overview says the legacy console icons should no
  longer be used, while its icon library still offers them; the style skill and `packages/icons` use them for
  sub-products. Following the overview means removing the `legacy` candidates from
  `packages/icons/mapping.json` (each key then falls to its category mark), giving the generic mark another
  source, and re-vendoring: a decision for the maintainer
  ([packages/icons/README.md](../packages/icons/README.md), "Google's older console icons").

## 8. Website and docs

- An axe test of every built page in both themes in `e2e/` (the website checks only its code blocks
  statically).
- `pages.yml` only warns on stale media on `main`: decide whether it should fail.
- "compared with the one before" on the landing page, where the app compares with the day you came from.
- `pnpm website:lighthouse -- --page X` fails because pnpm passes the `--` through.
- `THIRD_PARTY.md` lacks the GitHub mark the website uses (under GitHub's logo guidelines).
- The fillable commands: `fillable.ts` on pages with no variable that spans two blocks; `YOUR_PROJECT` against
  `YOUR_PROJECT_ID`; `YOUR_BUCKET`'s hint against its pattern; the Cloud Shell tutorial's tokens; "Clear
  values" clears every page; the hidden hint's `aria-describedby`.

## 9. Later

Not scheduled:

- A team workspace: opt-in storage in Cloud Storage, scheduled snapshots, sharing.
- An IAM policy layer and an OS inventory layer.
- Cloud Asset Inventory's relationship data where Security Command Center Premium provides it.
- Comparing snapshots across scopes.
- Sharing saved views.
- A per-asset history tab in the details drawer (`batchGetAssetsHistory`, at most 100 names per call;
  cai-ingestion skill §1).
