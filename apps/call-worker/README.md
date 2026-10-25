# LaunchStack Capture worker

The Local Capture Worker is bundled with **LaunchStack Capture for Mac**. Install the Apple-silicon DMG from **Calls → Get Call Notes for Mac**, open the app, and approve Microphone and Screen & System Audio Recording permissions. The app stores its paired device token in Keychain and supervises its bundled Node 24 worker. Start and Stop are available in both Calls and the menu-bar app; Pause and Resume are website controls, not native buttons. Users need no repository checkout, shared token, company/user environment configuration, database access, or transcription-provider credentials.

The target runtime is macOS 14+, Apple silicon. The app launches the bundled Node executable with `worker/main.js`; secrets are supplied on stdin, never in arguments or environment variables. Both microphone and computer audio come from the bundled native helper. Computer audio includes other applications and notifications, even when using headphones; it is not limited to the call application and does not identify speakers.

The download carries a 24-hour, single-use pairing code. Automatic pairing uses the app's own quarantine download URL, or the original DMG's raw `com.apple.metadata:kMDItemWhereFroms` extended attribute only after its quarantine event UUID exactly matches the app's. Spotlight locates candidate installers first; the bounded Downloads lookup may request macOS Downloads permission and reads installer metadata, not file contents. If provenance is unavailable, permission is denied, or the code has expired or been consumed, use **Connect** in Calls for a new `launchstack-capture://pair` link. The app's **Sync with website** opens that flow.

## Server-only transcription configuration

The web deployment, not the Mac app or worker, owns transcription-provider selection and credentials. Leave `CALL_NOTES_TRANSCRIPTION_PROVIDER` unset to keep the shared transcription registry and its existing `TRANSCRIPTION_*` / `AI_*` configuration. To use Azure Speech Fast Transcription for Capture utterances, configure **only the web server**:

```dotenv
CALL_NOTES_TRANSCRIPTION_PROVIDER="azure_speech"
CALL_NOTES_TRANSCRIPTION_BASE_URL="https://<region>.api.cognitive.microsoft.com"
CALL_NOTES_TRANSCRIPTION_API_KEY="<subscription-key>"
# Optional default locale when the worker supplies no language hint:
CALL_NOTES_TRANSCRIPTION_LANGUAGE="en-US"
```

Azure requires the URL and subscription key together. The URL may already end in `/speechtotext/transcriptions:transcribe`; otherwise the server appends that path. Existing query parameters are preserved, and `api-version=2025-10-15` is added only if the URL has no API version. A request's optional `language` overrides the server default; when neither is supplied, the Azure `definition` omits `locales`. Azure requests have a 20-second deadline and honor request cancellation. Do not put these settings or provider keys in the worker's stdin JSON, app configuration, or device credential storage.

## Optional development without the Mac app

This is a developer-only alternative, not an installation requirement. Prerequisites: Node 24, pnpm 10.15.1, Xcode command-line tools with a macOS 14+ SDK, and a running LaunchStack deployment that supports device pairing. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @launchstack/call-worker build:system-audio
pnpm --filter @launchstack/call-worker system-audio:request-permission microphone
pnpm --filter @launchstack/call-worker system-audio:request-permission system
pnpm --filter @launchstack/call-worker system-audio:status
```

The helper is `apps/call-worker/native/system-audio-capture/.build/release/launchstack-system-audio`. Its `--status` command does not prompt: it reports separate `microphone` and `system` permission objects. A successful status command means the payload was read, **not** that both permissions are granted; check each source's `authorized` field. Grant permissions to the host application macOS lists for this launch context and restart that host after changing permissions.

Worker probes use `--status --source microphone|system` and read only the selected permission object. Status observes permission and active-display availability; it is not capture proof. Only an explicit system-audio capture enumerates ScreenCaptureKit content, avoiding concurrent inventory queries from routine permission checks. The outer status-process deadline is seven seconds; actual capture inventory has its own five-second bound.

For this optional development path, obtain a device token through pairing (`POST /api/call-notes/devices/pair` using a single-use pairing code generated in Calls). Keep the raw token private. Create `~/.config/launchstack/call-worker.json`, readable only by your user (`chmod 600`), containing **one JSON line**, for example:

```jsonl
{
  "origin": "https://app.example.com",
  "deviceToken": "lsc_REPLACE_WITH_THE_43_CHARACTER_PAIRED_TOKEN",
  "appVersion": "0.1.7",
  "systemAudioHelperPath": "/absolute/path/to/checkout/apps/call-worker/native/system-audio-capture/.build/release/launchstack-system-audio",
  "language": "en",
  "autoEnrich": false
}
```

Replace the example token with the complete `lsc_…` token returned by pairing. The origin must be an HTTP(S) origin without a path, query or credentials; use HTTPS for remote deployments. `appVersion` is the Mac app's semantic version and is checked by the deployment's minimum-version policy.

```sh
pnpm --filter @launchstack/call-worker dev < ~/.config/launchstack/call-worker.json
```

The worker stays idle and long-polls until Calls assigns a capture to this paired device. Reaching EOF after the config line does not stop it. Use Calls to stop the capture; Ctrl-C or SIGTERM gracefully drains and shuts down the worker.

Graceful app Quit, `shutdown`, Ctrl-C and SIGTERM end a running capture's source with `source_stopped` before draining queued transcripts and finalizing. The server records `stopReason: "call_ended"`; no separate web Stop is required. Device revocation and unexpected source/device failures still interrupt capture rather than reporting a successful completion.

For a bundled development run:

```sh
pnpm --filter @launchstack/call-worker build
node apps/call-worker/dist/main.js < ~/.config/launchstack/call-worker.json
```

There is no environment-based worker configuration. The Mac app normally supplies all four required fields (`origin`, `deviceToken`, `appVersion`, `systemAudioHelperPath`); an empty or invalid first line exits 64 before opening audio or contacting the deployment.

### Optional JSON tuning

| Field                    | Default  | Purpose                                                                  |
| ------------------------ | -------- | ------------------------------------------------------------------------ |
| `language`               | Omitted  | Azure locale hint; overrides the server's optional language default      |
| `autoEnrich`             | `false`  | Generate AI proposals on finish; this does not accept them automatically |
| `silenceTimeoutMs`       | `240000` | Both VAD channels must be inactive this long before an auto-stop warning |
| `audioFrameMs`           | `20`     | PCM frame duration                                                       |
| `vadThreshold`           | `0.015`  | Normalized RMS activity threshold, between 0 and 1                       |
| `vadActivationFrames`    | `3`      | Consecutive speaking frames needed to enter activity                     |
| `vadReleaseFrames`       | `15`     | Consecutive quiet frames needed to leave activity                        |
| `utteranceMaxMs`         | `3000`   | Maximum buffered utterance duration, at most 60000 ms                    |
| `audioPreRollMs`         | `200`    | Audio retained before VAD activation                                     |
| `audioReadyTimeoutMs`    | `10000`  | Time allowed for both helper sources to deliver initial PCM              |
| `stopDrainTimeoutMs`     | `30000`  | Maximum graceful Pause/Stop/shutdown drain                               |
| `transcriptionTimeoutMs` | `20000`  | Per-utterance request deadline                                           |

PCM and transcription WAVs are always 16 kHz mono signed 16-bit little-endian. Utterance, pre-roll and frame budgets together must fit the deployment's 2 MB WAV limit. Unknown config fields and invalid tuning values are rejected rather than silently ignored.

These are worker-level development settings, not per-user website preferences. The installed app uses the four-minute silence default and a fixed 60-second native warning; Calls does not expose a pre-stop countdown or threshold editor.

## App IPC

Stdin line 1 is the config above. Subsequent JSON lines are control messages:

```json
{"type":"keep_recording"}
{"type":"call_ended_signal"}
{"type":"shutdown"}
```

Stdout is reserved **only** for newline-delimited contract JSON. Lifecycle updates are emitted for `idle`, `starting`, `capturing`, `paused` and `stopping`, with capture identity when applicable, microphone/system VAD activity, delivered segment count and the most recent segment timestamp. While capturing, progress snapshots are emitted every two seconds. Diagnostics and retry messages go only to stderr and do not include the device token or raw audio.

After both channels remain inactive for `silenceTimeoutMs` (four minutes by default), the worker emits `auto_stop_pending` with reason `silence` and an ISO `stopsAt` 60 seconds ahead. The native app shows the countdown and **Keep recording**, and requests a macOS notification when notification permission permits. The website shows the persisted automatic-stop reason, not this pre-stop warning. `call_ended_signal` starts the same countdown with reason `call_ended`; the app's macOS 14.2+ heuristic observes other processes releasing microphone input after previously using it, not a conferencing service's authoritative call state.

`keep_recording` emits `auto_stop_cancelled` when a countdown is pending and resets the silence window; renewed speech also cancels a silence countdown. On expiry, the worker stops sources and sends `attempt_ended` with reason `silence_timeout` or `source_stopped`, then drains pending transcription before `occurrence_ended` and finish. A server-requested Stop, including its maximum-duration policy, follows the normal Stop drain. Website Pause drains only the current attempt; website Resume opens a new attempt on the same Call.

| Exit | Meaning                                                                                 |
| ---- | --------------------------------------------------------------------------------------- |
| `0`  | Graceful shutdown, including `shutdown`, SIGINT and SIGTERM                             |
| `64` | Missing or invalid stdin configuration                                                  |
| `75` | Deployment returned HTTP 426; app upgrade required                                      |
| `77` | Deployment returned HTTP 401; app must clear the rejected Keychain token and pair again |
| `1`  | Other fatal worker/control-plane error                                                  |

## Network and failure behavior

All requests use `Authorization: Bearer <deviceToken>` and `X-LaunchStack-Capture-Version`. Poll, event and finish payloads contain no company/user identity: the deployment derives that from the device token. Idle polls send `wait: true` to `/api/internal/call-notes/local`; the server holds up to 25 seconds and the client allows 35 seconds. Capturing polls keep the short 750 ms interval. Transcription uses multipart `audio`, `channel` and optional `language` at `/api/call-notes/devices/transcribe`; audio remains in memory and the deployment chooses the provider.

Control-plane transport errors, timeouts, HTTP 429 and HTTP 5xx retain exponential backoff with full jitter (250 ms initial ceiling, 5-second cap). Poll retries have no total budget. Event and finish delivery have a 120-second total retry budget; individual non-long-poll requests time out after 30 seconds. Other HTTP 4xx and invalid JSON are non-retryable. HTTP 401 or 426 from either control or transcription terminates the worker with the app-specific exit code rather than restarting the capture.

The worker bounds pending audio/transcription at eight utterances and ordered text delivery at 600 undelivered segments. PCM/WAV buffers are zeroed once transcription settles. These are memory-only buffers, not a durable replay queue: a failed attempt cannot recover undelivered segments on Resume. Unexpected helper EOF, readiness failure, transcription failure, buffer exhaustion or an exceeded drain budget reports attempt failure without falsely finishing the call. Already-ingested transcript remains available.

A locally failed attempt is not restarted if a stale server poll reoffers it before the failure event arrives. Explicit website Resume must create a fresh attempt key. Confirmed stream loss uses `capture_stream_lost`; only an expired-lease `worker_unavailable` attempt proven to have a still-running pipeline may reattach and remove its presumed Gap. A crashed/restarted process does not prove that the old stream survived. Saved evidence remains available; real missing intervals remain Gaps and make a retained Transcript partial.

Successful audio shutdown is not proof that speech was transcribed. A stopped Call with no saved Transcript evidence finalizes with `outcome: "failed"` and Call failure code `empty_capture`, including an otherwise orderly silence auto-stop. Its attempt can be ended without an attempt failure code while Capture `stopReason` is still `silence`; do not report that as a source crash or a successful non-empty Call.

Installed ad-hoc **0.1.7** verified the native warning and silence-countdown expiry with three saved Computer audio sentences retained, a completed Call, native return to idle, and no recording helpers left running. Recorded installed-DMG coverage and release-signing limits are in the [implementation contract](../../docs/call-notes/implementation-contract.md#installed-mac-delivery-verification--2026-10-25). Local test artifacts are ad-hoc signed, not Developer ID-signed or notarized distribution proof.

## Checks

```sh
pnpm --filter @launchstack/call-worker typecheck
pnpm exec eslint apps/call-worker/src
pnpm exec prettier --check 'apps/call-worker/src/**/*.ts' apps/call-worker/package.json apps/call-worker/README.md
pnpm --filter @launchstack/call-worker test
pnpm --filter @launchstack/call-worker build
```
