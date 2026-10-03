---
"@launchstack/pipelines": patch
---

`sourceKindOf` recognises a saved web page by its `ocrMetadata.kind = "website"`
marker. Stored creation keys are hashed, so the `website:`/`crawl:` prefix
check never matched and website sources were sorted as "other".
