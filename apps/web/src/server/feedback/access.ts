import "server-only";

/**
 * Who triages feedback, and whether the feature is on at all.
 *
 * Triagers are the instance's operators, named by email in
 * `FEEDBACK_ADMIN_EMAILS` (comma, space or semicolon separated, matched
 * case-insensitively against the signed-in account's email). While nobody is
 * named the feature is off: a report nobody reads is worse than no button,
 * so `GET /api/feedback/me` says `enabled: false` and creating one is refused.
 *
 * The match is on the address alone, without `emailVerified`. This instance
 * has no mail transport, so no account here is ever verified (seeded users
 * included) and requiring it would make triage impossible. The cost: whoever
 * holds an account with a listed address is a triager, and password sign-up
 * does not prove the address. Sign-up refuses an address that already has an
 * account, so an operator should create their own account before listing it
 * — and once verification mail exists, this check should require it.
 *
 * Read per call (declared and validated in ~/env, like ~/server/public-origin)
 * so changing the list needs a restart at most, never a rebuild.
 */

import type { FeedbackAccess } from "~/lib/feedback/contract";

/** The listed addresses, lower-cased. Entries without an `@` are typos and are ignored. */
export function parseFeedbackAdminEmails(raw: string | undefined): ReadonlySet<string> {
    return new Set(
        (raw ?? "")
            .split(/[\s,;]+/)
            .map(entry => entry.trim().toLowerCase())
            .filter(entry => entry.length > 0 && entry.includes("@"))
    );
}

export function feedbackAdminEmails(): ReadonlySet<string> {
    return parseFeedbackAdminEmails(process.env.FEEDBACK_ADMIN_EMAILS);
}

/** On once at least one triager is named. */
export function feedbackEnabled(): boolean {
    return feedbackAdminEmails().size > 0;
}

export function isFeedbackTriager(email: string | null | undefined): boolean {
    const normalized = email?.trim().toLowerCase();
    if (!normalized) return false;
    return feedbackAdminEmails().has(normalized);
}

export function feedbackAccessFor(email: string | null | undefined): FeedbackAccess {
    const admins = feedbackAdminEmails();
    const normalized = email?.trim().toLowerCase() ?? "";
    return {
        enabled: admins.size > 0,
        triager: normalized.length > 0 && admins.has(normalized),
    };
}
