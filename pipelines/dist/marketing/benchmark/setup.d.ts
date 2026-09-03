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
export declare function configureJudgeFromEnv(): void;
//# sourceMappingURL=setup.d.ts.map