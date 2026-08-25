import type { ProviderResult } from "@launchstack/llm/providers";
import type { TranscriptionProvider, TranscriptionResult } from "./index";
import { getTranscriptionServiceApiKey, getTranscriptionServiceUrl } from "../../transcription-service";

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

        const data = (await resp.json()) as {
            text: string;
            language: string;
            confidence: number;
            filename: string;
        };

        return {
            data: {
                text: data.text,
                language: data.language,
                confidence: data.confidence,
            },
            usage: {
                tokensUsed: 0, // Self-hosted = free
                details: {},
            },
        };
    }
}
