import { createHash } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
    dispatchWithLedger,
    type ModelRequestMetadata,
    type ModelRequestReceipt,
} from "./request-ledger";

export interface MeteredFetchOptions {
    ledgerDirectory: string;
    metadata: ModelRequestMetadata;
    expectedUrl: string;
    expectedModelId: string;
    requestPath: string;
    responsePath: string;
    expectedRequestHash?: string;
    sanitize(this: void, text: string): string;
    fetchImpl: typeof globalThis.fetch;
}
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
function reject(message: string): never {
    throw new Error(`Metered transport: ${message}`);
}
const isObject = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);
function numeric(value: unknown): number | undefined {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
        ? value
        : undefined;
}
function tokenUsage(body: unknown): ModelRequestReceipt["usage"] {
    if (!isObject(body) || !isObject(body.usage)) return null;
    const usage = body.usage;
    const completion = isObject(usage.completion_tokens_details)
        ? usage.completion_tokens_details
        : {};
    const prompt = isObject(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
    const result = {
        inputTokens: numeric(usage.prompt_tokens ?? usage.input_tokens),
        outputTokens: numeric(usage.completion_tokens ?? usage.output_tokens),
        totalTokens: numeric(usage.total_tokens),
        reasoningTokens: numeric(completion.reasoning_tokens),
        cachedInputTokens: numeric(prompt.cached_tokens),
    };
    return Object.values(result).some(value => value !== undefined) ? result : null;
}

/** One instance permits exactly one attempted fetch. It performs no retries.
 * Install at the SDK's actual HTTP boundary; do not wrap an SDK invoke that may
 * make multiple requests. SDK retries must also be disabled. HTTP redirects
 * are forced manual so they cannot hide additional unmetered network requests.
 */
export function createMeteredFetch(options: MeteredFetchOptions): typeof globalThis.fetch {
    const metadata = structuredClone(options.metadata);
    const expectedModelId = options.expectedModelId;
    const expectedRequestHash = options.expectedRequestHash;
    const ledgerDirectory = options.ledgerDirectory;
    const sanitizeProvided = options.sanitize;
    const fetchImpl = options.fetchImpl;
    let endpoint: URL;
    try {
        endpoint = new URL(options.expectedUrl);
    } catch {
        return reject("approved endpoint is invalid");
    }
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash)
        reject("approved endpoint must be an explicit HTTPS URL");
    if (!expectedModelId || expectedModelId.length > 300)
        reject("approved model identity is missing");
    if (expectedRequestHash && !/^[a-f0-9]{64}$/.test(expectedRequestHash))
        reject("frozen request hash is invalid");
    const requestPath = resolve(options.requestPath),
        responsePath = resolve(options.responsePath);
    if (requestPath.toLowerCase() === responsePath.toLowerCase())
        reject("request and response artifacts must be separate new files");
    const sanitize = (value: string) => {
        let text: string;
        try {
            text = sanitizeProvided(value);
        } catch {
            return reject("artifact sanitization failed");
        }
        if (typeof text !== "string") reject("artifact sanitization failed");
        return text
            .split(endpoint.href)
            .join("[approved-endpoint]")
            .split(endpoint.origin)
            .join("[approved-endpoint]")
            .split(endpoint.host)
            .join("[approved-endpoint]");
    };
    let attempted = false;
    return async (input, init) => {
        if (attempted) reject("one intent cannot perform an automatic retry or a second fetch");
        attempted = true;
        let supplied: URL;
        try {
            if (typeof input !== "string" && !(input instanceof URL))
                reject("request must use an explicit URL and string body");
            supplied = new URL(input);
        } catch {
            return reject("request URL is not the approved endpoint");
        }
        if (supplied.href !== endpoint.href) reject("request URL is not the approved endpoint");
        if (init?.method?.toUpperCase() !== "POST" || typeof init.body !== "string")
            reject("only an explicit POST with a string JSON body is permitted");
        const rawRequest = init.body;
        let request: unknown;
        try {
            request = JSON.parse(rawRequest);
        } catch {
            return reject("request body is not JSON");
        }
        if (!isObject(request) || request.model !== expectedModelId)
            reject("request model is not the approved model");
        if (!Array.isArray(request.messages) || !request.messages.length)
            reject("request has no frozen messages");
        const promptHash = sha256(JSON.stringify(request.messages));
        const requestBodyHash = sha256(rawRequest);
        if (promptHash !== metadata.promptHash)
            reject("actual messages differ from the frozen prompt hash");
        if (expectedRequestHash && requestBodyHash !== expectedRequestHash)
            reject("actual request differs from the frozen request hash");
        // Headers and URL are deliberately never serialized. Sanitization runs
        // before any artifact write or provider dispatch.
        const requestArtifact =
            JSON.stringify(
                {
                    capturedAt: new Date().toISOString(),
                    requestBodyHash,
                    promptHash,
                    body: sanitize(rawRequest),
                },
                null,
                2
            ) + "\n";
        let requestFile: FileHandle | undefined, responseFile: FileHandle | undefined;
        let responseWriteAttempted = false,
            captureFailed = false;
        const writeResponse = async (value: unknown) => {
            if (!responseFile || responseWriteAttempted) {
                captureFailed = true;
                return;
            }
            responseWriteAttempted = true;
            try {
                await responseFile.writeFile(JSON.stringify(value, null, 2) + "\n", "utf8");
                await responseFile.sync();
            } catch {
                captureFailed = true;
            }
        };
        try {
            try {
                await mkdir(dirname(requestPath), { recursive: true });
                await mkdir(dirname(responsePath), { recursive: true });
                requestFile = await open(requestPath, "wx", 0o600);
                responseFile = await open(responsePath, "wx", 0o600);
                await requestFile.writeFile(requestArtifact, "utf8");
                await requestFile.sync();
                await requestFile.close();
                requestFile = undefined;
            } catch {
                return reject("new artifact files could not be reserved; no request sent");
            }
            const value = await dispatchWithLedger(ledgerDirectory, metadata, async () => {
                const started = performance.now();
                let response: Response;
                try {
                    response = await fetchImpl(input, { ...init, redirect: "manual" });
                } catch {
                    await writeResponse({
                        capturedAt: new Date().toISOString(),
                        elapsedMs: performance.now() - started,
                        httpStatus: null,
                        providerRequestId: null,
                        responseModel: null,
                        usage: null,
                        costUsd: null,
                        costBasis: null,
                        body: null,
                        captureError: "transport-error",
                    });
                    return reject("provider HTTP request failed; slot remains consumed");
                }
                let text: string | null = null,
                    captureError: string | null = null;
                try {
                    text = await response.clone().text();
                } catch {
                    captureError = "response-body-unavailable";
                    captureFailed = true;
                }
                let parsed: unknown;
                try {
                    parsed = text === null ? undefined : JSON.parse(text);
                } catch {
                    parsed = undefined;
                }
                const usage = tokenUsage(parsed);
                const id = ["x-request-id", "apim-request-id", "x-ms-request-id", "request-id"]
                    .map(header => response.headers.get(header))
                    .find(value => value !== null);
                const safeId = id ? sanitize(id) : undefined;
                const rawModel =
                    isObject(parsed) && typeof parsed.model === "string" ? parsed.model : undefined;
                const safeModel = rawModel ? sanitize(rawModel) : undefined;
                const receipt: ModelRequestReceipt = {
                    httpStatus: response.status,
                    ...(safeId && safeId.length <= 300 ? { providerRequestId: safeId } : {}),
                    ...(safeModel && safeModel.length <= 300 ? { responseModel: safeModel } : {}),
                    usage,
                    costUsd: null,
                    costBasis: null,
                };
                await writeResponse({
                    capturedAt: new Date().toISOString(),
                    elapsedMs: performance.now() - started,
                    httpStatus: response.status,
                    providerRequestId: receipt.providerRequestId ?? null,
                    responseModel: receipt.responseModel ?? null,
                    usage,
                    costUsd: null,
                    costBasis: null,
                    body: text === null ? null : sanitize(text),
                    captureError,
                });
                return { value: response, receipt };
            });
            if (captureFailed)
                reject("provider response capture failed; inspect the consumed ledger slot");
            return value;
        } catch (error) {
            if (!responseWriteAttempted && responseFile)
                await writeResponse({
                    capturedAt: new Date().toISOString(),
                    httpStatus: null,
                    providerRequestId: null,
                    responseModel: null,
                    usage: null,
                    costUsd: null,
                    costBasis: null,
                    body: null,
                    captureError: "dispatch-not-confirmed-see-ledger",
                });
            const message = error instanceof Error ? error.message : "";
            if (message.startsWith("Request ledger:") || message.startsWith("Metered transport:"))
                throw error;
            return reject("request was rejected or capture failed; no implicit retry");
        } finally {
            try {
                await requestFile?.close();
            } catch {
                /* No credential-bearing file error escapes. */
            }
            try {
                await responseFile?.close();
            } catch {
                /* A persisted admission is never refunded. */
            }
        }
    };
}
