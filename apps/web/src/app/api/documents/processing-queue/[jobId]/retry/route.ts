/**
 * POST /api/documents/processing-queue/[jobId]/retry — restart a failed
 * job from the stage that died. Needs `documents.upload` and edit access to
 * the file (ADR-014); a job the caller can't see is a 404, one that hasn't
 * failed (or has no dead step to restart) a 409.
 *
 * Answers `ProcessingRetryResponse` — the job's queue item, now waiting.
 */

import { NextResponse } from "next/server";

import type { ProcessingRetryResponse } from "~/lib/processing-queue/types";
import { withRateLimit } from "~/lib/rate-limit-middleware";
import { RateLimitPresets } from "~/lib/rate-limiter";
import { requireWorkspacePermission } from "~/lib/require-workspace-context";
import { retryProcessingJob } from "~/server/processing-queue/retry";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
    return withRateLimit(request, RateLimitPresets.standard, async () => {
        try {
            const { jobId } = await context.params;
            if (!jobId || jobId.length > 256) {
                return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
            }

            const ctx = await requireWorkspacePermission("documents.upload");
            if (!ctx.success) return ctx.response;

            const result = await retryProcessingJob(ctx.data, jobId);
            if (!result.ok) {
                return NextResponse.json({ error: result.error }, { status: result.status });
            }
            const body: ProcessingRetryResponse = { ok: true, item: result.item };
            return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
            console.error("[processing-queue] retry failed:", error);
            return NextResponse.json({ error: "Unable to retry this file" }, { status: 500 });
        }
    });
}
