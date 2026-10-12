<!-- SPDX-License-Identifier: MIT -->

# 0018. Non-affiliation is stated everywhere a user or contributor looks

- **Status:** accepted; amended twice on 2026-10-10 (the wording, see "Amendment (2026-10-10)", then the
  placement, see "Amended 2026-10-10 (placement)"), once on 2026-10-11 (the placement in drawings, see
  "Amended 2026-10-11 (placement, final)") and twice on 2026-10-12 (the trademark sentence, see "Amended
  2026-10-12 (wording)", then the short line and the long form, see "Amended 2026-10-12 (footers and long-form
  texts)")
- **Date:** 2026-10-08 (amended 2026-10-10, 2026-10-11 and 2026-10-12)
- **Deciders:** Florian Chrometz (maintainer)
- **Related:** agents.md hard rule 12, `frontend/src/branding.ts`, skill `gcp-diagram-style` §1 and §7,
  [ADR 0013](0013-png-and-svg-export.md), [ADR 0033](0033-render-api.md)

## Context

gcportrait draws *Google Cloud-style* architecture diagrams with Google's official product icons, which
invites the assumption that it is a Google product. Google's icons are trademarks used under usage terms,
nothing may imply Google's endorsement, and the maintainer wants no ambiguity.

## Decision

The project and the maintainer are not affiliated with, endorsed by, or sponsored by Google, and every surface
a user or contributor sees says so in one of the canonical forms below. The wording is fixed; change it only by
superseding or amending this ADR (as the amendments below did), never in one place alone.

**Footer notice** (the app footer on every route and the website footer on every page; the name is a link to
<https://florian-chrometz.de>, placement amendment):

> Not affiliated with Google / Google Cloud. gcportrait is an independent open-source project by Florian Chrometz

**Long form** (every long-form text: the README, the website's long-form texts (the landing page's author section,
the licence page, the guides), the docs, the icons README, the release notes, the image's description label, the close
of the infra scripts' `--help`, the Connect page's About block):

> gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is
> not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are
> trademarks of Google and are used under Google's icon usage terms.

**Placement:** the statement appears in footers and long-form texts only. There is no short line any more
(amendment of 2026-10-12, footers and long-form texts): the footer notice's first sentence appears nowhere else.

The diagram's title block ends with the **tagline** `gcportrait.app - Visualize your Google Cloud
Infrastructure` on the canvas and in exports; it is branding, not a statement. No drawing carries an affiliation
line: not the interactive canvas, not an exported SVG or PNG (title block or `<desc>`), not a render of `pnpm
render` or of the layout's debug script, not the website's sample exports (final placement amendment of
2026-10-11).

**Surfaces.**

| Form | Surface | Status |
|---|---|---|
| footer notice | app footer (every route), the maintainer's name a link (new tab, `rel="noopener"`, named "Florian Chrometz (personal website)"), next to the source link ("Source (MIT)" since 2026-10-12, ADR 0017) | in place since 2026-10-10; asserted by `frontend/src/App.test.tsx` and `e2e/tests/shell.spec.ts` (every route, both themes, contrast and focus ring) |
| footer notice | Connect page | in place: the footer, plus the long form in the page's About block |
| none | every drawing: the canvas's and an export's title block (SVG and PNG, the Export menu, `pnpm render` and the render API's `POST /api/render`, ADR 0033) and the SVG's `<desc>`, the layout's debug renders, the website's sample exports | removed on 2026-10-11 (final placement amendment; it was the export title block's fourth line from 2026-10-10): the title block is the canvas's three lines, ending with the tagline, and `<desc>` holds neutral metadata only; the absence is asserted by `e2e/tests/export.spec.ts`, `e2e/tests/shell.spec.ts`, `frontend/src/export/serialize.test.tsx`, the renderer's baseline tests, `packages/render-cli/test/render.test.ts` and `backend/src/routes/render.test.ts`; the sample exports in `docs/media/exports/` follow when `node scripts/exports.mjs` draws them again |
| none | the command-line banners: `pnpm render` (standard error and its `index.json`), `pnpm render-scene`, the layout's `debug-svg`, `bench`, `measure` and `metrics`, `infra/deploy.sh`, `infra/uninstall.sh` and `infra/cloud-run-button.sh`; the icons' contact sheet | removed on 2026-10-12: each banner names its command only; asserted by `packages/render-cli/test/cli.test.ts`, `packages/graph/scripts/render-scene.test.ts`, the layout's `scripts/*.test.ts` and `scripts/infra.test.ts` |
| none | the render API's answer (`POST /api/render`, ADR 0033): no `x-gcportrait-notice` header | removed on 2026-10-12; asserted by `backend/src/routes/render.test.ts` |
| none | the backend's `hostedBy` line in `/api/config`: "Hosted by NAME." alone, or null without `HOSTED_BY`, shown next to "Sign in with Google" | changed on 2026-10-12: `HOSTED_BY` still may not name Google; asserted by `backend/src/routes/config.test.ts`, `frontend/src/auth/SignIn.test.tsx` and `e2e/tests/signin.spec.ts` |
| none | the Permissions page and a snapshot bundle (`.gcportrait.json`, no `notice` key; older bundles with one are still read) | removed on 2026-10-12; asserted by `frontend/src/pages/PermissionsPage.test.tsx` and `frontend/src/snapshots/worker/parse.test.ts` |
| long | the close of `infra/deploy.sh --help` and `infra/uninstall.sh --help` | in place since 2026-10-12 (`infra/common.sh`, kept equal to `branding.ts` by `scripts/non-affiliation-copies.test.ts`) |
| long | root `README.md` | in place |
| long | docs index (`docs/README.md`) and `docs/contributing.md` | in place |
| long | the user guides `docs/permissions.md`, `docs/self-host.md`, `docs/configuration.md`, `docs/timeline.md`, `docs/modes.md`, `docs/lenses-and-filters.md`, `docs/export.md`, `docs/faq.md` and `docs/api.md` | in place (2026-10-10 and 2026-10-11; `docs/api.md` with the render API), at the top of each |
| footer notice | website footer, every page, the maintainer's name a link to their website | in place since 2026-10-12 (it replaced the long form and the copyright line there), from `website/src/site.ts` (kept equal to `branding.ts` by `website/src/site.test.ts`); asserted on every built page by `pnpm website:check` |
| long | website landing page: the author section only (`docs/author.md`'s closing paragraph), the licence page and the guides | in place; since 2026-10-12 no other section of the landing page carries it (the closing "See your own environment" section did), asserted by `pnpm website:check` |
| long | `packages/icons/README.md` | in place; asserted verbatim by `packages/icons/scripts/data.test.ts` |
| long | release notes | in place: `scripts/release-notes.mjs` puts it at the top of every GitHub release's notes (kept equal to `branding.ts` by `scripts/release-notes.test.ts`) |
| long | container image label `org.opencontainers.image.description` | in place: `infra/Dockerfile` and `release.yml` |

Never describe gcportrait as "Google's", "official" or "verified", and never alter Google's icons.

## Amendment (2026-10-10)

The maintainer revised the wording: the project does not describe the maintainer by any programme membership,
anywhere, and the statement says only that gcportrait is an independent open-source side project. The revised
forms were the long form above and the short form "Not affiliated with Google. An independent open-source side
project." (itself retired by the placement amendment below). They replaced the wording of 2026-10-08 to
2026-10-10, which is superseded and must not be used again: both of its forms named a programme membership of
the maintainer, and its long form also said that the project was built to support the Google Cloud community.
At the maintainer's request (2026-10-10) that membership is named nowhere in the repository, this record
included.

Every surface in the table was updated the same day, and the baselines that embed the title block (the
renderer's SVG baselines in `e2e/baselines/diagram/` and the render golden PNG) were regenerated with their
documented commands.

## Amended 2026-10-10 (placement)

Later the same day the maintainer revised where the statement goes:

- The diagram's title block (top-left, inside the SVG) no longer carries the affiliation line on the interactive
  canvas. Its third line is the tagline `gcportrait.app - Visualize your Google Cloud Infrastructure`, muted at
  10.5 px as the statement was.
- The app footer carries, on every route, `Not affiliated with Google / Google Cloud. gcportrait is an
  independent open-source project by Florian Chrometz`, the name linked to <https://florian-chrometz.de>, next to
  the Source link.
- Exports (SVG and PNG) have no footer, so an exported title block appends `Not affiliated with Google / Google
  Cloud.` as a fourth muted line below the tagline, and the SVG's `<desc>` ends with it. The command-line banners
  use the same short line.
- The long form stays as it is, for the README, the website, the docs and the icons README.

The short form of the first amendment, "Not affiliated with Google. An independent open-source side project.",
is retired with this one: no surface shows it any more. Where neither the maintainer's placement nor this ADR
named a surface, the export disclaimer took the short
form's place: the backend's `hostedBy` line, the Permissions page's closing note and a snapshot bundle's
`notice`.

Implementation (2026-10-10): `frontend/src/branding.ts` holds `TAGLINE`, `FOOTER_NOTICE` (with
`MAINTAINER_NAME`, `MAINTAINER_URL` and `MAINTAINER_LINK_LABEL`), `EXPORT_DISCLAIMER` and `NON_AFFILIATION_LONG`;
`NON_AFFILIATION_SHORT` is gone. A drawing made for a file (`DiagramSvg`: the export, the baselines, `pnpm
render`) carries the fourth line, the canvas does not, and the export refuses a drawing whose title block lacks
it. Workspaces that may not import the frontend keep their own copy of the disclaimer with a test that reads
`branding.ts` as text (the backend, `packages/layout`, `packages/graph`, `packages/icons`, `infra/common.sh`).
The renderer's SVG baselines and the render golden PNG were regenerated with their documented commands: every
static drawing's title band grew by one 16 px line.

## Amended 2026-10-11 (placement, final)

The maintainer revised the placement once more (2026-10-11): the line `Not affiliated with Google / Google
Cloud.` was still drawn as the fourth line of every exported title block and at the end of the SVG's `<desc>`,
and it belongs in the footer only.

- **No drawing carries the statement.** The diagram's title block is the same three lines on the interactive
  canvas and in every visual export (the app's Export menu as SVG and PNG, `pnpm render`, the layout's debug
  renders, the website's sample exports): the scope, the lens with the read time, and the tagline. The SVG's
  `<desc>` keeps neutral metadata only: the scope, the lens, the read time, a timeline day's changes and "Drawn
  with gcportrait.".
- **The statement stays in the footers and the long form.** The app footer and the website footer carry
  `FOOTER_NOTICE` with the maintainer's name linked; the README, the website, the docs and the Connect page's
  About block carry the long form. Both are unchanged.
- **Text that is not a drawing keeps the short line for now**: the command-line banners (the `pnpm render`
  banner is the first line of standard error, not part of the picture, and its `index.json` `notice`), the
  backend's `hostedBy` line, the Permissions page's note and a snapshot bundle's `notice`. `EXPORT_DISCLAIMER`
  keeps its name and text because the backend, `packages/layout`, `packages/graph`, `packages/icons`,
  `infra/common.sh`, the website and `scripts/exports.mjs` mirror it by that name.

Implementation: `titleBlock` (`frontend/src/diagram/titleBlock.ts`) has no fourth line and no `exported` flag,
`documentText` (`DiagramSvg.tsx`) ends the description with "Drawn with gcportrait.", and the export no longer
refuses a title block without the line (the `missing-statement` refusal is gone; a drawing without a title block
is still refused). The layout's debug SVG drops its second caption line and describes itself in `<desc>`. The
renderer's 32 SVG baselines and the render golden PNG were regenerated with their documented commands: every
static drawing's title band is 16 px shorter again (demo S overview 2349 × 1358 instead of 2349 × 1374; the golden
4794 × 2812 px instead of 4794 × 2844 px).

## Amended 2026-10-12 (wording)

On 2026-10-11 the maintainer instructed that Google is never named with its company suffix. The long form's
last sentence now reads "Google Cloud and the Google Cloud product icons are trademarks of Google and are used
under Google's icon usage terms.", the form `NOTICE` already used; the quote above is that form. Every copy
changed in the same change: `frontend/src/branding.ts`, each website's `src/site.ts` and sample-exports page,
`scripts/release-notes.mjs`, `scripts/third-party-notices.mjs`, the image label in `infra/Dockerfile` and
`release.yml`, the README, the docs and this record. The copy tests keep them equal, and a repository-wide test
keeps the suffix out of every tracked text file.

The maintainer restated the placement the same day: the statement appears in the app and website footers and in
long-form texts only, never in a diagram's title block, an SVG's `<desc>` or any other export. That is what the
final placement amendment of 2026-10-11 built. Whether the short line stays on the text surfaces that are not
drawings (the command-line banners, the backend's `hostedBy` line, the Permissions page's note, a snapshot
bundle's `notice` and the render API's `x-gcportrait-notice` header) was left to the maintainer, because the
bundle's notice and the render header travel with exported files; the next amendment settles it.

## Amended 2026-10-12 (footers and long-form texts)

The maintainer decided (2026-10-12):

- **Placement: footers and long-form texts only.** The short line "Not affiliated with Google / Google Cloud."
  leaves every surface but the footers, where it opens the footer notice: the command-line banners (each now
  names its command only), `pnpm render`'s `index.json` `notice`, the backend's `hostedBy` line ("Hosted by NAME."
  alone, or null), the Permissions page's note, a snapshot bundle's `notice` (the reader still accepts older
  bundles that carry it) and the render API's `x-gcportrait-notice` header (ADR 0033 as amended). The infra
  scripts' `--help` closes with the long form instead, as a long-form help text. `EXPORT_DISCLAIMER` is gone from
  `frontend/src/branding.ts` and from every copy of it.
- **Wording: an independent open-source project, the maintainer named in the footer only.** The long form calls
  gcportrait "an independent open-source project" (no longer a side project) and no longer names the maintainer;
  the quote in the Decision above is the new form. The footer notice, with the name linked, is unchanged, and
  besides it only the website's author section names the maintainer. Every copy of the long form changed in the
  same change (the copy tests keep them equal).
- **The website follows.** Its footer carries the footer notice, with the name linked, in place of the long form
  and of the copyright line that named the maintainer; the landing page carries the long form in its author section
  only (`docs/author.md`'s closing paragraph), no longer in its closing section, where it stood a second time right
  after the author section.

## Consequences

- The app defines every form once, in `frontend/src/branding.ts` (`TAGLINE`, `FOOTER_NOTICE`,
  `NON_AFFILIATION_LONG`); every other place in the app reuses those constants, and the places that cannot import
  them (the website, the tooling, the image, the infra scripts) keep a copy that a test compares with it.
- No drawing carries the affiliation line (amendment of 2026-10-11); a reviewer who finds it in a title block,
  a `<desc>` or a rendered picture treats it as a defect.
- `agents.md` makes the statement a hard rule, and the `gcp-diagram-style` skill points to this ADR from its
  principles and its icon rule: the diagrams are Google Cloud-*style*, the project is independent.
- Reviewers check new user-facing surfaces (pages, banners, release notes) for the statement, and drawings
  (exports, renders) for its absence.
