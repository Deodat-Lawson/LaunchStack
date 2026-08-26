/**
 * Route → model resolution.
 *
 * Callers name the *kind* of work they need; the operator's configuration
 * decides which model does it. Two rules make that safe:
 *
 *   1. Specialized routes fail closed. If `vision` is unassigned and the
 *      default model has no image input, the route is unavailable — the
 *      resolver never substitutes a different model or quietly drops the
 *      capability the caller asked for.
 *   2. Only declared behavior reaches the request. There are no universal
 *      temperature or reasoning defaults; a field the model does not declare
 *      is simply not sent.
 *
 * Resolution is cheap and throws a typed 400, so call it *before* retrieval,
 * web search, or embeddings rather than after paying for them.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage, BaseMessageLike } from "@langchain/core/messages";
import { createSlot } from "@launchstack/runtime";
import type { ChatModelsConfig } from "./chat-config";
import { applyMessageBehavior } from "./messages";
import {
    createOpenAiCompatibleChat,
    describeChatEndpointError,
} from "./openai-compatible-transport";
import {
    ChatConfigurationError,
    ChatRouteUnavailableError,
    InvalidReasoningControlError,
    behaviorSupportsReasoning,
    behaviorSupportsVision,
    missingCapabilities,
    type ChatCapability,
    type ChatModelBehavior,
    type ChatModelDefinition,
    type ChatRequestPatch,
    type ChatRoute,
    type ReasoningMode,
} from "./types";

const configSlot = createSlot<ChatModelsConfig>("llm/chatModels");

/** Install the deployment's chat configuration. Idempotent. */
export function configureChatModels(config: ChatModelsConfig): void {
    configSlot.set(config);
}

export function getChatModelsConfig(): ChatModelsConfig {
    const config = configSlot.get();
    if (!config) {
        throw new ChatConfigurationError(
            "Chat models are not configured. Call configureChatModels() with a validated configuration before resolving a route."
        );
    }
    return config;
}

export function isChatConfigured(): boolean {
    return configSlot.get() !== undefined;
}

/** Test/HMR helper — drops the installed configuration. */
export function resetChatModelsConfig(): void {
    configSlot.clear();
}

// ---------------------------------------------------------------------------
// Reasoning
// ---------------------------------------------------------------------------

export interface ReasoningControl {
    /** Whether the caller wants the model to reason on this request. */
    enabled?: boolean;
    /** Named level, for `effort` models. Validated against declared levels. */
    effort?: string;
    /** Token budget, for `budget` models. Validated against declared bounds. */
    budgetTokens?: number;
}

export interface AppliedReasoning {
    mode: ReasoningMode;
    /** True when the request will actually reason. */
    enabled: boolean;
    effort?: string;
    budgetTokens?: number;
    /** Exact fields merged into the request body. */
    requestPatch: ChatRequestPatch;
}

const NO_PATCH: ChatRequestPatch = Object.freeze({});

function resolveReasoning(
    behavior: ChatModelBehavior,
    route: ChatRoute,
    control: ReasoningControl | undefined
): AppliedReasoning {
    const reasoning = behavior.reasoning;
    const wants = control?.enabled === true;

    if (reasoning.mode === "none") {
        if (wants) {
            throw new ChatRouteUnavailableError({
                route,
                reason: "missing-capability",
                missingCapabilities: ["reasoning"],
                message:
                    "The selected model does not declare a reasoning mode, so reasoning cannot be enabled for this request.",
            });
        }
        return { mode: "none", enabled: false, requestPatch: NO_PATCH };
    }

    if (reasoning.mode === "always") {
        // Not optional for this model — the caller's toggle has nothing to switch.
        return {
            mode: "always",
            enabled: true,
            requestPatch: reasoning.request ?? NO_PATCH,
        };
    }

    if (reasoning.mode === "toggle") {
        return {
            mode: "toggle",
            enabled: wants,
            requestPatch: wants ? reasoning.on : (reasoning.off ?? NO_PATCH),
        };
    }

    if (reasoning.mode === "effort") {
        if (!wants) {
            return {
                mode: "effort",
                enabled: false,
                requestPatch: reasoning.off ?? NO_PATCH,
            };
        }
        const level = control?.effort ?? reasoning.default;
        const patch = reasoning.levels[level];
        if (!patch) {
            throw new InvalidReasoningControlError(
                `Reasoning effort "${level}" is not offered by the selected model. Available levels: ${Object.keys(reasoning.levels).join(", ")}.`
            );
        }
        return { mode: "effort", enabled: true, effort: level, requestPatch: patch };
    }

    if (!wants) {
        return {
            mode: "budget",
            enabled: false,
            requestPatch: reasoning.off ?? NO_PATCH,
        };
    }
    const budget = control?.budgetTokens ?? reasoning.default;
    if (!Number.isInteger(budget) || budget < reasoning.min || budget > reasoning.max) {
        throw new InvalidReasoningControlError(
            `Reasoning budget ${budget} is outside the range the selected model accepts (${reasoning.min}–${reasoning.max}).`
        );
    }
    return {
        mode: "budget",
        enabled: true,
        budgetTokens: budget,
        requestPatch: { [reasoning.field]: budget },
    };
}

// ---------------------------------------------------------------------------
// Route resolution
// ---------------------------------------------------------------------------

export interface ResolvedChatRoute {
    route: ChatRoute;
    /** Configured model name serving the route. */
    name: string;
    definition: ChatModelDefinition;
    /** True when the route had no explicit assignment and fell back to `default`. */
    inheritsDefault: boolean;
}

function requiredCapabilityForRoute(route: ChatRoute): ChatCapability | undefined {
    if (route === "vision") return "vision";
    if (route === "reasoning") return "reasoning";
    return undefined;
}

/**
 * Which model serves `route`, or a typed 400 explaining why none does.
 * `fast` always inherits `default` because speed is an operator preference,
 * not something a model either has or lacks.
 */
export function resolveChatRoute(
    route: ChatRoute,
    config: ChatModelsConfig = getChatModelsConfig()
): ResolvedChatRoute {
    const explicit = config.routes[route];
    if (explicit !== undefined) {
        const definition = config.models.get(explicit);
        if (!definition) {
            throw new ChatConfigurationError(
                `Route "${route}" references model "${explicit}", which is not declared.`
            );
        }
        return { route, name: explicit, definition, inheritsDefault: false };
    }

    const fallbackName = config.routes.default;
    const fallback = config.models.get(fallbackName);
    if (!fallback) {
        throw new ChatConfigurationError(
            `The "default" route references model "${fallbackName}", which is not declared.`
        );
    }

    const needed = requiredCapabilityForRoute(route);
    if (needed) {
        const supported =
            needed === "vision"
                ? behaviorSupportsVision(fallback.behavior)
                : behaviorSupportsReasoning(fallback.behavior);
        if (!supported) {
            throw new ChatRouteUnavailableError({
                route,
                reason: "route-not-configured",
                missingCapabilities: [needed],
                message:
                    `No model is configured for the "${route}" route, and the default model ` +
                    `"${fallback.id}" does not declare ${needed === "vision" ? "image input" : "a reasoning mode"}. ` +
                    `Assign a "${route}" route in the chat model configuration.`,
            });
        }
    }

    return {
        route,
        name: fallbackName,
        definition: fallback,
        inheritsDefault: true,
    };
}

// ---------------------------------------------------------------------------
// Model construction
// ---------------------------------------------------------------------------

export interface ResolveChatModelOptions {
    /** Defaults to `default`. */
    route?: ChatRoute;
    /** Capabilities this request genuinely needs. Missing ones raise a 400. */
    requiredCapabilities?: readonly ChatCapability[];
    reasoningControl?: ReasoningControl;
    /** Ignored unless the model declares temperature support. */
    temperature?: number;
    /** Ignored unless the model declares an output-token cap. */
    maxOutputTokens?: number;
    /** Ignored unless the model declares streaming support. */
    streaming?: boolean;
    timeoutMs?: number;
    config?: ChatModelsConfig;
}

export interface ResolvedChatModel {
    route: ChatRoute;
    /** Configured model name — an operator label, not the wire id. */
    name: string;
    /** The id sent to the endpoint. */
    modelId: string;
    behavior: ChatModelBehavior;
    inheritsDefault: boolean;
    reasoning: AppliedReasoning;
    chat: BaseChatModel;
    /** Apply the model's message rules (currently the system-role policy). */
    prepareMessages(messages: readonly BaseMessageLike[]): BaseMessage[];
}

/**
 * Resolve a route to a ready-to-invoke chat model.
 *
 * Throws {@link ChatRouteUnavailableError} or
 * {@link InvalidReasoningControlError} (both HTTP 400) when the request asks
 * for something the configuration cannot serve.
 */
export function resolveChatModel(options: ResolveChatModelOptions = {}): ResolvedChatModel {
    const config = options.config ?? getChatModelsConfig();
    const route = options.route ?? "default";
    const resolved = resolveChatRoute(route, config);
    const behavior = resolved.definition.behavior;

    const missing = missingCapabilities(behavior, options.requiredCapabilities ?? []);
    if (missing.length > 0) {
        throw new ChatRouteUnavailableError({
            route,
            reason: "missing-capability",
            missingCapabilities: missing,
            message:
                `Model "${resolved.definition.id}" serves the "${route}" route but does not support: ${missing.join(", ")}. ` +
                `Assign a capable model to that route in the chat model configuration.`,
        });
    }

    const reasoning = resolveReasoning(behavior, route, options.reasoningControl);

    return {
        route,
        name: resolved.name,
        modelId: resolved.definition.id,
        behavior,
        inheritsDefault: resolved.inheritsDefault,
        reasoning,
        chat: createOpenAiCompatibleChat({
            endpoint: config.endpoint,
            modelId: resolved.definition.id,
            behavior,
            temperature: options.temperature,
            maxOutputTokens: options.maxOutputTokens,
            streaming: options.streaming,
            timeoutMs: options.timeoutMs,
            requestPatch: reasoning.requestPatch,
        }),
        prepareMessages: messages => applyMessageBehavior(behavior, messages),
    };
}

/**
 * Pick the route for a request from what it needs.
 *
 * Vision wins when both are needed: images can only go to a vision model, so
 * that model must also reason. If it does not, the caller gets a typed 400
 * rather than a silent model swap or a silently dropped reasoning request.
 */
export function selectChatRoute(need: { vision?: boolean; reasoning?: boolean; fast?: boolean }): {
    route: ChatRoute;
    requiredCapabilities: ChatCapability[];
} {
    if (need.vision) {
        return {
            route: "vision",
            requiredCapabilities: need.reasoning ? ["vision", "reasoning"] : ["vision"],
        };
    }
    if (need.reasoning) {
        return { route: "reasoning", requiredCapabilities: ["reasoning"] };
    }
    if (need.fast) return { route: "fast", requiredCapabilities: [] };
    return { route: "default", requiredCapabilities: [] };
}

/** Map a transport failure onto an operator-actionable status and message. */
export function describeChatError(
    error: unknown,
    modelId: string
): { status: number; message: string } | null {
    const config = configSlot.get();
    if (!config) return null;
    return describeChatEndpointError(error, config.endpoint, modelId);
}
