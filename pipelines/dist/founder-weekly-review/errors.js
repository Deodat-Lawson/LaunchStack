/**
 * The HTTP meaning of each code, for the codes that have one.
 *
 * A code absent from this table has no defined client-facing status: it is an
 * internal condition, and the route contract reports it generically rather than
 * echoing its message. `claim_ownership_mismatch` is deliberately absent — it
 * means two workers raced for the same run, which is never a caller's fault and
 * never something a caller should be told about.
 */
const STATUS_BY_CODE = {
    not_found: 404,
    forbidden: 403,
    invalid_transition: 409,
    conflict: 409,
    invalid_payload: 400,
};
export class FounderWeeklyReviewError extends Error {
    code;
    /**
     * Present only for codes with a defined client-facing meaning. The shared
     * route contract matches errors structurally on `code` + `status`, so
     * leaving this undefined is what keeps an internal condition internal.
     */
    status;
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = new.target.name;
        this.status = STATUS_BY_CODE[code];
    }
}
export class FounderWeeklyReviewNotFoundError extends FounderWeeklyReviewError {
    constructor(runId) {
        super(`Founder weekly review run "${runId}" was not found.`, "not_found");
    }
}
export class FounderWeeklyReviewForbiddenError extends FounderWeeklyReviewError {
    constructor(message = "The active workspace role cannot mutate founder weekly reviews.") {
        super(message, "forbidden");
    }
}
export class FounderWeeklyReviewInvalidTransitionError extends FounderWeeklyReviewError {
    constructor(fromStatus, action) {
        super(`Cannot ${action} founder weekly review run from status "${fromStatus}".`, "invalid_transition");
    }
}
export class FounderWeeklyReviewConflictError extends FounderWeeklyReviewError {
    constructor(message) {
        super(message, "conflict");
    }
}
export class FounderWeeklyReviewInvalidPayloadError extends FounderWeeklyReviewError {
    constructor(message) {
        super(message, "invalid_payload");
    }
}
export class FounderWeeklyReviewClaimOwnershipMismatchError extends FounderWeeklyReviewError {
    constructor(runId) {
        super(`Generation claim ownership mismatch for founder weekly review run "${runId}".`, "claim_ownership_mismatch");
    }
}
//# sourceMappingURL=errors.js.map