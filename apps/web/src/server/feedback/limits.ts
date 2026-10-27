import "server-only";

/**
 * Per-person budgets for the feedback writes (route × limit × signed-in
 * user, see ~/lib/rate-limiter). Generous for a person, tight for a script.
 */

import type { RateLimitConfig } from "~/lib/rate-limiter";

const FIFTEEN_MINUTES = 15 * 60 * 1000;

/** Filing reports: ten per fifteen minutes. */
export const FEEDBACK_CREATE_LIMIT: RateLimitConfig = {
    maxRequests: 10,
    windowMs: FIFTEEN_MINUTES,
};

/** Replies: thirty per fifteen minutes — a triager answering a backlog fits. */
export const FEEDBACK_REPLY_LIMIT: RateLimitConfig = {
    maxRequests: 30,
    windowMs: FIFTEEN_MINUTES,
};
