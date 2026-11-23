"use client";

import { useTranslations } from "next-intl";
import { VantageApiError } from "../api";

const messages = {
    required_context_incomplete: "requiredContext",
    source_access_denied: "sourceAccess",
    source_authority_changed: "sourceChanged",
    source_version_unavailable: "sourceVersion",
    required_context_audience: "companyAudience",
    candidate_not_admitted: "notAdmitted",
    candidate_admission_invalid: "notAdmitted",
    unjudged_candidate: "notAdmitted",
    review_failed_use_new_key: "notAdmitted",
    context_budget_exceeded: "contextCapacity",
    dynamic_context_budget_exceeded: "contextCapacity",
    retrieval_source_too_large: "sourceCapacity",
    source_context_too_long: "sourceCapacity",
    source_context_unavailable: "sourceUnavailable",
    active_review_changed: "activeChanged",
    review_concurrent_update: "activeChanged",
    stale_review: "staleReview",
    stale_context_policy: "staleContext",
    stale_context_preferences: "staleContext",
    partially_visible_configuration: "hiddenContext",
    scoped_evidence_disabled: "scopesDisabled",
    review_configuration_denied: "configurationDenied",
    review_mutation_denied: "mutationDenied",
    review_access_denied: "accessDenied",
    review_identity_invalid: "accessDenied",
    review_policy_forbidden: "configurationDenied",
    business_role_forbidden: "configurationDenied",
    weekly_review_disabled: "disabled",
    invalid_review_week: "invalidWeek",
    invalid_review_request: "invalidRequest",
    invalid_context_policy: "invalidContext",
    invalid_context_preferences: "invalidContext",
    invalid_business_role: "invalidRole",
    review_stream_incomplete: "interrupted",
    review_stream_invalid: "interrupted",
    review_unavailable: "unavailable",
    review_not_found: "notFound",
    review_not_accepted: "notFound",
    topic_not_found: "staleReview",
    idempotency_key_required: "invalidRequest",
    idempotency_conflict: "alreadyRequested",
    dispatch_uncertain: "uncertain",
    review_dispatch_uncertain: "uncertain",
    dispatch_uncertain_expired: "uncertain",
} as const;

export function weeklyReviewErrorCode(error: unknown): string {
    if (typeof error === "string") return error;
    if (error instanceof VantageApiError || error instanceof Error) return error.message;
    return "review_unavailable";
}

/** Keep server codes and untrusted diagnostic text out of the interface. */
export function useWeeklyReviewErrorText() {
    const t = useTranslations("vantage.weeklyReview.errors");
    return (error: unknown) => {
        const code = weeklyReviewErrorCode(error);
        const key = Object.prototype.hasOwnProperty.call(messages, code)
            ? messages[code as keyof typeof messages]
            : "unavailable";
        return t(key);
    };
}
