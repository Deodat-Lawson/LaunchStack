import { z } from "zod";
import { NonRetriableError } from "inngest";
import { inngest } from "../client";
import { FounderWeeklyReviewWorkerService } from "@launchstack/features/founder-weekly-review";
import { generateFounderWeeklyReview } from "@launchstack/features/founder-weekly-review";
import { FounderWeeklyReviewGenerationValidationError } from "@launchstack/features/founder-weekly-review";
import { generateFounderWeeklyReviewStructured } from "~/server/founder-weekly-review/generation-adapter";
import { canonicalFounderWeeklyReviewEvidenceCollector } from "~/server/founder-weekly-review/evidence-collector";
import { claimPendingDispatches, markDispatchDispatched, returnDispatchToPending } from "~/server/founder-weekly-review/dispatch-service";
import { founderWeeklyReviewCitationFailures, founderWeeklyReviewDispatchFailures, founderWeeklyReviewGenerationTotal, founderWeeklyReviewJobsEnqueued, founderWeeklyReviewRunsCompleted, founderWeeklyReviewRunsFailed, founderWeeklyReviewStageDuration, logFounderWeeklyReview } from "~/server/founder-weekly-review/observability";

const GenerationEventSchema = z.object({ runId: z.string().min(1), companyId: z.string().min(1), generationJobId: z.string().min(1), generationClaimId: z.string().min(1) });

export const founderWeeklyReviewDispatcher = inngest.createFunction(
  { id: "founder-weekly-review-dispatcher", retries: 3 },
  { event: "founder-weekly-review/dispatch.requested" },
  async ({ step }) => step.run("dispatch-pending", async () => {
    const dispatches = await claimPendingDispatches();
    for (const dispatch of dispatches) {
      try {
        await inngest.send({ id: dispatch.eventId, name: "founder-weekly-review/generation.requested", data: {
          runId: dispatch.runId, companyId: dispatch.companyId.toString(), generationJobId: dispatch.generationJobId, generationClaimId: dispatch.generationClaimId,
        }});
        await markDispatchDispatched(dispatch.id);
        founderWeeklyReviewJobsEnqueued.inc({ operation: dispatch.operationType });
        logFounderWeeklyReview({ runId: dispatch.runId, companyId: dispatch.companyId.toString(), stage: "dispatch_sent", status: "dispatched" });
      } catch {
        await returnDispatchToPending(dispatch.id, "dispatch_failed");
        founderWeeklyReviewDispatchFailures.inc();
      }
    }
    return { dispatched: dispatches.length };
  })
);

/** Periodic reconciliation covers a process failure after the DB outbox commit. */
export const founderWeeklyReviewDispatchReconciler = inngest.createFunction(
  { id: "founder-weekly-review-dispatch-reconciler", retries: 2 },
  { cron: "*/5 * * * *" },
  async () => {
    await inngest.send({ name: "founder-weekly-review/dispatch.requested", data: {} });
    return { requested: true };
  }
);

export const founderWeeklyReviewGenerationJob = inngest.createFunction(
  { id: "founder-weekly-review-generation", retries: 3, concurrency: { key: "event.data.runId", limit: 1 },
    onFailure: async ({ event }) => {
      // `onFailure` fires on Inngest's `inngest/function.failed` envelope, whose
      // data is `{ error, event }` — the original trigger sits one level down.
      // Parsing `event.data` directly never matches, so every exhausted run was
      // silently left in `collecting`/`generating` with no terminal status.
      const original = (event as { data?: { event?: { data?: unknown } } }).data
        ?.event?.data;
      const parsed = GenerationEventSchema.safeParse(original);
      if (!parsed.success) return;
      const worker = new FounderWeeklyReviewWorkerService();
      const companyId = BigInt(parsed.data.companyId);
      const current = await worker.getRun(companyId, parsed.data.runId).catch(() => null);
      if (current?.status === "collecting" && !current.evidenceSnapshot) {
        await worker.markCollectionFailed({ companyId, runId: parsed.data.runId, collectionClaimId: parsed.data.generationClaimId }, { errorCode: "evidence_collection_failed", errorMessage: "Evidence collection failed after retries." }).catch(() => undefined);
      } else {
        await worker.markGenerationFailed({ companyId, runId: parsed.data.runId, generationJobId: parsed.data.generationJobId, generationClaimId: parsed.data.generationClaimId }, { errorCode: "generation_failed", errorMessage: "Generation failed after retries." }).catch(() => undefined);
      }
    } },
  { event: "founder-weekly-review/generation.requested" },
  async ({ event, step }) => {
    const data = GenerationEventSchema.parse(event.data);
    const context = { companyId: BigInt(data.companyId), runId: data.runId, generationJobId: data.generationJobId, generationClaimId: data.generationClaimId };
    const worker = new FounderWeeklyReviewWorkerService();
    let workflowRun = await worker.getRun(context.companyId, context.runId);
    if (workflowRun.status === "draft" || workflowRun.status === "published") return { skipped: true };
    if (!workflowRun.evidenceSnapshot) {
      const collectionContext = { companyId: context.companyId, runId: context.runId, collectionClaimId: data.generationClaimId };
      try {
        // Step results are JSON transport values; a run record contains bigint
        // IDs, so read the canonical record back rather than consuming a
        // lossy serialized step result in the callback.
        await step.run("claim-evidence", () => worker.claimEvidenceCollection(collectionContext));
        const collecting = await worker.getRun(context.companyId, context.runId);
        if (!collecting.evidenceSnapshot && collecting.status === "collecting" && collecting.collectionClaimId === collectionContext.collectionClaimId) {
          logFounderWeeklyReview({ runId: collecting.id, companyId: collecting.companyId.toString(), stage: "evidence_collection_started", status: collecting.status, retryCount: collecting.retryCount });
          const snapshot = await step.run("collect-evidence", () => canonicalFounderWeeklyReviewEvidenceCollector.collectFounderWeeklyReviewEvidence({
            companyId: collecting.companyId,
            reportingPeriod: collecting.reportingPeriod,
            workspaceTimezone: collecting.collectionInput?.workspaceTimezone ?? "UTC",
            founderContext: collecting.collectionInput?.founderContext,
            actor: { externalUserId: collecting.collectionInput?.actorExternalUserId ?? "unknown" },
            requestKey: collecting.requestKey,
          }));
          await step.run("persist-evidence", () => worker.attachEvidenceSnapshotIfAbsent(collectionContext, snapshot));
          workflowRun = await worker.getRun(context.companyId, context.runId);
          logFounderWeeklyReview({ runId: workflowRun.id, companyId: workflowRun.companyId.toString(), stage: "evidence_collection_completed", status: workflowRun.status, retryCount: workflowRun.retryCount });
        } else workflowRun = collecting;
      } catch (error) {
        // Do NOT mark the run failed here. This catch runs on every attempt,
        // including ones Inngest is about to retry, so marking it terminal on
        // the first transient error stranded runs that would have succeeded.
        // `onFailure` owns the terminal transition, once retries are exhausted.
        logFounderWeeklyReview({
          runId: context.runId,
          companyId: context.companyId.toString(),
          stage: "evidence_collection_attempt_failed",
          status: "collecting",
          errorClass: "evidence_collection",
        });
        throw error;
      }
    }
    if (!workflowRun.evidenceSnapshot) return { skipped: true };
    // Inngest's generic step inference intersects event return types; retain the
    // concrete LAU-5 lifecycle record at this boundary.
    await step.run("claim", () => worker.claimQueuedRun(context));
    const claimed = await worker.getRun(context.companyId, context.runId);
    if (claimed.status !== "generating" || claimed.generationClaimId !== data.generationClaimId) return { skipped: true };
    logFounderWeeklyReview({ runId: claimed.id, companyId: claimed.companyId.toString(), stage: "worker_claimed", status: claimed.status, generationAttempt: claimed.generationAttempt, retryCount: claimed.retryCount });
    try {
      const generationStartedAt = performance.now();
      logFounderWeeklyReview({ runId: claimed.id, companyId: claimed.companyId.toString(), stage: "generation_started", status: claimed.status, generationAttempt: claimed.generationAttempt, retryCount: claimed.retryCount });
      const evidenceSnapshot = claimed.evidenceSnapshot;
      if (!evidenceSnapshot) throw new Error("Evidence snapshot is required before generation.");
      const generated = await step.run("generate", () => generateFounderWeeklyReview({ evidenceSnapshot, generate: generateFounderWeeklyReviewStructured }));
      await step.run("persist", () => worker.saveGeneratedDraft(context, generated.reviewPayload, generated.modelMetadata));
      const saved = await worker.getRun(context.companyId, context.runId);
      founderWeeklyReviewGenerationTotal.inc({ result: "success", error_class: "none" });
      founderWeeklyReviewRunsCompleted.inc();
      founderWeeklyReviewStageDuration.observe({ stage: "generation", result: "success" }, (performance.now() - generationStartedAt) / 1000);
      founderWeeklyReviewStageDuration.observe({ stage: "end_to_end", result: "success" }, (Date.now() - saved.createdAt.getTime()) / 1000);
      logFounderWeeklyReview({ runId: saved.id, companyId: saved.companyId.toString(), stage: "generation_completed", status: saved.status, durationMs: Math.round(performance.now() - generationStartedAt), generationAttempt: saved.generationAttempt, retryCount: saved.retryCount, provider: generated.modelMetadata.provider, model: generated.modelMetadata.model });
      return { runId: saved.id, status: saved.status };
    } catch (error) {
      if (error instanceof FounderWeeklyReviewGenerationValidationError) founderWeeklyReviewCitationFailures.inc();
      founderWeeklyReviewGenerationTotal.inc({ result: "failure", error_class: error instanceof FounderWeeklyReviewGenerationValidationError ? "citation_validation" : "generation" });
      founderWeeklyReviewRunsFailed.inc({ error_class: error instanceof FounderWeeklyReviewGenerationValidationError ? "citation_validation" : "generation" });
      logFounderWeeklyReview({ runId: claimed.id, companyId: claimed.companyId.toString(), stage: error instanceof FounderWeeklyReviewGenerationValidationError ? "citation_validation_failed" : "generation_failed", status: "generating", generationAttempt: claimed.generationAttempt, retryCount: claimed.retryCount, errorClass: error instanceof FounderWeeklyReviewGenerationValidationError ? "citation_validation" : "generation" });
      if (error instanceof FounderWeeklyReviewGenerationValidationError) {
        throw new NonRetriableError("Founder Weekly Review validation failed after bounded semantic repair.");
      }
      throw error;
    }
  }
);
