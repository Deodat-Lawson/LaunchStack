/**
 * The browser-safe view of chat configuration.
 *
 * The UI needs enough to render honest controls — is there a vision route,
 * can the user pick a reasoning effort, which levels are legal — and nothing
 * more. Endpoint URLs, credentials, reasoning request patches, and the
 * models' internal context/output limits stay on the server. Everything in
 * these types is safe to serialize to an unauthenticated client.
 */

import {
    getChatModelsConfig,
    resolveChatRoute,
    type ResolvedChatRoute,
} from "./chat-model-factory";
import type { ChatModelsConfig } from "./chat-config";
import {
    ChatRoutes,
    behaviorSupportsVision,
    isChatRouteUnavailableError,
    type ChatModelBehavior,
    type ChatRoute,
    type NativeStructuredOutputMode,
    type ReasoningMode,
} from "./types";

export interface PublicVisionInfo {
    supported: boolean;
    /** Declared accepted MIME types. Absent means the model declared none. */
    mimeTypes?: readonly string[];
    /** Declared per-request image cap. Absent means undeclared, not unlimited. */
    maxImages?: number;
}

export interface PublicReasoningInfo {
    mode: ReasoningMode;
    /** Whether a per-request toggle does anything. False for `none` and `always`. */
    controllable: boolean;
    /** Selectable effort levels, for `effort` models. */
    efforts?: readonly string[];
    defaultEffort?: string;
    /** Selectable token budget bounds, for `budget` models. */
    budget?: { min: number; max: number; default: number };
}

export interface PublicChatRouteInfo {
    available: boolean;
    /** Effective model id serving the route. Absent when unavailable. */
    model?: string;
    /** True when the route has no explicit assignment and uses `default`. */
    inheritsDefault?: boolean;
    vision?: PublicVisionInfo;
    reasoning?: PublicReasoningInfo;
    nativeStructuredOutput?: readonly NativeStructuredOutputMode[];
    /** Operator-facing explanation, shown when a control is disabled. */
    unavailableReason?: string;
}

export interface PublicChatConfig {
    routes: Record<ChatRoute, PublicChatRouteInfo>;
}

function publicVision(behavior: ChatModelBehavior): PublicVisionInfo {
    if (!behaviorSupportsVision(behavior)) return { supported: false };
    return {
        supported: true,
        ...(behavior.image?.mimeTypes ? { mimeTypes: behavior.image.mimeTypes } : {}),
        ...(behavior.image?.maxImages !== undefined ? { maxImages: behavior.image.maxImages } : {}),
    };
}

function publicReasoning(behavior: ChatModelBehavior): PublicReasoningInfo {
    const reasoning = behavior.reasoning;
    switch (reasoning.mode) {
        case "none":
            return { mode: "none", controllable: false };
        case "always":
            return { mode: "always", controllable: false };
        case "toggle":
            return { mode: "toggle", controllable: true };
        case "effort":
            return {
                mode: "effort",
                controllable: true,
                efforts: Object.keys(reasoning.levels),
                defaultEffort: reasoning.default,
            };
        case "budget":
            return {
                mode: "budget",
                controllable: true,
                budget: {
                    min: reasoning.min,
                    max: reasoning.max,
                    default: reasoning.default,
                },
            };
    }
}

function describeRoute(resolved: ResolvedChatRoute): PublicChatRouteInfo {
    const behavior = resolved.definition.behavior;
    return {
        available: true,
        model: resolved.definition.id,
        inheritsDefault: resolved.inheritsDefault,
        vision: publicVision(behavior),
        reasoning: publicReasoning(behavior),
        nativeStructuredOutput: behavior.nativeStructuredOutput,
    };
}

/** Sanitized effective route information for every route. */
export function getPublicChatConfig(
    config: ChatModelsConfig = getChatModelsConfig()
): PublicChatConfig {
    const routes = {} as Record<ChatRoute, PublicChatRouteInfo>;
    for (const route of ChatRoutes) {
        try {
            routes[route] = describeRoute(resolveChatRoute(route, config));
        } catch (error) {
            if (!isChatRouteUnavailableError(error)) throw error;
            routes[route] = { available: false, unavailableReason: error.message };
        }
    }
    return { routes };
}
