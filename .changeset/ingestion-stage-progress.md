---
"@launchstack/indexing": minor
"@launchstack/store": minor
---

Record each document-ingestion stage as it runs. `runExtractionStage` and `runIndexingStage` now write a row per stage (route, read, chunk, embed with done/total, finalize) to `ocr_processing_steps`, so a UI can show where a file is. Writes are fail-soft and never affect ingestion. `ocrProcessingStepTypes` (store schema) names the stages; the step-type column stays a varchar, so there is no migration.
