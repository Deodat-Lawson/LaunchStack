import { type FounderWeeklyReviewClaimInput, type FounderWeeklyReviewCollectionClaimInput, type FounderWeeklyReviewEvidenceSnapshot, type FounderWeeklyReviewGenerationFailure, type FounderWeeklyReviewModelMetadata, type FounderWeeklyReviewPayload, type FounderWeeklyReviewRunRecord } from "./contracts.js";
import { FounderWeeklyReviewRepository } from "./repository.js";
export type FounderWeeklyReviewWorkerContext = FounderWeeklyReviewClaimInput;
export type FounderWeeklyReviewCollectionContext = FounderWeeklyReviewCollectionClaimInput;
export declare class FounderWeeklyReviewWorkerService {
    private readonly repository;
    constructor(repository?: FounderWeeklyReviewRepository);
    getRun(companyId: bigint, runId: string): Promise<FounderWeeklyReviewRunRecord>;
    claimQueuedRun(context: FounderWeeklyReviewWorkerContext): Promise<FounderWeeklyReviewRunRecord>;
    claimEvidenceCollection(context: FounderWeeklyReviewCollectionContext): Promise<FounderWeeklyReviewRunRecord>;
    attachEvidenceSnapshotIfAbsent(context: FounderWeeklyReviewCollectionContext, snapshot: FounderWeeklyReviewEvidenceSnapshot): Promise<FounderWeeklyReviewRunRecord>;
    markCollectionFailed(context: FounderWeeklyReviewCollectionContext, failure: FounderWeeklyReviewGenerationFailure): Promise<FounderWeeklyReviewRunRecord>;
    saveGeneratedDraft(context: FounderWeeklyReviewWorkerContext, reviewPayload: FounderWeeklyReviewPayload, modelMetadata: FounderWeeklyReviewModelMetadata | null): Promise<FounderWeeklyReviewRunRecord>;
    markGenerationFailed(context: FounderWeeklyReviewWorkerContext, failure: FounderWeeklyReviewGenerationFailure): Promise<FounderWeeklyReviewRunRecord>;
    markQueuedRunFailed(companyId: bigint, runId: string, failure: FounderWeeklyReviewGenerationFailure): Promise<FounderWeeklyReviewRunRecord>;
}
//# sourceMappingURL=worker-service.d.ts.map