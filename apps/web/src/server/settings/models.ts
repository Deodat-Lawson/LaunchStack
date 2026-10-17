/**
 * The admin's view of chat model configuration: which configured model serves
 * each route and what each model declares.
 *
 * Read-only by design. The YAML file is the source of truth and validated at
 * startup; this makes it legible without making it editable from a browser,
 * which would turn a 500-on-boot misconfiguration into a 500-on-first-ask.
 *
 * Workspace admins are customers, not operators, so this never names the
 * vendor: no endpoint host, no model id, no preset (preset names and notes
 * are vendor-prefixed), no config file name. Those live in the server's
 * configuration and logs.
 */

import {
    ChatRoutes,
    behaviorSupportsReasoning,
    behaviorSupportsVision,
    getChatModelsConfig,
    isChatRouteUnavailableError,
    resolveChatRoute,
    type ChatModelDefinition,
} from "@launchstack/llm";
import { env } from "~/env";
import { configureAppChatModels } from "~/server/chat-models";

export interface ModelRouteInfo {
    route: string;
    available: boolean;
    /** Configured model name, e.g. `fast` — the operator's label, not the wire id. */
    name?: string;
    inheritsDefault?: boolean;
    unavailableReason?: string;
}

export interface ModelInfo {
    name: string;
    /** Whether the behaviour comes from a verified preset rather than the file. */
    fromPreset: boolean;
    input: readonly string[];
    vision: boolean;
    reasoning: boolean;
    reasoningMode: string;
    structuredOutput: readonly string[];
    contextTokens: number | null;
    maxOutputTokens: number | null;
    /** Routes this model serves, explicitly or by inheritance. */
    routes: string[];
}

export interface ModelsOverview {
    routes: ModelRouteInfo[];
    models: ModelInfo[];
}

function describeModel(name: string, definition: ChatModelDefinition, routes: string[]): ModelInfo {
    return {
        name,
        fromPreset: Boolean(definition.preset),
        input: definition.behavior.input,
        vision: behaviorSupportsVision(definition.behavior),
        reasoning: behaviorSupportsReasoning(definition.behavior),
        reasoningMode: definition.behavior.reasoning.mode,
        structuredOutput: definition.behavior.nativeStructuredOutput,
        contextTokens: definition.behavior.limits?.contextTokens ?? null,
        maxOutputTokens: definition.behavior.limits?.maxOutputTokens ?? null,
        routes,
    };
}

export function modelsOverview(): ModelsOverview {
    configureAppChatModels(env.server);
    const config = getChatModelsConfig();

    const routes: ModelRouteInfo[] = [];
    const routesByModel = new Map<string, string[]>();
    for (const route of ChatRoutes) {
        try {
            const resolved = resolveChatRoute(route, config);
            routes.push({
                route,
                available: true,
                name: resolved.name,
                inheritsDefault: resolved.inheritsDefault,
            });
            routesByModel.set(resolved.name, [...(routesByModel.get(resolved.name) ?? []), route]);
        } catch (error) {
            if (!isChatRouteUnavailableError(error)) throw error;
            routes.push({ route, available: false, unavailableReason: error.message });
        }
    }

    const models: ModelInfo[] = [];
    for (const [name, definition] of config.models) {
        models.push(describeModel(name, definition, routesByModel.get(name) ?? []));
    }

    return { routes, models };
}
