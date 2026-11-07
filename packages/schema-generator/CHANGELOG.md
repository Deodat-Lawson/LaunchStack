# @launchstack/schema-generator

## 0.2.0

### Minor Changes

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

- Updated dependencies [fafd939]
- Updated dependencies [3a4d012]
- Updated dependencies [ee41d64]
- Updated dependencies [ba11446]
- Updated dependencies [fc83cb5]
- Updated dependencies [290483e]
  - @launchstack/conversion@0.2.0
  - @launchstack/orchestration@0.2.0
  - @launchstack/runtime@0.2.0
  - @launchstack/editing@0.2.0
