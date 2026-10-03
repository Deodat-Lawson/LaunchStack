---
"@launchstack/conversion": minor
"@launchstack/schema-generator": minor
---

Transcripts keep their timestamps. The self-hosted provider passes the
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
