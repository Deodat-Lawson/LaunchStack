import { NextResponse } from "next/server";
import type { FounderWeeklyReviewRunRecord } from "@launchstack/features/founder-weekly-review";

export function safeRun(run: FounderWeeklyReviewRunRecord) {
    return {
        id: run.id, status: run.status, reportingPeriod: run.reportingPeriod,
        generationAttempt: run.generationAttempt, retryCount: run.retryCount,
        queuedAt: run.queuedAt.toISOString(), claimedAt: run.claimedAt?.toISOString() ?? null,
        generatedAt: run.generatedAt?.toISOString() ?? null, publishedAt: run.publishedAt?.toISOString() ?? null,
        errorCode: run.status === "failed" ? run.errorCode : null,
        reviewPayload: run.reviewPayload,
    };
}

export function safeFounderWeeklyReviewError(error: unknown) {
    const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
    if (code === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (code === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (code === "invalid_transition" || code === "conflict") return NextResponse.json({ error: "Conflict" }, { status: 409 });
    if (code === "invalid_payload") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    if (code === "evidence_collector_unavailable" || code === "infrastructure_unavailable") return NextResponse.json({ error: "Generation unavailable" }, { status: 503 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
