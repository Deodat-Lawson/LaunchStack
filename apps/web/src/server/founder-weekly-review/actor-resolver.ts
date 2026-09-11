import { and, eq } from "drizzle-orm";
// Identity is product-side since the engine/product split; the engine barrel
// no longer publishes it.
import { users, userCompanyMemberships } from "~/server/db/schema";
import { db } from "~/server/db";
import { getActiveCompanyId } from "~/lib/active-workspace";
import { normalizeRoleSlug } from "~/lib/authz/permissions";
import { resolvePermissionsForRole } from "~/lib/authz/resolve";

/**
 * Generating a review writes into the workspace, so it takes the same
 * permission as editing a document. Viewers and guests read; they do not
 * generate.
 */
const GENERATION_PERMISSION = "documents.edit" as const;

export class FounderWeeklyReviewAuthorizationError extends Error {
    readonly code = "forbidden";
    readonly status = 403;
}

export interface FounderWeeklyReviewActor {
    externalUserId: string;
    internalUserId: bigint;
    companyId: bigint;
    /** Membership role slug, normalised (`owner` | `admin` | `member` | custom). */
    role: string;
}

/**
 * This is intentionally stricter than the legacy active-workspace context:
 * a legacy users.role is never a substitute for an actual membership row.
 */
export class FounderWeeklyReviewActorResolver {
    async resolve(externalUserId: string): Promise<FounderWeeklyReviewActor> {
        const companyId = await getActiveCompanyId(externalUserId);
        if (companyId == null) throw new FounderWeeklyReviewAuthorizationError();
        const [user] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.userId, externalUserId))
            .limit(1);
        if (!user) throw new FounderWeeklyReviewAuthorizationError();
        const [membership] = await db
            .select({ role: userCompanyMemberships.role, status: userCompanyMemberships.status })
            .from(userCompanyMemberships)
            .where(
                and(
                    eq(userCompanyMemberships.userId, BigInt(user.id)),
                    eq(userCompanyMemberships.companyId, companyId)
                )
            )
            .limit(1);
        if (!membership || (membership.status ?? "active") !== "active") {
            throw new FounderWeeklyReviewAuthorizationError();
        }
        const permissions = await resolvePermissionsForRole(companyId, membership.role);
        if (!permissions.has(GENERATION_PERMISSION)) {
            throw new FounderWeeklyReviewAuthorizationError();
        }
        return {
            externalUserId,
            internalUserId: BigInt(user.id),
            companyId,
            role: normalizeRoleSlug(membership.role),
        };
    }
}

export const productionFounderWeeklyReviewActorResolver = new FounderWeeklyReviewActorResolver();
