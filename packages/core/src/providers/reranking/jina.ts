import type { ProviderResult } from "../types";
import type { RerankProvider, RerankResult } from "./index";
import { resolveBaseUrl, resolveApiKey, resolveModel } from "../registry";

/**
 * Token cost per rerank query. This is the provider's billing rate (rerank
 * APIs don't return token counts in their responses), so the value is baked
 * in here rather than computed from the request shape. Apps that want a
 * different cost ratio can patch this file when bundling or wrap the
 * provider with their own accounting layer.
 */
const RERANK_TOKENS_PER_QUERY = 200;

/**
 * OpenAI-compatible reranking provider.
 * Works with Jina AI, SiliconFlow, and any provider that supports
 * POST /v1/rerank with {model, query, documents, top_n}.
 *
 * Resolution: RERANK_API_* → AI_BASE_URL/AI_API_KEY → JINA_API_KEY → defaults
 */
export class OpenAICompatibleRerankProvider implements RerankProvider {
    name: string;
    private baseUrl: string;
    private apiKey: string;
    private model: string;

    constructor() {
        this.baseUrl = resolveBaseUrl(
            process.env.RERANK_API_BASE_URL,
            "https://api.jina.ai/v1",
        );
        this.apiKey = resolveApiKey(
            process.env.RERANK_API_KEY,
            process.env.JINA_API_KEY,
        );
        this.model = resolveModel(
            process.env.RERANK_MODEL,
            "jina-reranker-v2-base-multilingual",
        );
        this.name = `rerank:${this.model}`;

        if (!this.apiKey) {
            console.warn("[Rerank] No API key found (RERANK_API_KEY / AI_API_KEY / JINA_API_KEY)");
        }
    }

    async rerank(
        query: string,
        documents: string[]
    ): Promise<ProviderResult<RerankResult>> {
        const resp = await fetch(`${this.baseUrl}/rerank`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                query,
                documents,
                top_n: documents.length,
            }),
        });

        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`Rerank failed (${resp.status}): ${text}`);
        }

        const data = (await resp.json()) as {
            results: Array<{ index: number; relevance_score: number }>;
        };

        const scores = new Array<number>(documents.length).fill(0);
        for (const result of data.results) {
            scores[result.index] = result.relevance_score;
        }

        return {
            data: { scores },
            usage: {
                tokensUsed: RERANK_TOKENS_PER_QUERY,
                details: { documents: documents.length },
            },
        };
    }
}
