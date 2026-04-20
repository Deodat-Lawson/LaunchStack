import type { ProviderResult } from "@launchstack/core/providers";
import type { RerankProvider, RerankResult } from "./index";

const SIDECAR_URL = process.env.SIDECAR_URL ?? "http://localhost:8000";

export class SidecarRerankProvider implements RerankProvider {
    name = "sidecar";

    async rerank(
        query: string,
        documents: string[]
    ): Promise<ProviderResult<RerankResult>> {
        const resp = await fetch(`${SIDECAR_URL}/rerank`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query, documents }),
        });

        if (!resp.ok) {
            throw new Error(`Sidecar rerank failed (${resp.status})`);
        }

        const data = (await resp.json()) as { scores: number[] };

        return {
            data: { scores: data.scores },
            usage: {
                tokensUsed: 0, // Self-hosted = free
                details: { documents: documents.length },
            },
        };
    }
}
