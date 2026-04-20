import type { ProviderResult } from "../types";
import { resolveRerankProvider } from "../registry";

export interface RerankResult {
    scores: number[];
}

export interface RerankProvider {
    name: string;
    rerank(query: string, documents: string[]): Promise<ProviderResult<RerankResult>>;
}

let _provider: RerankProvider | null = null;

export async function getRerankProvider(): Promise<RerankProvider> {
    if (_provider) return _provider;

    const type = resolveRerankProvider();
    if (type === "sidecar") {
        const { SidecarRerankProvider } = await import("./sidecar");
        _provider = new SidecarRerankProvider();
    } else {
        const { OpenAICompatibleRerankProvider } = await import("./jina");
        _provider = new OpenAICompatibleRerankProvider();
    }

    return _provider;
}
