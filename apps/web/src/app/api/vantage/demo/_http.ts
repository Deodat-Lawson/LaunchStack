import { z } from "zod";
import { VantageError } from "@launchstack/pipelines/vantage";
import { error, handleVantageError } from "../_http";
export { json, readBody } from "../_http";
export const WeekSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const SourceQuerySchema = z
    .object({
        reportId: z.string().uuid(),
        kind: z.enum(["ev", "obs", "cm", "doc", "company", "public"]),
        id: z.string().min(1).max(1000),
        version: z.string().min(1).max(2000),
    })
    .strict();
export const ReviewSchema = z
    .object({
        reportId: z.string().uuid(),
        topicId: z.string().uuid(),
        expectedVersion: z.number().int().positive(),
        status: z.enum(["kept", "dismissed"]).optional(),
        decision: z
            .object({
                value: z.enum(["go", "no-go", "needs-more-evidence"]),
                text: z.string().trim().max(2000).optional(),
            })
            .strict()
            .optional(),
    })
    .strict()
    .refine(
        value => value.status !== undefined || value.decision !== undefined,
        "Provide a review status or recorded decision."
    );
export function demoFailure(scope: string, failure: unknown) {
    if (
        failure &&
        typeof failure === "object" &&
        "code" in failure &&
        failure.code === "context_model_not_successful"
    )
        return error(
            "The model did not produce a validated contextual report within the demo limits. Your saved report and reviews were preserved.",
            503,
            { code: "context_model_not_successful" }
        );
    if (failure instanceof VantageError) return handleVantageError(scope, failure);
    if (
        failure &&
        typeof failure === "object" &&
        "status" in failure &&
        "code" in failure &&
        typeof failure.status === "number" &&
        [400, 403, 409, 503].includes(failure.status)
    )
        return error(
            "Authorized demonstration context is unavailable or changed. Reload and try again.",
            failure.status,
            { code: String(failure.code) }
        );
    return handleVantageError(scope, failure);
}
