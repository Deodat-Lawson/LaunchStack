/** Validate and price the Azure retrieval benchmark before sending model requests. */
import { resolveChatRoute, type ChatRoute } from "@launchstack/llm";
import { getAppChatModelsConfig } from "../src/server/chat-models";

export const AZURE_LIVE_LIMIT = 10;
export const AZURE_LUNA_DEPLOYMENT = "gpt-6-luna";
export const AZURE_LUNA_OUTPUT_LIMIT = 6000;
export const AZURE_LUNA_RESERVATION_PER_MILLION = { input: 0.3, output: 0.9 };
const rateSource =
    "https://azure.microsoft.com/en-us/blog/gpt-6-astra-sol-and-luna-for-production-agents-in-microsoft-foundry/";

// Nearest-rank p90 of the a68442c2 pilot's per-case exploration exposure
// (settled conservative charges plus full unresolved request reserves).
const pilotExplorationP90Usd = 0.0521793;
const explorationPadding = 1.5;

export function projectAzureLive(input: {
    remainingCases: number;
    missingDigestBytes?: readonly number[];
    currentExposureUsd?: number;
    completedExplorationCases?: number;
    completedExplorationExposureUsd?: number;
}) {
    const { input: inputRate, output: outputRate } = AZURE_LUNA_RESERVATION_PER_MILLION;
    const digestUsd = (input.missingDigestBytes ?? []).reduce(
        (sum, bytes) =>
            sum + ((bytes * 6 + 8192) * inputRate + AZURE_LUNA_OUTPUT_LIMIT * outputRate) / 1e6,
        0
    );
    // Keep the pilot projection until a small cohort from the changed path is available.
    const completed = input.completedExplorationCases ?? 0;
    const observedMeanUsd =
        completed >= 10 ? (input.completedExplorationExposureUsd ?? 0) / completed : 0;
    const explorationPerCaseUsd =
        Math.max(pilotExplorationP90Usd, observedMeanUsd) * explorationPadding;
    const explorationUsd = explorationPerCaseUsd * input.remainingCases;
    return {
        pilotExplorationP90Usd,
        explorationPadding,
        remainingCases: input.remainingCases,
        missingDigests: input.missingDigestBytes?.length ?? 0,
        digestUsd,
        explorationUsd,
        explorationPerCaseUsd,
        projectedUsd: (input.currentExposureUsd ?? 0) + digestUsd + explorationUsd,
        limitUsd: AZURE_LIVE_LIMIT,
    };
}

export function planAzureLive(env = process.env) {
    const base = env.CHAT_BASE_URL?.trim();
    const credential = env.CHAT_API_KEY?.trim();
    if (!base || !credential) throw new Error("benchmark_azure_chat_environment_required");
    const endpoint = new URL(base);
    if (
        endpoint.protocol !== "https:" ||
        !/^[a-z0-9-]+\.openai\.azure\.com$/i.test(endpoint.hostname) ||
        !/^\/openai\/v1\/?$/.test(endpoint.pathname) ||
        endpoint.port ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash
    )
        throw new Error("benchmark_azure_openai_v1_required");
    const configPath = "config/chat-models.azure.yaml";
    if (
        env.CHAT_MODELS_CONFIG !== configPath ||
        (env.VANTAGE_TOPIC_FIRST_DIGEST_ROUTE ?? "default") !== "default" ||
        (env.VANTAGE_TOPIC_FIRST_EXPLORATION_ROUTE ?? "reasoning") !== "reasoning"
    )
        throw new Error("benchmark_azure_route_config_required");
    const config = getAppChatModelsConfig({
        CHAT_BASE_URL: endpoint.toString().replace(/\/$/, ""),
        CHAT_API_KEY: credential,
        CHAT_MODELS_CONFIG: configPath,
    });
    const routes = (
        [
            { label: "default", route: "default", api: "chat/completions" },
            { label: "reasoning", route: "reasoning", api: "responses" },
            { label: "digest", route: "default", api: "chat/completions" },
        ] satisfies { label: string; route: ChatRoute; api: string }[]
    ).map(({ label, route, api }) => {
        const { definition } = resolveChatRoute(route, config);
        if (
            definition.id !== AZURE_LUNA_DEPLOYMENT ||
            definition.behavior.reasoning.mode !== "effort"
        )
            throw new Error("benchmark_azure_luna_route_mismatch");
        return {
            label,
            route,
            api,
            model: definition.id,
            host: endpoint.hostname,
            effort: definition.behavior.reasoning.default,
        };
    });
    if (routes.find(row => row.label === "reasoning")?.effort !== "high")
        throw new Error("benchmark_azure_high_reasoning_route_required");

    return { routes, rateSource, config, endpoint: config.endpoint.baseUrl, apiKey: credential };
}
