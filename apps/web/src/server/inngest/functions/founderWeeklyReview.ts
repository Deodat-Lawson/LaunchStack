import { z } from "zod";
import { inngest } from "../client";
import { FounderWeeklyReviewWorkerService, type FounderWeeklyReviewRunRecord } from "@launchstack/features/founder-weekly-review";
import { generateFounderWeeklyReview } from "@launchstack/features/founder-weekly-review";
import { FounderWeeklyReviewGenerationValidationError } from "@launchstack/features/founder-weekly-review";
import { generateFounderWeeklyReviewStructured } from "~/server/founder-weekly-review/generation-adapter";
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
      const parsed = GenerationEventSchema.safeParse(event.data); if (!parsed.success) return;
      const worker = new FounderWeeklyReviewWorkerService();
      await worker.markGenerationFailed({ companyId: BigInt(parsed.data.companyId), runId: parsed.data.runId, generationJobId: parsed.data.generationJobId, generationClaimId: parsed.data.generationClaimId }, { errorCode: "generation_failed", errorMessage: "Generation failed after retries." }).catch(() => undefined);
    } },
  { event: "founder-weekly-review/generation.requested" },
  async ({ event, step }) => {
    const data = GenerationEventSchema.parse(event.data);
    const context = { companyId: BigInt(data.companyId), runId: data.runId, generationJobId: data.generationJobId, generationClaimId: data.generationClaimId };
    const worker = new FounderWeeklyReviewWorkerService();
    // Inngest's generic step inference intersects event return types; retain the
    // concrete LAU-5 lifecycle record at this boundary.
    const claimed = await step.run("claim", () => worker.claimQueuedRun(context)) as unknown as FounderWeeklyReviewRunRecord;
    if (claimed.status !== "generating" || claimed.generationClaimId !== data.generationClaimId) return { skipped: true };
    logFounderWeeklyReview({ runId: claimed.id, companyId: claimed.companyId.toString(), stage: "worker_claimed", status: claimed.status, generationAttempt: claimed.generationAttempt, retryCount: claimed.retryCount });
    try {
      const generationStartedAt = performance.now();
      logFounderWeeklyReview({ runId: claimed.id, companyId: claimed.companyId.toString(), stage: "generation_started", status: claimed.status, generationAttempt: claimed.generationAttempt, retryCount: claimed.retryCount });
      const generated = await step.run("generate", () => generateFounderWeeklyReview({ evidenceSnapshot: claimed.evidenceSnapshot, generate: generateFounderWeeklyReviewStructured }));
      const saved = await step.run("persist", () => worker.saveGeneratedDraft(context, generated.reviewPayload, generated.modelMetadata)) as unknown as FounderWeeklyReviewRunRecord;
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
      throw error;
    }
  }
);
