import { type DbClient } from "@launchstack/store/client";
import { type CreateFounderWeeklyReviewRunInput, type FounderWeeklyReviewClaimInput, type FounderWeeklyReviewCollectionClaimInput, type FounderWeeklyReviewEvidenceSnapshot, type FounderWeeklyReviewGenerationFailure, type FounderWeeklyReviewModelMetadata, type FounderWeeklyReviewOperationRecord, type FounderWeeklyReviewPayload, type FounderWeeklyReviewRetryInput, type FounderWeeklyReviewRunRecord } from "./contracts.js";
export interface ConditionalRunMutationResult {
    updated: boolean;
    run: FounderWeeklyReviewRunRecord | null;
}
export interface CreateFounderWeeklyReviewResult {
    run: FounderWeeklyReviewRunRecord;
    created: boolean;
}
export interface RetryFounderWeeklyReviewResult {
    outcome: "updated" | "idempotent" | "conflict" | "not_found";
    run: FounderWeeklyReviewRunRecord | null;
    operation: FounderWeeklyReviewOperationRecord | null;
}
export declare class FounderWeeklyReviewRepository {
    private readonly db;
    constructor(db?: DbClient);
    createOrGetByRequestKey(input: CreateFounderWeeklyReviewRunInput): Promise<FounderWeeklyReviewRunRecord>;
    createOrGetByRequestKeyWithResult(input: CreateFounderWeeklyReviewRunInput): Promise<CreateFounderWeeklyReviewResult>;
    getByCompanyAndRunId(companyId: bigint, runId: string): Promise<FounderWeeklyReviewRunRecord | null>;
    getByCompanyAndRequestKey(companyId: bigint, requestKey: string): Promise<FounderWeeklyReviewRunRecord | null>;
    listByCompany(companyId: bigint): Promise<FounderWeeklyReviewRunRecord[]>;
    updateDraftConditionally(companyId: bigint, runId: string, reviewPayload: FounderWeeklyReviewPayload): Promise<ConditionalRunMutationResult>;
    publishConditionally(companyId: bigint, runId: string): Promise<ConditionalRunMutationResult>;
    claimQueuedRun(input: FounderWeeklyReviewClaimInput): Promise<ConditionalRunMutationResult>;
    claimEvidenceCollection(input: FounderWeeklyReviewCollectionClaimInput): Promise<ConditionalRunMutationResult>;
    attachEvidenceSnapshotIfAbsent(input: FounderWeeklyReviewCollectionClaimInput, evidenceSnapshot: FounderWeeklyReviewEvidenceSnapshot): Promise<ConditionalRunMutationResult>;
    markCollectionFailed(input: FounderWeeklyReviewCollectionClaimInput, failure: FounderWeeklyReviewGenerationFailure): Promise<ConditionalRunMutationResult>;
    saveGeneratedDraftWithClaim(input: FounderWeeklyReviewClaimInput, reviewPayload: FounderWeeklyReviewPayload, modelMetadata: FounderWeeklyReviewModelMetadata | null): Promise<ConditionalRunMutationResult>;
    markGenerationFailedWithClaim(input: FounderWeeklyReviewClaimInput, failure: FounderWeeklyReviewGenerationFailure): Promise<ConditionalRunMutationResult>;
    markQueuedRunFailed(companyId: bigint, runId: string, failure: FounderWeeklyReviewGenerationFailure): Promise<ConditionalRunMutationResult>;
    retryFailedRun(input: FounderWeeklyReviewRetryInput): Promise<RetryFounderWeeklyReviewResult>;
    private getRunInsideTransaction;
}
//# sourceMappingURL=repository.d.ts.map