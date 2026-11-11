---
"@launchstack/conversion": minor
---

Require an injected `cleanupArchive` callback after archive expansion so hosts can atomically snapshot stored objects, enqueue durable cleanup, and remove the original document and OCR job without importing application code into conversion.
