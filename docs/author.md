---
# The facts behind the website's "About the author" section (the landing page, /#author) and its Person
# structured data (JSON-LD), read by website/src/lib/author.ts. A value in square-bracketed capitals is still
# to be filled in by the maintainer; the website's deploying build (WEBSITE_STRICT=1) refuses this file until
# none is left, and a normal build shows them as they are.
name: Florian Chrometz # Person.name
url: https://florian-chrometz.de # Person.url, and the first link under the section
jobTitle: 'Google Cloud Solution Architect' # Person.jobTitle, optional: delete the line to leave it out
sameAs: # Person.sameAs, and the links under the section: profile pages, https only; delete a line to drop it
  - 'https://www.linkedin.com/in/florian-chrometz/'
  - 'https://github.com/florianchrometz'
---
<!-- SPDX-License-Identifier: MIT -->

# About the author

<!--
The landing page shows the name line "Florian Chrometz & contributors" above this text, "contributors"
linked to the repository's contributors on GitHub. The first paragraph is also the Person's description in
search results (its first 300 characters, Person.description); the last is the long form of the
non-affiliation statement, which the website's check requires in this section. Name no programme membership
and nothing that suggests Google's endorsement (AGENTS.md, "Non-affiliation, brand and legal"). This comment
does not appear on the site.
-->

Florian Chrometz builds and maintains gcportrait, which draws a Google Cloud environment as it actually is:
every box a real asset from Cloud Asset Inventory, every arrow a real reference. Feedback, bug reports and
pull requests are welcome on [GitHub](https://github.com/florianchrometz/gcportrait).

gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is
not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are
trademarks of Google and are used under Google's icon usage terms.
