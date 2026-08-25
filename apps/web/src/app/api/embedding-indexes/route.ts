import { NextResponse } from "next/server";

import {
    getEmbeddingIndexRegistry,
    type EmbeddingIndexConfig,
    type EmbeddingProvider,
} from "@launchstack/llm/embeddings";
import { requireWorkspaceContext } from "~/lib/require-workspace-context";

// "sidecar" is gone from EmbeddingProvider (ADR-004 §5 removed the phantom
// sidecar embedding provider), so it has no label here either.
const PROVIDER_LABELS: Record<EmbeddingProvider, string> = {
    openai: "OpenAI",
    ollama: "Ollama",
    huggingface: "Hugging Face",
};

function humanLabel(index: EmbeddingIndexConfig): string {
    const providerLabel = PROVIDER_LABELS[index.provider] ?? index.provider;
    return `${providerLabel} · ${index.model} (${index.dimension})`;
}

export async function GET() {
    const ctx = await requireWorkspaceContext();
    if (!ctx.success) return ctx.response;

    const indexes = getEmbeddingIndexRegistry()
        .filter(idx => idx.enabled)
        .map(idx => ({
            indexKey: idx.indexKey,
            label: humanLabel(idx),
            provider: idx.provider,
            model: idx.model,
            dimension: idx.dimension,
            supportsMatryoshka: idx.supportsMatryoshka ?? false,
            storageKind: idx.storageKind,
        }));

    return NextResponse.json({ indexes }, { status: 200 });
}
