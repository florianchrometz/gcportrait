<!-- SPDX-License-Identifier: MIT -->

# Frequently asked questions

gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is
not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are
trademarks of Google and are used under Google's icon usage terms.

Short answers, each with a link to where the long one is.

**The diagram**

- [Why does a resource have no arrows?](#why-does-a-resource-have-no-arrows)
- [What is a dangling reference?](#what-is-a-dangling-reference)
- [How does gcportrait show Shared VPC?](#how-does-gcportrait-show-shared-vpc)
- [What happens with an asset type gcportrait does not
  know?](#what-happens-with-an-asset-type-gcportrait-does-not-know)
- [Why do I see ids instead of names?](#why-do-i-see-ids-instead-of-names)
- [Why is most of my organisation collapsed?](#why-is-most-of-my-organisation-collapsed)
- [Can I move or edit boxes?](#can-i-move-or-edit-boxes)

**Data and time**

- [How fresh is what I see?](#how-fresh-is-what-i-see)
- [Why only 35 days?](#why-only-35-days)
- [What does reading my environment cost?](#what-does-reading-my-environment-cost)
- [Does my data leave the browser?](#does-my-data-leave-the-browser)

**Access and hosting**

- [Why does Google's consent screen say "edit, configure, and
  delete"?](#why-does-googles-consent-screen-say-edit-configure-and-delete)
- [Is there a hosted gcportrait I can sign in to?](#is-there-a-hosted-gcportrait-i-can-sign-in-to)
- [Is gcportrait made by Google?](#is-gcportrait-made-by-google)
- [Does it work on a phone or a tablet?](#does-it-work-on-a-phone-or-a-tablet)

## The diagram

### Why does a resource have no arrows?

An arrow is drawn only when all of these hold:

- **the lens draws that kind of relation.** Each lens draws some kinds only: of the ten curated lenses, only
  Identity draws `runsAs` (which service account a workload runs as) and only Security `encryptedBy`
  (customer-managed keys); Compute draws no Shared VPC `shares`; and so on. The Everything lens draws every
  kind. [lenses-and-filters.md](lenses-and-filters.md#2-lenses) lists them per lens;
- **both ends are in the view.** A lens, a focus or a filter that leaves the other end out also leaves the
  arrow out (a single-project focus is the exception: it draws arrows leaving the project, to "external" stub
  cards);
- **the other end is in the snapshot.** A reference to something the snapshot does not hold is a *dangling
  reference* and is never drawn (next question);
- **the catalog knows the reference.** Arrows come from catalog rules that read a field of the asset's own
  data (`network`, `kmsKeyName`, `serviceAccount`, …). An asset type the catalog does not know has no rules,
  so no arrows ([below](#what-happens-with-an-asset-type-gcportrait-does-not-know)).

Also: a resource that sits on exactly one subnet or network is drawn *inside* it rather than with an arrow
(`attaches` as nesting), and arrows into a collapsed zone end at its chip, merged with a count. The details
drawer lists every relation a resource has, drawn or not, grouped by kind.

### What is a dangling reference?

A field of an asset that names another resource which is not in the snapshot: a public image in Google's own
image projects, a Google-managed tenant project behind private services access or Private Service Connect, a
logging writer identity, a project outside the scope you read, or a resource that was deleted. gcportrait
never draws it (there is nothing to point at) and never invents a box for it; the details drawer lists a
resource's dangling references with the value as read, so you can see what it points at. The demo organisation
M has 49. Most point outside the organisation: 31 to public
images and 3 to container images of Google's own, 6 to resources in Google-managed tenant projects and 5 to
logging writer identities. Two point to `all-apis`, the bundle of Google APIs a Private Service Connect
endpoint targets, which is not a resource at all. The last two point inside the organisation: two virtual
machines run as the default Compute Engine service account of their project, `demo-partner-1`, and the
snapshot holds no such account (a deleted account dangles the same way). A rising count after an API change
can also mean a catalog rule needs an update ([catalog-followups.md](catalog-followups.md)).

### How does gcportrait show Shared VPC?

A resource in a service project that sits on a host project's subnet stays in its own project: gcportrait
never nests anything across projects. The two project zones are joined by a dashed `shares` arrow (service
project → host project), and the host's subnet shows how many projects use it ("shared with N projects"). Host
projects are recognised from Compute Engine's own record of the project (`xpnProjectStatus: HOST`) or from
those cross-project attachments. The **Shared VPC** focus shows one host project and all its service projects;
the Networking lens at the `networks` level shows the subnets
([lenses-and-filters.md](lenses-and-filters.md#4-focus-views)).

### What happens with an asset type gcportrait does not know?

It is still drawn: never dropped. A type the asset catalog does not describe becomes a generic card, nested in
its project by its `parent` and `ancestors`, labelled with its `displayName` or `name` or the last part of its
resource name, with its product's icon (or a generic cloud icon), and without arrows. The Everything lens
shows it, and so does any lens once you add the type under Filters › Include types (the picker lists the
snapshot's unknown types too); the other lenses list the types they take. The catalog describes 632 of the 641
types Cloud Asset Inventory supports (list of 2026-10-09); the other 9 are 7 Identity-Aware Proxy types that
exist only as IAM policy content and 2 BeyondCorp types Google shut down in 2023. New types appear every
month: a weekly job compares the catalog with Google's list, and [contributing.md](contributing.md) explains
how to add one.

### Why do I see ids instead of names?

The scope's own details, its display name among them, come from Resource Manager, which needs
`resourcemanager.organizations.get`, `resourcemanager.folders.get` or `resourcemanager.projects.get` on it (in
Browser and Viewer). `roles/cloudasset.viewer` alone reads the inventory but not those details, so where
gcportrait would name the scope it shows its id (`folders/…`) instead. The permission check says so as a
warning, with the command that grants Browser ([permissions.md](permissions.md#2-with-your-own-account));
reading the assets works either way. The folders and projects inside the scope are labelled from their own
inventory records.

### Why is most of my organisation collapsed?

With the detail level at `auto`, gcportrait opens only as deep as fits the window, and never deeper than the
lens's own limit, so the first view is readable: projects become chips with counts ("2 networks · 39
resources"). Click a chip to open it, use "Expand all", pick a level in the Detail control, drill into a
folder or project, or focus on part of the organisation
([lenses-and-filters.md](lenses-and-filters.md#7-detail-levels-and-chips)).

### Can I move or edit boxes?

No. gcportrait is a viewer, not a drawing tool: every box is a real asset and every arrow a real reference,
laid out by the same rules every time, so two people looking at the same snapshot and view see the same
picture. Export an SVG to edit it in a vector editor ([export.md](export.md)).

## Data and time

### How fresh is what I see?

A snapshot is the inventory *as of* its read time, which the title block and the Snapshot menu show;
gcportrait never calls it live. Cloud Asset Inventory itself trails the products it records: Google documents
that several products (among them Cloud SQL, Secret Manager, Dataflow, Cloud Logging, Vertex AI, Workflows,
Cloud NGFW and OS Config) synchronise with it only every few hours, and that IAM data can be days old. A
resource created a minute ago may not be there yet; pull again later to see it. An export's read time is the
moment of the export, or, without its `operation.json`, an estimate marked as such
([timeline.md](timeline.md#8-estimated-read-times)).

### Why only 35 days?

Cloud Asset Inventory answers questions about the past up to 35 days back (`readTime`), so the timeline shows
today (read as of now) and the 34 days before it (each at 00:00 UTC). Older states cannot be read from Google.
To keep them, keep snapshots: a pull or an imported export stays in your browser until you delete it, shows on
its scope's timeline as an extra tick, and the Snapshots page saves any snapshot as a `.gcportrait.json` file
to import again later ([timeline.md](timeline.md#9-the-35-day-limit-and-other-limits)).

### What does reading my environment cost?

- **Cloud Asset Inventory and Resource Manager calls** are free of charge within their quotas (check Google's
  pricing pages: prices change); an export also writes a Cloud Storage object, which is billed as storage. The
  calls count against the quota of the project that pays for them: your *quota project* when you read with
  your own account, the instance's project in service-account mode ([permissions.md](permissions.md)).
- **How many calls.** A pull lists the scope in pages of 500 assets, so 6 000 assets are 12 requests. The
  permission check adds a few small ones: with your own account, Google's `tokeninfo` for your token, one
  Resource Manager `GET` of the scope and a one-asset listing per quota project it tries (at most two: the
  scope's own project, then the one you picked); in service-account mode, `tokeninfo` and the gate's Resource
  Manager checks, then one such listing as the instance's account ([permissions.md, "Checking a
  scope"](permissions.md#6-checking-a-scope) and ["The gate"](permissions.md#the-gate)). Every day of the
  timeline you stop on is another full read of the scope (only when you stop on it, and its two neighbours
  while the page is idle; never all 35). For very large organisations, an export is one long-running operation
  instead of thousands of pages.
- **The instance** you run yourself costs Cloud Run time while it serves requests and nothing while idle (it
  scales to zero), plus the storage of its image ([self-host-options.md](self-host-options.md#costs)). Trying
  the demo costs you nothing.

### Does my data leave the browser?

No, apart from being fetched. Snapshots, the timeline's days and your saved views are kept in your browser's
IndexedDB, in this browser profile only, and the Snapshots page deletes them. The backend has no database and
no bucket: it forwards your Google token to Cloud Asset Inventory, Resource Manager or Cloud Storage, streams
the answer to your browser, and forgets it. The token stays in the tab's memory: it is never stored, logged or
put in a URL, and signing out revokes it. Diagrams are laid out and drawn in your browser; SVG, PNG and
snapshot files are downloads you start, and nothing is uploaded anywhere. The app has no telemetry and no
analytics. The backend's log lines name request paths, never tokens, bodies or query strings; Cloud Run's own
request log is the operator's ([self-host-options.md](self-host-options.md#logs)). A demo-only instance, like
`gcportrait.app/demo/`, has no sign-in, calls no Google API and stores nothing on its server; the demo
organisations are generated in your browser and kept there
([modes.md](modes.md#6-which-instance-offers-what-and-where-the-data-goes)).

## Access and hosting

### Why does Google's consent screen say "edit, configure, and delete"?

Cloud Asset Inventory accepts a token only with the `cloudasset` scope (or the much wider `cloud-platform`),
and Google describes that scope as "See, edit, configure, and delete your Google Cloud Asset data". gcportrait
only *lists* assets with it, and a token can never do more than your own IAM roles allow. The app says this
before you sign in; [permissions.md](permissions.md#2-with-your-own-account) has the details.

### Is there a hosted gcportrait I can sign in to?

No, on purpose: to read your own Google Cloud, you run your own instance, in a project of yours, with your own
OAuth client, so your organisation's data and tokens never pass through anyone else's server. One script sets
it up in about ten minutes ([self-host.md](self-host.md)). The project hosts only its website,
`gcportrait.app`, and a sign-in-free demo, `gcportrait.app/demo/`, with the synthetic organisations.

### Is gcportrait made by Google?

No. gcportrait draws *Google Cloud-style* diagrams with Google's product icons, used under Google's icon usage
terms, but it is an independent open-source project, not affiliated with, endorsed by, or sponsored by Google.
Its code is licensed under the MIT License ([../LICENSE](../LICENSE)); the gcportrait name and icon are not
covered by it.

### Does it work on a phone or a tablet?

No: gcportrait is built for desktop browsers, at least 1280 × 800 pixels. Architecture diagrams of a real
organisation need the room.
