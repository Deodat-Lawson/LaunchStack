import type { ProviderResult } from "@launchstack/llm/providers";
import type { RerankProvider, RerankResult } from "./index";
import { getCapabilityConfig, resolveEndpoint } from "@launchstack/llm/providers/registry";

/**
 * Token cost per rerank query. This is the provider's billing rate (rerank
 * APIs don't return token counts in their responses), so the value is baked
 * in here rather than computed from the request shape. Apps that want a
 * different cost ratio can patch this file when bundling or wrap the
 * provider with their own accounting layer.
 */
const RERANK_TOKENS_PER_QUERY = 200;

/**
 * Dedicated reranking service, for any endpoint implementing
 * POST /v1/rerank with {model, query, documents, top_n}.
 *
 * Opt-in only: it is selected when RERANK_API_BASE_URL names an endpoint.
 * There is no built-in vendor here — reranking has no default host because
 * the default reranker is {@link ../reranking/gemini}, which runs on the chat
 * endpoint the deployment already has. Set RERANK_API_BASE_URL, RERANK_API_KEY
 * and RERANK_MODEL together to use a purpose-built cross-encoder instead.
 *
 * Resolution: RERANK_API_* → AI_BASE_URL/AI_API_KEY
 */
export class DedicatedRerankProvider implements RerankProvider {
    name: string;
    private baseUrl: string;
    private apiKey: string;
    private model: string;

    constructor() {
        // RERANK_API_* values arrive through configureProviders() — this
        // module reads no process.env (ADR-002).
        const rerank = getCapabilityConfig("rerank");
        const endpoint = resolveEndpoint(rerank.baseUrl, rerank.apiKey);
        this.baseUrl = endpoint.baseUrl;
        this.apiKey = endpoint.apiKey;
        const model = rerank.model;
        if (!model) {
            throw new Error(
                "RERANK_MODEL is required when RERANK_API_BASE_URL is set: a " +
                    "dedicated rerank endpoint names its own model, and there is no " +
                    "default to fall back on."
            );
        }
        this.model = model;
        this.name = `rerank:${this.model}`;

        if (!this.apiKey) {
            console.warn("[Rerank] No API key found (RERANK_API_KEY / AI_API_KEY)");
        }
    }

    async rerank(query: string, documents: string[]): Promise<ProviderResult<RerankResult>> {
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
