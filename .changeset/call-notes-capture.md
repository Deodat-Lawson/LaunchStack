---
"@launchstack/pipelines": minor
"@launchstack/store": minor
"@launchstack/retrieval": minor
"@launchstack/llm": minor
"@launchstack/conversion": patch
"@launchstack/tools": patch
---

Call Notes: captured calls become notes, and indexed Call Notes become company knowledge.

- `@launchstack/pipelines` adds the `call-notes` vertical (`./call-notes`,
  `./call-notes/contracts`, `./call-notes/files`, `./call-notes/enrichment`):
  Calls, Capture Attempts and Gaps, paired Capture Devices, enrichment work
  items, and the schema behind them.
- `@launchstack/store` adds the partial index
  `document(company_id, id) WHERE ocr_metadata ? 'callNote'` (engine migration
  `20261025000000_call_note_document_scope_index`).
- `@launchstack/retrieval`: the ensemble's notes leg takes its own
  `embeddingProvider`, so notes stay on their fixed-width index when document
  legs move to another one; `null` turns the notes leg off.
- `@launchstack/llm`: structured calls can stream cumulative partial objects
  (`onPartial`) and be aborted; adds the `openai/gpt-5.4-mini` preset.
- `@launchstack/conversion`: finalizing ingestion merges metadata in one SQL
  statement, so provenance stamped mid-run (connector, mindmap, Call Note)
  survives and a successful run still drops a stale failure stamp.
- `@launchstack/tools`: the web-research cache has a hard size cap, evicting
  expired entries first and then the oldest writes.
