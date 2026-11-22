/** Validate and price the Azure pilot locally before sending model requests. */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { resolveChatRoute, type ChatRoute } from "@launchstack/llm";
import { z } from "zod";
import { getAppChatModelsConfig } from "../src/server/chat-models";

export const AZURE_LIVE_LIMIT = 15;
export const AZURE_LUNA_DEPLOYMENT = "gpt-6-luna";
export const AZURE_LUNA_OUTPUT_LIMIT = 6000;
export const AZURE_LUNA_STANDARD_PER_MILLION = { input: 0.1, cachedInput: 0.01, output: 0.5 };
export const AZURE_LUNA_RESERVATION_PER_MILLION = { input: 0.3, output: 0.9 };
const rateSource =
    "https://azure.microsoft.com/en-us/blog/gpt-6-astra-sol-and-luna-for-production-agents-in-microsoft-foundry/";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const previous = resolve(root, "docs/engineering/vantage-rag-multi-corpus-results-20261121.json");
const accounting = z.object({
    estimatedExplorationInputTokens: z.number().int().nonnegative(),
    estimatedDigestInputTokens: z.number().int().nonnegative(),
    estimatedOutputTokens: z.number().int().nonnegative().optional(),
    estimatedExplorationOutputTokens: z.number().int().nonnegative(),
    estimatedDigestOutputTokens: z.number().int().nonnegative(),
    digestProviderCalls: z.number().int().positive(),
    explorationResponses: z.number().int().positive(),
});

export async function planAzureLive(env = process.env) {
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

    const study = JSON.parse(await readFile(previous, "utf8")) as { liveDryAccounting?: unknown };
    const dry = accounting.parse(study.liveDryAccounting);
    const input = dry.estimatedDigestInputTokens + dry.estimatedExplorationInputTokens;
    const output = dry.estimatedDigestOutputTokens + dry.estimatedExplorationOutputTokens;
    const maxExplorationCalls = 20 * 12;
    const projectedInput =
        dry.estimatedDigestInputTokens +
        Math.ceil(
            (dry.estimatedExplorationInputTokens * maxExplorationCalls) / dry.explorationResponses
        );
    const projectedOutput =
        (dry.digestProviderCalls + maxExplorationCalls) * AZURE_LUNA_OUTPUT_LIMIT;
    const standardUsd =
        (input * AZURE_LUNA_STANDARD_PER_MILLION.input +
            output * AZURE_LUNA_STANDARD_PER_MILLION.output) /
        1e6;
    const paddedUsd =
        (projectedInput * AZURE_LUNA_RESERVATION_PER_MILLION.input +
            projectedOutput * AZURE_LUNA_RESERVATION_PER_MILLION.output) /
        1e6;
    const summary = {
        routes,
        standardUsd,
        paddedUsd,
        limitUsd: AZURE_LIVE_LIMIT,
        rateSource,
        dryDigestCalls: dry.digestProviderCalls,
        dryExplorationCalls: dry.explorationResponses,
        maxExplorationCalls,
        projectedInputTokens: projectedInput,
        projectedOutputTokens: projectedOutput,
    };
    return { summary, config, endpoint: config.endpoint.baseUrl, apiKey: credential };
}
