/**
 * The operator's view of chat model configuration: which model serves each
 * route, what each model declares, and where that declaration came from.
 *
 * Read-only by design. The YAML file is the source of truth and validated at
 * startup; this makes it legible without making it editable from a browser,
 * which would turn a 500-on-boot misconfiguration into a 500-on-first-ask.
 * Endpoint credentials are never included; the host is.
 */

import { basename } from "node:path";

import {
    ChatRoutes,
    behaviorSupportsReasoning,
    behaviorSupportsVision,
    getChatModelPreset,
    getChatModelsConfig,
    isChatRouteUnavailableError,
    resolveChatRoute,
    type ChatModelDefinition,
} from "@launchstack/llm";
import { env } from "~/env";
import { configureAppChatModels, resolveChatModelsConfigPath } from "~/server/chat-models";

export interface ModelRouteInfo {
    route: string;
    available: boolean;
    /** Configured model name, e.g. `fast`. */
    name?: string;
    /** Model id sent to the endpoint. */
    modelId?: string;
    inheritsDefault?: boolean;
    unavailableReason?: string;
}

export interface ModelInfo {
    name: string;
    modelId: string;
    /** Preset the behaviour started from, when one was referenced. */
    preset: string | null;
    /** Where the preset's behaviour was read from, and when it was last checked. */
    presetSource: string | null;
    verifiedOn: string | null;
    presetNotes: string | null;
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
    endpointHost: string | null;
    configFile: string;
    routes: ModelRouteInfo[];
    models: ModelInfo[];
}

function hostOf(url: string): string | null {
    try {
        return new URL(url).host;
    } catch {
        return url || null;
    }
}

function describeModel(name: string, definition: ChatModelDefinition, routes: string[]): ModelInfo {
    const preset = definition.preset ? getChatModelPreset(definition.preset) : undefined;
    return {
        name,
        modelId: definition.id,
        preset: definition.preset ?? null,
        presetSource: preset?.source ?? null,
        verifiedOn: preset?.verifiedOn ?? null,
        presetNotes: preset?.notes ?? null,
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
                modelId: resolved.definition.id,
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

    return {
        endpointHost: hostOf(config.endpoint.baseUrl),
        configFile: basename(resolveChatModelsConfigPath(env.server, process.cwd())),
        routes,
        models,
    };
}
