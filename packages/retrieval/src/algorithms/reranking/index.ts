import type { ProviderResult } from "@launchstack/llm/providers";
import { createSlot } from "@launchstack/runtime";
import { getCapabilityConfig } from "@launchstack/llm/providers/registry";

export interface RerankResult {
    scores: number[];
}

export interface RerankProvider {
    name: string;
    rerank(query: string, documents: string[]): Promise<ProviderResult<RerankResult>>;
}

const providerSlot = createSlot<RerankProvider>("providers/reranking");

/**
 * Whether the operator explicitly configured reranking
 * (RERANK_API_BASE_URL). Retrieval callers gate on this so an
 * unconfigured deployment keeps the historical behavior — RRF order with
 * NO extra LLM call per search. (Before ADR-004 the rerank hop only ran
 * when SIDECAR_URL was set; defaulting to the Gemini scorer would add a
 * chat-model invocation and its cost/latency to every ensemble search.)
 */
export function isRerankConfigured(): boolean {
    return Boolean(getCapabilityConfig("rerank").baseUrl);
}

/**
 * Returns the rerank provider. Cloud only: the sidecar provider called
 * ${SIDECAR_URL}/rerank, a route no service ever implemented, and was
 * removed (ADR-004 §5). Callers that can live without reranking should
 * treat a provider failure as "keep the input order".
 */
export async function getRerankProvider(): Promise<RerankProvider> {
    const cached = providerSlot.get();
    if (cached) return cached;

    let provider: RerankProvider;
    if (getCapabilityConfig("rerank").baseUrl) {
        // Only when the operator names a dedicated /v1/rerank service
        // (RERANK_API_BASE_URL, registered via configureProviders). There is
        // no default host for that path, so it is never reached by accident.
        const { DedicatedRerankProvider } = await import("./rerank-api");
        provider = new DedicatedRerankProvider();
    } else {
        // Default: score relevance on the chat endpoint the deployment already
        // has, rather than requiring a second vendor for one capability.
        const { GeminiRerankProvider } = await import("./gemini");
        provider = new GeminiRerankProvider();
    }
    providerSlot.set(provider);

    return provider;
}
