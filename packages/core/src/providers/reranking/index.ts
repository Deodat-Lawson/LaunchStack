import type { ProviderResult } from "../types";
import { resolveRerankProvider } from "../registry";
import { createSlot } from "../../internal/slot";

export interface RerankResult {
    scores: number[];
}

export interface RerankProvider {
    name: string;
    rerank(query: string, documents: string[]): Promise<ProviderResult<RerankResult>>;
}

const providerSlot = createSlot<RerankProvider>("providers/reranking");

export async function getRerankProvider(): Promise<RerankProvider> {
    const cached = providerSlot.get();
    if (cached) return cached;

    const type = resolveRerankProvider();
    let provider: RerankProvider;
    if (type === "sidecar") {
        const { SidecarRerankProvider } = await import("./sidecar");
        provider = new SidecarRerankProvider();
    } else if (process.env.RERANK_API_BASE_URL) {
        // Only when the operator names a dedicated /v1/rerank service. There is
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
