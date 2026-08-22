import { and, eq } from "drizzle-orm";
// Identity is product-side since the engine/product split; the engine barrel
// no longer publishes it.
import { users, userCompanyMemberships } from "~/server/db/schema";
import { db } from "~/server/db";
import { getActiveCompanyId } from "~/lib/active-workspace";

const GENERATION_ROLES = new Set(["owner", "admin", "editor"]);

export class FounderWeeklyReviewAuthorizationError extends Error {
    readonly code = "forbidden";
    readonly status = 403;
}

export interface FounderWeeklyReviewActor {
    externalUserId: string;
    internalUserId: bigint;
    companyId: bigint;
    role: "owner" | "admin" | "editor";
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
            .select({ role: userCompanyMemberships.role })
            .from(userCompanyMemberships)
            .where(
                and(
                    eq(userCompanyMemberships.userId, BigInt(user.id)),
                    eq(userCompanyMemberships.companyId, companyId)
                )
            )
            .limit(1);
        if (!membership || !GENERATION_ROLES.has(membership.role)) {
            throw new FounderWeeklyReviewAuthorizationError();
        }
        return {
            externalUserId,
            internalUserId: BigInt(user.id),
            companyId,
            role: membership.role as FounderWeeklyReviewActor["role"],
        };
    }
}

export const productionFounderWeeklyReviewActorResolver = new FounderWeeklyReviewActorResolver();
