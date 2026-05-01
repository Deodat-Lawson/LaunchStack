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
    } else {
        const { OpenAICompatibleRerankProvider } = await import("./jina");
        provider = new OpenAICompatibleRerankProvider();
    }
    providerSlot.set(provider);

    return provider;
}
