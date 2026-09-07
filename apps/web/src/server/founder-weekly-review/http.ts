/**
 * Investor-update route plumbing, layered on the shared route contract in
 * `~/server/api/context`.
 *
 * What stays here is the one thing that is genuinely about reviews: which
 * fields of a run record are safe to put on the wire. Error mapping moved to
 * the shared contract — every error this service throws now carries its own
 * status, so there is nothing left for a bespoke mapper to decide.
 */

import type { FounderWeeklyReviewRunRecord } from "@launchstack/pipelines/founder-weekly-review";

export { fail, handleRouteError, ok, readJson } from "~/server/api/responses";

/**
 * The client-facing projection of a run.
 *
 * Deliberately narrower than the record: the evidence snapshot, the model
 * metadata and the internal claim ids stay server-side, and `errorMessage` is
 * never exposed — a failed run reports its code, and the client turns that into
 * language a founder can act on.
 */
export function safeRun(run: FounderWeeklyReviewRunRecord) {
    return {
        id: run.id,
        status: run.status,
        reportingPeriod: run.reportingPeriod,
        generationAttempt: run.generationAttempt,
        retryCount: run.retryCount,
        queuedAt: run.queuedAt.toISOString(),
        claimedAt: run.claimedAt?.toISOString() ?? null,
        generatedAt: run.generatedAt?.toISOString() ?? null,
        publishedAt: run.publishedAt?.toISOString() ?? null,
        errorCode: run.status === "failed" ? run.errorCode : null,
        reviewPayload: run.reviewPayload,
    };
}
