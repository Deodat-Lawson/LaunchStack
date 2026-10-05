# Local Capture Worker

Supported deployment: a server-hosted LaunchStack web app and one Local Capture Worker running directly on the Capture User's Mac. The worker polls the web app, acquires the `microphone` and `system` Audio Channels only during a Capture Attempt, and posts derived Transcript events. It does not need database access.

## Prerequisites and helper build

- macOS 14 or newer, on Apple silicon or Intel. The Swift package targets macOS 14 and builds for the Mac's architecture; it is not an Apple-silicon-only or universal binary.
- Node 24 and the repository's pnpm version (10.15.1).
- ffmpeg with AVFoundation input support, available on `PATH` or at an explicitly configured path. For example, install it with `brew install ffmpeg`.
- Xcode command line tools with Swift 5.9 or newer and a macOS 14+ SDK. Install the tools with `xcode-select --install` if needed.
- A checkout of the same LaunchStack revision deployed on the server, and network access from the Mac to the web app and the transcription provider.

Run from the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @launchstack/call-worker build:system-audio
```

The helper script runs `swift build --package-path native/system-audio-capture -c release` from `apps/call-worker`. Its executable is:

```text
apps/call-worker/native/system-audio-capture/.build/release/launchstack-system-audio
```

Set `CALL_NOTES_SYSTEM_AUDIO_HELPER_PATH` to that executable's absolute path. Build it on the Mac that will run the worker.

## macOS permissions and microphone selection

Run these from the same terminal or host application that will run the worker:

```sh
pnpm --filter @launchstack/call-worker system-audio:request-permission
pnpm --filter @launchstack/call-worker system-audio:status
ffmpeg -f avfoundation -list_devices true -i ""
```

In **System Settings > Privacy & Security**, grant **Microphone** and **Screen & System Audio Recording** (called **Screen Recording** on some macOS versions) to the process/host application macOS lists for this launch context, including the helper where listed. The permission-request command requests screen capture access; it does not grant Microphone permission. Approve the microphone prompt when ffmpeg first opens the input. Restart the worker's host application after permission changes, then run the status command again. Its JSON output reports support and authorization; exit 0 means ready, and it never prompts. It does not check Microphone permission.

The ffmpeg command prints separate video and audio device indexes and may exit nonzero because it is only listing devices. Choose the desired audio index: `:0` selects audio device 0 with no video input. The Mac needs an unlocked, capturable display/session for the helper.

Computer Audio is the combined system output, including other applications and notifications, even with headphones. It is not restricted to the Call's application and does not establish speaker identity or complete coverage.

## Web server configuration

The web server reads only these four Call Notes variables. Replace all placeholders, configure one existing company and one authenticated user in that company, and restart/redeploy the web app:

```dotenv
CALL_NOTES_CAPTURE_ENABLED="true"
CALL_NOTES_INTERNAL_TOKEN="REPLACE_WITH_GENERATED_SECRET"
CALL_NOTES_LOCAL_COMPANY_ID="REPLACE_WITH_NUMERIC_COMPANY_ID"
CALL_NOTES_LOCAL_USER_ID="REPLACE_WITH_USER_ID"
```

Generate the shared secret with `openssl rand -hex 32`. Do not put it in a `NEXT_PUBLIC_*` variable or send it to the browser. The same token, company ID, and user ID must be configured on the Mac. The configured user is the only Capture User enabled for this deployment; other company users do not gain local Capture control. Capture remains disabled by default in `.env.example` and Compose.

## Mac worker configuration and running

Create a private environment file outside the checkout, for example `~/.config/launchstack/call-worker.env`, with the same four values above plus the following. Replace the origin, helper path, API key, and microphone index before starting:

```dotenv
CALL_NOTES_WEB_ORIGIN="https://app.example.com"
CALL_NOTES_FFMPEG_PATH="ffmpeg"
CALL_NOTES_AUDIO_INPUT_FORMAT="avfoundation"
CALL_NOTES_AUDIO_INPUT_DEVICE=":0"
CALL_NOTES_AUDIO_SAMPLE_RATE="16000"
CALL_NOTES_AUDIO_FRAME_MS="20"
CALL_NOTES_VAD_THRESHOLD="0.015"
CALL_NOTES_VAD_ACTIVATION_FRAMES="3"
CALL_NOTES_SYSTEM_AUDIO_ENABLED="true"
CALL_NOTES_SYSTEM_AUDIO_HELPER_PATH="/absolute/path/to/checkout/apps/call-worker/native/system-audio-capture/.build/release/launchstack-system-audio"
CALL_NOTES_TRANSCRIPTION_PROVIDER="openai"
CALL_NOTES_TRANSCRIPTION_BASE_URL="https://api.openai.com/v1"
CALL_NOTES_TRANSCRIPTION_MODEL="whisper-1"
CALL_NOTES_TRANSCRIPTION_API_KEY="REPLACE_WITH_PROVIDER_KEY"
```

`CALL_NOTES_WEB_ORIGIN` must be reachable from the Mac and contain only an HTTP(S) origin, not a path, query, or credentials. Use HTTPS for a remote server. The ffmpeg path, input format/device, sample rate, frame duration, Voice Activity threshold/activation frames, web origin, token, IDs, transcription base URL/key, and OpenAI model are required explicitly when Capture is enabled; the numeric values above are suggested settings, not implicit enabled-mode defaults. The helper path is required when Computer Audio is enabled (the default on macOS).

`openai` is the default provider and requires an OpenAI-compatible `/audio/transcriptions` endpoint. To use Azure Speech Fast Transcription, set `CALL_NOTES_TRANSCRIPTION_PROVIDER="azure_speech"`, `CALL_NOTES_TRANSCRIPTION_BASE_URL="https://YOUR_RESOURCE.cognitiveservices.azure.com"`, and the Azure Speech resource key; omit the model, which Azure does not use. There is no configured base URL, model, or API key default. The worker's `CALL_NOTES_TRANSCRIPTION_*` settings are independent of the web server's `TRANSCRIPTION_*` settings.

Optional worker settings and their actual `src/config.ts` defaults:

| Variable                              | Default                                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `CALL_NOTES_VAD_RELEASE_FRAMES`       | `15`                                                                                                 |
| `CALL_NOTES_UTTERANCE_MAX_MS`         | `3000`                                                                                               |
| `CALL_NOTES_AUDIO_PRE_ROLL_MS`        | `200`                                                                                                |
| `CALL_NOTES_AUDIO_READY_TIMEOUT_MS`   | `10000`                                                                                              |
| `CALL_NOTES_STOP_DRAIN_TIMEOUT_MS`    | `30000`                                                                                              |
| `CALL_NOTES_TRANSCRIPTION_TIMEOUT_MS` | `20000`                                                                                              |
| `CALL_NOTES_TRANSCRIPTION_LANGUAGE`   | Unset (no language hint); use the provider's format, such as `en` for OpenAI or `en-US` for Azure    |
| `CALL_NOTES_AUTO_ENRICH`              | `false`; enabling it incurs AI proposal-generation cost, not automatic acceptance into the Call Note |

The worker does not load an `.env` file automatically. Export it into the launching process's environment. From the repository root:

```sh
chmod 600 "$HOME/.config/launchstack/call-worker.env"
set -a
. "$HOME/.config/launchstack/call-worker.env"
set +a
pnpm --filter @launchstack/call-worker dev
```

For a bundled run, use `pnpm --filter @launchstack/call-worker build`, then `pnpm --filter @launchstack/call-worker start` in the same configured shell. Leave the worker running; `call_worker_ready` with state `idle` indicates it is polling, not that microphone access has been verified. Sign in as the configured Capture User and use **Start capture** in Calls to open audio. Use the Calls controls to stop Capture; `Ctrl-C` shuts down the worker.

## Outages, Pause, and Resume

Backend transport errors, request timeouts, HTTP 429, and HTTP 5xx are retried with exponential backoff and full jitter: a 250 ms initial delay ceiling, capped at 5 seconds. A request times out after 30 seconds. Poll retries have no total budget, so an idle worker keeps waiting for the web server rather than exiting; `call_worker_backend_retry` records retries. Each event and finish request has a 120-second total retry budget, including requests and backoff. Other HTTP 4xx and invalid JSON are not retried. Invalid configuration or a rejected token terminates the worker with a non-zero exit status.

During a backend outage, audio capture and transcription continue. At most eight utterances may hold audio for transcription; their PCM/WAV buffers are zeroed as soon as transcription settles. Completed transcription waits for ordered delivery as text-only segments, bounded at 600 undelivered segments, including an in-flight delivery. A 40-second outage fits the retry budget while capture is running, provided these bounds are not exceeded.

If an audio/transcription failure, full delivery buffer, or exhausted event budget ends the Capture Attempt, the worker logs `call_worker_pipeline_failed`, stops reporting that Attempt in polls, and keeps polling. The server pauses the Capture with reason `worker_error`; the Call remains active and its already-ingested Transcript is retained. Resume opens a new Capture Attempt on the same Call.

The buffer is memory-only, not a durable replay queue. When an Attempt gives up, queued segments that never reached the server are lost, along with unfinished transcription and any current buffered utterance. A segment committed by the server despite a lost acknowledgement remains in the Transcript; retries retain its event ID. Resume cannot recover the old worker's undelivered segments, and the missing interval is represented by a Gap.

User Pause stops the audio sources, drains pending transcription and ordered delivery, and sends `attempt_ended` with reason `user_paused`. It sends neither `attempt_failed` nor finish and does not finalize the Call. The worker then idles until Resume assigns a new Attempt key. Pause and Stop drains use `CALL_NOTES_STOP_DRAIN_TIMEOUT_MS`; a drain that exceeds that limit is a worker error. Stop still drains and finishes the Call.

## Limits

- macOS only; there is no Linux/Docker microphone fallback or capture container.
- One configured Capture User and one Local Capture Worker per deployment, with a shared internal token. There is no per-device credential or enrollment protocol.
- No installer, background agent, or automatic startup. The operator must build, configure, grant permissions, and keep the worker process running.
- No conversation bot, retained raw recording, or guaranteed complete/speaker-attributed Transcript. Only the supplied local Audio Channels can contribute evidence.
