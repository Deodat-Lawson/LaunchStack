import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import {
  configureChatModels,
  createChatModelsConfig,
} from "@launchstack/core/llm";

/**
 * Configure the chat-model factory for a standalone benchmark run (test or
 * script). In the web app this is done inside getEngine(); the benchmark runs
 * outside that, so it must configure the judge itself. Call once before
 * scoring.
 *
 * Model ids and per-model behavior live in the deployment's chat-model YAML,
 * not in environment variables — the benchmark reads the same file the app
 * does so a judged score reflects the deployment's actual routing.
 */
export function configureJudgeFromEnv(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): void {
  const baseUrl = env.AI_BASE_URL?.trim() ?? env.OPENAI_BASE_URL?.trim();
  const apiKey = env.AI_API_KEY?.trim() ?? env.OPENAI_API_KEY?.trim();
  if (!baseUrl) {
    throw new Error(
      "Set AI_BASE_URL (or OPENAI_BASE_URL) to the OpenAI-compatible endpoint " +
        "before running the benchmark judge.",
    );
  }
  if (!apiKey) {
    throw new Error(
      "Set AI_API_KEY (or OPENAI_API_KEY) before running the benchmark judge.",
    );
  }

  const configured = env.CHAT_MODELS_CONFIG?.trim() ?? "chat-models.yaml";
  const path = isAbsolute(configured) ? configured : join(cwd, configured);

  let yaml: string;
  try {
    yaml = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(
      `Unable to read the chat model configuration at "${path}": ` +
        `${error instanceof Error ? error.message : String(error)}. ` +
        `Run the benchmark from apps/web, or set CHAT_MODELS_CONFIG to an absolute path.`,
    );
  }

  configureChatModels(
    createChatModelsConfig({
      yaml,
      endpoint: { baseUrl, apiKey },
      sourceLabel: path,
    }),
  );
}
