/**
 * Talking to a candidate endpoint before it is saved: list what it serves,
 * and send each chosen model one tiny message through the same transport real
 * chat uses. A key that works for `/models` but not for chat, or a model id
 * the endpoint doesn't serve, shows up here rather than in someone's Ask.
 */

import { HumanMessage } from "@langchain/core/messages";
import {
    ChatConfigurationError,
    describeChatEndpointError,
    modelContentToText,
    resolveChatModel,
} from "@launchstack/llm";

import type { WorkspaceModelSelection } from "~/server/db/schema/workspace-models";
import { fetchPublicUrl } from "~/server/security/url-guard";

import { WORKSPACE_MODEL_ROUTES, buildWorkspaceChatModelsConfig } from "./config";
import { allowsPrivateModelEndpoints } from "./endpoint-url";

const LIST_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 45_000;
const MAX_LISTED_MODELS = 1000;

export interface EndpointCandidate {
    /** Normalized and already checked against the address policy. */
    baseUrl: string;
    apiKey: string | null;
}

export class EndpointProbeError extends Error {
    constructor(
        message: string,
        readonly status = 502
    ) {
        super(message);
        this.name = "EndpointProbeError";
    }
}

/**
 * Model ids the endpoint lists at `GET {baseUrl}/models`, sorted. Google's
 * compatibility layer prefixes ids with `models/` but takes them bare in chat,
 * so the prefix is dropped.
 */
export async function listEndpointModels(candidate: EndpointCandidate): Promise<string[]> {
    const url = `${candidate.baseUrl}/models`;
    const init: RequestInit = {
        headers: {
            accept: "application/json",
            ...(candidate.apiKey ? { authorization: `Bearer ${candidate.apiKey}` } : {}),
        },
        signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    };

    let response: Response;
    try {
        response = allowsPrivateModelEndpoints()
            ? await fetch(url, { ...init, redirect: "error" })
            : await fetchPublicUrl(url, init);
    } catch (error) {
        console.warn(
            `[workspace-models] listing models at ${candidate.baseUrl} failed:`,
            error instanceof Error ? error.message : error
        );
        throw new EndpointProbeError(
            "Couldn't reach that address. Check it, or type the model id yourself."
        );
    }

    if (response.status === 401 || response.status === 403) {
        throw new EndpointProbeError("The endpoint rejected the API key.", 401);
    }
    if (!response.ok) {
        throw new EndpointProbeError(
            `The endpoint doesn't list its models (HTTP ${response.status}). Type the model id yourself.`
        );
    }

    const body = (await response.json().catch(() => null)) as {
        data?: Array<{ id?: unknown }>;
    } | null;
    const ids = (body?.data ?? [])
        .map(entry => (typeof entry?.id === "string" ? entry.id.replace(/^models\//, "") : null))
        .filter((id): id is string => Boolean(id));
    return Array.from(new Set(ids))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, MAX_LISTED_MODELS);
}

export interface ModelTestResult {
    route: (typeof WORKSPACE_MODEL_ROUTES)[number];
    modelId: string;
    ok: boolean;
    latencyMs: number;
    /** Why it failed, worded for an admin. */
    message?: string;
}

/**
 * Send each distinct chosen model "Reply with OK." and report per route.
 * Never throws for an endpoint failure — the admin needs the per-model
 * answer — only for a selection that can't be built at all.
 */
export async function testEndpoint(
    candidate: EndpointCandidate,
    selection: WorkspaceModelSelection
): Promise<ModelTestResult[]> {
    const config = buildWorkspaceChatModelsConfig({
        baseUrl: candidate.baseUrl,
        apiKey: candidate.apiKey,
        selection,
    });

    const results: ModelTestResult[] = [];
    const tested = new Map<string, Omit<ModelTestResult, "route">>();

    for (const route of WORKSPACE_MODEL_ROUTES) {
        const choice = selection[route];
        if (!choice) continue;
        const modelId = choice.id.trim();
        const previous = tested.get(modelId);
        if (previous) {
            results.push({ route, ...previous });
            continue;
        }

        const started = Date.now();
        let outcome: Omit<ModelTestResult, "route">;
        try {
            // One attempt: the admin is waiting, and a retry would only repeat
            // what the first attempt already showed.
            const resolved = resolveChatModel({
                config,
                route,
                timeoutMs: TEST_TIMEOUT_MS,
                maxRetries: 0,
            });
            const reply = await resolved.chat.invoke(
                resolved.prepareMessages([new HumanMessage("Reply with the single word OK.")])
            );
            const text = modelContentToText(reply.content).trim();
            outcome = text
                ? { modelId, ok: true, latencyMs: Date.now() - started }
                : {
                      modelId,
                      ok: false,
                      latencyMs: Date.now() - started,
                      message: "The model answered with nothing. Check that it is a chat model.",
                  };
        } catch (error) {
            const described =
                error instanceof ChatConfigurationError
                    ? { message: error.message }
                    : describeChatEndpointError(error, config.endpoint, modelId);
            if (!described) {
                console.warn(
                    `[workspace-models] test of ${modelId} at ${candidate.baseUrl} failed:`,
                    error instanceof Error ? error.message : error
                );
            }
            outcome = {
                modelId,
                ok: false,
                latencyMs: Date.now() - started,
                // The admin is already in Settings; "fix it in Settings" is noise here.
                message:
                    described?.message.replace(
                        /\s*A workspace admin can fix it in Settings › Models\.$/,
                        ""
                    ) ??
                    "The endpoint returned an error for this model. Check the model id and that the key can use it.",
            };
        }
        tested.set(modelId, outcome);
        results.push({ route, ...outcome });
    }
    return results;
}
