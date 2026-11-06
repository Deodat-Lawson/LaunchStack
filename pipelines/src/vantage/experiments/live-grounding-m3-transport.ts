/** M3 HTTP boundary: every SDK dispatch awaits the shared durable budget. No implicit network fallback. */
import { createHash, randomUUID } from "node:crypto";
import {
    resolveChatModel,
    type ChatModelsConfig,
    type ReasoningControl,
    type ResolvedChatModel,
    createChatModelsConfig,
    buildChatModelsConfig,
} from "@launchstack/llm";
import type {
    M3RequestBudget,
    M3Reservation,
    M3RequestKind,
} from "../evaluation-live/m3-request-budget";
import { z } from "zod";
import { fingerprint } from "../validation/input";
export type M3Mode = "offline" | "live";
export interface M3ModelIdentity {
    configurationId: string;
    wireModelId: string;
    family: string;
    modelConfigHash: string;
    endpointHash: string;
    familyEvidenceHash: string;
    availability: "proposed" | "verified";
    responseModelIds: readonly string[];
}
export interface M3ModelSettings {
    identity: M3ModelIdentity;
    config: ChatModelsConfig;
    reasoningControl?: ReasoningControl;
    maxOutputTokens: number;
    timeoutMs: number;
}
export interface M3OfflineResponse {
    status: number;
    body: unknown;
    headers?: Record<string, string>;
}
export type M3TransportAdapter =
    | {
          kind: "offline-injected";
          respond(request: {
              kind: "generation" | "judge";
              requestId: string;
              body: Record<string, unknown>;
          }): Promise<M3OfflineResponse>;
      }
    | { kind: "offline-loopback-fetch"; fetch: typeof globalThis.fetch }
    | { kind: "live-fetch"; fetch: typeof globalThis.fetch };
export interface M3DispatchTrace {
    kind: "generation" | "judge";
    requestId: string;
    reservation: M3Reservation | null;
    requestBodyHash: string | null;
    promptHash: string | null;
    responseHash: string | null;
    responseModel: string | null;
    httpStatus: number | null;
    state: "not-dispatched" | "responded" | "failed" | "timeout";
    actualExternalDispatches: number;
    injectedDispatches: number;
    requestBody: Record<string, unknown> | null;
    responseBody: unknown;
}
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const hash = /^[a-f0-9]{64}$/;
export function m3EndpointHash(baseUrl: string) {
    const url = new URL(baseUrl);
    if (
        (url.protocol !== "https:" &&
            !(url.protocol === "http:" && url.hostname === "127.0.0.1")) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
    )
        throw new Error("M3 requires an explicit credential-free HTTPS OpenAI-compatible base URL");
    return fingerprint({ protocol: "openai-compatible", baseUrl: url.href.replace(/\/$/, "") });
}
export function m3ModelConfigurationHash(
    settings: Omit<M3ModelSettings, "identity">,
    identity: Pick<
        M3ModelIdentity,
        "configurationId" | "wireModelId" | "family" | "familyEvidenceHash"
    >
) {
    const endpoint = { ...settings.config.endpoint };
    delete endpoint.apiKey;
    const pinnedIdentity = {
        configurationId: identity.configurationId,
        wireModelId: identity.wireModelId,
        family: identity.family,
        familyEvidenceHash: identity.familyEvidenceHash,
    };
    return fingerprint({
        identity: pinnedIdentity,
        config: { ...settings.config, endpoint, models: canonicalModelEntries(settings.config) },
        reasoningControl: settings.reasoningControl ?? null,
        maxOutputTokens: settings.maxOutputTokens,
        timeoutMs: settings.timeoutMs,
    });
}
function canonicalModelEntries(config: ChatModelsConfig) {
    if (!(config.models instanceof Map) || config.models.size === 0)
        throw new Error("M3 model definitions require a nonempty runtime Map");
    return [...config.models.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
const serializedSettingsSchema = z
    .object({
        version: z.literal("vantage-m3-model-settings/v1"),
        identity: z
            .object({
                configurationId: z.string().min(1),
                wireModelId: z.string().min(1),
                family: z.string().min(1),
                modelConfigHash: z.string().regex(/^[a-f0-9]{64}$/),
                endpointHash: z.string().regex(/^[a-f0-9]{64}$/),
                familyEvidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
                availability: z.enum(["proposed", "verified"]),
                responseModelIds: z.array(z.string().min(1)).min(1),
            })
            .strict(),
        config: z
            .object({
                version: z.number().int(),
                endpoint: z.object({ baseUrl: z.string().url() }).strict(),
                models: z.array(z.tuple([z.string().min(1), z.unknown()])).min(1),
                routes: z
                    .object({
                        default: z.string(),
                        fast: z.string().optional(),
                        reasoning: z.string().optional(),
                        vision: z.string().optional(),
                    })
                    .strict(),
            })
            .strict(),
        reasoningControl: z
            .object({
                enabled: z.boolean().optional(),
                effort: z.string().optional(),
                budgetTokens: z.number().int().nonnegative().optional(),
            })
            .strict()
            .optional(),
        maxOutputTokens: z.number().int().positive(),
        timeoutMs: z.number().int().positive().max(60000),
    })
    .strict();
export type SerializedM3ModelSettings = z.infer<typeof serializedSettingsSchema>;
/** Registry-safe explicit wire format. Credentials remain outside the serialized configuration. */
export function serializeM3ModelSettings(settings: M3ModelSettings): SerializedM3ModelSettings {
    assertM3ModelSettings(settings, "offline");
    return serializedSettingsSchema.parse({
        version: "vantage-m3-model-settings/v1",
        identity: settings.identity,
        config: {
            ...settings.config,
            endpoint: { baseUrl: settings.config.endpoint.baseUrl },
            models: canonicalModelEntries(settings.config),
        },
        reasoningControl: settings.reasoningControl,
        maxOutputTokens: settings.maxOutputTokens,
        timeoutMs: settings.timeoutMs,
    });
}
/** Validate through the original model-config parser; never cast JSON directly into runtime Maps. */
export function hydrateM3ModelSettings(raw: unknown, apiKey?: string): M3ModelSettings {
    const value = serializedSettingsSchema.parse(raw);
    const names = value.config.models.map(([name]) => name);
    if (new Set(names).size !== names.length)
        throw new Error("M3 serialized model names must be unique");
    const config = buildChatModelsConfig({
        file: {
            version: value.config.version,
            models: Object.fromEntries(value.config.models),
            routes: value.config.routes,
        },
        endpoint: { ...value.config.endpoint, ...(apiKey ? { apiKey } : {}) },
        sourceLabel: "M3 serialized settings",
    });
    const settings: M3ModelSettings = {
        identity: value.identity,
        config,
        reasoningControl: value.reasoningControl,
        maxOutputTokens: value.maxOutputTokens,
        timeoutMs: value.timeoutMs,
    };
    assertM3ModelSettings(settings, "offline");
    return settings;
}
export function assertM3ModelSettings(settings: M3ModelSettings, mode: M3Mode) {
    const identity = settings.identity;
    for (const value of [
        identity.modelConfigHash,
        identity.endpointHash,
        identity.familyEvidenceHash,
    ])
        if (!hash.test(value)) throw new Error("M3 model identity hashes are required");
    if (
        !identity.configurationId ||
        !identity.wireModelId ||
        !identity.family ||
        !identity.responseModelIds.length
    )
        throw new Error("M3 model identity is incomplete");
    if (identity.endpointHash !== m3EndpointHash(settings.config.endpoint.baseUrl))
        throw new Error("M3 endpoint hash mismatch");
    if (identity.modelConfigHash !== m3ModelConfigurationHash(settings, identity))
        throw new Error("M3 model configuration hash mismatch");
    if (mode === "live" && new URL(settings.config.endpoint.baseUrl).protocol !== "https:")
        throw new Error("M3 live transport requires HTTPS");
    if (mode === "live" && identity.availability !== "verified")
        throw new Error("M3 live model/endpoint identity is only proposed, not verified");
}
export function bindM3Attempt(options: {
    kind: "generation" | "judge";
    mode: M3Mode;
    settings: M3ModelSettings;
    adapter: M3TransportAdapter;
    budget: M3RequestBudget;
    planHash: string;
    configHash: string;
    inputHash: string;
    dependsOn?: { requestId: string; responseHash: string };
    inspectRequest?: (body: Record<string, unknown>) => void;
}): { model: ResolvedChatModel; trace: M3DispatchTrace } {
    assertM3ModelSettings(options.settings, options.mode);
    if ((options.mode === "offline") !== (options.adapter.kind !== "live-fetch"))
        throw new Error("M3 mode and transport adapter differ");
    if (
        options.adapter.kind === "offline-loopback-fetch" &&
        new URL(options.settings.config.endpoint.baseUrl).hostname !== "127.0.0.1"
    )
        throw new Error("M3 offline HTTP transport must remain loopback");
    const requestId = randomUUID(),
        identity = options.settings.identity;
    const trace: M3DispatchTrace = {
        kind: options.kind,
        requestId,
        reservation: null,
        requestBodyHash: null,
        promptHash: null,
        responseHash: null,
        responseModel: null,
        httpStatus: null,
        state: "not-dispatched",
        actualExternalDispatches: 0,
        injectedDispatches: 0,
        requestBody: null,
        responseBody: null,
    };
    const expectedUrl = new URL(
        "chat/completions",
        options.settings.config.endpoint.baseUrl.replace(/\/?$/, "/")
    ).href;
    let attempted = false;
    const fetch: typeof globalThis.fetch = async (input, init) => {
        if (attempted)
            throw new Error("M3 forbids a hidden SDK retry or second fetch for one attempt");
        attempted = true;
        const actualUrl =
            typeof input === "string" || input instanceof URL ? new URL(input).href : null;
        if (
            actualUrl !== expectedUrl ||
            init?.method?.toUpperCase() !== "POST" ||
            typeof init.body !== "string"
        )
            throw new Error("M3 request endpoint/method/body mismatch");
        const body = JSON.parse(init.body) as Record<string, unknown>;
        if (
            body.model !== identity.wireModelId ||
            body.stream === true ||
            !Array.isArray(body.messages) ||
            !body.messages.length
        )
            throw new Error("M3 wire model/messages/stream mismatch");
        options.inspectRequest?.(body);
        trace.requestBodyHash = sha(init.body);
        trace.promptHash = sha(JSON.stringify(body.messages));
        trace.requestBody = structuredClone(body);
        trace.reservation = await options.budget.beforeDispatch({
            requestId,
            kind: options.kind as M3RequestKind,
            purpose: "initial",
            planHash: options.planHash,
            configHash: options.configHash,
            inputHash: options.inputHash,
            modelConfigHash: identity.modelConfigHash,
            endpointHash: identity.endpointHash,
            wireModelId: identity.wireModelId,
            promptHash: trace.promptHash,
            requestBodyHash: trace.requestBodyHash,
            ...(options.dependsOn ? { dependsOn: options.dependsOn } : {}),
        });
        if (
            trace.reservation.mode !== options.mode ||
            trace.reservation.planHash !== options.planHash ||
            trace.reservation.requestId !== requestId
        )
            throw new Error("M3 durable reservation identity mismatch");
        let response: Response;
        try {
            if (options.adapter.kind === "offline-injected") {
                trace.injectedDispatches++;
                const fixture = await options.adapter.respond({
                    kind: options.kind,
                    requestId,
                    body: structuredClone(body),
                });
                response = new Response(JSON.stringify(fixture.body), {
                    status: fixture.status,
                    headers: { "content-type": "application/json", ...fixture.headers },
                });
            } else {
                if (options.adapter.kind === "offline-loopback-fetch") trace.injectedDispatches++;
                else trace.actualExternalDispatches++;
                response = await options.adapter.fetch(input, { ...init, redirect: "manual" });
            }
        } catch {
            trace.state = init.signal?.aborted ? "timeout" : "failed";
            await options.budget.completion({ requestId, status: trace.state });
            throw new Error("M3 provider transport failed");
        }
        let raw: string;
        try {
            raw = await response.text();
        } catch {
            trace.state = init.signal?.aborted ? "timeout" : "failed";
            await options.budget.completion({
                requestId,
                status: trace.state,
                httpStatus: response.status,
            });
            throw new Error("M3 response body capture failed");
        }
        if (Buffer.byteLength(raw) > 128000) {
            trace.state = "failed";
            await options.budget.completion({
                requestId,
                status: "failed",
                httpStatus: response.status,
            });
            throw new Error("M3 provider wire response exceeds its bound");
        }
        trace.httpStatus = response.status;
        trace.responseHash = sha(raw);
        const secret = options.settings.config.endpoint.apiKey;
        if (secret && raw.includes(secret)) {
            trace.state = "failed";
            trace.responseBody = { error: "provider-secret-echo-rejected" };
            await options.budget.completion({
                requestId,
                status: "failed",
                httpStatus: response.status,
                responseHash: trace.responseHash,
            });
            throw new Error("M3 provider response contained a credential echo");
        }
        let parsedBody: unknown;
        try {
            parsedBody = JSON.parse(raw);
        } catch {
            parsedBody = null;
        }
        // Failed provider payloads may contain echoed credentials; retain only their hash/status.
        trace.responseBody = response.ok
            ? parsedBody
            : { error: "provider-http-failure", httpStatus: response.status };
        const parsed = trace.responseBody as { model?: unknown } | null;
        trace.responseModel = typeof parsed?.model === "string" ? parsed.model : null;
        trace.state = response.ok ? "responded" : "failed";
        await options.budget.completion({
            requestId,
            status: trace.state,
            httpStatus: response.status,
            responseHash: trace.responseHash,
        });
        if (!response.ok) throw new Error("M3 provider HTTP request failed");
        if (
            response.ok &&
            (!trace.responseModel || !identity.responseModelIds.includes(trace.responseModel))
        )
            throw new Error("M3 provider response model is not in the reviewed identity set");
        return new Response(raw, { status: response.status, headers: response.headers });
    };
    const model = resolveChatModel({
        config: options.settings.config,
        route: "default",
        reasoningControl: options.settings.reasoningControl,
        maxOutputTokens: options.settings.maxOutputTokens,
        timeoutMs: options.settings.timeoutMs,
        streaming: false,
        fetch,
    });
    if (
        model.modelId !== identity.wireModelId ||
        model.behavior.parameters.maxOutputTokens !== "supported"
    )
        throw new Error(
            "M3 resolved model identity/output cap differs from the reviewed configuration"
        );
    return { model, trace };
}

export function createM3OfflineModelSettings(input: {
    baseUrl: string;
    kind: "generation" | "judge";
    yaml: string;
}): M3ModelSettings {
    const generation = input.kind === "generation";
    const configurationId = generation
        ? "m3-proposed-google-generation/v1"
        : "m3-proposed-openai-judge/v1";
    const wireModelId = generation ? "google/gemini-3.7-flash" : "gpt-6-luna";
    const family = generation ? "google-gemini" : "openai-gpt6";
    const config = createChatModelsConfig({
        yaml: input.yaml,
        endpoint: { baseUrl: input.baseUrl, apiKey: "m3-offline-no-provider-key" },
        sourceLabel: generation
            ? "apps/web/config/chat-models.yaml"
            : "apps/web/config/chat-models.vantage-demo.azure.yaml",
    });
    const settings = {
        config,
        reasoningControl: { enabled: true, effort: generation ? "none" : "medium" },
        maxOutputTokens: generation ? 2400 : 4096,
        timeoutMs: 20000,
    };
    const baseIdentity = {
        configurationId,
        wireModelId,
        family,
        familyEvidenceHash: fingerprint({
            configurationId,
            wireModelId,
            family,
            localYamlHash: sha(input.yaml),
            status: "proposed-not-provider-verified",
        }),
    };
    return {
        ...settings,
        identity: {
            ...baseIdentity,
            modelConfigHash: m3ModelConfigurationHash(settings, baseIdentity),
            endpointHash: m3EndpointHash(input.baseUrl),
            availability: "proposed",
            responseModelIds: [wireModelId],
        },
    };
}
