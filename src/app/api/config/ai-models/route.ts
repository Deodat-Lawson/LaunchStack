import { NextResponse } from "next/server";
import type { AIModelType } from "~/app/api/agents/documentQ&A/services/types";

export const revalidate = 3600;

type ProviderKey = "openai" | "anthropic" | "google" | "ollama";

const MODEL_PROVIDER_MAP: Record<AIModelType, ProviderKey> = {
  "gpt-5.2": "openai",
  "gpt-5.1": "openai",
  "gpt-5-nano": "openai",
  "gpt-5-mini": "openai",
  "claude-sonnet-4": "anthropic",
  "claude-opus-4.5": "anthropic",
  "gemini-2.5-flash": "google",
  "gemini-3-flash": "google",
  "gemini-3-pro": "google",
  "llama3.1:8b": "ollama",
  "llama3.2:3b": "ollama",
  "mistral:7b": "ollama",
  "codellama:7b": "ollama",
  "gemma2:9b": "ollama",
  "phi3:mini": "ollama",
  "qwen2.5:7b": "ollama",
};

export async function GET() {
  const providers = {
    openai: Boolean(process.env.OPENAI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    google: Boolean(process.env.GOOGLE_AI_API_KEY),
    ollama: Boolean(process.env.OLLAMA_BASE_URL),
  } as const;

  const models = Object.fromEntries(
    Object.entries(MODEL_PROVIDER_MAP).map(([model, provider]) => [
      model,
      providers[provider],
    ])
  ) as Record<AIModelType, boolean>;

  return NextResponse.json({ providers, models });
}
