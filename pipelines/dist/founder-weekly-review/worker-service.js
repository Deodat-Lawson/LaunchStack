import { ZodError } from "zod";
import {
    parseFounderWeeklyReviewModelMetadata,
    parseFounderWeeklyReviewPayload,
} from "./contracts.js";
import {
    FounderWeeklyReviewClaimOwnershipMismatchError,
    FounderWeeklyReviewConflictError,
    FounderWeeklyReviewInvalidPayloadError,
    FounderWeeklyReviewInvalidTransitionError,
    FounderWeeklyReviewNotFoundError,
} from "./errors.js";
import { FounderWeeklyReviewRepository } from "./repository.js";
export class FounderWeeklyReviewWorkerService {
    repository;
    constructor(repository = new FounderWeeklyReviewRepository()) {
        this.repository = repository;
    }
    async getRun(companyId, runId) {
        const run = await this.repository.getByCompanyAndRunId(companyId, runId);
        if (!run) throw new FounderWeeklyReviewNotFoundError(runId);
        return run;
    }
    async claimQueuedRun(context) {
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
    async claimEvidenceCollection(context) {
        const result = await this.repository.claimEvidenceCollection(context);
        if (!result.run) throw new FounderWeeklyReviewNotFoundError(context.runId);
        if (result.updated) return result.run;
        if (
            result.run.status === "collecting" &&
            result.run.collectionClaimId === context.collectionClaimId
        )
            return result.run;
        if (result.run.evidenceSnapshot) return result.run;
        throw new FounderWeeklyReviewConflictError(
            `Founder weekly review run "${context.runId}" is already owned by another collection claim.`
        );
    }
    async attachEvidenceSnapshotIfAbsent(context, snapshot) {
        const result = await this.repository.attachEvidenceSnapshotIfAbsent(context, snapshot);
        if (!result.run) throw new FounderWeeklyReviewNotFoundError(context.runId);
        if (result.updated || result.run.evidenceSnapshot) return result.run;
        throw new FounderWeeklyReviewClaimOwnershipMismatchError(context.runId);
    }
    async markCollectionFailed(context, failure) {
        const result = await this.repository.markCollectionFailed(context, failure);
        if (!result.run) throw new FounderWeeklyReviewNotFoundError(context.runId);
        if (
            result.updated ||
            (result.run.status === "failed" &&
                result.run.collectionClaimId === context.collectionClaimId)
        )
            return result.run;
        throw new FounderWeeklyReviewClaimOwnershipMismatchError(context.runId);
    }
    async saveGeneratedDraft(context, reviewPayload, modelMetadata) {
        let payload;
        let metadata;
        try {
            payload = parseFounderWeeklyReviewPayload(reviewPayload);
            metadata = modelMetadata ? parseFounderWeeklyReviewModelMetadata(modelMetadata) : null;
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
    async markGenerationFailed(context, failure) {
        const result = await this.repository.markGenerationFailedWithClaim(context, failure);
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
    async markQueuedRunFailed(companyId, runId, failure) {
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
//# sourceMappingURL=worker-service.js.map
