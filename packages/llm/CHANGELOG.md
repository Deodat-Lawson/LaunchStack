# @launchstack/llm

## 0.2.0

### Minor Changes

- c8750e4: Azure OpenAI is a supported chat setup out of the box.
  - New preset `openai/gpt-6-luna`, verified against Azure OpenAI's v1
    chat-completions endpoint: effort `none`–`xhigh` (Azure rejects `minimal`
    and `max`), `max_completion_tokens`, no `temperature`. Tool-calling is not
    declared because Luna supports function tools over chat completions only at
    effort `none`; json-schema returned valid output at every effort.
  - `apps/web/config/chat-models.azure.yaml` runs every route on a `gpt-6-luna`
    deployment. Select it with `CHAT_MODELS_CONFIG=config/chat-models.azure.yaml`.
  - Structured output in `json-schema` mode sends `strict: true`. Without it an
    Azure `gpt-5.4-mini` deployment returned the schema itself instead of data in
    6 of 9 calls. Optional fields are sent as required-and-nullable and returned
    `null`s are restored to `undefined` before the Zod parse, so existing schemas
    keep their contract. Schemas strict mode cannot express (open records) are
    refused with a 400 and keep the existing prompt-based fallback.

  Fixes:
  - Docker Compose mounts `apps/web/config/` into the app and the worker, and the
    worker resolves `CHAT_MODELS_CONFIG` against `apps/web` like the app does.
    Previously the worker was pinned to `chat-models.yaml`, so choosing another
    file ran the app and the worker on different models.
  - `.env.example` sets `BETTER_AUTH_URL=http://localhost:3000`; without it a
    local browser sign-up was refused with "Invalid origin". It no longer ships
    an uncommented `CHAT_API_KEY="AIza..."` placeholder, which overrode
    `GOOGLE_AI_API_KEY`, and it states that embeddings never fall back to Gemini.
  - README and CONTRIBUTING: the seed command is
    `pnpm --filter @launchstack/web db:seed` and needs `DEV_SEED_PASSWORD`; the
    old `@launchstack/core` filter matched nothing and exited 0.

- ba11446: Reorganize the engine by feature (ADR-008). The kind-based packages
  (protocol/application/adapters/core) dissolve into feature packages that
  each own their tools, wire contracts, and clients; the product verticals
  move to the top-level pipelines/ tier. Nothing was ever published under
  the old names, so they are deleted rather than deprecated.
- fc83cb5: Gemini 3.8 Flash replaces the 2.5 family everywhere a model is defaulted.
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

- b08dc2a: Scenarios contract v2: durable, exactly-once runs and evidence-grounded people.
  - `@launchstack/pipelines/scenarios/v2`, plus its `db`, `engine`, `stages`,
    `graph-http` and `read` subpaths: a v2 run is a plan of units, each executed
    under a fenced lease.
    - A unit's outputs, its credit settlement and its journaled model replies
      commit in one transaction.
    - Acceptance, idempotency, the first hold and the dispatch outbox are one
      transaction.
    - Graph mode builds a Graphiti + Neo4j graph through the private
      `services/scenario-graph`.
    - Cast fields carry a basis (source, inferred, assumed, unknown) and
      evidence ids.
    - A finished run replays from its recorded turns with no model calls.
    - Contract v1 runs are unchanged.
  - `@launchstack/llm`: `resolveChatModel({ longWait: true })` sends a request
    through undici's own client, so a timeout longer than Node's five-minute
    limit on waiting for reply headers is honoured. `longWaitFetch` and
    `NODE_FETCH_HEADERS_TIMEOUT_MS` are exported.
  - `@launchstack/simulation`: a persona can carry its cast `slotId` and the
    facts it `knows`, and new model purposes cover the ontology, the cast plan
    and the attributed cast.

- 52bab9f: Embeddings and paid web searches are counted alongside chat, so usage can be
  weighed in one unit.
  - `ChatUsageEvent` gains `kind` (`chat`, `embedding`, `web_search`,
    `web_contents`) and `calls` (searches made or pages read; 1 when absent).
  - New `reportUsage(event)` counts work that never passes the chat transport
    against the current chat scope's recorder. Outside a scope it does nothing;
    it never throws.
  - The embedding client reports every successful request with the provider's
    token count, or an estimate of four characters a token when the provider
    sends none (Gemini, Ollama, Hugging Face). `EmbeddingConfig.owner` and the
    effective config's `openAIOwner`, `huggingFaceOwner` and `ollamaOwner` say
    whether the deployment's endpoint or a workspace's own served it.
  - Web search reports each answered request: one search for Exa and Serper
    (general, news and company search), and the pages asked for when Exa reads
    company homepages. Failed requests report nothing.
  - Ingestion's embedding debit carries the embedding model in its metadata, so
    the host can price it.

### Patch Changes

- fafd939: Audio transcription on Gemini works for real recordings, in any language.
  - On Google's endpoint transcription now uses Gemini's native API. The
    OpenAI-compatible `input_audio` part accepts only wav and mp3, so every
    `.m4a`/`.mp4`/`.aac` upload failed with `Invalid audio format "aac"`.
  - Long recordings are cut into 30-minute, 16 kHz mono MP3 chunks with ffmpeg
    when it is on the PATH, so each call carries only its own audio. Without
    ffmpeg, a recording over 16 MB is stored once through the Files API and
    transcribed in 30-minute windows.
  - Transcripts come back with timestamped segments and the spoken language as a
    BCP-47 code (`yue`, `es`, `ar`…), with every language heard in `languages`.
    Speech is never translated during transcription.
  - 5xx and short 429 replies are retried; a spent daily quota fails at once with
    a message that says so. A few minutes Gemini will not transcribe (a prompt
    block) become a marked gap instead of failing the recording.
  - Failures throw `TranscriptionError`, whose `userMessage` is safe to show the
    uploader and whose `status` is 422 (the file) or 502 (the vendor).
  - New `translateTranscriptLines(lines, target)`: line-for-line translation on
    the transcription endpoint and model, so translated lines keep their
    timestamps.
  - WAV, AAC, FLAC and Ogg are transcribable alongside MP3 and MPEG-4.
  - `resolveModel` treats a blank value as unset. Compose passes unset variables
    as `""`, which sent an empty model name.

- 1237451: A workspace's own model endpoint now points admins at Settings › Bring your own
  keys, where that endpoint is set up, instead of Settings › Models.
- ee41d64: A missing embeddings configuration fails a document once instead of retrying it.
  - The outbox treats an error whose own `retryable` property is `false` as
    terminal: the event goes dead on that attempt through the existing dead path
    (`onDead` runs once), instead of backing off through every retry.
  - `@launchstack/llm` throws `EmbeddingConfigurationError` (non-retryable) when
    the embeddings API key or base URL is missing. The messages are unchanged.
  - `OutboxStore.reclaimStale` accepts an optional `onDead` callback, so events it
    kills after their final attempt are stamped as failed too.

- Updated dependencies [2c09443]
- Updated dependencies [bb64f34]
- Updated dependencies [ba11446]
  - @launchstack/store@0.2.0
  - @launchstack/runtime@0.2.0
