/**
 * The single OpenAI-compatible chat transport.
 *
 * Every route in the deployment reaches its model through here, which is why
 * this is the only module allowed to import a provider SDK. "Any endpoint"
 * means any server implementing the OpenAI `/chat/completions` protocol — not
 * an arbitrary HTTP API.
 *
 * The request body is assembled from the model's declared behavior alone.
 * Fields the model marks unsupported are omitted entirely rather than sent
 * with a neutral value: endpoints commonly reject the presence of a field,
 * not just a bad value for it.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import {
    DEFAULT_MAX_OUTPUT_TOKENS_FIELD,
    type ChatEndpointConfig,
    type ChatModelBehavior,
    type ChatRequestPatch,
} from "./types";

/**
 * Sent when the endpoint needs no credential. An explicit placeholder stops
 * the OpenAI SDK from quietly falling back to `OPENAI_API_KEY` in the
 * process environment and pointing someone else's key at this endpoint.
 */
export const KEYLESS_PLACEHOLDER_API_KEY = "launchstack-no-key";

const DEFAULT_TIMEOUT_MS = 600_000;

export interface CreateCompatibleChatOptions {
    endpoint: ChatEndpointConfig;
    modelId: string;
    behavior: ChatModelBehavior;
    /** Applied only when the model declares temperature support. */
    temperature?: number;
    /** Applied only when the model declares an output-token cap. */
    maxOutputTokens?: number;
    /** Applied only when the model declares streaming support. */
    streaming?: boolean;
    timeoutMs?: number;
    /** Operator-declared reasoning fields, already resolved for this request. */
    requestPatch?: ChatRequestPatch;
}

/**
 * Extra body fields for this request: the resolved reasoning patch plus the
 * output-token cap when it needs a non-default field name.
 */
export function buildModelKwargs(
    options: Pick<CreateCompatibleChatOptions, "behavior" | "maxOutputTokens" | "requestPatch">
): Record<string, unknown> {
    const { behavior, maxOutputTokens, requestPatch } = options;
    const kwargs: Record<string, unknown> = { ...(requestPatch ?? {}) };

    const field = behavior.parameters.maxOutputTokensField ?? DEFAULT_MAX_OUTPUT_TOKENS_FIELD;
    if (
        behavior.parameters.maxOutputTokens === "supported" &&
        typeof maxOutputTokens === "number" &&
        field !== DEFAULT_MAX_OUTPUT_TOKENS_FIELD
    ) {
        kwargs[field] = maxOutputTokens;
    }
    return kwargs;
}

export function createOpenAiCompatibleChat(options: CreateCompatibleChatOptions): BaseChatModel {
    const { endpoint, modelId, behavior } = options;
    const { parameters } = behavior;

    const acceptsCap = parameters.maxOutputTokens === "supported";
    const capField = parameters.maxOutputTokensField ?? DEFAULT_MAX_OUTPUT_TOKENS_FIELD;
    const usesDefaultCapField = capField === DEFAULT_MAX_OUTPUT_TOKENS_FIELD;
    const modelKwargs = buildModelKwargs(options);

    return new ChatOpenAI({
        apiKey: endpoint.apiKey ?? KEYLESS_PLACEHOLDER_API_KEY,
        modelName: modelId,
        configuration: { baseURL: endpoint.baseUrl },
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ...(parameters.temperature === "supported" && typeof options.temperature === "number"
            ? { temperature: options.temperature }
            : {}),
        ...(acceptsCap && usesDefaultCapField && typeof options.maxOutputTokens === "number"
            ? { maxTokens: options.maxOutputTokens }
            : {}),
        ...(parameters.streaming === "supported" && options.streaming !== undefined
            ? { streaming: options.streaming }
            : {}),
        ...(Object.keys(modelKwargs).length > 0 ? { modelKwargs } : {}),
    });
}

/**
 * Translate transport failures into operator-actionable messages. Kept here
 * because the wording depends on how this transport authenticates.
 */
export function describeChatEndpointError(
    error: unknown,
    endpoint: ChatEndpointConfig,
    modelId: string
): { status: number; message: string } | null {
    if (!(error instanceof Error)) return null;
    const message = error.message.toLowerCase();

    if (
        message.includes("401") ||
        message.includes("403") ||
        message.includes("authentication") ||
        message.includes("invalid api key") ||
        message.includes("no auth credentials") ||
        message.includes("unauthorized")
    ) {
        return {
            status: 401,
            message: endpoint.apiKey
                ? "The chat endpoint rejected CHAT_API_KEY. Check the credential configured for CHAT_BASE_URL."
                : "The chat endpoint requires a credential. Set CHAT_API_KEY for CHAT_BASE_URL.",
        };
    }

    if (
        message.includes("fetch failed") ||
        message.includes("econnrefused") ||
        message.includes("enotfound") ||
        message.includes("socket hang up") ||
        message.includes("timeout")
    ) {
        return {
            status: 502,
            message: `Unable to reach the chat endpoint at ${endpoint.baseUrl}. Confirm the server is running and CHAT_BASE_URL is correct.`,
        };
    }

    if (
        message.includes("model_not_found") ||
        message.includes("does not exist") ||
        message.includes("unknown model") ||
        message.includes("no such model")
    ) {
        return {
            status: 400,
            message: `The chat endpoint does not serve model "${modelId}". Update the model id in the chat model configuration.`,
        };
    }

    return null;
}
