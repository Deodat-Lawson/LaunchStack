import type { ProviderResult } from "../types";
import { createSlot } from "../../internal/slot";
import { getCapabilityConfig } from "../registry";

export interface RerankResult {
    scores: number[];
}

export interface RerankProvider {
    name: string;
    rerank(query: string, documents: string[]): Promise<ProviderResult<RerankResult>>;
}

const providerSlot = createSlot<RerankProvider>("providers/reranking");

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
