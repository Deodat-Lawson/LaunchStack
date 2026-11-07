---
"@launchstack/conversion": patch
---

`finalizeStorage` merges its completion keys into the document's
`ocrMetadata` in SQL instead of writing back the row it read earlier. A key
another request added while the run was finishing (such as a website source's
stored preview) is no longer lost. As before, failure-stamp keys are dropped,
and so is any completion key the run leaves unset: a run on the default index
removes a previous run's `embeddingIndexKey`.
