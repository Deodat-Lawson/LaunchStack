/**
 * Turning a workspace's saved model choices into a chat configuration.
 *
 * Pure: no database, no network, no environment. The scope loader feeds it a
 * decrypted row; tests feed it literals.
 *
 * Behavior is what the admin declared, never inferred from the model id — the
 * same rule the deployment's configuration file follows (see the header of
 * `packages/llm/src/presets.ts`). The admin says whether a model reads images
 * and whether it reasons; everything else is the most conservative contract
 * every OpenAI-compatible server accepts, because nobody has verified more:
 *
 * - no `temperature` (Claude's compatibility layer and reasoning models reject
 *   values the app sends),
 * - no output-token cap (OpenAI's reasoning models reject `max_tokens`, and a
 *   cap that counts reasoning tokens can leave an answer empty),
 * - structured output by prompting rather than a `response_format` the server
 *   may ignore.
 */

import {
    ChatConfigurationError,
    buildChatModelsConfig,
    type ChatModelsConfig,
    type ChatRoute,
} from "@launchstack/llm";

import type {
    WorkspaceModelChoice,
    WorkspaceModelSelection,
} from "~/server/db/schema/workspace-models";

/** The routes a workspace can assign, in the order Settings lists them. */
export const WORKSPACE_MODEL_ROUTES = ["default", "fast", "reasoning", "vision"] as const;

/** Model ids are opaque to us, but an id with whitespace or a 300-char paste is a typo. */
const MODEL_ID_PATTERN = /^[^\s]{1,200}$/;

export function isPlausibleModelId(id: string): boolean {
    return MODEL_ID_PATTERN.test(id);
}

/** The declared behavior for one model, from the admin's two answers. */
export function behaviorForChoice(choice: WorkspaceModelChoice) {
    return {
        input: choice.vision ? (["text", "image"] as const) : (["text"] as const),
        reasoning: choice.reasoning ? { mode: "always" as const } : { mode: "none" as const },
        nativeStructuredOutput: [] as const,
        parameters: {
            temperature: "unsupported" as const,
            systemMessages: "supported" as const,
            streaming: "supported" as const,
            maxOutputTokens: "unsupported" as const,
        },
    };
}

/** The configuration-file document a selection stands for. */
export function workspaceModelsFile(selection: WorkspaceModelSelection) {
    const models: Record<string, { id: string; behavior: ReturnType<typeof behaviorForChoice> }> =
        {};
    const routes: Partial<Record<ChatRoute, string>> = {};
    for (const route of WORKSPACE_MODEL_ROUTES) {
        const choice = selection[route];
        if (!choice) continue;
        models[route] = { id: choice.id.trim(), behavior: behaviorForChoice(choice) };
        routes[route] = route;
    }
    return { version: 1, models, routes };
}

/**
 * Check a selection before it is saved, so a bad one is refused in Settings
 * rather than discovered by the next person who asks a question. Returns the
 * first problem in words an admin can act on, or null.
 */
export function selectionProblem(selection: WorkspaceModelSelection): string | null {
    for (const route of WORKSPACE_MODEL_ROUTES) {
        const choice = selection[route];
        if (!choice) continue;
        if (!isPlausibleModelId(choice.id.trim())) {
            return `"${choice.id}" doesn't look like a model id. Copy it exactly as your provider lists it.`;
        }
    }
    if (selection.vision && !selection.vision.vision) {
        return "The model for images has to be one that reads images.";
    }
    if (selection.reasoning && !selection.reasoning.reasoning) {
        return "The model for reasoning has to be one that reasons.";
    }
    return null;
}

export interface WorkspaceEndpointInput {
    baseUrl: string;
    apiKey?: string | null;
    selection: WorkspaceModelSelection;
}

/**
 * Build the chat configuration a workspace's work resolves against. Throws
 * {@link ChatConfigurationError} when the selection cannot serve the routes it
 * claims to.
 */
export function buildWorkspaceChatModelsConfig(input: WorkspaceEndpointInput): ChatModelsConfig {
    const problem = selectionProblem(input.selection);
    if (problem) throw new ChatConfigurationError(problem);
    return buildChatModelsConfig({
        file: workspaceModelsFile(input.selection),
        endpoint: {
            baseUrl: input.baseUrl,
            ...(input.apiKey ? { apiKey: input.apiKey } : {}),
            owner: "workspace",
        },
        sourceLabel: "Your workspace's model settings",
    });
}
