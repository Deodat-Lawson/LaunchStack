/**
 * Models for the AI that runs while a document is ingested: table summaries
 * (OCR chunker), page image descriptions (VLM enrichment) and entity
 * extraction (opt-in NER).
 *
 * The deployment configures these apart from chat (`configureAuxiliaryOpenAI`,
 * `NER_API_*`), and that stays the default. But a workspace that brought its
 * own model endpoint sent its documents' text and page images to the server's
 * provider all the same, because these calls never read the chat scope. Now
 * they do: inside a workspace's scope (`runWithChatModelsScope`), each task
 * asks for one of the workspace's routes — `vision` for page images, `fast`
 * for the text tasks — and goes to the workspace's endpoint.
 *
 * Fails closed, like chat. A workspace whose endpoint can't be used, or that
 * has no model reading images, gets no table summary, image description or
 * entities — the document still indexes, with the plain fallbacks — and never
 * the deployment's provider in its place.
 */

import type OpenAI from "openai";

import { resolveChatRoute } from "./chat-model-factory";
import { getChatModelsScope } from "./chat-scope";
import { createOpenAiCompatibleClient } from "./openai-compatible-transport";
import {
    ChatConfigurationError,
    ChatRequestError,
    DEFAULT_MAX_OUTPUT_TOKENS_FIELD,
    missingCapabilities,
    type ChatModelBehavior,
    type ChatModelDefinition,
} from "./types";

/** The routes ingestion uses: images need a model that reads them; text needs a cheap one. */
export type AuxiliaryRoute = "fast" | "vision";

export interface AuxiliaryModel {
    owner: "deployment" | "workspace";
    client: OpenAI;
    /** Sent verbatim as `model`. */
    modelId: string;
    /**
     * What the model declared. Present for a workspace's model, whose request
     * may carry only declared fields; the deployment's auxiliary settings
     * carry none and keep sending what they always sent.
     */
    behavior?: ChatModelBehavior;
}

export type AuxiliaryModelResolution =
    /** No workspace model in scope: the deployment's own auxiliary settings apply. */
    | { owner: "deployment" }
    /** The workspace's endpoint, with the model it assigned to the route. */
    | { owner: "workspace"; model: AuxiliaryModel }
    /** The workspace brought its own model, but not one this task can use. Skip the task. */
    | { owner: "workspace"; model: null; reason: string };

/**
 * Ingestion runs dozens of these per document. Retries beyond one would turn
 * a refusing address into minutes per upload, and every caller already has a
 * fallback for a failed call.
 */
const INGESTION_MAX_RETRIES = 1;
const INGESTION_TIMEOUT_MS = 120_000;

/** Which model an ingestion task here should use. Never throws for a workspace's setup. */
export function resolveAuxiliaryModel(route: AuxiliaryRoute): AuxiliaryModelResolution {
    const scope = getChatModelsScope();
    if (!scope || scope.source === "deployment") return { owner: "deployment" };
    if (scope.error) return { owner: "workspace", model: null, reason: scope.error.message };
    if (!scope.config) {
        return { owner: "workspace", model: null, reason: "the workspace has no model set up." };
    }

    let definition: ChatModelDefinition;
    try {
        definition = resolveChatRoute(route, scope.config).definition;
    } catch (error) {
        // No model serves the route (a 400), or the saved setup is broken.
        if (error instanceof ChatRequestError || error instanceof ChatConfigurationError) {
            return { owner: "workspace", model: null, reason: error.message };
        }
        throw error;
    }
    if (route === "vision" && missingCapabilities(definition.behavior, ["vision"]).length > 0) {
        return {
            owner: "workspace",
            model: null,
            reason: "the workspace's model for images doesn't read images.",
        };
    }

    // Ingestion output is stored text, not an answer to a person, so the
    // assistant identity rule chat carries is left off — as it is for the
    // deployment's auxiliary client.
    const endpoint = { ...scope.config.endpoint, systemInstructions: undefined };
    return {
        owner: "workspace",
        model: {
            owner: "workspace",
            client: createOpenAiCompatibleClient({
                endpoint,
                behavior: definition.behavior,
                timeoutMs: INGESTION_TIMEOUT_MS,
                maxRetries: INGESTION_MAX_RETRIES,
                usage: { route, modelId: definition.id, pricing: definition.pricing },
            }),
            modelId: definition.id,
            behavior: definition.behavior,
        },
    };
}

export interface AuxiliaryRequestWishes {
    temperature?: number;
    maxTokens?: number;
    /** Ask for a JSON object (`response_format: json_object`). */
    json?: boolean;
}

export interface AuxiliaryRequestFields {
    temperature?: number;
    max_tokens?: number;
    max_completion_tokens?: number;
    response_format?: { type: "json_object" };
}

/**
 * The optional request fields a call may send to `model`. The deployment's
 * auxiliary models get every wish, as before. A workspace's model gets only
 * what it declared: endpoints reject a field's presence, not just its value
 * (Claude's compatibility layer refuses some temperatures; OpenAI's reasoning
 * models refuse `max_tokens`). JSON mode rides on the admin's "follows a JSON
 * schema"; without it the prompt asks for JSON and the caller parses leniently.
 */
export function auxiliaryRequestFields(
    model: AuxiliaryModel,
    wishes: AuxiliaryRequestWishes
): AuxiliaryRequestFields {
    const { behavior } = model;
    if (!behavior) {
        return {
            ...(wishes.temperature !== undefined ? { temperature: wishes.temperature } : {}),
            ...(wishes.maxTokens !== undefined ? { max_tokens: wishes.maxTokens } : {}),
            ...(wishes.json ? { response_format: { type: "json_object" as const } } : {}),
        };
    }

    const fields: AuxiliaryRequestFields = {};
    const { parameters } = behavior;
    if (wishes.temperature !== undefined && parameters.temperature === "supported") {
        fields.temperature = wishes.temperature;
    }
    if (wishes.maxTokens !== undefined && parameters.maxOutputTokens === "supported") {
        const field = parameters.maxOutputTokensField ?? DEFAULT_MAX_OUTPUT_TOKENS_FIELD;
        if (field === "max_completion_tokens") fields.max_completion_tokens = wishes.maxTokens;
        else if (field === DEFAULT_MAX_OUTPUT_TOKENS_FIELD) fields.max_tokens = wishes.maxTokens;
    }
    if (wishes.json && behavior.nativeStructuredOutput.includes("json-schema")) {
        fields.response_format = { type: "json_object" };
    }
    return fields;
}
