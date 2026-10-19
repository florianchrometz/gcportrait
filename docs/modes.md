<!-- SPDX-License-Identifier: Apache-2.0 -->

# Modes: your account, the service account, export files and the demo

Every diagram is drawn from a *snapshot*: the assets of one scope (an organisation, a folder or a project) as
Cloud Asset Inventory reported them at one moment. There are four ways to get one, and they differ in what
they read, what they need and who they read as. This guide compares them, says which instance offers which,
and where the data goes.

| Section | |
|---|---|
| [1. At a glance](#1-at-a-glance) | The four ways side by side. |
| [2. Your account (user mode)](#2-your-account-user-mode) | Sign in with Google, pick a scope, check, pull. |
| [3. The instance's service account](#3-the-instances-service-account) | A team grants one account once. |
| [4. The demo](#4-the-demo) | Synthetic organisations S to XL, no Google account. |
| [5. Export files](#5-export-files) | A `gcloud asset export`, dropped in or read from Cloud Storage; snapshot files. |
| [6. Which instance offers what, and where the data goes](#6-which-instance-offers-what-and-where-the-data-goes) | Normal, demo-only and demo builds; the browser's storage. |

## 1. At a glance

| | Your account | Service account | Demo | Export files |
|---|---|---|---|---|
| **Reads** | a scope, live, from Cloud Asset Inventory | a scope, live, from Cloud Asset Inventory | synthetic organisations, generated in your browser | a Cloud Asset Inventory export you made |
| **As** | you: your own IAM roles | the instance's service account, after a gate checks that you can see the scope | nobody | you, when the file is read from Cloud Storage; nothing when you drop it in |
| **Needs** | an instance with an OAuth client; `roles/cloudasset.viewer` on the scope and a quota project of yours | an instance with service-account mode on; the account granted `roles/cloudasset.viewer` on the scope; you can see the scope | nothing | the export file (to make one: `roles/cloudasset.viewer`) |
| **Timeline** | the last 35 days, each day read when you stop on it | the same | the organisation's own 35 days, all at once | its own read time, as an extra tick of its scope |
| **Start on the Connect page with** | "Sign in with Google", Read with › *Your account*, then "Pull now" | "Sign in with Google", Read with › *Service account*, then "Pull now" | "Try the demo" (on the Settings page on a live instance) | "Load export" (or the Snapshots page's import) |
| **Guide** | [permissions.md](permissions.md#2-with-your-own-account) | [permissions.md](permissions.md#3-through-the-instances-service-account) | [section 4](#4-the-demo) | [section 5](#5-export-files) |

Whatever the way, the result is the same kind of snapshot, stored in your browser, drawn by the same code,
with the same lenses, filters, timeline and export. Nothing in gcportrait writes to Google Cloud.

**Large snapshots.** Drawing more than 10,000 assets at once is slow and heavy on memory (the diagram still
works), so the app asks before it draws a larger snapshot, "Draw it anyway" or "Cancel": before "Try the demo"
generates XL, before a stored snapshot opens, for export files dropped on the Connect page once they are read
and before they are stored, and for a pull or a Cloud Storage read as soon as its count passes 10,000; for the
files, the pull and the read, Cancel stores nothing. "Do not ask again in this session" stops the question in
that browser tab until it is closed, and a snapshot you chose to draw is not asked about again there when you
change the view.

## 2. Your account (user mode)

The default on any instance whose operator configured an OAuth client
([self-host-options.md](self-host-options.md#the-oauth-client-in-detail)):

1. **Sign in with Google.** Google's window asks you to let gcportrait view your Google Cloud data
   (`cloud-platform.read-only`) and your Cloud Asset Inventory data (`cloudasset`), and for your email
   address. The token stays in the tab's memory and is revoked when you sign out
   ([permissions.md](permissions.md#2-with-your-own-account) has what Google's consent screen says and why).
2. **Pick a scope.** The scope picker searches the organisations, folders and projects your account can see,
   by name or id.
3. **Check permissions** (in the Connect page's "Read your environment"). The check
   names each thing that is missing, with the exact `gcloud` command that grants it, and finds the *quota
   project* your requests are charged to.
4. **Pull now.** The backend streams the scope's assets page by page to your browser; the diagram opens on the
   new snapshot. Cancel stops it and keeps nothing.

You read exactly what your own roles let you read; the instance's own account plays no part.

## 3. The instance's service account

When the operator deployed with `--sa-mode` (`SA_MODE_ENABLED=true`), the Connect page offers **Read with ›
Service account**. Someone who may grant roles on a scope grants the instance's account
`roles/cloudasset.viewer` there once; after that, everyone who can see that scope and sign in to the instance
reads it through the account, without Cloud Asset Inventory roles of their own. Before every read as the
account, the instance checks with your own sign-in that you can see the scope (the *gate*), and refuses
otherwise. The account's own project pays; you pick no quota project.
[permissions.md](permissions.md#3-through-the-instances-service-account) has the grant, the gate and what it
does not protect against; [self-host-options.md](self-host-options.md#service-account-mode) the operator's
side.

## 4. The demo

"Try the demo" needs no Google account, no sign-in and no backend. Pick a size and press it:

| Size | Assets | Asset types | What it is like |
|---|---|---|---|
| S | 96 | 59 | one business unit, one Shared VPC; the smallest organisation with one of everything the demo models |
| M | 952 | 208 | three business units, production and non-production; the reference for the docs and the visual tests |
| L | 6 382 | 219 | ten business units, three environments |
| XL | 51 242 | 219 | thirty business units; for trying the limits |

These default-seed figures are checked against `packages/demo-data/fixtures/stats.json` by
`node scripts/user-docs.mjs`.

Each is a synthetic organisation `example.com` (names and numbers chosen not to be anyone's: projects
`demo-web-1`, `demo-net-1`, …, numbers below 100000000000, documentation IP ranges) with a 35-day history of
additions, removals and changes, from 4 September to 8 October 2026. It is generated in your browser (in a
background worker), stored in your browser, and opened on the diagram; the timeline then moves through its 35
days at once ([timeline.md](timeline.md)). While signed out (or in demo mode), the Snapshot menu also offers
S, M and L directly, and a link opens one: `/diagram#snapshot=demo:M`.
[packages/demo-data/README.md](../packages/demo-data/README.md) says what is
modelled: folders, Shared VPC, load balancers, GKE, Cloud Run, data, keys, a perimeter, an App Hub
application, and edge cases such as an empty project.

The demo runs in four places:

- **on any instance**, on the Settings page while signed out;
- **on a demo-only instance** of your own: the image with `DEMO_ONLY=true`. It has no sign-in and no route
  that calls Google, and stores nothing on its server; its Connect page offers the demo, a link to deploy
  gcportrait to your own Google Cloud project, and its operator's legal pages if it has any
  ([self-host-options.md](self-host-options.md#demo-only-instance));
- **in the static demo**, such as the project's own at <https://gcportrait.app/demo/>: the same app as on a
  demo-only instance, built once by `pnpm demo:static` with that configuration built in (no backend at all,
  not even for `/api/config`), so any static host serves it; the website's GitHub Pages site serves the
  project's. It looks and behaves like a demo-only instance, links its legal pages elsewhere, and keeps
  everything in your browser ([website.md, "The demo"](website.md#the-demo));
- **in a demo build** without any backend: `pnpm dev:demo` (the SPA served with `VITE_DEMO=1`), for
  contributors and for trying gcportrait from a checkout. It builds the same demo-only configuration in as
  the static demo, so it too looks and behaves like a demo-only instance, linking no legal page unless it was
  given one.

## 5. Export files

For organisations too large to pull comfortably, for a scope you can export but not list live, or for a state
you want to keep, make an export with `gcloud` and open it in gcportrait. The Connect page's "Load export"
card shows these commands, filled in with the scope you picked:

```sh
gcloud asset export --organization=YOUR_ORG_ID --content-type=resource --output-path=gs://YOUR_BUCKET/export.json
gcloud asset operations describe YOUR_OPERATION_NAME --format=json > operation.json
gcloud storage cp gs://YOUR_BUCKET/export.json .
```

(`--folder=YOUR_FOLDER_ID` or `--project=YOUR_PROJECT_ID` for the other kinds of scope.) Then either:

- **drop the file** (several files of one export at once, and `operation.json` with them) onto the card, or
  onto the Snapshots page's import, which every instance and build has (in a browser that keeps IndexedDB). It
  is read in your browser; nothing is uploaded and no sign-in is needed. Cancel, under the progress bar while
  the files are read, stops the import and keeps nothing, and so does leaving the page before it ends; or
- **read it from Cloud Storage**: sign in, type the `gs://` address and press "Read from Cloud Storage"; the
  backend reads the object with your token (you need `storage.objects.get` on it) and streams it to your
  browser.

**The read time.** An export does not record when it was taken; the export's operation does. Keep the
operation's JSON as `operation.json` next to the file, or type the time in "When the export was taken (UTC,
optional)"; without either, gcportrait uses the latest change among the assets and marks the snapshot
*estimated* ([timeline.md](timeline.md#8-estimated-read-times)). Every export and every pull of a scope also
appears as an extra tick on that scope's timeline.

**Snapshot files.** The Snapshots page exports any stored snapshot as a `.gcportrait.json` file (with its
35-day history for a demo organisation) and imports such files and Cloud Asset Inventory exports again, each
under a new id. That is how you move a snapshot to another browser or keep it past the 35-day window.

## 6. Which instance offers what, and where the data goes

| Instance | Your account | Service account | Demo | Export files | How it is started |
|---|---|---|---|---|---|
| a normal instance with an OAuth client | yes | when the operator turned it on | yes | yes (Cloud Storage reads need sign-in) | `infra/deploy.sh --oauth-client-id …` ([self-host.md](self-host.md)) |
| a normal instance without an OAuth client | no ("Sign in with Google" shows as not configured) | no | yes | dropped files only | `infra/deploy.sh` without `--oauth-client-id`; `pnpm docker:run` |
| a demo-only instance | no | no | yes | dropped files, on the Snapshots page | `infra/deploy.sh --demo-only`; `DEMO_ONLY=true` |
| the static demo | no | no | yes | dropped files, on the Snapshots page | `pnpm demo:static` (`VITE_STATIC_DEMO=1`), served by any static host |
| a demo build | no | no | yes | dropped files, on the Snapshots page | `pnpm dev:demo` (`VITE_DEMO=1`) |

`GET /api/config` says which kind an instance is: `oauthClientId`, `saMode` and `demoOnly`
(`curl -s https://YOUR_INSTANCE/api/config`).

**Where your data goes.** Snapshots, the timeline's days and your saved views live in your browser's
IndexedDB, in this browser profile only; the Snapshots page lists them with their sizes and deletes them. The
backend has no database and no bucket: it forwards your token to Google, streams the answer to your browser
and forgets it. Your token is never stored, never logged and never put in a URL. Exported pictures and
snapshot files are downloads you start; nothing is uploaded anywhere. gcportrait has no telemetry.
([faq.md](faq.md#does-my-data-leave-the-browser) has more.)
