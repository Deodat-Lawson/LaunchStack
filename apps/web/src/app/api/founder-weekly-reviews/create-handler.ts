/**
 * Factory for the create-run POST handler, in its own module because
 * Next.js route files may only export route fields — the factory is
 * exported for dependency-injected tests (routes.test.ts).
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import {
  type FounderWeeklyReviewRepository,
  ReportingPeriodSchema,
  WorkspaceTimezoneSchema,
} from "@launchstack/features/founder-weekly-review";
import type { FounderWeeklyReviewEvidenceCollector } from "~/server/founder-weekly-review/evidence-collector";
import type { FounderWeeklyReviewActorResolver } from "~/server/founder-weekly-review/actor-resolver";
import type { createRunWithDispatch } from "~/server/founder-weekly-review/dispatch-service";
import { safeFounderWeeklyReviewError, safeRun } from "~/server/founder-weekly-review/http";
import { logFounderWeeklyReview } from "~/server/founder-weekly-review/observability";

const CreateSchema = z.object({
  requestKey: z.string().min(1).max(128),
  // The shared contract, not a local copy of it: it rejects impossible dates
  // and an inverted period, which a bare shape regex accepts. An invalid
  // reporting period or time zone is a permanent user error, so it has to fail
  // as a 400 here rather than be persisted and retried to exhaustion by the
  // worker that eventually reads it.
  reportingPeriod: ReportingPeriodSchema,
  workspaceTimezone: WorkspaceTimezoneSchema,
  // An empty (or whitespace-only) box means "no founder context", not a
  // zero-length one. The collection contract requires min(1), so passing `""`
  // straight through was accepted here and then rejected on persistence, which
  // surfaced as a 500 on a perfectly ordinary empty textarea.
  founderContext: z
    .string()
    .max(4000)
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed === undefined || trimmed === "" ? undefined : trimmed;
    }),
});

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

