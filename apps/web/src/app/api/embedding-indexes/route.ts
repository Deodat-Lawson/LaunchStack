import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import {
  getEmbeddingIndexRegistry,
  type EmbeddingIndexConfig,
  type EmbeddingProvider,
} from "@launchstack/core/embeddings";

const PROVIDER_LABELS: Record<EmbeddingProvider, string> = {
  openai: "OpenAI",
  ollama: "Ollama",
  huggingface: "Hugging Face",
  sidecar: "Sidecar",
};

function humanLabel(index: EmbeddingIndexConfig): string {
  const providerLabel = PROVIDER_LABELS[index.provider] ?? index.provider;
  return `${providerLabel} · ${index.model} (${index.dimension})`;
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  const indexes = getEmbeddingIndexRegistry()
    .filter((idx) => idx.enabled)
    .map((idx) => ({
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
