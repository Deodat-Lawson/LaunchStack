---
"@launchstack/llm": minor
"@launchstack/tools": patch
"@launchstack/conversion": patch
"@launchstack/pipelines": patch
---

Gemini 3.8 Flash replaces the 2.5 family everywhere a model is defaulted.
Google stopped serving `gemini-2.5-*` to new API keys, so a fresh deployment
404'd on transcription, VLM enrichment, NER, reranking and table summaries.

- `GEMINI_DEFAULT_MODEL` and `GEMINI_FAST_MODEL` are `gemini-3.8-flash` (there
  is no 3.8 Flash-Lite).
- New preset `google/gemini-3.8-flash`, verified against Google's
  OpenAI-compatible endpoint. The `google/gemini-2.5-*` presets still resolve
  but are marked `deprecated`, and the config loader warns once naming the
  replacement.
- The image tool defaults to `google/gemini-3.1-flash-image` (no 3.8 image
  model is published).

Fixes found running the whole pipeline against Gemini:

- Embeddings accept Gemini's response shape, which has no `usage` and omits a
  zero `index`; ingestion previously failed every batch against Gemini.
- Structured output in `json-schema` mode sends a plain JSON Schema. LangChain
  used to hand the Zod schema to OpenAI's strict helper, which refuses any
  `.optional()` field that is not also `.nullable()` before a request is sent
  (the founder weekly review and the prospector's discovery plan). Literals go
  out as single-value `enum`s, because Gemini ignores `const`. When an endpoint
  refuses the schema with a 400, as Gemini does for one it judges too complex,
  the call is retried once without size bounds (Zod still enforces them), then
  falls back to the prompt-based JSON path.
- Ingestion fetches root-relative `/api/files/{id}` references (audio
  transcripts, archive members) through the storage port instead of a bare
  `fetch`, which could not parse them.
- The document converter's `/route` call is signed like `/convert`; unsigned it
  was a 401, so vision routing silently fell back to the default provider.
