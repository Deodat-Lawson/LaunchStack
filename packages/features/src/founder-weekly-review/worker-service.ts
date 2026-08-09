import { ZodError } from "zod";

import {
    type FounderWeeklyReviewClaimInput,
    type FounderWeeklyReviewCollectionClaimInput,
    type FounderWeeklyReviewEvidenceSnapshot,
    type FounderWeeklyReviewGenerationFailure,
    type FounderWeeklyReviewModelMetadata,
    type FounderWeeklyReviewPayload,
    type FounderWeeklyReviewRunRecord,
    parseFounderWeeklyReviewModelMetadata,
    parseFounderWeeklyReviewPayload,
} from "./contracts";
import {
    FounderWeeklyReviewClaimOwnershipMismatchError,
    FounderWeeklyReviewConflictError,
    FounderWeeklyReviewInvalidPayloadError,
    FounderWeeklyReviewInvalidTransitionError,
    FounderWeeklyReviewNotFoundError,
} from "./errors";
import { FounderWeeklyReviewRepository } from "./repository";

export type FounderWeeklyReviewWorkerContext = FounderWeeklyReviewClaimInput;
export type FounderWeeklyReviewCollectionContext =
    FounderWeeklyReviewCollectionClaimInput;

export class FounderWeeklyReviewWorkerService {
    constructor(
        private readonly repository = new FounderWeeklyReviewRepository()
    ) {}

    async getRun(companyId: bigint, runId: string): Promise<FounderWeeklyReviewRunRecord> {
        const run = await this.repository.getByCompanyAndRunId(companyId, runId);
        if (!run) throw new FounderWeeklyReviewNotFoundError(runId);
        return run;
    }

    async claimQueuedRun(
        context: FounderWeeklyReviewWorkerContext
    ): Promise<FounderWeeklyReviewRunRecord> {
        const result = await this.repository.claimQueuedRun(context);

        if (!result.run) {
            throw new FounderWeeklyReviewNotFoundError(context.runId);
        }
        if (result.updated) {
            return result.run;
        }
        if (
            result.run.status === "generating" &&
            result.run.generationClaimId === context.generationClaimId
        ) {
            return result.run;
        }
        throw new FounderWeeklyReviewConflictError(
            `Founder weekly review run "${context.runId}" is already owned by another generation claim or moved out of queue.`
        );
    }

    async claimEvidenceCollection(context: FounderWeeklyReviewCollectionContext): Promise<FounderWeeklyReviewRunRecord> {
        const result = await this.repository.claimEvidenceCollection(context);
        if (!result.run) throw new FounderWeeklyReviewNotFoundError(context.runId);
        if (result.updated) return result.run;
        if (result.run.status === "collecting" && result.run.collectionClaimId === context.collectionClaimId) return result.run;
        if (result.run.evidenceSnapshot) return result.run;
        throw new FounderWeeklyReviewConflictError(`Founder weekly review run "${context.runId}" is already owned by another collection claim.`);
    }

    async attachEvidenceSnapshotIfAbsent(context: FounderWeeklyReviewCollectionContext, snapshot: FounderWeeklyReviewEvidenceSnapshot): Promise<FounderWeeklyReviewRunRecord> {
        const result = await this.repository.attachEvidenceSnapshotIfAbsent(context, snapshot);
        if (!result.run) throw new FounderWeeklyReviewNotFoundError(context.runId);
        if (result.updated || result.run.evidenceSnapshot) return result.run;
        throw new FounderWeeklyReviewClaimOwnershipMismatchError(context.runId);
    }

    async markCollectionFailed(context: FounderWeeklyReviewCollectionContext, failure: FounderWeeklyReviewGenerationFailure): Promise<FounderWeeklyReviewRunRecord> {
        const result = await this.repository.markCollectionFailed(context, failure);
        if (!result.run) throw new FounderWeeklyReviewNotFoundError(context.runId);
        if (result.updated || (result.run.status === "failed" && result.run.collectionClaimId === context.collectionClaimId)) return result.run;
        throw new FounderWeeklyReviewClaimOwnershipMismatchError(context.runId);
    }

    async saveGeneratedDraft(
        context: FounderWeeklyReviewWorkerContext,
        reviewPayload: FounderWeeklyReviewPayload,
        modelMetadata: FounderWeeklyReviewModelMetadata | null
    ): Promise<FounderWeeklyReviewRunRecord> {
        let payload: FounderWeeklyReviewPayload;
        let metadata: FounderWeeklyReviewModelMetadata | null;
        try {
            payload = parseFounderWeeklyReviewPayload(reviewPayload);
            metadata = modelMetadata
                ? parseFounderWeeklyReviewModelMetadata(modelMetadata)
                : null;
        } catch (error) {
            if (error instanceof ZodError) {
                throw new FounderWeeklyReviewInvalidPayloadError(error.message);
            }
            throw error;
        }
        const result = await this.repository.saveGeneratedDraftWithClaim(
            context,
            payload,
            metadata
        );

        if (!result.run) {
            throw new FounderWeeklyReviewNotFoundError(context.runId);
        }
        if (result.updated) {
            return result.run;
        }
        if (result.run.generationClaimId !== context.generationClaimId) {
            throw new FounderWeeklyReviewClaimOwnershipMismatchError(context.runId);
        }
        throw new FounderWeeklyReviewInvalidTransitionError(result.run.status, "save draft");
    }

    async markGenerationFailed(
        context: FounderWeeklyReviewWorkerContext,
        failure: FounderWeeklyReviewGenerationFailure
    ): Promise<FounderWeeklyReviewRunRecord> {
        const result = await this.repository.markGenerationFailedWithClaim(
            context,
            failure
        );

        if (!result.run) {
            throw new FounderWeeklyReviewNotFoundError(context.runId);
        }
        if (result.updated) {
            return result.run;
        }
        if (
            result.run.status === "failed" &&
            result.run.generationClaimId === context.generationClaimId
        ) {
            return result.run;
        }
        if (result.run.generationClaimId !== context.generationClaimId) {
            throw new FounderWeeklyReviewClaimOwnershipMismatchError(context.runId);
        }
        throw new FounderWeeklyReviewInvalidTransitionError(result.run.status, "mark failed");
    }

    async markQueuedRunFailed(
        companyId: bigint,
        runId: string,
        failure: FounderWeeklyReviewGenerationFailure
    ): Promise<FounderWeeklyReviewRunRecord> {
        const result = await this.repository.markQueuedRunFailed(companyId, runId, failure);

        if (!result.run) {
            throw new FounderWeeklyReviewNotFoundError(runId);
        }
        if (result.updated) {
            return result.run;
        }
        throw new FounderWeeklyReviewInvalidTransitionError(result.run.status, "mark failed");
    }
}
