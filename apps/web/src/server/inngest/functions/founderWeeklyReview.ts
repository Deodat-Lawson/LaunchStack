import { z } from "zod";
import { inngest } from "../client";
import { FounderWeeklyReviewWorkerService, type FounderWeeklyReviewRunRecord } from "@launchstack/features/founder-weekly-review";
import { generateFounderWeeklyReview } from "@launchstack/features/founder-weekly-review";
import { FounderWeeklyReviewGenerationValidationError } from "@launchstack/features/founder-weekly-review";
import { generateFounderWeeklyReviewStructured } from "~/server/founder-weekly-review/generation-adapter";
import { claimPendingDispatches, markDispatchDispatched, returnDispatchToPending } from "~/server/founder-weekly-review/dispatch-service";
import { founderWeeklyReviewCitationFailures, founderWeeklyReviewGenerationTotal, founderWeeklyReviewJobsEnqueued, logFounderWeeklyReview } from "~/server/founder-weekly-review/observability";

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
      } catch {
        await returnDispatchToPending(dispatch.id, "dispatch_failed");
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
    const claimed = await step.run("claim", () => worker.claimQueuedRun(context));
    if (claimed.status !== "generating" || claimed.generationClaimId !== data.generationClaimId) return { skipped: true };
    try {
      const generated = await step.run("generate", () => generateFounderWeeklyReview({ evidenceSnapshot: claimed.evidenceSnapshot, generate: generateFounderWeeklyReviewStructured }));
      const saved = await step.run("persist", () => worker.saveGeneratedDraft(context, generated.reviewPayload, generated.modelMetadata)) as unknown as FounderWeeklyReviewRunRecord;
      founderWeeklyReviewGenerationTotal.inc({ result: "success", error_class: "none" });
      logFounderWeeklyReview({ runId: saved.id, companyId: saved.companyId.toString(), stage: "persist", status: saved.status, generationAttempt: saved.generationAttempt, retryCount: saved.retryCount, provider: generated.modelMetadata.provider, model: generated.modelMetadata.model });
      return { runId: saved.id, status: saved.status };
    } catch (error) {
      if (error instanceof FounderWeeklyReviewGenerationValidationError) founderWeeklyReviewCitationFailures.inc();
      founderWeeklyReviewGenerationTotal.inc({ result: "failure", error_class: error instanceof FounderWeeklyReviewGenerationValidationError ? "citation_validation" : "generation" });
      throw error;
    }
  }
);
