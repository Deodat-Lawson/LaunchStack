---
"@launchstack/conversion": patch
---

`finalizeStorage` merges its completion keys into the document's
`ocrMetadata` in SQL instead of writing back the row it read earlier. A key
another request added while the run was finishing (such as a website source's
stored preview) is no longer lost; failure-stamp keys are still dropped.
