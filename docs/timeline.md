<!-- SPDX-License-Identifier: MIT -->

# The timeline: the last 35 days of a scope

The bar at the bottom of the diagram page moves the diagram through time. Every view you can draw today (any
lens, focus, filter, detail level or drill-in) can also be drawn as it was on any of the last 35 days, and the
diagram then marks what was added, removed or changed since the day you came from. This guide explains what a
*tick* is, where the days come from, what is kept in your browser, how playback works, what the extra ticks of
exports and manual pulls are, and the limits. [modes.md](modes.md) says where snapshots come from;
[lenses-and-filters.md](lenses-and-filters.md) how a view is chosen.

## 1. Ticks

A **tick** is one position on the timeline:

- **The days.** Today and each of the 34 days before it, each read at 00:00 UTC (Cloud Asset Inventory answers
  for any moment up to 35 days back). The latest day is read at "now", so a tick is never in the future. The
  bar labels each day in your own local date (in a time zone west of UTC, the day `2026-09-30` at 00:00 UTC
  reads as the evening of 29 September).
- **The snapshot itself.** The snapshot you opened sits on its own day: that day's tick *is* the snapshot,
  drawn as it was read (at its real read time, not at 00:00).
- **Extra ticks** (section 7): every export and manual pull of the same scope kept in this browser, placed at
  its read time between the days.

The view's tick is part of the link like everything else in the view: `#snapshot=…&tick=2026-09-17` for a day,
`tick=2026-10-05T14:30:00Z` for an extra tick (its read time to the second, in UTC). The snapshot's own day is
written as no tick at all. A link with a tick opens on that day, a reload keeps it, and Back undoes each step
made with the step buttons or keys.

## 2. Moving through time

| Do this | What happens |
|---|---|
| Drag the slider or click a marker | moves the view in place, without a history entry per day |
| Press "Previous day" or "Next day" (the arrows beside the play button), or `[` and `]` | one tick back or forward (a history entry each, so Back undoes it); `[` and `]` work on any keyboard layout, and say why when they cannot move (the first or last tick, no snapshot, the timeline not known yet) |
| Press the play button | playback (section 6) |
| Open a link with `tick=…` | the diagram opens on that tick |

The bar shows one marker per tick, its state told by its shape (never by colour alone):

| Marker | Means |
|---|---|
| hollow ring | a day not read yet (live scopes only) |
| filled dot | a day ready to draw at once |
| turning dashed ring | a day being read (it stands still with reduced motion) |
| cross | the read failed; the readout says Google's message and offers "Try again" |
| larger ringed dot in the primary colour | the tick on screen |
| diamond (hollow: estimated read time) | an extra tick (section 7) |

The readout next to the slider says the day on screen in your local date ("Thursday, 17 September 2026",
"Thursday, 8 October 2026 · the snapshot"), the progress of a read while one runs ("Reading 30 Sept: 12 pages
· 4,800 assets · 3.2 MB · 0:05"), why a day cannot be read or could not be drawn, or that the snapshot was
read after the timeline's last day (this computer's clock is behind it). It takes two lines at most; point at
it for the whole text.

## 3. Where the days come from

**A stored history: the demo organisations and imported bundles.** The demo organisations S, M, L and XL come
with a 35-day history, and a `.gcportrait.json` bundle exported from the Snapshots page keeps it. Every day of
such a history is rebuilt in your browser from the history (in the background worker), so every day is ready
at once, and nothing is read from Google Cloud. A history's timeline ends on its own last day, not on today:
the demo's 35 days are always 4 September to 8 October 2026.

**A live scope: a pull or an export without a history.** Other days are read from Cloud Asset Inventory on
demand, as a "Pull now" reads the scope, but at that day's 00:00 UTC (`readTime`). The timeline ends on today
(UTC). Reading a day needs:

- that you are signed in and the permission check, in either mode, is ready for the snapshot's scope: the same
  check the Connect and Permissions pages run ([permissions.md](permissions.md)). Without it the readout says
  what is missing, and only days already kept in this browser are drawn;
- an instance that can reach Google Cloud. The demo-only build reads nothing; it draws the days it keeps.

Reads are lazy, because each day is a full read of the scope:

- a day is read once the view has rested on it for 300 ms, never all 35;
- a day kept in this browser is not read again, even one another tab read after this page opened. A tab
  that stores or deletes a day tells the other tabs of this browser, and a tab open on the same scope marks
  the day ready, or not read, at once, so it can be drawn and played straight away. What a tab tells is which
  day of which scope changed, never its assets. A browser that cannot tell its tabs takes such a day from what
  is kept once the view rests on it or next to it (until then its marker may show it not read yet);
- once the view rests, its two neighbours are read when the browser is idle, the one in the direction you were
  moving first;
- at most two reads run at once, and a read of a day you moved away from (no longer the day on screen or a
  neighbour) is cancelled;
- nothing is read while the page stays where it opened, on the snapshot's own day;
- a day that failed is read again only when you come back to it or press "Try again".

While a day is being read, the diagram on screen stays; the new day replaces it once it has arrived. Errors
from Google are shown as they come, with the same advice as a pull (a `readTime` before the scope existed, for
example, is Google's "not found").

## 4. What is kept in your browser

| What | Where | Kept until |
|---|---|---|
| A live scope's days | IndexedDB, store `tickCache`, one entry per (scope, read time, content type, asset types): a day is never shared between scopes | a newer day of the same scope is stored and the entry has left the 35-day window, or you delete it |
| Today's day, read at "now" | the same cache | it counts as ready only while it is still the latest day; once a newer day exists, that day is read again as of its 00:00 UTC |
| A history's days | inside the snapshot's own record (the history), rebuilt in memory when drawn | the snapshot is deleted |
| Extra ticks | they are ordinary stored snapshots (section 7) | you delete them |

The access token is never stored; only the assets that came back are. The Snapshots page's **Timelines by
scope** section lists, for each scope, its snapshots, extra ticks and cached days with their asset counts and
sizes: "Delete" on a cached day removes it at once (the timeline of every tab marks it not read and reads it
again when you come back to it),
"Delete the cached days of …" removes a scope's whole cache after a confirmation, and an extra tick is deleted
after a confirmation. Deleting cached days never deletes a snapshot or an extra tick.

## 5. What changed: the diff overlay

When you move from one tick to another of the same snapshot, the new tick is drawn **compared with the tick
you came from**:

- **added** (present now, absent before): a green outline around the node, on the outermost node of what was
  added;
- **removed** (absent now): a *ghost* of the node where it stood, its body faded to half, a dashed red
  outline, and "removed" under its name. A ghost is not a node: it cannot be clicked or focused on the canvas
  (pointing at it points at the zone around it), but the drawer of the zone it lay in lists it under "Removed
  inside" with a link;
- **changed** (same name, a different `updateTime`): a small amber dot on the node's top-right corner. A
  collapsed zone holding anything added, removed or changed gets the dot too, and its name says how many of
  each. A node that moved (a project into another folder) is marked only where it is now, never at its old
  place; one the view no longer draws where it stood (a project marked for deletion) comes back as a ghost
  there, with "not drawn now" under its name;
- the legend adds a row for each marker drawn ("added since 2026-09-23"; "compared with 2026-09-24" when you
  stepped back), and the details drawer of a changed node gets a **What changed** section: its update time on
  both ticks, the fields of its data that differ ("targetSize 2 → 4"), and for a container what inside it was
  added, removed or changed, with links.

The markers last while the tick stays on screen (another lens or filter on the same tick keeps them) and the
next tick replaces them. The tick you came from is not part of the link, so a link or a reload shows its tick
without markers. The markers are part of the drawing: an SVG or PNG export of a compared tick carries them.

## 6. Playback

The play button steps through the ticks one per interval: 0.5, 1 (the default) or 2 seconds per tick, chosen
under "Speed"; with reduced motion at least 2 seconds, and the thumb jumps instead of gliding. Each step waits
until its tick is drawn, so a slow tick never gets skipped. Playback:

- starts from the tick on screen (from the first one when you are on the last) and stops at the last;
- goes only through ticks that are ready: every day of a stored history, but only the *cached* days of a live
  scope (it never starts a read from Google Cloud);
- leaves extra ticks out unless "Play extras" is pressed (shown only when there are extra ticks);
- stops on any press, key or wheel turn, when a tick cannot be drawn, or when the snapshot changes.

## 7. Extra ticks: exports and manual pulls

Every export (a file dropped into the browser or a `gs://` object) and every "Pull now" of a scope kept in
this browser is an **extra tick** on the timeline of every other snapshot of the same scope, on a stored
history and on a live scope alike. Each one:

- is drawn as a diamond, placed by its read time among the days, and named like "export 2026-10-05 14:30",
  "pull 2026-10-07 09:15" or "export 2026-10-04 18:38 (estimated)" in your local time;
- is selected, stepped onto with `[` and `]` and drawn like a day, at once (it is already stored here; nothing
  is read from Google Cloud);
- has its read time to the second as its id in the link, so the same export opened in another browser that
  holds it lands on the same tick. A link naming an extra tick this browser does not hold draws the snapshot
  itself, and the readout says so.

Copies of the same scope read in the same second are one tick, showing the copy stored last; the Snapshots
page still lists each copy. The open snapshot is never one of its own extra ticks. A read time later than this
computer's clock (an `operation.json` from a machine whose clock ran ahead, or this computer's clock running
behind) is placed at "now" with a warning, at the import and in the marker's tooltip, never as a tick in the
future.

Each demo organisation (S, M, L, XL) has its own synthetic organisation number, so an export of demo M is an
extra tick of demo M's timeline only.

When a tick you came from is an extra tick, the legend, the names and the drawer's **What changed** name it by
its label, "added since export 2026-10-05 14:30", so it is not read as the day 5 October.

## 8. Estimated read times

An extra tick is placed at its snapshot's read time. Where that comes from:

| Source | When | Marked |
|---|---|---|
| Cloud Asset Inventory's answer | a pull | — |
| the export's `operation.json` | an export imported together with the `operation.json` that `gcloud asset export` writes next to it | — |
| typed by you | the "When the export was taken (UTC, optional)" field of the Connect page's export card and of the Snapshots page's import, for an export without its `operation.json` (for example `2026-10-05 14:30`); impossible dates and offsets, and times later than this computer's clock, are refused | "entered" |
| the latest asset change | neither of the above: the latest `updateTime` among its assets | **estimated**: the diamond is hollow, and the Snapshot menu, the Snapshots page and the tooltip say so |

An estimate is never later than the real read time and often earlier (a quiet scope may have changed nothing
for days). If you know when the export was taken, type it at the import, or keep the `operation.json` with the
export file. An `operation.json` read time wins over a typed one, with a note saying so.

## 9. The 35-day limit and other limits

- **35 days back is Google's limit.** Cloud Asset Inventory answers a `readTime` up to 35 days in the past, so
  a live scope's timeline shows exactly 35 days and nothing older can be read. To keep older states, keep
  snapshots: a pull or an imported export stays in this browser until you delete it, and the Snapshots page
  exports any snapshot as a file to import again later. Stored exports and pulls read before the timeline's
  first day are not on the bar; a link naming one draws the snapshot itself and the readout says why.
- **A history's days are fixed.** The demo organisations and imported bundles keep the 35 days they were made
  with; their timeline does not move with the calendar.
- **Today does not roll over while the page is open.** A live timeline takes "today" when the page opens;
  after midnight UTC, reload to get the new day.
- **What a tick cannot show.** A day's diagram is what Cloud Asset Inventory returned for that moment. Several
  products synchronise with it only every few hours and IAM data can be days old, so a tick is "as of", never
  live. Deleted assets are simply absent from a later day (there is no record of the deletion), which is why
  "removed" is worked out by comparing two ticks.
- **Cost.** Each live day is a full read of the scope (one `assets.list` call set, as a pull), which is why
  reads are lazy and limited to two at once. On large organisations a step costs work in the browser too: on
  the largest demo organisation at the folder level, under a second to a day not drawn yet, and next to
  nothing back to one of the last few days drawn.
