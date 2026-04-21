import type { ProviderResult } from "@launchstack/core/providers";
import type { TranscriptionProvider, TranscriptionResult } from "./index";

const SIDECAR_URL = process.env.SIDECAR_URL ?? "http://localhost:8000";

export class SidecarTranscriptionProvider implements TranscriptionProvider {
    name = "sidecar";

    async transcribe(
        audioBuffer: Buffer,
        filename: string
    ): Promise<ProviderResult<TranscriptionResult>> {
        const formData = new FormData();
        const blob = new Blob([new Uint8Array(audioBuffer)], { type: "application/octet-stream" });
        formData.append("file", blob, filename);

        const resp = await fetch(`${SIDECAR_URL}/transcribe`, {
            method: "POST",
            body: formData as any,
        });

        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`Sidecar transcription failed (${resp.status}): ${text}`);
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
