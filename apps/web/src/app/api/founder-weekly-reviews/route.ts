import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { FounderWeeklyReviewRepository } from "@launchstack/features/founder-weekly-review";
import type { FounderWeeklyReviewEvidenceCollector } from "~/server/founder-weekly-review/evidence-collector";
import { canonicalFounderWeeklyReviewEvidenceCollector } from "~/server/founder-weekly-review/evidence-collector";
import type { FounderWeeklyReviewActorResolver } from "~/server/founder-weekly-review/actor-resolver";
import { productionFounderWeeklyReviewActorResolver } from "~/server/founder-weekly-review/actor-resolver";
import { createRunWithDispatch } from "~/server/founder-weekly-review/dispatch-service";
import { safeFounderWeeklyReviewError, safeRun } from "~/server/founder-weekly-review/http";
import { inngest } from "~/server/inngest/client";
import { founderWeeklyReviewRunsCreated, founderWeeklyReviewStageDuration, logFounderWeeklyReview } from "~/server/founder-weekly-review/observability";

const CreateSchema = z.object({ requestKey: z.string().min(1).max(128), reportingPeriod: z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), workspaceTimezone: z.string().min(1).max(128), founderContext: z.string().max(4000).optional() });

export interface FounderWeeklyReviewRouteDependencies {
  actorResolver: Pick<FounderWeeklyReviewActorResolver, "resolve">;
  evidenceCollector: FounderWeeklyReviewEvidenceCollector;
  repository: Pick<FounderWeeklyReviewRepository, "getByCompanyAndRequestKey">;
  createRunWithDispatch: typeof createRunWithDispatch;
  sendDispatchRequested: () => Promise<unknown>;
}

export function createFounderWeeklyReviewPostHandler(deps: FounderWeeklyReviewRouteDependencies) {
  return async function POST(request: Request) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
      // Authorization is deliberately before parsing/collection: invalid or
      // unauthorized callers must never cause workspace evidence reads.
      const actor = await deps.actorResolver.resolve(userId);
      const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
      const existing = await deps.repository.getByCompanyAndRequestKey(actor.companyId, parsed.data.requestKey);
      if (existing) return NextResponse.json({ run: safeRun(existing) }, { status: 202 });
      const startedAt = performance.now();
      logFounderWeeklyReview({ runId: "pending", companyId: actor.companyId.toString(), stage: "evidence_collection_started", status: "pending" });
      const evidenceSnapshot = await deps.evidenceCollector.collectFounderWeeklyReviewEvidence({ companyId: actor.companyId, reportingPeriod: parsed.data.reportingPeriod, workspaceTimezone: parsed.data.workspaceTimezone, founderContext: parsed.data.founderContext, actor: { externalUserId: actor.externalUserId }, requestKey: parsed.data.requestKey });
      const durationMs = Math.round(performance.now() - startedAt);
      founderWeeklyReviewStageDuration.observe({ stage: "evidence_collection", result: "success" }, durationMs / 1000);
      logFounderWeeklyReview({ runId: "pending", companyId: actor.companyId.toString(), stage: "evidence_collection_completed", status: "pending", durationMs });
      const { run } = await deps.createRunWithDispatch({ actor, requestKey: parsed.data.requestKey, reportingPeriod: parsed.data.reportingPeriod, evidenceSnapshot });
      founderWeeklyReviewRunsCreated.inc();
      logFounderWeeklyReview({ runId: run.id, companyId: run.companyId.toString(), stage: "run_created", status: run.status, retryCount: run.retryCount });
      logFounderWeeklyReview({ runId: run.id, companyId: run.companyId.toString(), stage: "dispatch_created", status: run.status });
      await deps.sendDispatchRequested();
      return NextResponse.json({ run: safeRun(run) }, { status: 202 });
    } catch (error) {
      founderWeeklyReviewStageDuration.observe({ stage: "evidence_collection", result: "failure" }, 0);
      return safeFounderWeeklyReviewError(error);
    }
  };
}

const productionDependencies: FounderWeeklyReviewRouteDependencies = {
  actorResolver: productionFounderWeeklyReviewActorResolver,
  evidenceCollector: canonicalFounderWeeklyReviewEvidenceCollector,
  repository: new FounderWeeklyReviewRepository(),
  createRunWithDispatch,
  sendDispatchRequested: () => inngest.send({ name: "founder-weekly-review/dispatch.requested", data: {} }),
};
export const POST = createFounderWeeklyReviewPostHandler(productionDependencies);
