/**
 * Shared HTTP plumbing for compute-service clients (ADR-004 §6).
 *
 * Every call: X-API-Key auth, X-Trace-Id propagation, bounded timeout via
 * AbortController, zod validation of the response body, and typed errors
 * carrying the service's error envelope when it sent one.
 */
import { serviceErrorSchema } from "./document-converter/wire";
import type { z } from "zod";

export interface ServiceClientConfig {
    baseUrl: string;
    /** Sent as X-API-Key. Services fail closed, so this is effectively required. */
    apiKey: string;
    /** Per-request timeout. Defaults to 60s; converter calls override higher. */
    timeoutMs?: number;
    /** Injectable for tests. Defaults to global fetch. */
    fetchImpl?: typeof fetch;
}

export class ComputeServiceError extends Error {
    constructor(
        message: string,
        readonly opts: {
            service: string;
            path: string;
            status?: number;
            code?: string;
            traceId?: string;
            retryable: boolean;
        }
    ) {
        super(message);
        this.name = "ComputeServiceError";
    }
}

export async function postJson<T>(
    service: string,
    config: ServiceClientConfig,
    path: string,
    body: unknown,
    responseSchema: z.ZodType<T>,
    traceId: string,
    timeoutMs?: number
): Promise<T> {
    const fetchImpl = config.fetchImpl ?? fetch;
    const timeout = timeoutMs ?? config.timeoutMs ?? 60_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const url = `${config.baseUrl.replace(/\/$/, "")}${path}`;

    let response: Response;
    try {
        response = await fetchImpl(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": config.apiKey,
                "X-Trace-Id": traceId,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (error) {
        const aborted = controller.signal.aborted;
        throw new ComputeServiceError(
            aborted
                ? `${service} ${path} timed out after ${timeout}ms`
                : `${service} ${path} unreachable: ${
                      error instanceof Error ? error.message : String(error)
                  }`,
            { service, path, traceId, retryable: true }
        );
    } finally {
        clearTimeout(timer);
    }

    if (!response.ok) {
        let code: string | undefined;
        let detail = "";
        try {
            const parsed = serviceErrorSchema.safeParse(await response.json());
            if (parsed.success) {
                code = parsed.data.error.code;
                detail = `: ${parsed.data.error.message}`;
            }
        } catch {
            // Non-JSON error body — status alone is the signal.
        }
        throw new ComputeServiceError(`${service} ${path} returned ${response.status}${detail}`, {
            service,
            path,
            status: response.status,
            code,
            traceId,
            // 4xx means the request itself is wrong — retrying cannot help.
            retryable: response.status >= 500,
        });
    }

    const json: unknown = await response.json();
    const parsed = responseSchema.safeParse(json);
    if (!parsed.success) {
        throw new ComputeServiceError(
            `${service} ${path} response failed contract validation: ${parsed.error.message}`,
            { service, path, status: response.status, traceId, retryable: false }
        );
    }
    return parsed.data;
}
