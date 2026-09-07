import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { company } from "@launchstack/store/schema";
import { users } from "~/server/db/schema";
import { createSuccessResponse, handleApiError } from "~/lib/api-utils";
import { requireAuthIdentity } from "~/lib/require-workspace-context";

/**
 * GET /api/signup/check-registration
 * Auth required – whether the signed-in user already has a `users` row, and
 * the name of their default workspace when they do. The membership row, not
 * the legacy `users.role`, says what they may do there.
 */
export async function GET() {
    try {
        const identity = await requireAuthIdentity();
        if (!identity.success) return identity.response;
        const authUserId = identity.data.authUserId;

        const [existingUser] = await db
            .select({
                id: users.id,
                companyId: users.companyId,
            })
            .from(users)
            .where(eq(users.userId, authUserId));

        if (!existingUser) {
            return createSuccessResponse({ registered: false });
        }

        // Fetch company name for context
        const [companyRecord] = await db
            .select({ name: company.name })
            .from(company)
            .where(eq(company.id, Number(existingUser.companyId)));

        return createSuccessResponse({
            registered: true,
            companyName: companyRecord?.name ?? "Unknown",
        });
    } catch (error: unknown) {
        console.error("Error checking registration:", error);
        return handleApiError(error);
    }
}
