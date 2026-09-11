import { NextResponse } from "next/server";

import {
    getEmbeddingIndexRegistry,
    type EmbeddingIndexConfig,
    type EmbeddingProvider,
} from "@launchstack/llm/embeddings";
import { requireAuthIdentity } from "~/lib/require-workspace-context";

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
    // Session only, deliberately: the signup page reads this list *before* the
    // user has a workspace, so requiring one made the very first call of a new
    // account's lifetime a guaranteed 401. The registry returned here is not
    // workspace-scoped — getEmbeddingIndexRegistry() is called with no company
    // config below — so the context was fetched and discarded anyway.
    const identity = await requireAuthIdentity();
    if (!identity.success) return identity.response;

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
