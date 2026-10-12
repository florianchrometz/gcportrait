<!-- SPDX-License-Identifier: MIT -->

# Release readiness, 2026-10-11

A record of the build, written on 2026-10-11 and not kept up to date since (on 2026-10-12 the build's
task and phase ids gave way to plain names and dates); what is still open is in
[../backlog.md](../backlog.md), and the steps before the release are in [../handoff.md](../handoff.md).

The review before the first release: the commands with their real output, a link check of the root README and the
built website, what is done, what the maintainer does by hand before gcportrait 1.0.0 is public, the known
limitations of the release as built, and the open questions of the last reports, deduplicated. The hand-off itself
(the new public repository) is deferred by the maintainer: its script is built and was rehearsed on a scratch copy
([../handoff.md](../handoff.md)); it has not been run for real. The draft release notes were then the "Unreleased"
section of [../../CHANGELOG.md](../../CHANGELOG.md), now its 1.0.0 section. The earlier reviews are
[2026-10-10-app-walkthrough.md](2026-10-10-app-walkthrough.md),
[2026-10-10-self-hosting-smoke-test.md](2026-10-10-self-hosting-smoke-test.md) and
[2026-10-10-timeline-review.md](2026-10-10-timeline-review.md); the performance pass is
[2026-10-11-performance-pass.md](2026-10-11-performance-pass.md).

| | |
|---|---|
| Date | 2026-10-11, 12:52 to 13:15 UTC |
| Tree | `main` at `bbc2eb4` plus the uncommitted hand-off tooling (`scripts/handoff.sh`, its test, `docs/handoff.md` and their edits to the planning document of the build, `agents.md`, the docs index, `docs/contributing.md`, the contributor-workflow skill, `scripts/check-provenance.mjs` and `website/src/lib/changelog.test.ts`) |
| Where the commands ran | an isolated copy of that tree in a scratch directory (`git archive HEAD`, the hand-off files laid over it, `pnpm install --offline --frozen-lockfile`), because the shared working tree also held another task's unfinished website files (section 1). `pnpm e2e` started its own demo-mode server from the copy; its live specs (`chromium-live`) loaded the app from the long-running `pnpm dev` Vite server of the shared tree on port 5173, whose `frontend/` and `packages/` have no change against `bbc2eb4`, and the two that need the real backend started it from the copy. The review's own documentation changes were laid over the copy afterwards and checked again (section 8) |
| Machine | macOS 27.0 on an Apple M1, Node 22.23.2, pnpm 10.18.1; Playwright's Chromium for e2e |
| Data | the synthetic demo organisations only; the read-only checks of section 2 looked at public DNS and at the Cloud Run services of the maintainer's project `gcportrait` (names, regions, readiness), nothing else |
| Reviewer | the review agent |

## 1. Commands and their results

| Command | Result |
|---|---|
| `pnpm check` (isolated copy) | **green** in 3 min 14 s: `format:check` clean; `lint` and `typecheck` clean; `test` 313 files, **7 577 tests** passed (the timeline review: 7 012); `catalog:check` OK (641 official types of 2026-10-09); `provenance` OK (2 324 files, 1 299 SPDX headers); `licenses` OK (558 installed packages under allowed licences, the 13 workspace packages declare the project licence, `THIRD_PARTY.md` current) |
| `pnpm check` (the shared working tree at 12:52 UTC, for comparison) | **red at `format:check`** on three files of the website's live star count, unfinished and not part of this review: `website/scripts/check-site.ts`, `website/src/lib/star-count-page.ts`, `website/src/lib/star-count.ts`. Their owner formats them before committing; nothing reviewed here is affected |
| `pnpm build` | **green** in 7.2 s: the backend bundle `dist/server.mjs` 2 724 kB with 64 npm packages inlined (licences in `dist/licenses/`); the website, 19 pages; the SPA, with Vite's usual warning that `index-*.js` is over 500 kB minified (686 kB raw, 220.6 kB gzipped) |
| `pnpm size` | **green**: UI thread 229.97 of 350 kB (65.7 %; the timeline review: 224.4), workers 197.13 of 400 kB (49.3 %; the timeline review: 194.0), gzipped (ADR 0029); no zod on the UI thread |
| `pnpm e2e` | **green**: **208 passed** in 3.9 min (the timeline review: 192), first run, no retries: 160 in demo mode (`chromium`), 48 in normal and demo-only mode (`chromium-live`) |
| `pnpm website:build`, then `pnpm website:check` | **green**: 19 pages built; "19 pages OK (metadata, links, anchors, sitemap, self-hosted resources, focusable code blocks, the header's GitHub link, the non-affiliation statement, viewport and phone widths, command variables and Copy buttons, sample exports)". The build warns that the legal drafts and `docs/author.md` still hold placeholders and that GitHub answers 404 for the star count (the repository is private) |
| `WEBSITE_STRICT=1 pnpm website:build` (what a deploying build runs) | **refused, as designed**: the Impressum draft still holds 8 placeholders and the privacy notice 11 ("A published site needs both texts, filled in (docs/website.md)"). It stops at the first refusal; `docs/author.md`'s 5 placeholders are refused the same way. It passes once the maintainer has filled them (section 4.1, items 2 and 3) |
| `pnpm media --check` | **green**: "docs/media is up to date (inputs 1e48065c9c0b, 90 files)" |
| `node scripts/exports.mjs --check` | **green**: "docs/media/exports is up to date (24 files, 4.47 MiB)" |
| Link check of `README.md` (section 2) | 53 relative links and anchors resolve (54 after this review's change to the README's status section, all of them too); 28 of the 37 external links answer, **9 do not** (no DNS for the website and the demo yet; the repository is private) |
| Link check of the built site (section 2) | `pnpm website:check` covers every internal link and anchor; of the 67 distinct external link targets, 18 answer and **49 do not**, for the same two reasons |
| The same checks after this review's documentation changes | section 8 |

## 2. Links and DNS

The link checker (a scratch script, not part of the repository) read every link of `README.md`, resolved the
relative ones against the tree with GitHub's heading anchors, and requested every external one (HEAD, then GET
on an error status; 20 s timeout). For the site it requested every `https` link target of the 19 built pages.

| Target | README | Site | Why it fails today | When it resolves |
|---|---|---|---|---|
| `https://gcportrait.app` and its `/#author`, `/docs/`, `/coverage/`, `/changelog/`, `/exports/` | 6 links fail (DNS: no address) | 1 (`/exports/`) | the apex has no A or AAAA record yet | after the DNS records of section 4.2 and the first Pages deployment |
| `https://demo.gcportrait.app` | 1 fails (DNS) | 1, on all 19 pages | no CNAME (the mapping waits for it) | after the demo's CNAME, or never if the demo moves (section 5) |
| `github.com/florianchrometz/gcportrait` and paths in it (CI workflow, releases, issues, 43 files and folders) | 3 fail (404) | 47, the repository on all 19 pages | the repository is private | when it is public; every one of the 43 paths exists in the tree |

Everything else answers: shields.io's badges (which draw "repo not found" until then), Google's and GitHub's
documentation, the Cloud Shell and Cloud Run Button images, the maintainer's site and the tech-stack links.

**DNS on 2026-10-11, 12:55 UTC** (`dig @8.8.8.8`; the zone is on Porkbun's name servers): `gcportrait.app` has
a `google-site-verification` TXT record (Search Console verification, done) and
`_github-pages-challenge-florianchrometz.gcportrait.app` has GitHub's TXT record (Pages domain verification,
done); the registrar's parking records are gone. There is no A, AAAA or CNAME record for the apex, `www` or
`demo` yet.

**Cloud Run in `gcportrait`, read-only, the same time:** three services, `gcportrait` (europe-west3, the
private verification instance, never advertised), `gcportrait-demo` (europe-west1, demo-only, public; it
answers `/api/healthz` with version `3bff23e`, so it predates the later commits of 2026-10-11) and
`gcportrait-website-preview` (europe-west3, a temporary preview of the website, not in the repository). The
domain mapping `demo.gcportrait.app` → `gcportrait-demo` exists; Cloud Run reports "Waiting for certificate
provisioning. You must configure your DNS records" and asks for `demo CNAME ghs.googlehosted.com.`.

## 3. What is done

The last work in the tree, with where each result is recorded:

- [x] **Website** (`website/`, [../website.md](../website.md)): the Astro site for `gcportrait.app` with the
  landing page, animated demos and stills in both themes, the user guides rendered from `docs/`, the coverage
  page from the catalog, sample exports, the changelog, contributing and licence pages, the author section and
  the GitHub link; SEO metadata and structured data on every page; phones served as well as desktops; fillable
  command variables in the docs. Lighthouse when the website was built: accessibility, best practices and SEO 100 on every page,
  performance 100 on desktop and 96 to 100 on mobile. `pages.yml` deploys it once `PAGES_DEPLOY` is `true`.
- [x] **Generated media** (`pnpm media`, `docs/media/`, 90 files; `node scripts/exports.mjs`, 24 sample
  exports): regenerated in full from the current build and fresh in this review.
- [x] **User guides** ([../README.md](../README.md)): getting started, modes, permissions, lenses and filters,
  timeline, export, FAQ, self-host, configuration and the Cloud Shell tutorial; the eight checked guides carry
  a "Verified on" date and their transcripts, and `node scripts/user-docs.mjs` (part of `pnpm test`) keeps
  their commands, flags and settings equal to the tree.
- [x] **Demo-only mode** (`DEMO_ONLY=true`, `infra/deploy.sh --demo-only`, [ADR
  0032](../adr/0032-hosted-surfaces-and-domains.md)): built, tested (e2e `demo-only.spec.ts` against the real
  backend) and deployed for real as `gcportrait-demo` in europe-west1 on 2026-10-11, with its domain mapping
  created.
- [x] **Distribution** ([../self-host.md](../self-host.md), "Maintainer release setup"): `release.yml` builds,
  smoke-tests and publishes a multi-platform image to GitHub Container Registry with the workflow's own token,
  with an SBOM per platform and the GitHub release from the changelogs; `infra/deploy.sh` pulls released
  images through an Artifact Registry remote repository (proven for real on 2026-10-11 with a stand-in image:
  first deploy 48 s, a second 22 s, the uninstall 15 s); the "Open in Cloud Shell" tutorial and the "Run on
  Google Cloud" button.
- [x] **Performance** ([2026-10-11-performance-pass.md](2026-10-11-performance-pass.md)): every target met on demo L and XL;
  heap stable across tick switches; bundle budgets met (section 1).
- [x] **Security** ([../security.md](../security.md), [../threat-model.md](../threat-model.md)): the checklist
  complete with evidence per item; open findings O1 to O11 listed with their severity (section 6); the audit
  gate (`node scripts/check-audit.mjs`) in CI; third-party notices shipped with every build.
- [x] **Legal drafts and the author page** ([../legal/README.md](../legal/README.md),
  [../author.md](../author.md)): the Impressum and the privacy notice as drafts for review by a lawyer, every
  personal detail a placeholder; the data-processing inventory; the author section's facts.
- [x] **README as a product page** ([../../README.md](../../README.md)).
- [x] **Hand-off tooling** ([../handoff.md](../handoff.md)): `scripts/handoff.sh`, rehearsed on a scratch copy
  (2 323 files, `pnpm check` green in the copy, one commit), with the release steps after it rehearsed against
  a local bare repository.
- [x] **Non-affiliation** ([ADR 0018](../adr/0018-non-affiliation-statement.md)): the statement in the app's
  footer on every route, on the website, in the README and the guides; no longer drawn in any diagram or
  export.
- [x] **Icons**: Google Cloud's icons described as provided by Google Cloud, with a weekly drift check
  (`.github/workflows/icon-drift.yml`).
- [x] **This review**: the commands of section 1 green on the isolated copy; the release notes drafted
  ([../../CHANGELOG.md](../../CHANGELOG.md)); this document.

Acceptance, item by item: the website (site builds; Lighthouse ≥ 95 for accessibility and best practices) met
locally, not yet in CI because nothing has been pushed; demo-only mode and the legal settings, the user guides, the
performance pass, the security review, the release pipeline, and the legal fact sheet and author page met; the
README's "every link resolves" waits for the DNS records and the public repository (section 2); the hand-off
deferred by the maintainer (rehearsed only; its acceptance, a fresh clone of the new repository with `pnpm check` green and
the image and site published, waits for the hand-off).

## 4. What the maintainer does by hand

In this order. Each step names where its details are; nothing here has been done for the maintainer.

### 4.1 Before the hand-off, in this repository

1. **Decide the Google Cloud diagram supplied as the look to match** (then tracked under `docs/reference/`, not
   in `THIRD_PARTY.md`): remove it or document it; `scripts/handoff.sh` copies it otherwise. (Removed on
   2026-10-12.)
2. **Fill in `docs/author.md`**: the job title, the LinkedIn, GitHub and X profile URLs and the bio paragraph
   (5 placeholders; a deploying website build refuses the file until none is left). The portrait is optional;
   a photo needs its licence stated before it is committed.
3. **The legal texts**: fill in the Impressum and the privacy notice outside the repository and have them
   reviewed; each draft ends with the questions for the lawyer (GitHub as controller or processor for the
   Pages logs, Google's Cloud Data Processing Addendum, a second contact channel, § 18 (2) MStV, a German
   version). The privacy notice must cover the demo's Cloud Run request logs (client addresses) and the rate
   limiter's one-minute counter per address; the demo's Connect page says it "processes no personal data",
   which needs the maintainer's wording decision ([../legal/README.md](../legal/README.md); section 5 for the
   decision to link to pages on the maintainer's own site instead).
4. **Accept or amend the proposed ADRs** 0030 (own Cloud Build account), 0031 (the token header behind IAP)
   and 0032 (hosted surfaces), and the hero image (demo S instead of the demo M first intended; reason in
   [../website.md](../website.md)).
5. **Contributor licence agreement**: decide whether external contributions will need one (only relevant if
   gcportrait is ever offered under other terms too); there is none today, and the README and
   `docs/contributing.md` say so.
6. **Commit everything** on `main`: `scripts/handoff.sh` refuses uncommitted changes.

### 4.2 DNS records for gcportrait.app

At Porkbun, the zone's name servers. Already in place (section 2): the Search Console TXT record and GitHub's
`_github-pages-challenge-florianchrometz` TXT record. To create for the website, once the repository is pushed
and Pages is set up ([../website.md](../website.md), "Deploying to GitHub Pages" and "DNS records"):

```text
gcportrait.app.            3600  IN  A      185.199.108.153
gcportrait.app.            3600  IN  A      185.199.109.153
gcportrait.app.            3600  IN  A      185.199.110.153
gcportrait.app.            3600  IN  A      185.199.111.153
gcportrait.app.            3600  IN  AAAA   2606:50c0:8000::153
gcportrait.app.            3600  IN  AAAA   2606:50c0:8001::153
gcportrait.app.            3600  IN  AAAA   2606:50c0:8002::153
gcportrait.app.            3600  IN  AAAA   2606:50c0:8003::153
www.gcportrait.app.        3600  IN  CNAME  florianchrometz.github.io.
```

For the demo as this tree builds it (a Cloud Run domain mapping, which already exists and waits for it):

```text
demo.gcportrait.app.       3600  IN  CNAME  ghs.googlehosted.com.
```

Create the demo record only if the demo stays on Cloud Run: the decision of 2026-10-11 to serve a static demo
from the website (section 5) makes it unnecessary, and the maintainer was advised the same day not to add it
yet. The zone has no CAA record; if one is added, it must allow `letsencrypt.org` for GitHub Pages. Check with
the commands in [../website.md](../website.md), "DNS records".

### 4.3 GitHub: the hand-off, the repository settings and the first release

1. **The hand-off** ([../handoff.md](../handoff.md)): `scripts/handoff.sh --message "MESSAGE"`. Two facts the
   guide does not know yet: the repository `florianchrometz/gcportrait` already exists (private, created by
   the maintainer on 2026-10-11), so its step 1 is done; and the default destination `../gcportrait` exists on
   this machine as an empty clone with that origin, so the script stops with exit status 2 until that
   directory is removed or `--dest` names another one. Git has no stored github.com credential here:
   authenticate once (for example `gh auth login`) or push from your own terminal.
2. **Pages**, in the order of [../website.md](../website.md), "Deploying to GitHub Pages": the
   `WEBSITE_LEGAL_BUNDLE` secret with the filled texts (4.1, item 3), Pages source "GitHub Actions", the
   `github-pages` environment allowing `main` and `v*`, the verified domain (its TXT record exists), the DNS
   records of 4.2, the custom domain `gcportrait.app` with "Enforce HTTPS", and last the repository variable
   `PAGES_DEPLOY=true`. Leave the Firebase variables unset.
3. **Dependabot** alerts and security updates on (Settings > Advanced Security;
   [../security.md](../security.md), O7).
4. **`DEFAULT_SOURCE_URL`** already names `https://github.com/florianchrometz/gcportrait` in
   `backend/src/config.ts` and `frontend/src/source.ts`; nothing to change for that repository. Every
   instance's footer source link, the demo's included, answers 404 until the repository is public.
5. **Make the repository public.** The README's badges, buttons and clone addresses, the site's 47 links into
   the repository and the privacy notice's link to the data-processing inventory resolve only then.
6. **The first `v*` tag** ([../handoff.md](../handoff.md), "After the script", step 5): run Release by hand
   once on `main` (publishes `dev` and creates the package `ghcr.io/florianchrometz/gcportrait`, private),
   make the package public, add the major changeset (the draft in `CHANGELOG.md` can be its summary; decide
   whether the 37 step-by-step changesets go), `pnpm release:version`, commit, tag `v1.0.0`, push the tag.
   That publishes the image as `1.0.0`, `1.0` and `latest`, creates the GitHub release and, with
   `PAGES_DEPLOY`, deploys the site. After a change to the app, run a full `pnpm media` first: the tag's
   website job refuses stale media.

### 4.4 Google Cloud, in the project `gcportrait`

1. **The demo**: redeploy `gcportrait-demo` from the released image once 1.0.0 exists
   (`infra/deploy.sh --project gcportrait --region europe-west1 --demo-only --image v1.0.0`; it keeps its
   domain mapping), or retire it if the static demo replaces it (section 5).
2. **Remove the private verification instance** once the self-hosting guide is verified:
   `infra/uninstall.sh --project gcportrait --region europe-west3 --service gcportrait`. That also deletes its
   build repository `gcportrait-builds`, which holds the image of the temporary website preview: delete
   `gcportrait-website-preview` first
   (`gcloud run services delete gcportrait-website-preview --project gcportrait --region europe-west3`) or
   keep the instance until GitHub Pages serves the site. The OAuth client of that instance is not deploy.sh's
   and stays until it is deleted in the console (Google Auth Platform > Clients).

## 5. Decided after this tree, not built yet

The maintainer took these decisions on 2026-10-11, after the last tasks of the build were written. They change parts of
section 4 once they are built; until then the tree, the docs and this document describe what is built.

- **Everything hosted on GitHub; a static demo.** The demo becomes a static build of the app served by the
  same GitHub Pages site at `gcportrait.app/demo/`; `demo.gcportrait.app` and its Cloud Run service go, and
  the demo-only container mode stays for self-hosters. Then the demo's CNAME (4.2) is not needed, the domain
  mapping and `gcportrait-demo` are removed with
  `infra/uninstall.sh --project gcportrait --region europe-west1 --service gcportrait-demo`, ADR 0032 is
  amended, and the README, the guides and the website say `/demo/`.
- **Legal pages on the maintainer's own site.** The website and the demo link to the Impressum and the privacy
  notice at `florian-chrometz.de` instead of carrying them; the Impressum and privacy drafts and the website's
  own legal pages go, `docs/legal/data-processing-inventory.md` stays as the fact sheet, and the backend gets
  link settings for them. Then 4.1 item 3 becomes "publish the texts on your own site", and
  `WEBSITE_LEGAL_BUNDLE` is no longer needed.
- **The planning document of the build retires.** It is deleted once its knowledge lives in the skills,
  `agents.md` and the ADRs (ADR 0035); the ids of its tasks, phases and decisions are removed from the project; the trademark
  sentence names "Google" without the company suffix everywhere (the maintainer's instruction of 2026-10-11,
  which `NOTICE` already follows and the draft release notes in `CHANGELOG.md` follow too; the other copies of
  the long form change together, with a check that keeps the suffix out). This runs before the hand-off.
- **Further work queued before the release:** a live star count in the website header (in progress during this
  review), a render endpoint for self-hosted instances, a review of the tests for redundancy, and two
  design variants of the website and the app for comparison. Each changes the draft release notes.

## 6. Known limitations of the release as built

**Not verified on a real system yet:**

- Signing in with your own account behind Identity-Aware Proxy (`deploy.sh --iap`; [ADR
  0031](../adr/0031-token-header-behind-iap.md) moved the token to its own header for it) and
  `infra/uninstall.sh --disable-apis`. These are what keeps the self-hosting smoke test formally open
  ([2026-10-10-self-hosting-smoke-test.md](2026-10-10-self-hosting-smoke-test.md), section 7.1; the timed deploy from scratch and the release
  path it also asked for are done). The maintainer reported on 2026-10-10 that signing in through Google's
  real window works with a local build; the consent screen's wording that the quota-project spike's sign-in row asks to record is
  not written down yet ([../spikes/quota-project.md](../spikes/quota-project.md)).
- The release workflow, the CI workflows and the Pages deployment have never run on GitHub; the "Open in Cloud
  Shell" tutorial and the "Run on Google Cloud" button have not been clicked through (the tutorial's
  `{{project-id}}` follows Google's own tutorials).
- The rate limit's client address behind Cloud Run's front end (`TRUST_PROXY_HOPS=1`, security finding O3).

**Behaviour to know about:**

- The app is for desktop browsers (1280 × 800 or larger); the website also serves phones.
- Security findings O1 (any valid Google token is accepted, not only the instance's own client's), O2 (anyone
  with a Google account can use a public instance's capacity within the limits; `--iap` closes it), O8
  (service-account mode's strict exposure check is off by default) and O11 (slow readers hold a page's memory
  claim up to the stall limit) are open by design or for a decision ([../security.md](../security.md), section
  12); O6: GitHub Actions are pinned by major tag, one by commit.
- Performance: demo XL takes about 2.6 s to its first diagram; demo L at the `all` detail level pans at about
  29 frames per second; the first timeline step back on an imported bundle costs about 290 ms, and a far jump
  (Home or End) on demo L 261 to 291 ms against the 300 ms target
  ([2026-10-11-performance-pass.md](2026-10-11-performance-pass.md)).
- On a demo-only instance the Snapshots page still shows "Read from Cloud Storage", which needs sign-in.
- The pending changesets describe each step of the build, including states later replaced (an export line with
  the non-affiliation statement, image publishing to Artifact Registry); the website's changelog page lists
  them under "Unreleased" until they are consumed or replaced (4.3, item 6).
- The animated media are not byte-reproducible: every full `pnpm media` run rewrites about 10 MB of GIF and
  WebM.
- The catalog has not been checked against a real Cloud Asset Inventory export of a larger organisation
  ([../catalog-followups.md](../catalog-followups.md), section 4).
- Defects that earlier reviews left and the last work did not take up stay listed there, with their suggested
  owner ([2026-10-10-timeline-review.md](2026-10-10-timeline-review.md), section 4.3, items 5 to 8 and 10;
  [2026-10-10-app-walkthrough.md](2026-10-10-app-walkthrough.md), section 6).

## 7. Open questions for the maintainer (from the last reports and this review, deduplicated)

Questions answered meanwhile are left out (the demo's deployment and domain mapping, the timed pull-path run,
the ADR number 0032, the hero image's reason, the legal drafts' region).

1. **The non-affiliation wording.** The long form of the time names Google with its company suffix; the instruction
   of 2026-10-11 is never to write that suffix. `NOTICE` and the draft release notes say "trademarks of
   Google"; the README, the guides, `frontend/src/branding.ts`, `scripts/release-notes.mjs` (the GitHub
   release's first paragraph), the image label and the website still carry the old form until the scrub
   changes all copies together. The scrub must land before the first tag, or the GitHub release and the image
   label carry the old form.
2. **The demo's privacy sentence** ("This demo processes no personal data … stores nothing on its server")
   against Cloud Run's request log of client addresses and the rate limiter's one-minute counter: reword it,
   add a log exclusion, or both; and whether the demo may be public before the legal texts are.
3. **The step-by-step changesets**: keep the 37 for the 1.0.0 release, or replace them with one major
   changeset carrying the draft notes (4.3, item 6). The rehearsal versioned 1.0.0 as a second commit after
   the hand-off commit; the alternative is to version here first so that the single hand-off commit is already
   1.0.0.
4. **The `legacy/` wording** that stays in the new tree (`agents.md` rule 11 and its link,
   `docs/contributing.md`, the contributor-workflow skill, ADR 0007): reword before the hand-off or as the
   first change after it.
5. **Security decisions** ([../security.md](../security.md), section 12): accept only the instance's own OAuth
   client's tokens (O1); steer team instances to `--iap` (O2); pin GitHub Actions by commit and add a
   dependency cooldown (O6); the strict exposure default in service-account mode (O8); a per-token share or a
   higher minimum rate for the page budget, or a configurable `STREAM_STALL_MS` (O11).
6. **Performance follow-ups**: the fast first timeline step for imported bundles; a higher difference
   threshold for far jumps; loading the timeline's replay code at idle (would that count as the prefetch
   decided against?).
7. **Deploy script follow-ups**: should `deploy.sh --legal-dir` refuse placeholders as the strict website
   build does (it bundles the unedited drafts today), and check the texts exactly as the backend does (a text
   of only a byte-order mark or non-breaking spaces passes it and stops the backend)? APIs enabled by a
   stopped run are never recorded, so `uninstall.sh --disable-apis` keeps them.
8. **Website follow-ups**: an axe test of every built page in both themes in `e2e/` (the website checks only
   its code blocks statically); `pages.yml` warns on stale media on `main` rather than failing (kept so far);
   the portrait image and its licence; the duplicated non-affiliation sentence at the end of the author
   section on the landing page; "compared with the one before" on the landing page, where the app compares
   with the day you came from; `pnpm website:lighthouse -- --page X` fails because pnpm passes the `--`
   through; the transcript in [../website.md](../website.md) predates the legal drafts and the sample exports
   page (its runs show 16 and 18 pages; the build now makes 19).
9. **Decision text that the retirement of the planning document must carry over or correct**: the
   distribution decision's "Cloud Run cannot pull ghcr.io directly" (Google's documentation now describes
   deploying public ghcr.io images directly; the remote repository stays the default); its release line and the
   deploy scripts' task still describe Workload Identity Federation; its website section names
   `scripts/screenshots.mjs` (now `pnpm media`); its `auto` ceiling sentence lacks the exception for views of at
   most 100 boxes; an ADR for "ghcr.io plus a remote repository, no WIF" (now ADR 0035, section 2); the
   graph's bundling comment and README say groups of 21 to 24 where the code makes 20 to 24 (the user guide is
   corrected).
10. **Pricing**: confirm against Google's current pricing page that the Cloud Asset Inventory and Resource
    Manager calls gcportrait makes are free within their quotas, as the FAQ and the self-hosting guide say.
11. **Dependabot** will propose newer commits of `anchore/sbom-action` (pinned at v0.24.0): accept them after
    review?

## 8. This review's own changes and checks

Changes, all in documentation: the draft release notes ([../../CHANGELOG.md](../../CHANGELOG.md), new); this
document; the docs index ([../README.md](../README.md)); the root README's "Status and roadmap"; the planning
document's status lines. Small fixes in passing: ADR 0018 no longer quotes the
superseded wording that named a programme membership of the maintainer (it describes it instead, so the term
appears nowhere in the repository); the user guide on lenses says groups of 20 to 24 (the bundling code's
actual range); `docs/getting-started.md` says a day is compared with the day you came from.

Checks after these changes:

| Command | Result |
|---|---|
| `pnpm check` (the isolated copy with this review's files laid over it) | **green** in 3 min 9 s: 313 files, 7 577 tests; catalog, provenance (1 300 SPDX headers) and licences OK |
| `pnpm website:build`, then `pnpm website:check` (the same copy) | **green**: 19 pages built, "19 pages OK" (the two corrected guides are rendered on the site) |
| `pnpm provenance` (the shared tree) | OK: 2 547 files scanned, 1 304 SPDX headers |
| `node scripts/user-docs.mjs` (the shared tree) | "user-docs: OK. 8 guides current with the tree." |
| `pnpm format` (the shared tree, 13:09 UTC) | changed nothing; by then the star count's files were formatted too, and `prettier --check .` passed on the whole shared tree. Markdown is not formatted by Prettier (`.prettierignore`); it is hand-wrapped at 110 columns |
| The link checker on the changed Markdown files | every relative link and anchor resolves (this document 19, `CHANGELOG.md` 7, the docs index 38, `README.md` 54, `docs/getting-started.md` 11) |

## 9. Reproduce

```sh
# An isolated copy of the committed tree, then the commands in it
git archive HEAD | tar -x -C /path/to/copy
cd /path/to/copy && pnpm install --offline --frozen-lockfile
pnpm check && pnpm build && pnpm size && pnpm e2e
pnpm website:build && pnpm website:check
WEBSITE_STRICT=1 pnpm website:build      # refused until the legal texts and docs/author.md are filled in
pnpm media --check && node scripts/exports.mjs --check
# DNS and the demo mapping
dig +short @8.8.8.8 A gcportrait.app
dig +short @8.8.8.8 TXT _github-pages-challenge-florianchrometz.gcportrait.app
dig +short @8.8.8.8 CNAME demo.gcportrait.app
```
