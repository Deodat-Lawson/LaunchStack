---
"@launchstack/conversion": minor
"@launchstack/llm": patch
---

Audio transcription on Gemini works for real recordings, in any language.

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
