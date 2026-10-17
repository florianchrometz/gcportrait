---
'@gcportrait/backend': patch
---

The permission check, the scope search and the service-account check describe Google's answer exactly as a live pull's error does. An answer without Google's usual JSON error (an HTML error page, say), or with a status that is not one of Google's codes, carries the canonical code its HTTP status implies, so "Google refused the request (404)" reads "Google refused the request (404 NOT_FOUND)"; an `ErrorInfo` reason that is not spelled as Google spells them is left out, as in a pull's error. What each check decides is unchanged.
