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
 *
 * It also carries the web search engine (`webSearch`), set the same way: in
 * the server's environment, read-only here. The no-vendor rule is about AI
 * models; search engines are named (Prospects names them too). Keys and
 * addresses are not: only which setting each engine reads and whether it is
 * present.
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
import { describeSearchSetup, type SearchSetupView } from "@launchstack/tools/web-research";
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

/** The search engine every feature uses; see `describeSearchSetup`. */
export type WebSearchInfo = SearchSetupView;

export interface ModelsOverview {
    routes: ModelRouteInfo[];
    models: ModelInfo[];
    webSearch: WebSearchInfo;
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

/**
 * The search setup, field by field: whatever `describeSearchSetup` grows
 * later reaches the browser only once it is added here on purpose.
 */
export function webSearchOverview(): WebSearchInfo {
    const setup = describeSearchSetup();
    return {
        provider: setup.provider,
        label: setup.label,
        source: setup.source,
        requested: setup.requested,
        problem: setup.problem,
        credential: setup.credential,
        capabilities: {
            web: setup.capabilities.web,
            news: setup.capabilities.news,
            companies: setup.capabilities.companies,
        },
        providers: setup.providers.map(provider => ({
            id: provider.id,
            label: provider.label,
            credential: provider.credential,
            configured: provider.configured,
            companies: provider.companies,
        })),
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

    return { routes, models, webSearch: webSearchOverview() };
}
