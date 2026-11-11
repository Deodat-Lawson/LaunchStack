---
"@launchstack/store": patch
---

Index document/version URLs, preview/audio metadata, OCR/batch input URLs, extracted database file ids, and provider pointer URLs for durable deletion's shared-reference checks. The unshipped reference/guard migrations were regenerated as one concurrent-index migration; existing-table index builds use the nontransactional migration runner.
