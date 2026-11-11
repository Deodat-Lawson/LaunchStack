---
"@launchstack/indexing": minor
---

Require a host-provided archive cleanup callback in `DocIngestionPipeline` and forward it to archive expansion, allowing the worker to use its transactional document deletion lifecycle.
