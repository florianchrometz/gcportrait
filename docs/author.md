---
# The facts behind the website's "About the author" section (the landing page, /#author) and its Person
# structured data (JSON-LD), read by website/src/lib/author.ts. A value in square-bracketed capitals is still
# to be filled in by the maintainer; the website's deploying build (WEBSITE_STRICT=1) refuses this file until
# none is left, and a normal build shows them as they are.
name: Florian Chrometz # Person.name
url: https://florian-chrometz.de # Person.url, and the first link under the section
jobTitle: '[JOB TITLE]' # Person.jobTitle, optional: delete the line to leave it out
sameAs: # Person.sameAs, and the links under the section: profile pages, https only; delete a line to drop it
  - '[LINKEDIN PROFILE URL]' # https://www.linkedin.com/in/...
  - '[GITHUB PROFILE URL]' # https://github.com/... (the repository's owner is github.com/florianchrometz)
  - '[X PROFILE URL]' # https://x.com/...
# The portrait: a square photo of at least 400 x 400 pixels in WebP, at the path below; uncomment the line
# once the file is there. Person.image and the section do not show it yet: website/src/lib/author.ts reads
# the path, and the landing page does not use it so far.
# image: docs/media/author/portrait.webp
---
<!-- SPDX-License-Identifier: MIT -->

# About the author

<!--
The bio: one paragraph of 60 to 120 words, in the third person, for the Google Cloud community: what Florian
does, his work with Google Cloud, what he writes or speaks about, and where to find him. Its first 300
characters become the description in search results (Person.description). Name no programme membership and
nothing that suggests Google's endorsement (ADR 0018). This comment does not appear on the site.
-->

[BIO PARAGRAPH]

Florian Chrometz builds and maintains gcportrait, which draws a Google Cloud environment as it actually is:
every box a real asset from Cloud Asset Inventory, every arrow a real reference. Feedback, bug reports and
pull requests are welcome on [GitHub](https://github.com/florianchrometz/gcportrait); more about Florian is
on his [personal website](https://florian-chrometz.de).

gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is
not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are
trademarks of Google and are used under Google's icon usage terms.
