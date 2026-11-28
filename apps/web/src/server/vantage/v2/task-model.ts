import { createLangchainAgentPort, type ChatProviderRetryPolicy } from "@launchstack/llm";
import { resolveConfiguredChatModel, resolveConfiguredChatRoute } from "~/lib/models";
import { VANTAGE_V2_MODEL_ROUTE } from "./model-journal";

export function createVantageTaskModel(deadlineAt: number, retry: ChatProviderRetryPolicy) {
    const { reasoning } = resolveConfiguredChatRoute(VANTAGE_V2_MODEL_ROUTE).definition.behavior;
    // Azure Luna requires an explicit non-reasoning effort when tools are bound.
    const reasoningControl =
        reasoning.mode === "effort" && reasoning.levels.none
            ? { enabled: true, effort: "none" }
            : undefined;
    return createLangchainAgentPort(
        resolveConfiguredChatModel({
            route: VANTAGE_V2_MODEL_ROUTE,
            reasoningControl,
            maxRetries: 0,
            timeoutMs: Math.max(1, Math.min(45_000, deadlineAt - Date.now())),
            maxOutputTokens: 1000,
            providerRetry: retry,
        })
    );
}
