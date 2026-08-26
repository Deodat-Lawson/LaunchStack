import type {
    FounderWeeklyReviewEvidenceSnapshot,
    FounderWeeklyReviewV2Payload,
} from "./contracts.js";
export declare class FounderWeeklyReviewGenerationValidationError extends Error {
    readonly details: ReadonlyArray<FounderWeeklyReviewValidationDetail>;
    constructor(message: string, details?: ReadonlyArray<FounderWeeklyReviewValidationDetail>);
}
export interface FounderWeeklyReviewValidationDetail {
    code: string;
    section?: string;
    itemIndex?: number;
    sourceId?: string;
}
export declare function assertUniqueSnapshotSourceIds(
    evidenceSnapshot: FounderWeeklyReviewEvidenceSnapshot
): void;
export declare function validateFounderWeeklyReviewV2Citations(
    payload: FounderWeeklyReviewV2Payload,
    evidenceSnapshot: FounderWeeklyReviewEvidenceSnapshot
): FounderWeeklyReviewV2Payload;
//# sourceMappingURL=generation-validation.d.ts.map
