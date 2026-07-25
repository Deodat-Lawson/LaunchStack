import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { productionFounderWeeklyReviewActorResolver } from "~/server/founder-weekly-review/actor-resolver";
import { retryRunWithDispatch } from "~/server/founder-weekly-review/dispatch-service";
import { safeFounderWeeklyReviewError, safeRun } from "~/server/founder-weekly-review/http";
import { inngest } from "~/server/inngest/client";
import { founderWeeklyReviewRetries, logFounderWeeklyReview } from "~/server/founder-weekly-review/observability";
const RetrySchema = z.object({ requestKey: z.string().min(1).max(128) });
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { userId } = await auth(); if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = RetrySchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try { const actor = await productionFounderWeeklyReviewActorResolver.resolve(userId); const { runId } = await params;
    logFounderWeeklyReview({ runId, companyId: actor.companyId.toString(), stage: "retry_requested", status: "failed" });
    const { run } = await retryRunWithDispatch({ actor, runId, requestKey: parsed.data.requestKey });
    if (run.status === "queued") { founderWeeklyReviewRetries.inc(); logFounderWeeklyReview({ runId: run.id, companyId: run.companyId.toString(), stage: "retry_queued", status: run.status, retryCount: run.retryCount }); }
    await inngest.send({ name: "founder-weekly-review/dispatch.requested", data: {} });
    return NextResponse.json({ run: safeRun(run) }, { status: 202 });
  } catch (error) { return safeFounderWeeklyReviewError(error); }
}
