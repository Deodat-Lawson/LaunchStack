import type { ProviderResult } from "../types";
import { createSlot } from "@launchstack/runtime";

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

/**
 * Returns the NER provider. The LLM-based extractor is the only
 * implementation: the sidecar provider called ${SIDECAR_URL}/extract-entities,
 * a route no service ever implemented, and was removed (ADR-004 §5).
 */
export async function getNERProvider(): Promise<NERProvider> {
    const cached = providerSlot.get();
    if (cached) return cached;

    const { LLMNERProvider } = await import("./llm");
    const provider = new LLMNERProvider();
    providerSlot.set(provider);

    return provider;
}
