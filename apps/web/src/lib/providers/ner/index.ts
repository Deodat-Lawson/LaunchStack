import type { ProviderResult } from "@launchstack/core/providers";
import { resolveNERProvider } from "@launchstack/core/providers/registry";

export interface EntityResult {
    text: string;
    label: string;
    score: number;
}

export interface ChunkEntities {
    text: string;
    entities: EntityResult[];
}

export interface NERResult {
    results: ChunkEntities[];
    totalEntities: number;
}

export interface NERProvider {
    name: string;
    extract(chunks: string[]): Promise<ProviderResult<NERResult>>;
}

let _provider: NERProvider | null = null;

export async function getNERProvider(): Promise<NERProvider> {
    if (_provider) return _provider;

    const type = resolveNERProvider();
    if (type === "sidecar") {
        const { SidecarNERProvider } = await import("./sidecar");
        _provider = new SidecarNERProvider();
    } else {
        const { LLMNERProvider } = await import("./llm");
        _provider = new LLMNERProvider();
    }

    return _provider;
}
