/**
 * Typed service errors, serialized as the uniform envelope defined in
 * packages/schema-generator/schemas/v1/service-error.schema.json:
 *
 *   { "error": { "code", "message", "traceId?" } }
 */

export type ServiceErrorCode =
    | "invalid-request"
    | "unauthorized"
    | "not-found"
    | "url-not-allowed"
    | "fetch-failed"
    | "fetch-too-large"
    | "payload-too-large"
    | "docling-not-configured"
    | "docling-failed"
    | "internal";

export class ServiceError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: ServiceErrorCode,
        message: string
    ) {
        super(message);
        this.name = "ServiceError";
    }
}

export interface ServiceErrorEnvelope {
    error: { code: string; message: string; traceId?: string };
}

export function errorEnvelope(
    code: string,
    message: string,
    traceId?: string
): ServiceErrorEnvelope {
    return {
        error: {
            code,
            message,
            ...(traceId ? { traceId } : {}),
        },
    };
}

export function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
