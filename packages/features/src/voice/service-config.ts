/**
 * Transcription service endpoint resolution (ADR-004).
 *
 * The sidecar's Whisper + yt-dlp routes moved to services/transcription, so
 * the canonical variables are TRANSCRIPTION_SERVICE_URL and
 * TRANSCRIPTION_SERVICE_API_KEY. The old SIDECAR_URL / SIDECAR_API_KEY names
 * are still honored as deprecated fallbacks so existing deployments keep
 * working, with a single startup warning naming the replacement.
 */

let warnedDeprecatedNames = false;

function warnOnce(): void {
    if (warnedDeprecatedNames) return;
    warnedDeprecatedNames = true;
    console.warn(
        "[voice] SIDECAR_URL / SIDECAR_API_KEY are deprecated (ADR-004): the sidecar was " +
            "replaced by services/transcription. Set TRANSCRIPTION_SERVICE_URL and " +
            "TRANSCRIPTION_SERVICE_API_KEY instead.",
    );
}

/** Base URL of the transcription service. Defaults to the local dev port. */
export function getTranscriptionServiceUrl(): string {
    const url = process.env.TRANSCRIPTION_SERVICE_URL;
    if (url) return url;
    if (process.env.SIDECAR_URL) {
        warnOnce();
        return process.env.SIDECAR_URL;
    }
    return "http://localhost:8000";
}

/** X-API-Key for the transcription service (it fails closed when empty). */
export function getTranscriptionServiceApiKey(): string {
    const key = process.env.TRANSCRIPTION_SERVICE_API_KEY;
    if (key) return key;
    if (process.env.SIDECAR_API_KEY) {
        warnOnce();
        return process.env.SIDECAR_API_KEY;
    }
    return "";
}
