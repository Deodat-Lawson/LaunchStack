import type { ProviderResult } from "../types";
import { resolveNERProvider } from "../registry";
import { createSlot } from "../../internal/slot";

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

const providerSlot = createSlot<NERProvider>("providers/ner");

export async function getNERProvider(): Promise<NERProvider> {
    const cached = providerSlot.get();
    if (cached) return cached;

    const type = resolveNERProvider();
    let provider: NERProvider;
    if (type === "sidecar") {
        const { SidecarNERProvider } = await import("./sidecar");
        provider = new SidecarNERProvider();
    } else {
        const { LLMNERProvider } = await import("./llm");
        provider = new LLMNERProvider();
    }
    providerSlot.set(provider);

    return provider;
}
