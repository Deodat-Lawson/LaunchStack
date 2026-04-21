import type { ProviderResult } from "../types";
import type { NERProvider, NERResult, ChunkEntities } from "./index";

const SIDECAR_URL = process.env.SIDECAR_URL ?? "http://localhost:8000";

export class SidecarNERProvider implements NERProvider {
    name = "sidecar";

    async extract(chunks: string[]): Promise<ProviderResult<NERResult>> {
        const resp = await fetch(`${SIDECAR_URL}/extract-entities`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chunks }),
        });

        if (!resp.ok) {
            throw new Error(`Sidecar NER failed (${resp.status})`);
        }

        const data = (await resp.json()) as {
            results: ChunkEntities[];
            total_entities: number;
        };

        return {
            data: {
                results: data.results,
                totalEntities: data.total_entities,
            },
            usage: {
                tokensUsed: 0, // Self-hosted = free
                details: { chunks: chunks.length, totalEntities: data.total_entities },
            },
        };
    }
}
