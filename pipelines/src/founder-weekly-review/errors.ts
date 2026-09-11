export type FounderWeeklyReviewErrorCode =
    | "not_found"
    | "forbidden"
    | "invalid_transition"
    | "conflict"
    | "invalid_payload"
    | "claim_ownership_mismatch";

/**
 * The HTTP meaning of each code, for the codes that have one.
 *
 * A code absent from this table has no defined client-facing status: it is an
 * internal condition, and the route contract reports it generically rather than
 * echoing its message. `claim_ownership_mismatch` is deliberately absent — it
 * means two workers raced for the same run, which is never a caller's fault and
 * never something a caller should be told about.
 */
const STATUS_BY_CODE: Partial<Record<FounderWeeklyReviewErrorCode, number>> = {
    not_found: 404,
    forbidden: 403,
    invalid_transition: 409,
    conflict: 409,
    invalid_payload: 400,
};

export class FounderWeeklyReviewError extends Error {
    /**
     * Present only for codes with a defined client-facing meaning. The shared
     * route contract matches errors structurally on `code` + `status`, so
     * leaving this undefined is what keeps an internal condition internal.
     */
    readonly status?: number;

    constructor(
        message: string,
        readonly code: FounderWeeklyReviewErrorCode
    ) {
        super(message);
        this.name = new.target.name;
        this.status = STATUS_BY_CODE[code];
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
