/**
 * What a workspace's model calls were for.
 *
 * Every entry point that runs work under a workspace's models names one of
 * these (`withWorkspaceChatModels` in ~/server/workspace-models/scope), and
 * each call made inside is counted against it in `ai_usage_daily`. The usage
 * page groups by it, so the ids double as message keys
 * (`settings.usage.models.features.<id>`): add one there in both languages
 * when adding one here.
 */
export const AI_FEATURES = [
    "ask",
    "mcp",
    "notes",
    "documentWriter",
    "marketing",
    "emailCampaigns",
    "prospects",
    "distribution",
    "proposals",
    "scenarios",
    "trends",
    "predictiveAnalysis",
    "repoExplainer",
    "meetings",
    "vantage",
    "companyProfile",
    "ingestion",
] as const;

export type AiFeature = (typeof AI_FEATURES)[number];

export function isAiFeature(value: string): value is AiFeature {
    return (AI_FEATURES as readonly string[]).includes(value);
}

/**
 * The chat routes a call can be counted under, plus `auxiliary` for the
 * models ingestion runs on its own settings (table summaries, image
 * descriptions, entity extraction). Message keys under
 * `settings.usage.models.routes`.
 */
export const AI_USAGE_ROUTES = ["default", "fast", "reasoning", "vision", "auxiliary"] as const;

export type AiUsageRoute = (typeof AI_USAGE_ROUTES)[number];

export function isAiUsageRoute(value: string): value is AiUsageRoute {
    return (AI_USAGE_ROUTES as readonly string[]).includes(value);
}
