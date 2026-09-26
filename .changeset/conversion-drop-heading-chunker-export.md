---
"@launchstack/conversion": patch
---

Remove the `./heading-chunker` subpath. Its source was deleted when the
chunker was rebuilt on the document tree, so the export pointed at a file
that is never built, and the release's export check failed on it.
