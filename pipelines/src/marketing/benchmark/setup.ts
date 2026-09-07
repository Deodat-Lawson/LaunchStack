import {
    GEMINI_BASE_URL,
    GEMINI_DEFAULT_MODEL,
    configureChatModels,
    createChatModelsConfig,
} from "@launchstack/llm";

const trimmed = (value: string | undefined): string | undefined => {
    const t = value?.trim();
    if (!t) return undefined;
    return t;
};

/**
 * Configure the chat-model factory for a standalone benchmark run (test or
 * script) from environment variables. In the web app this is done inside
 * getEngine(); the benchmark runs outside that, so it must configure the judge
 * itself. Call once before scoring.
 *
 * Endpoint selection mirrors the app: CHAT_BASE_URL/CHAT_API_KEY when set,
 * otherwise the Gemini OpenAI-compatible endpoint keyed by GOOGLE_AI_API_KEY.
 * Override the judge's wire model id with BENCHMARK_JUDGE_MODEL when the
 * endpoint does not serve the Gemini default.
 */
export function configureJudgeFromEnv(): void {
    const baseUrl =
        trimmed(process.env.CHAT_BASE_URL) ?? trimmed(process.env.AI_BASE_URL) ?? GEMINI_BASE_URL;
    const apiKey =
        trimmed(process.env.CHAT_API_KEY) ??
        trimmed(process.env.AI_API_KEY) ??
        trimmed(process.env.GOOGLE_AI_API_KEY);
    if (!apiKey) {
        throw new Error(
            "Set CHAT_API_KEY (or GOOGLE_AI_API_KEY for the default Gemini endpoint) before running the benchmark judge."
        );
    }
    const modelId = trimmed(process.env.BENCHMARK_JUDGE_MODEL) ?? GEMINI_DEFAULT_MODEL;

    configureChatModels(
        createChatModelsConfig({
            yaml: [
                "version: 1",
                "models:",
                "  judge:",
                // JSON-quote the id so values containing ':' or '#' stay one YAML scalar.
                `    id: ${JSON.stringify(modelId)}`,
                "    preset: google/gemini-2.5-flash",
                "routes:",
                "  default: judge",
            ].join("\n"),
            endpoint: { baseUrl, apiKey },
            sourceLabel: "marketing-pipeline/benchmark/setup.ts",
        })
    );
}
