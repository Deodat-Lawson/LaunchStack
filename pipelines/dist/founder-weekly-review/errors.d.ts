export type FounderWeeklyReviewErrorCode = "not_found" | "forbidden" | "invalid_transition" | "conflict" | "invalid_payload" | "claim_ownership_mismatch";
export declare class FounderWeeklyReviewError extends Error {
    readonly code: FounderWeeklyReviewErrorCode;
    /**
     * Present only for codes with a defined client-facing meaning. The shared
     * route contract matches errors structurally on `code` + `status`, so
     * leaving this undefined is what keeps an internal condition internal.
     */
    readonly status?: number;
    constructor(message: string, code: FounderWeeklyReviewErrorCode);
}
export declare class FounderWeeklyReviewNotFoundError extends FounderWeeklyReviewError {
    constructor(runId: string);
}
export declare class FounderWeeklyReviewForbiddenError extends FounderWeeklyReviewError {
    constructor(message?: string);
}
export declare class FounderWeeklyReviewInvalidTransitionError extends FounderWeeklyReviewError {
    constructor(fromStatus: string, action: string);
}
export declare class FounderWeeklyReviewConflictError extends FounderWeeklyReviewError {
    constructor(message: string);
}
export declare class FounderWeeklyReviewInvalidPayloadError extends FounderWeeklyReviewError {
    constructor(message: string);
}
export declare class FounderWeeklyReviewClaimOwnershipMismatchError extends FounderWeeklyReviewError {
    constructor(runId: string);
}
//# sourceMappingURL=errors.d.ts.map