import { type FounderWeeklyReviewEvidenceSnapshot, type FounderWeeklyReviewCollectionInput, type FounderWeeklyReviewPayload, type FounderWeeklyReviewRunRecord, type FounderWeeklyReviewUserActor } from "./contracts.js";
import { FounderWeeklyReviewRepository } from "./repository.js";
export interface CreateFounderWeeklyReviewRunRequest {
    requestKey: string;
    reportingPeriod: {
        start: string;
        end: string;
    };
    evidenceSnapshot?: FounderWeeklyReviewEvidenceSnapshot;
    collectionInput?: FounderWeeklyReviewCollectionInput;
}
export interface CreateFounderWeeklyReviewRunResult {
    run: FounderWeeklyReviewRunRecord;
    created: boolean;
}
export interface RetryFounderWeeklyReviewRunResult {
    run: FounderWeeklyReviewRunRecord;
    transitionApplied: boolean;
}
export declare class FounderWeeklyReviewUserService {
    private readonly repository;
    constructor(repository?: FounderWeeklyReviewRepository);
    createOrGetRun(actor: FounderWeeklyReviewUserActor, input: CreateFounderWeeklyReviewRunRequest): Promise<FounderWeeklyReviewRunRecord>;
    createOrGetRunWithMetadata(actor: FounderWeeklyReviewUserActor, input: CreateFounderWeeklyReviewRunRequest): Promise<CreateFounderWeeklyReviewRunResult>;
    getRun(actor: FounderWeeklyReviewUserActor, runId: string): Promise<FounderWeeklyReviewRunRecord>;
    listRuns(actor: FounderWeeklyReviewUserActor): Promise<FounderWeeklyReviewRunRecord[]>;
    retryFailedRun(actor: FounderWeeklyReviewUserActor, runId: string, requestKey: string): Promise<FounderWeeklyReviewRunRecord>;
    retryFailedRunWithMetadata(actor: FounderWeeklyReviewUserActor, runId: string, requestKey: string): Promise<RetryFounderWeeklyReviewRunResult>;
    updateDraft(actor: FounderWeeklyReviewUserActor, runId: string, reviewPayload: FounderWeeklyReviewPayload): Promise<FounderWeeklyReviewRunRecord>;
    publishDraft(actor: FounderWeeklyReviewUserActor, runId: string): Promise<FounderWeeklyReviewRunRecord>;
}
//# sourceMappingURL=user-service.d.ts.map