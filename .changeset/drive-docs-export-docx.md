---
"@launchstack/pipelines": minor
---

The Google Drive connector exports Google Docs as Word (`.docx`) instead of
Markdown, so a synced Doc keeps its formatting. An export action can name a
`fallback` target (new `ExportTarget` type): Docs fall back to Markdown when
Drive refuses the DOCX as over its ~10 MB export cap, and the collected item
then carries the fallback's MIME and extension. Fingerprints are unchanged,
so a Doc stored as Markdown becomes `.docx` the next time it changes in Drive.
