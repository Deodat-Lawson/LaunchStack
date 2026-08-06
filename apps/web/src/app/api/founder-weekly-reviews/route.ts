import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { FounderWeeklyReviewRepository } from "@launchstack/features/founder-weekly-review";
import type { FounderWeeklyReviewEvidenceCollector } from "~/server/founder-weekly-review/evidence-collector";
import type { FounderWeeklyReviewActorResolver } from "~/server/founder-weekly-review/actor-resolver";
import { productionFounderWeeklyReviewActorResolver } from "~/server/founder-weekly-review/actor-resolver";
import { createRunWithDispatch } from "~/server/founder-weekly-review/dispatch-service";
import { safeFounderWeeklyReviewError, safeRun } from "~/server/founder-weekly-review/http";
import { inngest } from "~/server/inngest/client";
import { founderWeeklyReviewRunsCreated, logFounderWeeklyReview } from "~/server/founder-weekly-review/observability";

const CreateSchema = z.object({ requestKey: z.string().min(1).max(128), reportingPeriod: z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), workspaceTimezone: z.string().min(1).max(128), founderContext: z.string().max(4000).optional() });

export interface FounderWeeklyReviewRouteDependencies {
  actorResolver: Pick<FounderWeeklyReviewActorResolver, "resolve">;
  /** Retained only for test construction compatibility; collection is worker-owned. */
  evidenceCollector?: FounderWeeklyReviewEvidenceCollector;
  repository: Pick<FounderWeeklyReviewRepository, "getByCompanyAndRequestKey">;
  createRunWithDispatch: typeof createRunWithDispatch;
  sendDispatchRequested: () => Promise<unknown>;
  recordRunCreated: () => void;
}

export function createFounderWeeklyReviewPostHandler(deps: FounderWeeklyReviewRouteDependencies) {
  return async function POST(request: Request) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
      // Authorization precedes all workflow persistence: invalid callers must
      // never create a company-scoped collection job.
      const actor = await deps.actorResolver.resolve(userId);
      const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
      const existing = await deps.repository.getByCompanyAndRequestKey(actor.companyId, parsed.data.requestKey);
      if (existing) return NextResponse.json({ run: safeRun(existing) }, { status: 202 });
      const { run, created } = await deps.createRunWithDispatch({ actor, requestKey: parsed.data.requestKey, reportingPeriod: parsed.data.reportingPeriod, collectionInput: { workspaceTimezone: parsed.data.workspaceTimezone, founderContext: parsed.data.founderContext, actorExternalUserId: actor.externalUserId } });
      if (created) deps.recordRunCreated();
      logFounderWeeklyReview({ runId: run.id, companyId: run.companyId.toString(), stage: "run_created", status: run.status, retryCount: run.retryCount });
      logFounderWeeklyReview({ runId: run.id, companyId: run.companyId.toString(), stage: "dispatch_created", status: run.status });
      await deps.sendDispatchRequested();
      return NextResponse.json({ run: safeRun(run) }, { status: 202 });
    } catch (error) {
      return safeFounderWeeklyReviewError(error);
    }
  };
}

const productionDependencies: FounderWeeklyReviewRouteDependencies = {
  actorResolver: productionFounderWeeklyReviewActorResolver,
  repository: { getByCompanyAndRequestKey: (companyId, requestKey) => new FounderWeeklyReviewRepository().getByCompanyAndRequestKey(companyId, requestKey) },
  createRunWithDispatch,
  sendDispatchRequested: () => inngest.send({ name: "founder-weekly-review/dispatch.requested", data: {} }),
  recordRunCreated: () => founderWeeklyReviewRunsCreated.inc(),
};
export const POST = createFounderWeeklyReviewPostHandler(productionDependencies);
