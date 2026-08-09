export class FounderWeeklyReviewError extends Error {
    constructor(
        message: string,
        readonly code:
            | "not_found"
            | "forbidden"
            | "invalid_transition"
            | "conflict"
            | "invalid_payload"
            | "claim_ownership_mismatch"
    ) {
        super(message);
        this.name = new.target.name;
    }
}

export class FounderWeeklyReviewNotFoundError extends FounderWeeklyReviewError {
    constructor(runId: string) {
        super(`Founder weekly review run "${runId}" was not found.`, "not_found");
    }
}

export class FounderWeeklyReviewForbiddenError extends FounderWeeklyReviewError {
    constructor(message = "The active workspace role cannot mutate founder weekly reviews.") {
        super(message, "forbidden");
    }
}

export class FounderWeeklyReviewInvalidTransitionError extends FounderWeeklyReviewError {
    constructor(fromStatus: string, action: string) {
        super(
            `Cannot ${action} founder weekly review run from status "${fromStatus}".`,
            "invalid_transition"
        );
    }
}

export class FounderWeeklyReviewConflictError extends FounderWeeklyReviewError {
    constructor(message: string) {
        super(message, "conflict");
    }
}

export class FounderWeeklyReviewInvalidPayloadError extends FounderWeeklyReviewError {
    constructor(message: string) {
        super(message, "invalid_payload");
    }
}

export class FounderWeeklyReviewClaimOwnershipMismatchError extends FounderWeeklyReviewError {
    constructor(runId: string) {
        super(
            `Generation claim ownership mismatch for founder weekly review run "${runId}".`,
            "claim_ownership_mismatch"
        );
    }
}
