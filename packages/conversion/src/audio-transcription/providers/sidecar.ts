import type { ProviderResult } from "@launchstack/llm/providers";
import type { TranscriptionProvider, TranscriptionResult } from "./index";
import type { TranscribeResponse } from "../wire";
import {
    getTranscriptionServiceApiKey,
    getTranscriptionServiceUrl,
} from "../../transcription-service";

/**
 * Self-hosted Whisper transcription via services/transcription (ADR-004).
 * The provider name stays "sidecar" because that is the TRANSCRIPTION_PROVIDER
 * value that selects it.
 */
export class SidecarTranscriptionProvider implements TranscriptionProvider {
    name = "sidecar";

    async transcribe(
        audioBuffer: Buffer,
        filename: string
    ): Promise<ProviderResult<TranscriptionResult>> {
        const formData = new FormData();
        const blob = new Blob([new Uint8Array(audioBuffer)], { type: "application/octet-stream" });
        formData.append("file", blob, filename);

        const resp = await fetch(`${getTranscriptionServiceUrl()}/transcribe`, {
            method: "POST",
            // X-API-Key only — letting fetch set Content-Type itself is what
            // supplies the multipart boundary.
            headers: { "X-API-Key": getTranscriptionServiceApiKey() },
            body: formData,
        });

        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`Transcription service request failed (${resp.status}): ${text}`);
        }

        const data = (await resp.json()) as TranscribeResponse;

        return {
            data: {
                text: data.text,
                language: data.language,
                confidence: data.confidence,
                // The viewer's click-to-seek transcript; an older service
                // build that omits them just gets the plain transcript.
                ...(Array.isArray(data.segments) && data.segments.length > 0
                    ? { segments: data.segments }
                    : {}),
            },
            usage: {
                tokensUsed: 0, // Self-hosted = free
                details: {},
            },
        };
    }
}
