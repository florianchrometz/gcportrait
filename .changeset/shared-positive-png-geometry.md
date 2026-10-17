---
'@gcportrait/frontend': patch
'@gcportrait/model': patch
'@gcportrait/render': patch
'@gcportrait/backend': patch
---

Use one PNG geometry calculation for browser and server exports, keeping capped dimensions and requested
widths identical. Refuse geometry with no usable positive scale before rasterizing, with an actionable
export message and the render API's existing VIEW_REFUSED response.
