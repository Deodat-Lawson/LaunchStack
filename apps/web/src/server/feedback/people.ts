import "server-only";

/**
 * How the people on a report are named: the reporter (to triagers) and the
 * triagers who answered (to the reporter).
 *
 * The same chain every other name in the app resolves through
 * (`resolveProfile` in ~/lib/profile/resolve, which `workspaceLooks` and the
 * Settings "Set by" line use): the profile's display name, then the full
 * name. Feedback is instance-wide — a triager need not share a workspace with
 * the reporter — so no workspace's override applies. Someone with no product
 * profile yet (signed up, never finished onboarding) falls back to their
 * sign-in account's name, then the part of their email before the `@`.
 */

import { inArray } from "drizzle-orm";

import { firstFilled } from "~/lib/profile/resolve";
import { db } from "~/server/db";
import { authUser, users } from "~/server/db/schema";

export interface FeedbackPersonRecord {
    name: string;
    email: string;
}

/** Most distinct people any one response names (a page of triage, a long thread). */
const PEOPLE_MAX = 200;

export function emailLocalPart(email: string | null | undefined): string | null {
    return firstFilled(email?.split("@")[0]);
}

export function feedbackPersonName(input: {
    displayName?: string | null;
    profileName?: string | null;
    accountName?: string | null;
    email?: string | null;
}): string {
    return (
        firstFilled(input.displayName, input.profileName, input.accountName) ??
        emailLocalPart(input.email) ??
        ""
    );
}

/** Keyed by auth subject id. Unknown ids are absent. */
export async function feedbackPeople(
    authUserIds: Iterable<string | null | undefined>
): Promise<Map<string, FeedbackPersonRecord>> {
    const ids = [...new Set([...authUserIds].filter((id): id is string => Boolean(id)))].slice(
        0,
        PEOPLE_MAX
    );
    const out = new Map<string, FeedbackPersonRecord>();
    if (ids.length === 0) return out;

    const [profiles, accounts] = await Promise.all([
        db
            .select({
                authUserId: users.userId,
                name: users.name,
                email: users.email,
                displayName: users.displayName,
            })
            .from(users)
            .where(inArray(users.userId, ids)),
        db
            .select({ id: authUser.id, name: authUser.name, email: authUser.email })
            .from(authUser)
            .where(inArray(authUser.id, ids)),
    ]);
    const profileOf = new Map(profiles.map(row => [row.authUserId, row]));
    const accountOf = new Map(accounts.map(row => [row.id, row]));

    for (const id of ids) {
        const profile = profileOf.get(id);
        const account = accountOf.get(id);
        if (!profile && !account) continue;
        // The sign-in address is the account's own; the profile keeps a copy.
        const email = firstFilled(account?.email, profile?.email) ?? "";
        out.set(id, {
            name: feedbackPersonName({
                displayName: profile?.displayName,
                profileName: profile?.name,
                accountName: account?.name,
                email,
            }),
            email,
        });
    }
    return out;
}
