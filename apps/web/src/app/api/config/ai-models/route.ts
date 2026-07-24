import { NextResponse } from "next/server";
import {
  AIModelTypes,
  inferProviderFromModel,
  type AIModelType,
} from "@launchstack/core/llm";

export const revalidate = 3600;

export async function GET() {
  const providers = {
    openai: Boolean(process.env.OPENAI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    google: Boolean(process.env.GOOGLE_AI_API_KEY),
    ollama: Boolean(process.env.OLLAMA_BASE_URL),
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
  } as const;

  const models = Object.fromEntries(
    AIModelTypes.map((model) => [
      model,
      providers[inferProviderFromModel(model)],
    ]),
  ) as Record<AIModelType, boolean>;

  return NextResponse.json({ providers, models });
}
