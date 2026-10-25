# LaunchStack Capture worker

The Local Capture Worker is bundled with **LaunchStack Capture for Mac**. Install the Apple-silicon DMG from **Calls → Get Call Notes for Mac**, open the app, and approve Microphone and Screen & System Audio Recording permissions. The download pairs this Mac with your LaunchStack account; the app stores the device token in Keychain and supervises its bundled Node 24 worker. Use Start, Pause, Resume and Stop in Calls or the menu-bar app. The worker needs no database access or transcription-provider credentials.

Supported production runtime: macOS 14+, Apple silicon. The app launches the bundled Node executable with `worker/main.js`; secrets are supplied on stdin, never in arguments or environment variables. Both microphone and computer audio come from the bundled native helper. Computer audio includes other applications and notifications, even when using headphones; it is not limited to the call application and does not identify speakers.

## Development without the Mac app

Prerequisites: Node 24, pnpm 10.15.1, Xcode command-line tools with a macOS 14+ SDK, and a running LaunchStack deployment that supports device pairing. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @launchstack/call-worker build:system-audio
pnpm --filter @launchstack/call-worker system-audio:request-permission microphone
pnpm --filter @launchstack/call-worker system-audio:request-permission system
pnpm --filter @launchstack/call-worker system-audio:status
```

The helper is `apps/call-worker/native/system-audio-capture/.build/release/launchstack-system-audio`. Its `--status` command does not prompt: it reports separate `microphone` and `system` permission objects. A successful status command means the payload was read, **not** that both permissions are granted; check each source's `authorized` field. Grant permissions to the host application macOS lists for this launch context and restart that host after changing permissions.

Obtain a device token through pairing (`POST /api/call-notes/devices/pair` using a single-use pairing code generated in Calls). Keep the raw token private. Create `~/.config/launchstack/call-worker.json`, readable only by your user (`chmod 600`), containing **one JSON line**, for example:

```json
{
  "origin": "https://app.example.com",
  "deviceToken": "lsc_REPLACE_WITH_THE_43_CHARACTER_PAIRED_TOKEN",
  "appVersion": "0.1.0",
  "systemAudioHelperPath": "/absolute/path/to/checkout/apps/call-worker/native/system-audio-capture/.build/release/launchstack-system-audio",
  "language": "en",
  "autoEnrich": false
}
```

Replace the example token with the complete `lsc_…` token returned by pairing. The origin must be an HTTP(S) origin without a path, query or credentials; use HTTPS for remote deployments. `appVersion` is the Mac app's semantic version and is checked by the deployment's minimum-version policy.

```sh
pnpm --filter @launchstack/call-worker dev < ~/.config/launchstack/call-worker.json
```

The worker stays idle and long-polls until Calls assigns a capture to this paired device. Reaching EOF after the config line does not stop it. Use Calls to stop the capture; Ctrl-C or SIGTERM gracefully drains and shuts down the worker. For a bundled development run:

```sh
pnpm --filter @launchstack/call-worker build
node apps/call-worker/dist/main.js < ~/.config/launchstack/call-worker.json
```

There is no environment-based worker configuration. The Mac app normally supplies all four required fields (`origin`, `deviceToken`, `appVersion`, `systemAudioHelperPath`); an empty or invalid first line exits 64 before opening audio or contacting the deployment.

### Optional JSON tuning

| Field                    | Default  | Purpose                                                                  |
| ------------------------ | -------- | ------------------------------------------------------------------------ |
| `language`               | Omitted  | Transcription language hint, forwarded to the deployment                 |
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

## App IPC

Stdin line 1 is the config above. Subsequent JSON lines are control messages:

```json
{"type":"keep_recording"}
{"type":"call_ended_signal"}
{"type":"shutdown"}
```

Stdout is reserved **only** for newline-delimited contract JSON. Lifecycle updates are emitted for `idle`, `starting`, `capturing`, `paused` and `stopping`, with capture identity when applicable, microphone/system VAD activity, delivered segment count and the most recent segment timestamp. While capturing, progress snapshots are emitted every two seconds. Diagnostics and retry messages go only to stderr and do not include the device token or raw audio.

After both channels remain inactive for `silenceTimeoutMs`, the worker emits `auto_stop_pending` with reason `silence` and an ISO `stopsAt` 60 seconds ahead. `call_ended_signal` starts the same countdown with reason `call_ended`. `keep_recording` emits `auto_stop_cancelled` when a countdown is pending and resets the silence window; renewed speech also cancels a silence countdown. On expiry, the worker sends `attempt_ended` with reason `silence_timeout` or `source_stopped`, then drains pending transcription before `occurrence_ended` and finish. A server-requested Stop, including its maximum-duration policy, follows the normal Stop drain. Pause drains only the current attempt; Resume opens a new attempt on the same call.

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

## Checks

```sh
pnpm --filter @launchstack/call-worker typecheck
pnpm exec eslint apps/call-worker/src
pnpm exec prettier --check 'apps/call-worker/src/**/*.ts' apps/call-worker/package.json apps/call-worker/README.md
pnpm --filter @launchstack/call-worker test
pnpm --filter @launchstack/call-worker build
```
