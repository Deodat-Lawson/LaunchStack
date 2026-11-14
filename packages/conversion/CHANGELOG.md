# @launchstack/conversion

## 0.2.0

### Minor Changes

- eb91aa7: Archive expansion carries an archive's origin down to the files it extracts.
  When the archive's row has `originUrl` and `originEntryBaseUrl` in its
  `ocr_metadata` (the GitHub import writes both), each extracted file gets its
  own `originUrl` (the base plus its path, without a GitHub zipball's top
  folder) and the project summary gets the archive's. New exports:
  `sharedTopFolder` and `archiveEntryOriginUrl`.
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

- ba11446: Reorganize the engine by feature (ADR-008). The kind-based packages
  (protocol/application/adapters/core) dissolve into feature packages that
  each own their tools, wire contracts, and clients; the product verticals
  move to the top-level pipelines/ tier. Nothing was ever published under
  the old names, so they are deleted rather than deprecated.
- 290483e: Transcripts keep their timestamps. The self-hosted provider passes the
  transcription service's `segments` through, so `transcribeAudioFromUrl`
  returns them, and the video contract (`POST /download-and-transcribe`) now
  carries `segments` as well: `videoTranscribeResponseSchema` and the generated
  `transcription.video-response` schema gain the field, and
  `VideoTranscriptionResult.segments` is optional for service builds that
  predate it.

  `shouldTranscribeFile` recognises MPEG-4 audio however a browser names it
  (`audio/x-m4a`, `audio/m4a`, `audio/mp3` besides `audio/mpeg`, `audio/mp4`,
  `video/mp4`), reads the type case-insensitively, and decides by file name —
  now including `.m4a` — when the type is missing or `application/octet-stream`.

### Patch Changes

- 3a4d012: Remove the `./heading-chunker` export. Its source was deleted in September, so
  importing it could only fail.
- 7e1ab83: `finalizeStorage` merges its completion keys into the document's
  `ocrMetadata` in SQL instead of writing back the row it read earlier. A key
  another request added while the run was finishing (such as a website source's
  stored preview) is no longer lost. As before, failure-stamp keys are dropped,
  and so is any completion key the run leaves unset: a run on the default index
  removes a previous run's `embeddingIndexKey`.
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

- Updated dependencies [fafd939]
- Updated dependencies [c8750e4]
- Updated dependencies [1237451]
- Updated dependencies [2c09443]
- Updated dependencies [bb64f34]
- Updated dependencies [1348cdb]
- Updated dependencies [ee41d64]
- Updated dependencies [ba11446]
- Updated dependencies [fc83cb5]
- Updated dependencies [b08dc2a]
- Updated dependencies [52bab9f]
  - @launchstack/llm@0.2.0
  - @launchstack/store@0.2.0
  - @launchstack/orchestration@0.2.0
  - @launchstack/runtime@0.2.0
