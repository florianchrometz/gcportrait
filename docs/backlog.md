<!-- SPDX-License-Identifier: MIT -->

# Backlog

The open work on gcportrait: decisions the maintainer has not taken yet, what is left before the first public
release, and follow-ups found while building and reviewing it. Start a task from an item here or from an issue
([agents.md](../agents.md), "How to work a task"); a change that needs a decision starts with an ADR
([adr/README.md](adr/README.md)). Take an item off this list in the pull request that settles it. The asset
catalog keeps its own, more detailed backlog in [catalog-followups.md](catalog-followups.md).

Collected on 2026-10-12 from the reviews of the build (2026-10-09 to 2026-10-11, kept in [history/](history/))
and the security review. Each item names its area and, where known, the file.

| Section | What it holds |
|---|---|
| [1. Maintainer decisions](#1-maintainer-decisions) | Questions only the maintainer can settle. |
| [2. Before the first release](#2-before-the-first-release) | By hand, once, before or right after the hand-off. |
| [3. CI](#3-ci) | Follow-ups of the pull-request workflow's review. |
| [4. Self-hosting and backend](#4-self-hosting-and-backend) | Runs not made for real yet, defects, hardening. |
| [5. App](#5-app) | The diagram, the drawer, search, the timeline, the Connect and Permissions pages. |
| [6. Performance](#6-performance) | Open items against the targets of the layout skill §7. |
| [7. Catalog and icons](#7-catalog-and-icons) | Beyond [catalog-followups.md](catalog-followups.md). |
| [8. Website and docs](#8-website-and-docs) | The site, the guides, the legal fact sheet. |
| [9. Later](#9-later) | Features planned but not scheduled. |
| [Historical wording](#historical-wording) | Words about the build that stay on purpose, each with its reason. |

## 1. Maintainer decisions

- **Security defaults** ([security.md](security.md), section 12): accept only the instance's own OAuth client's
  tokens (O1); steer team instances to `--iap` (O2); the strict exposure check in service-account mode, off by
  default (O8), and the audit line's plain SHA-256 against an HMAC; a per-token share of the page budget, a higher
  minimum rate, or a configurable `STREAM_STALL_MS` (O11).
- **Service-account mode at organisation scope** is open to every member of the customer's domain who can sign
  in, since Google grants `resourcemanager.organizations.get` domain-wide by default; a stricter rule for
  organisations ([ADR 0028](adr/0028-quota-project-and-sa-gate.md), Consequences).
- **The demo-only Connect page's privacy sentence** ("This demo processes no personal data … stores nothing on its
  server") against the request logs and the in-memory rate limiter of a self-hosted demo-only instance on Cloud
  Run: reword it, add a log exclusion, or both.
- **Dependabot updates of `anchore/sbom-action`** (pinned at v0.24.0 by commit): accept them after review?
- **App decisions left by the walkthrough of 2026-10-10:** history entries for view changes; whether the drawer's
  column counts in the `auto` budget; the layout of a focus view; applications and perimeters by structure (an
  App Hub flag; a narrower `secures`); navigation exceptions and Escape on a selection; the console fallback;
  folding NICs; snapshot ids on re-import; Collapse all reopening closed zones; Expand and Collapse all in the
  Detail control; framing an expanded chip at 100 %; search ranking; the glide rules; axe-core's MPL-2.0 in the
  e2e tooling.
- **Self-hosting decisions left by the review of 2026-10-10:** the preflight's 403 contracts; the Connect page's
  inline permission check.

## 2. Before the first release

- **The hand-off machine.** The repository `florianchrometz/gcportrait` exists already (private,
  created on 2026-10-11), so step 1 of [handoff.md](handoff.md), "After the script", is done. The default
  destination `../gcportrait` exists on the maintainer's machine as an empty clone with that origin, so
  `scripts/handoff.sh` stops with exit status 2 until it is removed or `--dest` names another directory. Git has
  no stored github.com credential there: authenticate once (`gh auth login`) or push from your own terminal.
- **DNS records** for `gcportrait.app` and `www` ([website.md](website.md), "DNS records"); the Pages settings
  and `PAGES_DEPLOY` last ([handoff.md](handoff.md), step 3).
- **Dependabot** alerts and security updates on (security finding O7).
- **Make the repository and the ghcr.io package public**; the first `v1.0.0` tag ([handoff.md](handoff.md),
  step 5).
- **`docs/author.md`**: fill in its placeholders; a portrait needs its licence stated before it is committed.
- **The legal pages** on the maintainer's website, checked against [legal/](legal/README.md); the privacy notice
  at <https://florian-chrometz.de/legal/privacy-policy> must mention TelemetryDeck, which counts the website's page
  views once it deploys (the inventory's row W4; [website.md](website.md), "Analytics"); and the
  data-processing inventory's placeholders (`[LOG BUCKET LOCATION]`, `[LOG RETENTION IN DAYS]`,
  `[EMAIL PROVIDER]`, `[EMAIL PROVIDER LOCATION]`, `[DATE OF LEGAL REVIEW]`); rewrite the inventory's rows R1
  to R3, which still describe the demo on Cloud Run, for the static demo of [ADR 0034](adr/0034-static-demo-on-pages.md).
- **The Google Cloud clean-up in the project `gcportrait`:** delete the three website preview services in
  europe-west3 first (`gcportrait-website-preview` and the two whose names start with it;
  `gcloud run services list --project gcportrait --region europe-west3` lists them), since their images live in the
  build repository `gcportrait-builds`; then remove the private verification instance with
  `infra/uninstall.sh --project gcportrait --region europe-west3 --service gcportrait` once the self-hosting
  guide is verified ([ADR 0032](adr/0032-hosted-surfaces-and-domains.md), decision 4); remove the retired Cloud Run
  demo `gcportrait-demo` (europe-west1) and its domain mapping with `infra/uninstall.sh --project gcportrait
  --region europe-west1 --service gcportrait-demo` if it still runs; delete the instance's OAuth client by hand
  (Google Auth Platform > Clients). The maintainer's `roles/iam.serviceAccountTokenCreator` on the backend
  account, granted for the quota-project spike, can go too.
- **Pricing.** Confirm against Google's pricing page that the Cloud Asset Inventory and Resource Manager calls
  gcportrait makes are free within their quotas, as the FAQ and the self-hosting guide say.
- **A full `pnpm media`** after the last change to the app (the tag's website job refuses stale media), then
  `node scripts/exports.mjs --check`.

## 3. CI

From the review of the pull-request workflow (2026-10-12):

- A dependency cooldown (`cooldown` in `.github/dependabot.yml`, `minimumReleaseAge` in `pnpm-workspace.yaml`),
  the rest of security finding O6; every action of every workflow is pinned to a commit since 2026-10-12.
- A `merge_group` trigger for `pr.yml` if a merge queue is ever enabled.
- `pages.yml`'s website build duplicates CI's website job on pull requests.
- actionlint does not shellcheck the composite actions' `run` steps (`.github/actions/setup`,
  `.github/actions/playwright`).
- The Playwright cache-key race warning is harmless (a note only).
- A CI job for the website's phone check (`pnpm website:mobile`, 80 MB of WebKit per run) was deferred.
- `node scripts/exports.mjs --check` as a root script and a CI step.
- `release.yml`'s strict website build should get `GITHUB_TOKEN` (for the repository widget's facts).
- The workflows, the Pages deployment and the release have never run on GitHub.
- Signing the image (cosign with the workflow's OIDC identity) and build provenance attestations, as
  `release.yml`'s header lists them.

## 4. Self-hosting and backend

- **Not run for real yet:** `deploy.sh --iap` with user mode, sign-in, a pull ([ADR 0031](adr/0031-token-header-behind-iap.md));
  `infra/uninstall.sh --disable-apis`, and APIs enabled by a stopped run are never labelled, so `--disable-apis`
  keeps them (`API_LABELS`); the "Open in Cloud Shell" tutorial and the "Run on Google Cloud" button clicked
  through.
- **Record the consent screen** of a real sign-in: its wording for each scope, whether Google's Data Access page
  lists `cloudasset` as sensitive or restricted, and which consumer a header-less Resource Manager call names with
  the instance's own token ([spikes/quota-project.md](spikes/quota-project.md), "The sign-in row").
- `TRUST_PROXY_HOPS=1` behind Cloud Run's front end is not measured (security finding O3).
- `deploy.sh --legal-dir` should refuse placeholders as the strict website build does, and check the texts exactly
  as the backend does (a text of only a byte-order mark or non-breaking spaces passes it and stops the backend).
- `infra/compose.yaml` lacks the `LEGAL_*` pass-through.
- Instances deployed before the render API keep 512 MiB until they are redeployed.
- The build account's Storage Admin on its bucket: a narrower custom role (Storage Object Admin plus
  `storage.buckets.get`) needs a real `--build` run to verify (security finding O5).
- Requester-pays buckets and an `operation.json` next to a `gs://` export are not supported; the export read's
  idle timeout counts the client's time too.
- The licence-report code is duplicated (`backend/bundle.ts`, `frontend/vite.config.ts`).
- The export route's stall test; the `ClientStalledError` wording; threat T7's wording about slow readers
  ([threat-model.md](threat-model.md)).

## 5. App

- **Renderer and layout** (the visual review of 2026-10-10): zone badges and the title block's scope line have
  no width cap; a selection inside a chip after a lens or detail change shows nothing (`selection.shownAs` is
  unused); the chip count line is declared twice (`packages/layout` and `frontend/src/diagram/Drawing.tsx`), and
  `ZONE_MARKS` belongs in the icons data ([packages.md](packages.md), section 5); identical GKE marks on every
  Kubernetes object, and the kubernetes lens draws disks, MIGs and forwarding rules; blank areas under Platform
  and right of Retail (packing, ADR 0026); underline routes along long ring tops and long ways round in root row
  gaps; margin routes in L networking; the `secures` line from a lone card in the root's card row runs to the
  canvas edge; the trace is weak at the fitted scale; the drawer covers the right quarter of the canvas without
  moving the camera; the check mark in `ViewControls.module.css` has no fallback for browsers without CSS alt
  text; exported SVG not verified in Inkscape or Illustrator.
- **Engineering** (the walkthrough of 2026-10-10): worker-side budgets for search and locate (XL search about
  150 ms, locate 0.9–1.7 s); the data worker's per-request store read; the floating "N of M shown" bar; breadcrumb
  truncation; XL's Snapshot-menu radio; the dark scrim; `shares` bands on L and XL.
- **Defects from the walkthrough:** search mixes texts on XL; slow reveals reopen the drawer; focus after a jump
  link; renaming a saved view can duplicate a name; a double-click leaves a stray flip; Expand all reads a stale
  drawing; a pending `jumpTo`; another tab deleting the open snapshot.
- **Connect and Permissions pages** (the self-hosting review of 2026-10-10): a permission check in flight at
  sign-out is not cancelled; the scope picker's hint lacks `aria-describedby`; a type-filtered pull is stored
  like a full one; an `operation.json` whose scope differs relabels silently; `ImportFailure.command` is never
  set; the sign-in e2e runs on Vite, so no spec covers the built app's CSP and COOP; nothing ties the backend's
  zod contracts to the frontend's guards; the read time in the export title block is raw ISO.
- **Timeline** (the timeline review of 2026-10-10, still open): a removed node that stays selected gets the
  "zone" note, and a ghost selected through a drawer link gets no ring; diff marker details (nested added
  outlines under virtual zones; a removals-only chip gets the amber dot; the SVG `<desc>` counts the whole
  snapshot's diff; the console circle covers half of the dot; the slider's focus ring covers the marker);
  playback (Speed stops playback; the worker's cached "now"; an extra tick cancels a neighbour's read; a chatty
  live region); wording ("Previous day" and "Next day" also step onto extra ticks; "Timelines by scope" counts
  copies, not ticks); coverage (no e2e of a live day read or of a manual pull becoming an extra tick; "today"
  does not roll over at midnight).
- **The timeline against a real scope.** A live scope's days are covered only by unit tests against a pretend
  backend; reading days from a real organisation needs a sign-in through a real OAuth client
  ([the timeline guide's verification record](history/2026-10-12-guide-verification-records.md); timeline.md
  section 4, the consent screen).
- On a demo-only instance the Snapshots page still offers "Read from Cloud Storage", which needs sign-in.
- **Command variables:** a stale `aria-invalid` after a fact changes; trim typed values on blur; clear the Copy
  status on a change; the Copy button's accessible name from typed values.
- `ThemeProvider.test.tsx` failed once without a reason found; fix it if it recurs.

## 6. Performance

Against the app's targets in the [layout skill](../.agents/skills/gcp-diagram-layout/SKILL.md), §7, all met on
2026-10-11:

- An imported bundle's first step back costs about 290 ms (target 300).
- Far jumps (Home and End) on L take 261–291 ms against 300: consider a higher `MAX_DIFFERENCE`.
- Load the timeline's replay code at idle? (Would that count as the prefetch decided against?)
- XL's first diagram takes about 2.6 s; L at the `all` detail level pans at about 29 frames per second.
- The XL data worker is 15 MB larger at opening (accepted).
- The `ticks.ts` formatter `Map` is unbounded.
- A step at the folder level on XL builds the earlier day's view and the open views for the chips' counts; no
  budget covers it.

## 7. Catalog and icons

- Check the catalog against a real, large Cloud Asset Inventory export ([catalog-followups.md](catalog-followups.md),
  section 4).
- Icon drift hardening (`packages/icons/scripts/drift.mjs`): restrict the archive download's redirects to https
  and Google's hosts; cap bodies without `Content-Length`; a total inflation cap; same-basename collisions
  across archives; the overview PDF is untracked.
- Compare the palette with Google's current public architecture-diagram guidance (the style skill's palette
  comes from the previous implementation's validated look); commit no copy of Google's diagrams.

## 8. Website and docs

- An axe test of every built page in both themes in `e2e/` (the website checks only its code blocks
  statically).
- `pages.yml` only warns on stale media on `main` (kept so far).
- "compared with the one before" on the landing page, where the app compares with the day you came from.
- `pnpm website:lighthouse -- --page X` fails because pnpm passes the `--` through.
- The website guide's transcript ([its verification record](history/2026-10-12-guide-verification-records.md))
  predates the legal links and the sample exports page.
- `THIRD_PARTY.md` lacks the GitHub mark the website uses (under GitHub's logo guidelines).
- The fillable commands: `fillable.ts` on pages with no variable that spans two blocks; `YOUR_PROJECT` against
  `YOUR_PROJECT_ID`; `YOUR_BUCKET`'s hint against its pattern; the Cloud Shell tutorial's tokens; "Clear values"
  clears every page; the hidden hint's `aria-describedby`.

## 9. Later

Not scheduled:

- A team workspace: opt-in storage in Cloud Storage, scheduled snapshots, sharing.
- An IAM policy layer and an OS inventory layer.
- Cloud Asset Inventory's relationship data where Security Command Center Premium provides it.
- Comparing snapshots across scopes.
- Sharing saved views.
- A per-asset history tab in the details drawer (`batchGetAssetsHistory`, [ADR 0008](adr/0008-timeline-daily-ticks.md)).

## Historical wording

gcportrait was built from a planning document, retired on 2026-10-12 ([ADR
0035](adr/0035-decisions-inherited-from-the-implementation-plan.md)); the provenance check keeps its file name and
the ids of its tasks, phases and decisions out of the tree, except in `docs/adr/` and `docs/history/`. These
mentions of the build stay on purpose, so nothing here is open work:

- **ADRs 0021, 0025 and 0029** each name "the implementation plan of October 2026" once, in their context: they
  record what a decision changed, and the plan is what it changed.
- **ADR 0035** names the plan in its title and context: it is the record of what the plan decided.
- **The status lines of ADRs 0019, 0022 to 0027 and 0029 to 0032** name the build orchestrator as who accepted
  on the maintainer's behalf, and ADR 0021 speaks of "the fan-out" of its many authors: who decided, and how, is
  part of the record.
- **[history/](history/)** holds the reviews of 2026-10-09 to 2026-10-11 with dates and plain names in place of
  ids, and, since the licence decision of 2026-10-12 (ADR 0017), "the project licence" and "the footer source link"
  in place of the former licence's name; kept as written otherwise. The scratch paths they name under `out/` and
  `e2e/.scratch/` never existed in the repository.
- **Dates such as "since 2026-10-10" or "the performance pass of 2026-10-11"** in code comments, READMEs and
  ADR 0029's amendment say when something changed; they point to no document.
- **The FAQ's verification record of 2026-10-11** ([history/](history/2026-10-12-guide-verification-records.md))
  covers the guide as a whole; its coverage transcript was run again on 2026-10-12, and the block says so.
- **The quota-project spike's bad quota project, `<project>-s1-missing`** (in `scripts/spike-quota-project.sh`
  and the spike's tables): the id the real run used, kept so that the script and its recorded results agree.
- **"catalog follow-ups §1.x"** cites that document's own sections, and words such as "address plan", "budget
  plan", "backup plan", "control plane" or a Terraform "plan" are ordinary words, not references.
- **"gate"** names the service-account gate or a CI check, never a step of the build.
