import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { company } from "@launchstack/store/schema";
import { users } from "~/server/db/schema";
import { createSuccessResponse, handleApiError } from "~/lib/api-utils";
import { requireClerkIdentity } from "~/lib/require-workspace-context";

/**
 * GET /api/signup/check-registration
 * Auth required – checks whether the current Clerk user already
 * has a record in the `users` table (i.e. is already registered
 * with a company).
 */
export async function GET() {
    try {
        const identity = await requireClerkIdentity();
        if (!identity.success) return identity.response;
        const clerkUserId = identity.data.clerkUserId;

        const [existingUser] = await db
            .select({
                id: users.id,
                role: users.role,
                companyId: users.companyId,
            })
            .from(users)
            .where(eq(users.userId, clerkUserId));

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
            role: existingUser.role,
            companyName: companyRecord?.name ?? "Unknown",
        });
    } catch (error: unknown) {
        console.error("Error checking registration:", error);
        return handleApiError(error);
    }
}
