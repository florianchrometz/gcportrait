<!-- SPDX-License-Identifier: MIT -->

# @gcportrait/icons

> gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is
> not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are
> trademarks of Google and are used under Google's icon usage terms.

The Google Cloud product icons, as Google Cloud provides them at <https://cloud.google.com/icons>, vendored
unmodified, plus a few icons of gcportrait's own, behind the icon keys the asset catalog uses (ADRs 0017 and
0018; the icon rules of the gcp-diagram-style skill). The icons are Google Cloud's, not gcportrait's (see
[Trademark, usage terms and copyright](#trademark-usage-terms-and-copyright)). The package is data and lookups
only: no DOM, no Node APIs, so the app, its workers and the headless renderer can all import it.
`src/index.ts` is the only public surface; the tooling lives in `scripts/`.

```ts
import { iconFor, resolveIcon, placeIcon, isOwnDrawing, ICON_KEYS } from '@gcportrait/icons';

const icon = iconFor(card.icon); // Icon | undefined: { key, svg, viewBox, kind, set, plateOnDark, category }
const fallback = resolveIcon(productKey, typeKey); // never undefined: type → product → category → generic
svg += placeIcon(fallback, 24, x, y); // a nested <svg x y width height viewBox>; the artwork is untouched
if (theme === 'dark' && fallback.plateOnDark) drawPlate(); // style skill §2: colour marks on a light plate
```

## Public API

| Export | What |
|---|---|
| `iconFor(key)` | the `Icon` of a key, or `undefined` for an unknown key; frozen and shared |
| `resolveIcon(productKey?, typeKey?, categoryKey?)` | the fallback chain, never fails: the type's icon key, then the product's, then the category mark (`categoryKey`, else the category of the type's or the product's key), then the generic cloud mark |
| `ICON_KEYS` | every key the package resolves, sorted (catalog keys, category marks, generic marks) |
| `GENERIC_ICON_KEY` | `cloud_generic`, Google's generic cloud icon; the same key `@gcportrait/graph` gives a card of an unknown type (`GENERIC_ICON`) |
| `isOwnDrawing(key)` | whether the artwork is ours rather than Google's |
| `categoryOf(key)` | the category mark key of a product key |
| `placeIcon(icon, size, x?, y?)` | the icon as a nested `<svg>` with position and size added for inlining into a diagram |
| `Icon`, `IconKind`, `IconSet` | the types (`kind`: `official`, `own`, `category`, `generic`; `set`: `core`, `legacy`, `category`, `own`) |

`Icon.svg` is a complete SVG document without `width` or `height`; `viewBox` is `0 0 24 24` (legacy icons, own
drawings) or `0 0 512 512` (core and category marks). `plateOnDark` is true for Google's colour and grey marks:
on dark canvases they sit on a small light plate (`#FFFFFF` at 92 % opacity, radius 4) so the artwork stays as
designed; the two-tone blue icons and the own drawings need none. Never recolour, outline, stretch or restyle
`svg`.

## Trademark, usage terms and copyright

The Google Cloud product icons are Google Cloud's. Google Cloud provides them in its icon library at
<https://cloud.google.com/icons> ("the official library for Google Cloud product icons … for your diagrams,
technical documentation, and more"), which also still offers the older symbols, the legacy console icons, for
the products its 2025 icon system has not updated yet, together with the *Google Cloud product icons* overview
(<https://services.google.com/fh/files/misc/google-cloud-product-icons.pdf>, "Updated: May 2026"). gcportrait
uses the icons as provided there, under the terms stated on that page: the page states no separate licence; it
links Google's Site terms (<https://policies.google.com/terms>) and Google Cloud terms
(<https://cloud.google.com/product-terms>), and Google's trademark rules are in its Brand Resource Center
(<https://about.google/brand-resource-center/>). These are the "Google's icon usage terms" of ADRs 0017
and 0018. Google Cloud and the Google Cloud product icons are trademarks of Google.

The icons are third-party material. They are not covered by gcportrait's own licence (`MIT`, ADR
0017), and neither gcportrait nor its maintainer licenses them: anyone who uses or passes them on does so
under the terms Google Cloud states at <https://cloud.google.com/icons>, not under gcportrait's licence.
`THIRD_PARTY.md` lists them as third-party material. The own drawings below are gcportrait's code and artwork,
under `MIT`.

gcportrait uses the icons to label the Google Cloud products in diagrams of the user's own environment, and:

- never alters the artwork (the transforms below change how a file is written, never what it draws; a test and
  an optional pixel comparison prove it);
- never implies endorsement: the footers of the app and the website carry the non-affiliation notice, and the
  long-form texts carry the statement above in full (ADR 0018); a drawing or an export never does;
- marks its own drawings as its own (`kind: 'own'`, `isOwnDrawing`, a comment in each file, an amber outline
  on the contact sheet), and never presents them as Google Cloud's.

None of Google's SVG files carries a copyright notice, so nothing was stripped; the transforms keep any comment
that might hold one, and the provenance check needs no exemption for `vendored/`. The maintainer's one-time IP
review before a commercial launch should cover this package.

## What is vendored, from where, when

Vendored on 2026-10-09 by `scripts/vendor.mjs` from the three ZIP files the library page links
(`manifest.json` records each ZIP's size and SHA-256, `archive-index.json` every SVG entry in each ZIP with
its SHA-256, the baseline of the [drift check](#keeping-the-icons-current); the index was added on 2026-10-11
from the same archives, byte for byte):

| Set | Google's title | URL | SVGs in the ZIP | Vendored |
|---|---|---|---|---|
| `core` | Core product icons (4-colour marks, 512 grid) | <https://services.google.com/fh/files/misc/core-products-icons.zip> | 19 | 14 |
| `legacy` | Legacy console icons (two-tone blue, 24 grid) | <https://services.google.com/fh/files/misc/google-cloud-legacy-icons.zip> | 216 | 74 |
| `category` | Product category icons (grey and blue, 512 grid) | <https://services.google.com/fh/files/misc/category-icons.zip> | 26 | 22 |

110 files, 148 kB (173 kB as shipped), the largest 4.3 kB; none above the 8 kB guard. Only what an icon key
needs is vendored. The files are `vendored/<key>.svg` (a product key) and `vendored/category_<name>.svg` (a
category mark); `manifest.json` lists, per file, the set, the entry name inside the ZIP, the viewBox, the size
and SHA-256 of the raw and of the transformed file, its colours and the date it was vendored, and per icon key
the file it uses.

## Selection: which artwork a key gets

`mapping.json` (hand-maintained, validated by the tests) names, for every icon key, candidate artwork in this
order: an own drawing (`own`), Google's core colour mark (`core`), Google's two-tone console icon (`legacy`),
and the key's `category` (one of Google's category marks, which is also the key's category for the fallback
chain). `vendor.mjs` takes the first candidate the downloaded sets contain, so marquee products get the colour
mark, sub-products the two-tone icon, and products without an icon of their own the category mark:

- **Core colour marks (14 keys):** `alloydb`, `anthos`, `apigee`, `bigquery`, `cloud_run`, `cloud_sql`,
  `cloud_storage`, `compute_engine`, `google_kubernetes_engine`, `looker`, `security_command_center`,
  `spanner`, `vertex_ai`, and `persistent_disk`, which Google's overview lists as "Hyperdisk (previously
  Persistent Disk)" and so gets the Hyperdisk mark. Each also names its two-tone icon as a fallback.
- **Two-tone console icons (73 keys and the generic mark):** the key is the icon's directory name in the ZIP,
  except where the product was renamed or Google spells it differently: `api_gateway` ← `cloud_api_gateway`,
  `cloud_billing` ← `billing`, `cloud_quotas` ← `quotas`, `cloud_service_mesh` ← `anthos_service_mesh`,
  `identity_aware_proxy` ← `identity-aware_proxy`, `migrate_to_virtual_machines` ←
  `migrate_for_compute_engine`, `sensitive_data_protection` ← `data_loss_prevention_api`, `speech_to_text` ←
  `speech-to-text`.
- **Category marks standing in (44 keys)**, grouped by mark: security and identity (`access_approval`,
  `api_keys`, `cloud_controls_partner`, `organization_policy`, `privileged_access_manager`, `recaptcha`),
  integration services (`api_hub`, `application_integration`, `integration_connectors`), operations
  (`app_hub`, `backup_and_dr`, `workload_manager`), management tools (`app_lifecycle_manager`,
  `essential_contacts`, `krm_api_hosting`, `resource_manager`), developer tools (`application_design_center`,
  `cloud_workstations`, `developer_connect`, `infrastructure_manager`, `secure_source_manager`), Web3
  (`blockchain_node_engine`), compute (`cluster_director`, `os_config`), data analytics (`dataform`,
  `managed_service_for_apache_kafka`), AI and machine learning (`financial_services`, `gemini`), web and mobile
  (`firebase`, `firebase_data_connect`), media services (`live_stream`, `transcoder`, `video_stitcher`),
  storage (`managed_lustre`, `netapp_volumes`, `parallelstore`, `storage_transfer_service`), migration
  (`migration_center`), databases (`oracle_database`), networking (`secure_web_proxy`,
  `serverless_vpc_access`, `service_directory`, `service_networking`), AI applications and agents
  (`vertex_ai_search`). Google's overview lists Gemini as a core product, but the core ZIP ships no Gemini
  mark, so `gemini` uses the AI and machine learning mark.
- **Own drawings (4 keys)**, see below.

Every key's category follows the product-to-category lists of Google's overview; products it does not list
(media, Firebase, resource hierarchy, several newer products) were placed by their documentation's product
family. The legacy ZIP also holds icons whose names resemble a catalog product but may belong to another
(`transfer`, `connectors`, `service_discovery`, `os_configuration_management`, `private_connectivity`); none is
used, because a wrong product's icon misleads more than a category mark. Keys of the catalog that the mapping
does not list stop `vendor.mjs` with the list.

The 22 category marks used are keys too (`category_networking`, …), and `cloud_generic` (Google's generic
cloud icon from the legacy set, `kind: 'generic'`) is the last resort of `resolveIcon`.

## Mechanical transforms

`scripts/lib/svg.mjs` rewrites each file without changing what it draws:

1. the XML prolog, editor comments (`<!-- Generator: Adobe Illustrator … -->`), `<title>`, `<desc>` and
   `<metadata>` are removed; a comment that may carry a copyright notice is kept (none occurs);
2. `<style>` class rules and inline `style` attributes become presentation attributes, following the CSS
   cascade (presentation attribute < class rule in stylesheet order < inline style); anything that is not a
   single-class rule of presentation properties stops the run instead of being guessed;
3. ids nothing references are removed; referenced ids (clip paths, masks, filters, `<use>` targets) are
   renamed `icon-<file>-<n>` so that several icons can share one document, and every `url(#…)` and `href`
   follows;
4. editor attributes (`data-*`, `jetwayHook*`, `xml:space`) and the root's `id`, `version`, `baseProfile`,
   `x`, `y`, `width` and `height` are removed (the renderer sizes icons), and `<defs>` left empty goes;
5. the viewBox is written `0 0 24 24` or `0 0 512 512`, the set's native size (all sources already use it; a
   different one stops the run, since rescaling coordinates would not be mechanical);
6. whitespace between tags is dropped, attributes are written with double quotes.

Checks, at vendoring time and in the tests: no colour appears that the source did not have, no drawing element
is lost, no file exceeds 8 kB, each committed file still matches the SHA-256, size and colours the manifest
recorded (so nothing was recoloured or edited since), and each file is a fixed point of the transforms.
`vendor.mjs --verify-render` also rasterises every source and its transform in headless Chromium at 16, 24 and
96 px, both sized alike, and requires identical pixels; on 2026-10-09 all 110 were pixel-identical.

## Own drawings

Drawn for gcportrait on the 24 px grid in the two-tone palette (`#4285F4` + `#AECBFA`), each file starting with
the comment "Own drawing for gcportrait (…): not a Google icon.":

| Key | What it shows | Why it is ours |
|---|---|---|
| `organization` | a three-level hierarchy (one node over three) | Google's sets have no organisation icon |
| `folder` | a folder | no folder icon in Google's sets |
| `service_account` | a person with a machine badge | no service-account icon in Google's sets |
| `generic_resource` | an isometric box | meant for things that are not a Google product (virtual region and zone containers, external stubs), where a Google mark would misattribute; the SVG renderer decides where to use it |

`project` uses Google's two-tone project icon.

## 16 / 24 px legibility check list

Every candidate on the list below was rendered at 16 and 24 px with one device pixel per CSS pixel
(`out/icons-legibility-16px.png`, from `pnpm --filter @gcportrait/icons contact-sheet`), and a redraw was made
only where Google's glyph does not hold up. The list is data (`legibility16` in `mapping.json`):

| Subject | Key | 16 px | Decision |
|---|---|---|---|
| VM instance | `compute_engine` | chip outline and pins stay distinct | official kept |
| GKE pod (and every Kubernetes object) | `google_kubernetes_engine` | inner cube softens, four-colour hexagon recognisable | official kept; Google ships no pod glyph, and a pod-specific drawing would need a catalog icon override |
| Firewall rule and firewall policy | `cloud_firewall_rules` | brick courses stay separate | official kept |
| Subnetwork (and VPC network) | `virtual_private_cloud` | four nodes and links stay distinct | official kept; subnet and VPC share the glyph, the zone tint and title tell them apart |
| Service account | `service_account` | — | own drawing (no Google glyph exists) |

At 24 px every icon is legible. At 16 px a few dense two-tone icons soften (`network_connectivity_center`,
`bigtable`) but stay recognisable; none was redrawn.

## Contrast

The tests check every icon on the card and plate backgrounds of both themes (style skill §2 and §10): its most
contrasting colour must reach 3:1 on the light card (`#FFFFFF`) and, in the dark theme, on the plate (colour
and grey marks) or on the dark card `#2B2C2F` (two-tone and own icons). Two official icons are drawn by Google
only in its two light tones (`#669DF6`, `#AECBFA`) and reach 2.72:1 on the white card: `cloud_armor` and
`cloud_domains`. Icons are never recoloured, so they ship as drawn under a narrow, documented exemption in
`scripts/data.test.ts` (the card's title names the resource, so the glyph is not the only carrier of its
meaning; the same reasoning as the subnet-stroke exemption of style skill §10). The test fails if another icon
falls below 3:1 or an exempted one stops needing it.

## Generated module

`src/generated/icons.ts` holds every distinct artwork once (`ARTWORK`) and one record per key (`RECORDS`); it
is generated by `scripts/build.mjs` (`pnpm --filter @gcportrait/icons build`) and **committed**: 177 kB, 46 kB
gzipped, changing only when someone re-vendors or edits an own drawing. Committing it keeps every root command
(`lint`, `typecheck`, `test`, the app build) working on a fresh clone without another pre-hook, and a test
regenerates it in memory and fails while the committed file is stale. Every artwork the catalog can reference
must be available synchronously to the renderer, so the module holds exactly the icons the catalog uses (plus
the category and generic marks of the fallback chain) and nothing else, each once.

## Commands

| Command | What it does |
|---|---|
| `pnpm --filter @gcportrait/icons vendor` | download the three ZIPs, vendor, write `vendored/`, `manifest.json` and `archive-index.json` (`--zips <dir>` uses downloaded files, `--date YYYY-MM-DD` the date for new or changed files, `--check` writes nothing and exits 1 on a difference, `--verify-render` adds the pixel comparison, `--keep-temp` keeps the unzipped sets) |
| `pnpm --filter @gcportrait/icons drift` | compare the archives <https://cloud.google.com/icons> links today with what was vendored and print the report; exit 0 no drift, 1 drift, 2 usage error, 3 could not check (`--offline --zips <dir>` reads saved archives and touches no network, `--page <file>` a saved copy of the page, `--markdown <file>` / `--json <file>` also write the report, `--keep-temp` keeps the downloads); see [Keeping the icons current](#keeping-the-icons-current) |
| `pnpm --filter @gcportrait/icons build` | regenerate `src/generated/icons.ts` (`node scripts/build.mjs --check` only compares) |
| `pnpm --filter @gcportrait/icons contact-sheet` | write `out/icons-contact-sheet.svg`, `out/icons-contact-sheet.png` (every key at 24 and 16 px, light and dark) and `out/icons-legibility-16px.png` at the repository root (git-ignored); the PNGs need Chromium (`pnpm --filter @gcportrait/e2e install-browsers`) |
| `pnpm --filter @gcportrait/icons test` | the transform, zip and lookup tests and the data guards against the real catalog |
| `pnpm catalog:check --strict-icons` | the catalog side: every icon key a product or type uses is listed in `packages/catalog/icon-keys.json` |

## Keeping the icons current

Google Cloud updates its icons on <https://cloud.google.com/icons>: new product marks join the 2025 icon
system, and the page keeps offering the older symbols (the legacy console icons) for the products not updated
yet. The drift check finds out what changed, the way `pnpm catalog:fetch-official` does for the asset types:

```sh
pnpm --filter @gcportrait/icons drift              # read the page, download the archives, report
pnpm --filter @gcportrait/icons drift --keep-temp  # the same, keeping the downloads (for vendor --zips)
```

`scripts/drift.mjs` reads the library page, downloads every ZIP archive it links into a new temporary
directory (https, Google hosts only, size-capped), lists their SVG entries with the package's own ZIP reader
(bounded entry sizes, no path escapes; nothing from the download is executed), and compares entry names and
SHA-256 hashes with `archive-index.json`, `mapping.json` and `manifest.json`. It never writes to the
repository. The weekly workflow `.github/workflows/icon-drift.yml` runs it on Thursdays and opens one issue
titled "Icon drift: Google Cloud product icons changed" (or updates it while it is open), with the same report
as Markdown; every run also puts the report in its job summary.

What the report means:

| Line (text) / section (issue) | Meaning | What to do |
|---|---|---|
| `NEW LINK` / `GONE LINK`, "Archive links on the page that changed" | the page links a ZIP that `mapping.json` does not name, or no longer links one it names; a new archive is downloaded and its icons listed as new | read the page; name a new set in `sources` (and `SETS` in `scripts/lib/mapping.mjs`) or point a set at its new URL |
| `NEW`, "New icons" | an SVG entry that was not in the archive when it was vendored, with a guess of the catalog product it shows, by name (`probably cloud_armor, by the name "cloud_armor" (1)`: 1 the same name, 0.9 an acronym such as GKE, else the share of common words) | decide whether a product key should use it (below) |
| `CHANGED`, "Changed icons" | the same entry name with other bytes; "used by" names the keys that draw it | re-vendor; look at the contact sheet |
| `RENAMED`, "Renamed icons" | the same bytes under another name, or (content changed too) one removed and one added entry that name the same product | point `mapping.json` at the new name when a key used it |
| `REMOVED`, "Removed icons" | an entry that is gone | as for a rename; a key whose artwork vanished falls back as listed below |
| `MISSING mapped …`, "Entries mapping.json uses that are missing upstream" | an entry `mapping.json` names is not in the current archive, with what `vendor.mjs` would fall back to (core → legacy → category mark; a category mark has no fallback and stops it) | fix `mapping.json` before re-vendoring |
| `NEWER ICON for …`, "Products on an older symbol although a newer icon exists" | a key drawn with a legacy console icon or a category mark while a core mark (or an icon in a newly linked archive) matches its name | adopt it, or keep the older symbol on purpose (below) |
| `UNAVAILABLE` | a mapped archive answered HTTP 4xx (or is missing from `--zips`) | read the page; the set may have moved |
| "older symbols still in use" | information, not drift: how many product keys use a core colour mark, a legacy console icon (the older symbols), a category mark standing in, or an own drawing, and which core marks on the page no key uses | nothing, unless one of those products should now get a newer mark |

The last line is the summary: `icon drift: none. …` with exit code 0, or `icon drift: 1 new, 0 changed, …`
with exit code 1. Exit code 3 means the check itself failed (the network, a corrupt archive, a page without
ZIP links): the workflow then fails instead of opening an issue.

To vendor an update:

1. Run the drift check (`--keep-temp` keeps the downloaded archives) and read the report; if the ZIP links
   changed, update `sources` in `mapping.json`, and read the current product icons overview for new core
   products and category assignments.
2. To give a product the new icon over its older symbol, add the new entry as the key's `core` candidate in
   `mapping.json`, ahead of its `legacy` one, which stays as the fallback (`vendor.mjs` takes the first
   candidate the archives contain). To keep the older symbol on purpose (the new mark shows something else, or
   does not hold up at 16 px), record why under `keepOlderSymbol` instead; the report then lists the match as
   kept, not as drift. For a renamed or removed entry, point the key at the current name; never edit the
   artwork. For example (the first entry goes under `icons`, the second at the top level of `mapping.json`):

   ```json
   "cloud_armor": {
     "core": "Unique Icons/Cloud Armor/SVG/CloudArmor-512-color.svg",
     "legacy": "cloud_armor/cloud_armor.svg",
     "category": "category_networking"
   },
   "keepOlderSymbol": { "cloud_domains": "why the older symbol stays" }
   ```

3. `pnpm --filter @gcportrait/icons vendor --verify-render` (or `... vendor --zips <kept directory>
   --verify-render` to vendor exactly the bytes the check looked at). It fails when a mapped entry vanished
   from its ZIP with nothing to fall back to, when a transform meets something it does not handle, when a file
   exceeds 8 kB, or when the rendered pixels differ; fix `mapping.json` (never the artwork). It also rewrites
   `archive-index.json`, which accepts the archives as the new baseline: a new icon no key uses stops being
   reported once vendored.
4. `pnpm --filter @gcportrait/icons build`, then `pnpm --filter @gcportrait/icons contact-sheet` and look at
   `out/icons-contact-sheet.png` in both themes and at `out/icons-legibility-16px.png`.
5. `pnpm --filter @gcportrait/icons test`, `pnpm --filter @gcportrait/icons drift` (now `icon drift: none`,
   unless a decision is still open) and `pnpm catalog:check --strict-icons`.
6. Update the dates and counts in this README and the icons section of `THIRD_PARTY.md`; commit `vendored/`,
   `manifest.json`, `archive-index.json`, `mapping.json` and `src/generated/icons.ts` together, in a pull
   request that closes the drift issue.

Files whose raw and transformed hashes did not change keep their original date, so a re-run against unchanged
ZIPs produces byte-identical output.

A new catalog icon key needs an entry in `mapping.json` (and, for the catalog, in
`packages/catalog/icon-keys.json`) before `vendor.mjs` will run.

## Open point for the maintainer

Google's product icons overview (May 2026) says of the legacy console icons, in its appendix: "Please note,
these icons should not be used as of 2026", while the library page still offers them "for your projects". The
style skill uses them for sub-products, and this package follows it. Following Google's
newer guidance instead is a data change: remove the `legacy` candidates from `mapping.json` (each key then falls
to its category mark, assigned per that overview), give the generic mark another source (for example an own
drawing), and re-vendor. That is a design decision for an ADR, not for this package alone.
